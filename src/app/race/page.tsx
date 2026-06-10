'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import type { GodModeAction, RaceResult, SimSpeed } from '@/lib/sim/types'
import { isOffSeason } from '@/lib/sim/types'
import { calendarForYear } from '@/data/calendars'
import { buildRaceResults } from '@/lib/sim/race-results'
import { actionGetDriverCareers } from '@/lib/news/actions'
import { foldLiveSeason, type DriverCareer } from '@/lib/news/engine'
import RaceTable from '@/components/race/RaceTable'
import GodModePanel from '@/components/race/GodModePanel'
import CommentaryFeed from '@/components/race/CommentaryFeed'
import { LiveChampionship } from '@/components/race/LiveChampionship'
import { RaceHeader } from '@/components/race/RaceHeader'
import { PreQualPanel } from '@/components/race/PreQualPanel'
import { PreRacePanel } from '@/components/race/PreRacePanel'
import { PostRacePanel } from '@/components/race/PostRacePanel'
import { SpeedBar } from '@/components/race/SpeedBar'
import { ConfirmModal } from '@/components/race/ConfirmModal'
import { QualifyingPanel } from '@/components/race/QualifyingPanel'
import { TrackMap } from '@/components/race/TrackMap'
import { UpgradeRevealModal } from '@/components/race/UpgradeRevealModal'
import { useQualifyingEngine } from '@/components/race/useQualifyingEngine'

// 1-4 are real-time tick intervals (slow -> fast); 5 (FF) = 0 = instant "sim to the end". Speed 1 is
// half the old slowest; 2/3/4 are the old 1/2/3.
const SPEED_INTERVALS: Record<SimSpeed, number> = { 1: 10000, 2: 5000, 3: 2000, 4: 500, 5: 0 }

export default function RacePage() {
  const router = useRouter()
  const season = useSeasonStore()
  const {
    raceState, drivers, teams, forms, godModeDriverId,
    loadFromSeason, updateDriverForm, setGodModeDriver,
    tickLap, setSpeed, setPaused,
  } = useRaceStore()

  const phase = raceState?.phase ?? 'pre-qualifying'
  const speed = raceState?.speed ?? 1
  const paused = raceState?.paused ?? false

  const qe = useQualifyingEngine(raceState, drivers, teams, season.constructorStandings, season.currentRound)

  const [pendingGodModeActions, setPendingGodModeActions] = useState<GodModeAction[]>([])
  const [showRaceFFModal, setShowRaceFFModal] = useState(false)
  const [showQualyFFModal, setShowQualyFFModal] = useState(false)
  const [ffConfirmed, setFFConfirmed] = useState(false)
  const hydrated = useHydrated()
  const [lapProgress, setLapProgress] = useState(0)
  // Team Manager: the pre-race upgrade reveal shows once per upgrade; dismissing latches this round.
  const [acknowledgedRound, setAcknowledgedRound] = useState<number | null>(null)

  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextTickAtRef = useRef<number>(0)
  const doTickRef = useRef<() => void>(() => {})
  // Once the race has finished, raceState going null means End Race fired and we're navigating to Home;
  // render nothing instead of flashing the (now-advanced) next round's pre-qualifying for a frame (#113).
  const endedRef = useRef(false)

  const currentCircuit = calendarForYear(season.year)[season.currentRound - 1]
  const gridDrivers = season.drivers.filter((d) => d.teamId !== '')

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

  const handleSpeedClick = (s: SimSpeed) => {
    if (s === 5) { setShowRaceFFModal(true); return }
    setFFConfirmed(false); setSpeed(s)
  }
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

  const doTick = useCallback(() => {
    const actions = pendingGodModeActions.length > 0 ? [...pendingGodModeActions] : undefined
    if (actions) setPendingGodModeActions([])
    tickLap(actions)
  }, [pendingGodModeActions, tickLap])

  useEffect(() => { doTickRef.current = doTick }, [doTick])

  useEffect(() => {
    if (phase !== 'racing' || paused || speed !== 5 || !ffConfirmed) return
    if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
    let cancelled = false
    const run = async () => {
      while (!cancelled) {
        const current = useRaceStore.getState().raceState
        if (!current || current.phase !== 'racing') break
        useRaceStore.getState().tickLap()
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    run()
    return () => { cancelled = true }
  }, [phase, paused, speed, ffConfirmed])

  useEffect(() => {
    if (phase !== 'racing' || speed === 5) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }
    if (paused) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }
    const ms = SPEED_INTERVALS[speed]
    const remaining = nextTickAtRef.current > Date.now() ? Math.min(nextTickAtRef.current - Date.now(), ms) : ms
    const schedule = (delay: number) => {
      nextTickAtRef.current = Date.now() + delay
      tickTimerRef.current = setTimeout(() => {
        doTickRef.current()
        const s = useRaceStore.getState().raceState
        if (s?.phase === 'racing' && !s.paused && s.speed !== 5) schedule(SPEED_INTERVALS[s.speed as SimSpeed])
      }, delay)
    }
    schedule(remaining)
    return () => { if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null } }
  }, [phase, paused, speed])

  useEffect(() => {
    if (phase !== 'racing' || paused || speed === 5) {
      setLapProgress(paused ? Math.max(0, Math.min(100, (1 - (nextTickAtRef.current - Date.now()) / SPEED_INTERVALS[speed]) * 100)) : 0)
      return
    }
    const timer = setInterval(() => {
      setLapProgress(Math.max(0, Math.min(100, (1 - (nextTickAtRef.current - Date.now()) / SPEED_INTERVALS[speed]) * 100)))
    }, 50)
    return () => clearInterval(timer)
  }, [phase, paused, speed])

  // Confirming FF runs it immediately (unpause), since the race/session starts paused.
  const confirmRaceFF = () => { setShowRaceFFModal(false); setFFConfirmed(true); setSpeed(5); setPaused(false) }
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

  return (
    <div className="h-full bg-[#0F1419] text-[#FFFFFF] flex flex-col overflow-hidden">
      <RaceHeader
        phase={phase} raceState={raceState} lapProgress={lapProgress}
        currentCircuit={currentCircuit}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
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
                drivers={drivers} teams={teams} states={raceState.drivers}
                currentLap={raceState.currentLap} totalLaps={raceState.totalLaps}
                gridPos={Object.fromEntries(raceState.qualifyingResults.map((q) => [q.driverId, q.gridPosition]))}
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
              <div className="h-[45%] min-h-0 flex border-b border-[#2A3142] overflow-hidden">
                <div className="w-1/2 min-h-0 p-4 border-r border-[#2A3142] flex flex-col overflow-hidden">
                  <CommentaryFeed entries={raceState?.commentary ?? []} />
                </div>
                <div className="w-1/2 min-h-0 p-4 flex flex-col overflow-hidden">
                  <LiveChampionship
                    states={raceState?.drivers ?? []}
                    drivers={drivers}
                    teams={teams}
                    baselineDrivers={season.driverStandings}
                    baselineConstructors={season.constructorStandings}
                    year={season.year}
                  />
                </div>
              </div>
              <div className="h-[55%] min-h-0 p-4 overflow-y-auto">
                {raceState && phase === 'racing' ? (
                  <GodModePanel
                    drivers={drivers} teams={teams} states={raceState.drivers}
                    raceState={raceState}
                    selectedDriverId={selectedDriverId ?? drivers[0]?.id ?? ''}
                    onAction={(actions) => setPendingGodModeActions((prev) => [...prev, ...actions])}
                  />
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
                      <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">{season.teamManagerMode ? 'Pit Wall' : 'God Mode'}</h2>
                    </div>
                    <p className="text-[#FFFFFF] text-sm">{season.teamManagerMode ? 'Pit strategy control opens when the race starts.' : 'Available during race.'}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {phase === 'racing' && raceState && (
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

      {showRaceFFModal && (
        <ConfirmModal
          title="Fast-forward to the end?"
          body="The rest of the race will be simulated instantly."
          confirmLabel="Fast-forward"
          onConfirm={confirmRaceFF}
          onCancel={() => setShowRaceFFModal(false)}
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
          onDismiss={() => setAcknowledgedRound(season.currentRound)}
        />
      )}
    </div>
  )
}
