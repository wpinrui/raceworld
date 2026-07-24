'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import type { GodModeAction, RaceResult, RaceState, SimSpeed } from '@/lib/sim/types'
import { isOffSeason } from '@/lib/sim/types'
import { calendarForYear } from '@/data/calendars'
import { buildRaceResults } from '@/lib/sim/race-results'
import { actionGetDriverCareers } from '@/lib/news/actions'
import { foldLiveSeason, type DriverCareer } from '@/lib/news/engine'
import RaceTable from '@/components/race/RaceTable'
import GodModePanel from '@/components/race/GodModePanel'
import PitWallPanel from '@/components/race/PitWallPanel'
import CommentaryFeed from '@/components/race/CommentaryFeed'
import { LiveChampionship } from '@/components/race/LiveChampionship'
import { RaceHeader } from '@/components/race/RaceHeader'
import { PreQualPanel } from '@/components/race/PreQualPanel'
import { PreRacePanel } from '@/components/race/PreRacePanel'
import { PostRacePanel } from '@/components/race/PostRacePanel'
import { SpeedBar } from '@/components/race/SpeedBar'
import { ConfirmModal } from '@/components/race/ConfirmModal'
import { StartingTyrePanel } from '@/components/race/StartingTyrePanel'
import { QualifyingPanel } from '@/components/race/QualifyingPanel'
import { TrackMap } from '@/components/race/TrackMap'
import { UpgradeRevealModal } from '@/components/race/UpgradeRevealModal'
import { useQualifyingEngine } from '@/components/race/useQualifyingEngine'
import { RaceDayView } from '@/components/race/RaceDayView'
import { useRaceMapSampler } from '@/components/race/useRaceMapSampler'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { SECTORS_PER_LAP } from '@/lib/sim/sector'

// Race playback multipliers (#sim-2d): 1x is REAL TIME — one tick animates the leader's just-resolved
// sector over its actual duration — and the rest divide it. The old instant fast-forward is gone; 25x
// is the ceiling.
const SPEED_MULTS: Record<SimSpeed, number> = { 1: 1, 2: 2, 3: 5, 4: 10, 5: 25 }
// The pre-race grid wait before lap 1 starts animating.
const GRID_HOLD_MS = 2000

export default function RacePage() {
  const router = useRouter()
  const season = useSeasonStore()
  const {
    raceState, drivers, teams, forms, godModeDriverId,
    loadFromSeason, updateDriverForm, setGodModeDriver,
    tickSector, setSpeed, setPaused,
  } = useRaceStore()

  const phase = raceState?.phase ?? 'pre-qualifying'
  const speed = raceState?.speed ?? 1
  const paused = raceState?.paused ?? false

  const qe = useQualifyingEngine(raceState, drivers, teams, season.constructorStandings, season.currentRound)

  const [pendingGodModeActions, setPendingGodModeActions] = useState<GodModeAction[]>([])
  const [showQualyFFModal, setShowQualyFFModal] = useState(false)
  const hydrated = useHydrated()
  const [lapProgress, setLapProgress] = useState(0)
  // Team Manager: the pre-race upgrade reveal shows once per upgrade; dismissing latches this round.
  const [acknowledgedRound, setAcknowledgedRound] = useState<number | null>(null)

  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextTickAtRef = useRef<number>(0)
  const tickIntervalRef = useRef<number>(GRID_HOLD_MS)
  const lapFracDoneRef = useRef(0)
  const doTickRef = useRef<() => void>(() => {})
  // Once the race has finished, raceState going null means End Race fired and we're navigating to Home;
  // render nothing instead of flashing the (now-advanced) next round's pre-qualifying for a frame (#113).
  const endedRef = useRef(false)

  const currentCircuit = calendarForYear(season.year)[season.currentRound - 1]
  const gridDrivers = season.drivers.filter((d) => d.teamId !== '')

  // The 2D race-day view runs wherever the circuit has an authored track layout; others keep the
  // classic screen until their traces are imported (#sim-2d).
  const trackLayout = currentCircuit ? TRACK_LAYOUTS[currentCircuit.id] : undefined
  const gridPosMap = useMemo(
    () => Object.fromEntries((raceState?.qualifyingResults ?? []).map((q) => [q.driverId, q.gridPosition])),
    [raceState?.qualifyingResults],
  )
  const mapSampleRef = useRaceMapSampler(gridPosMap, nextTickAtRef, tickIntervalRef, raceState?.paused ?? false)

  // Driver hover card data: career totals (through last season, folded with this season's results) + this
  // year's WDC standing, so a name in the race table opens the same expanded card used around the app.
  const [careers, setCareers] = useState<Record<string, DriverCareer>>({})
  useEffect(() => {
    actionGetDriverCareers(season.year - 1)
      .then((base) => setCareers(foldLiveSeason(base, season.year, season.raceResults, season.endOfSeasonSummary?.driverChampion)))
      .catch(() => setCareers({}))
  }, [season.year, season.raceResults, season.endOfSeasonSummary])
  const wdcPosOf = useMemo(() => new Map(season.driverStandings.map((s, i) => [s.driverId, i + 1])), [season.driverStandings])
  const wdcPtsOf = useMemo(() => new Map(season.driverStandings.map((s) => [s.driverId, s.points])), [season.driverStandings])

  useEffect(() => {
    if (season.phase === 'idle') { router.replace('/setup'); return }
    if (isOffSeason(season.phase)) { router.replace('/home'); return }
    if (!raceState && currentCircuit) loadFromSeason(gridDrivers, season.teams, currentCircuit)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (phase === 'finished') endedRef.current = true }, [phase])

  const handleSpeedClick = (s: SimSpeed) => setSpeed(s)
  // Qualifying FF (speed 5) skips the rest of the session instantly — confirm first, like the race FF.
  const handleQualySpeedClick = (s: SimSpeed) => {
    if (s === 5) { setShowQualyFFModal(true); return }
    setSpeed(s)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === ' ' && (phase === 'racing' || phase === 'finished' || phase === 'qualifying')) { e.preventDefault(); setPaused(!paused) }
      if (phase === 'racing') {
        if (e.key === '1') handleSpeedClick(1)
        if (e.key === '2') handleSpeedClick(2)
        if (e.key === '3') handleSpeedClick(3)
        if (e.key === '4') handleSpeedClick(4)
        if (e.key === '5') handleSpeedClick(5)
      }
      if (phase === 'qualifying') {
        // Keys map to the animated speeds 1-4 (2x..16x); FF (skip) is button-only, behind its confirm.
        if (e.key === '1') setSpeed(1)
        if (e.key === '2') setSpeed(2)
        if (e.key === '3') setSpeed(3)
        if (e.key === '4') setSpeed(4)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused])

  // The 2D view animates the SECTOR the sim just resolved (#sector-engine), so everything the player
  // reads (board, gaps, stops, commentary, championship) must show the state from the start of that
  // slice and flip forward as the cars reach it — broadcast-style, now at most 1/8 lap stale. The
  // pre-tick snapshot is that display state; the sim itself stays one sector ahead internally.
  const [displayState, setDisplayState] = useState<RaceState | null>(null)

  const doTick = useCallback(() => {
    setDisplayState(useRaceStore.getState().raceState)
    const actions = pendingGodModeActions.length > 0 ? [...pendingGodModeActions] : undefined
    if (actions) setPendingGodModeActions([])
    tickSector(actions)
  }, [pendingGodModeActions, tickSector])

  useEffect(() => { doTickRef.current = doTick }, [doTick])

  // Tick scheduler: each interval animates the leader's JUST-COMPLETED sector, so its duration is
  // that slice's real time divided by the speed multiplier (1x = real time). The first interval (no
  // slice yet) is a short grid hold before lights out.
  useEffect(() => {
    if (phase !== 'racing' || paused) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }
    const nextMs = () => {
      const s = useRaceStore.getState().raceState
      if (!s) return GRID_HOLD_MS
      const running = s.drivers.filter((d) => !d.retired)
      const leader = running.reduce((a, b) => (a.totalTime <= b.totalTime ? a : b), running[0])
      const last = leader?.sectorTimes?.[leader.sectorTimes.length - 1]
        ?? (leader?.lapTimes[leader.lapTimes.length - 1] ?? NaN) / SECTORS_PER_LAP
      const ms = last ? (last * 1000) / (SPEED_MULTS[s.speed as SimSpeed] ?? 1) : GRID_HOLD_MS
      // NaN is sticky through the clock refs (it survives clamps), so never let one out of here.
      return Number.isFinite(ms) && ms > 0 ? ms : GRID_HOLD_MS
    }
    // `fullMs` is the whole slice's animation window (what the sampler divides by); `delay` is the
    // part still to play. Keeping them separate lets a speed change resume mid-slice instead of
    // restarting it.
    const schedule = (fullMs: number, delay: number) => {
      tickIntervalRef.current = fullMs
      nextTickAtRef.current = Date.now() + delay
      tickTimerRef.current = setTimeout(() => {
        doTickRef.current()
        lapFracDoneRef.current = 0
        const s = useRaceStore.getState().raceState
        if (s?.phase === 'racing' && !s.paused) {
          const m = nextMs()
          schedule(m, m)
        }
      }, delay)
    }
    const ms = nextMs()
    if (!Number.isFinite(lapFracDoneRef.current)) lapFracDoneRef.current = 0
    schedule(ms, (1 - lapFracDoneRef.current) * ms)
    return () => {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      // Remember how far through the lap we were, for the next run (speed change or unpause).
      const done = 1 - (nextTickAtRef.current - Date.now()) / tickIntervalRef.current
      lapFracDoneRef.current = Number.isFinite(done) ? Math.min(1, Math.max(0, done)) : 0
    }
  }, [phase, paused, speed])

  // Whole-lap progress for the classic header bar: the tick window is one SECTOR, so fold the
  // fraction-through-window into the sector being animated ((currentSector − 1) mod 8 — the sim sits
  // one slice ahead of the animation). Before any slice has resolved the bar just sits at zero.
  useEffect(() => {
    const lapFrac = () => {
      const s = useRaceStore.getState().raceState
      const started = s?.drivers.some((d) => (d.sectorTimes?.length ?? 0) > 0 || d.lapTimes.length > 0)
      if (!s || !started) return 0
      const tickFrac = Math.max(0, Math.min(1, 1 - (nextTickAtRef.current - Date.now()) / tickIntervalRef.current))
      const sec = ((s.currentSector ?? 0) - 1 + SECTORS_PER_LAP) % SECTORS_PER_LAP
      return Math.max(0, Math.min(100, ((sec + tickFrac) / SECTORS_PER_LAP) * 100))
    }
    if (phase !== 'racing' || paused) {
      setLapProgress(paused ? lapFrac() : 0)
      return
    }
    const timer = setInterval(() => setLapProgress(lapFrac()), 50)
    return () => clearInterval(timer)
  }, [phase, paused, speed])

  const confirmQualyFF = () => { setShowQualyFFModal(false); setSpeed(5); setPaused(false) }

  function computeResults(): RaceResult[] {
    if (!raceState) return []
    return buildRaceResults(raceState, drivers, teams, season.year)
  }

  if (!hydrated) return null
  // Race over and mid-navigation to Home: render nothing instead of flashing round N+1. The re-render here is
  // driven by raceState going null (reactive); endedRef is just a latch read at that render, so this is safe.
  // eslint-disable-next-line react-hooks/refs
  if (!raceState && endedRef.current) return null

  const resultsForDisplay = phase === 'finished' ? computeResults() : []
  const selectedDriverId = godModeDriverId

  // Team Manager: the player's upgrade for this round was delivered when the weekend began (advanceRound),
  // recorded in allUpgradeEvents. Reveal it once per round, as early as the Friday (pre-qualifying) screen.
  const deliveredUpgrade = season.teamManagerMode
    ? season.allUpgradeEvents.find((e) => e.round === season.currentRound && e.teamId === season.playerTeamId)
    : undefined
  const showUpgradeReveal =
    !!deliveredUpgrade &&
    phase !== 'racing' &&
    phase !== 'finished' &&
    acknowledgedRound !== season.currentRound

  const useNewView = !!trackLayout && !!raceState && (phase === 'racing' || phase === 'finished')

  // What the player READS during racing: the pre-tick snapshot, in lockstep with the animated lap.
  // Falls back to the live state at the lights, after the flag, and across a restart (lap regression).
  const shownRace =
    phase === 'racing' && displayState && raceState && displayState.currentLap <= raceState.currentLap
      ? displayState
      : raceState

  return (
    <div className="h-full bg-[#0F1419] text-[#FFFFFF] flex flex-col overflow-hidden">
      {!useNewView && (
        <RaceHeader
          phase={phase} raceState={shownRace} lapProgress={lapProgress}
          currentCircuit={currentCircuit}
        />
      )}

      {useNewView && raceState && trackLayout && currentCircuit && (
        <RaceDayView
          raceState={shownRace!}
          phase={phase as 'racing' | 'finished'}
          layout={trackLayout}
          circuit={currentCircuit}
          drivers={drivers}
          teams={teams}
          speed={speed}
          paused={paused}
          onSpeedClick={handleSpeedClick}
          onTogglePause={() => setPaused(!paused)}
          sampleRef={mapSampleRef}
          results={resultsForDisplay}
          baselineDrivers={season.driverStandings}
          baselineConstructors={season.constructorStandings}
          year={season.year}
          driverMode={season.driverMode}
          teamManagerMode={season.teamManagerMode}
          playerDriverId={season.playerDriverId ?? null}
          playerTeamId={season.playerTeamId ?? null}
          godSelectedId={godModeDriverId}
          onGodSelect={setGodModeDriver}
          onGodActions={(actions) => setPendingGodModeActions((prev) => [...prev, ...actions])}
          onRetire={(driverId) => setPendingGodModeActions((prev) => [...prev, { type: 'force-retire', driverId }])}
        />
      )}

      {!useNewView && <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left 60% */}
        <div className="w-[60%] border-r border-[#2A3142] flex flex-col min-h-0 overflow-hidden">
          {phase === 'pre-qualifying' && (
            <PreQualPanel
              drivers={drivers} teams={teams} forms={forms}
              currentCircuit={currentCircuit}
              onFormChange={updateDriverForm}
            />
          )}
          {phase === 'qualifying' && raceState && (
            <QualifyingPanel
              rows={qe.rows} sessionName={qe.sessionName} cutSize={qe.cutSize} dropFrom={qe.dropFrom}
              progress={qe.progress} showElim={qe.showElim} eliminated={qe.eliminated} closeElim={qe.closeElim}
              drivers={drivers} teams={teams} currentCircuit={currentCircuit}
            />
          )}
          {phase === 'pre-race' && raceState && (
            <PreRacePanel
              raceState={raceState} drivers={drivers} teams={teams}
              currentCircuit={currentCircuit}
            />
          )}
          {(phase === 'racing' || phase === 'finished') && raceState && (
            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2">
              <RaceTable
                drivers={drivers} teams={teams} states={shownRace!.drivers}
                currentLap={shownRace!.currentLap} totalLaps={shownRace!.totalLaps}
                gridPos={Object.fromEntries(shownRace!.qualifyingResults.map((q) => [q.driverId, q.gridPosition]))}
                year={season.year} careers={careers} wdcPosOf={wdcPosOf} wdcPtsOf={wdcPtsOf}
                selectedDriverId={selectedDriverId}
                onSelectDriver={setGodModeDriver}
              />
            </div>
          )}
        </div>

        {/* Right 40% */}
        <div className="w-[40%] flex flex-col min-h-0 overflow-hidden">
          {phase === 'finished' ? (
            <PostRacePanel results={resultsForDisplay} teams={teams} />
          ) : phase === 'qualifying' ? (
            <TrackMap clockRef={qe.clockRef} schedule={qe.schedule} rows={qe.rows} drivers={drivers} teams={teams} />
          ) : (
            <>
              <div className="h-1/3 min-h-0 flex border-b border-[#2A3142] overflow-hidden">
                <div className="w-1/2 min-h-0 p-4 border-r border-[#2A3142] flex flex-col overflow-hidden">
                  <CommentaryFeed entries={shownRace?.commentary ?? []} />
                </div>
                <div className="w-1/2 min-h-0 p-4 flex flex-col overflow-hidden">
                  <LiveChampionship
                    states={shownRace?.drivers ?? []}
                    drivers={drivers}
                    teams={teams}
                    baselineDrivers={season.driverStandings}
                    baselineConstructors={season.constructorStandings}
                    year={season.year}
                  />
                </div>
              </div>
              <div className="h-2/3 min-h-0 p-4 overflow-y-auto">
                {raceState && phase === 'racing' ? (
                  season.teamManagerMode || season.driverMode ? (
                    <PitWallPanel
                      drivers={drivers} teams={teams} states={shownRace!.drivers}
                      raceState={shownRace!}
                      onRetire={(driverId) => setPendingGodModeActions((prev) => [...prev, { type: 'force-retire', driverId }])}
                    />
                  ) : (
                    <GodModePanel
                      drivers={drivers} teams={teams} states={shownRace!.drivers}
                      raceState={shownRace!}
                      selectedDriverId={selectedDriverId ?? drivers[0]?.id ?? ''}
                      onAction={(actions) => setPendingGodModeActions((prev) => [...prev, ...actions])}
                    />
                  )
                ) : raceState && phase === 'pre-race' && (season.teamManagerMode || season.driverMode) ? (
                  <StartingTyrePanel />
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
                      <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">{season.teamManagerMode || season.driverMode ? 'Pit Wall' : 'God Mode'}</h2>
                    </div>
                    <p className="text-[#FFFFFF] text-sm">{season.teamManagerMode || season.driverMode ? 'Pit strategy control opens when the race starts.' : 'Available during race.'}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>}

      {!useNewView && phase === 'racing' && raceState && (
        <SpeedBar
          speed={speed} paused={paused}
          onSpeedClick={handleSpeedClick}
          onTogglePause={() => setPaused(!paused)}
        />
      )}

      {phase === 'qualifying' && raceState && (
        <SpeedBar
          speed={speed} paused={paused}
          onSpeedClick={handleQualySpeedClick}
          onTogglePause={() => setPaused(!paused)}
        />
      )}

      {showQualyFFModal && (
        <ConfirmModal
          title="Fast-forward qualifying?"
          body="The rest of this session will be simulated instantly."
          confirmLabel="Fast-forward"
          onConfirm={confirmQualyFF}
          onCancel={() => setShowQualyFFModal(false)}
        />
      )}

      {showUpgradeReveal && deliveredUpgrade && (
        <UpgradeRevealModal
          paceDelta={deliveredUpgrade.paceDelta}
          failed={deliveredUpgrade.failed}
          packageName={deliveredUpgrade.packageName}
          onDismiss={() => setAcknowledgedRound(season.currentRound)}
        />
      )}
    </div>
  )
}
