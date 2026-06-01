'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import type { GodModeAction, RaceResult, SimSpeed } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'
import { getPoints } from '@/lib/sim/points'
import { actionCreateSeason, actionFlushRaceResult } from '@/lib/db/actions'
import RaceTable from '@/components/race/RaceTable'
import GodModePanel from '@/components/race/GodModePanel'
import CommentaryFeed from '@/components/race/CommentaryFeed'

const SPEED_INTERVALS: Record<SimSpeed, number> = { 1: 5000, 2: 2000, 3: 500, 4: 0 }

function formatQualTime(t: number | null): string {
  if (t === null) return '--'
  const mins = Math.floor(t / 60)
  const secs = (t % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

export default function RacePage() {
  const router = useRouter()
  const season = useSeasonStore()
  const {
    raceState, drivers, teams, forms, strategyNoise, godModeDriverId,
    loadFromSeason, updateDriverForm, setStrategyNoise, setGodModeDriver,
    initSession, tickLap, setSpeed, setPaused, resetSession,
  } = useRaceStore()

  const phase = raceState?.phase ?? 'pre-qualifying'
  const speed = raceState?.speed ?? 1
  const paused = raceState?.paused ?? false

  const [pendingGodModeActions, setPendingGodModeActions] = useState<GodModeAction[]>([])
  const selectedDriverId = godModeDriverId
  const [showSpeed4Modal, setShowSpeed4Modal] = useState(false)
  const [speed4Confirmed, setSpeed4Confirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [showRestartConfirm, setShowRestartConfirm] = useState(false)
  const [lapProgress, setLapProgress] = useState(0)

  // Timing refs for pause-resume accuracy
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextTickAtRef = useRef<number>(0)  // absolute timestamp of next scheduled tick
  const doTickRef = useRef<() => void>(() => {})

  const currentCircuit = calendar2026[season.currentRound - 1]
  const isSeasonActive = season.phase !== 'idle'

  // On mount: redirect if no season, or load from season into race store
  useEffect(() => {
    setHydrated(true)
    if (season.phase === 'idle') {
      router.replace('/setup')
      return
    }
    if (season.phase === 'end-of-season') {
      router.replace('/standings')
      return
    }
    if (!raceState && currentCircuit) {
      loadFromSeason(season.drivers, season.teams, currentCircuit.id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === ' ' && (phase === 'racing' || phase === 'finished')) {
        e.preventDefault()
        setPaused(!paused)
      }
      if (phase === 'racing' || phase === 'pre-race') {
        if (e.key === '1') handleSpeedClick(1)
        if (e.key === '2') handleSpeedClick(2)
        if (e.key === '3') handleSpeedClick(3)
        if (e.key === '4') handleSpeedClick(4)
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

  // Keep a stable ref so the recursive setTimeout can always call the latest doTick
  useEffect(() => { doTickRef.current = doTick }, [doTick])

  // Speed 4 loop
  useEffect(() => {
    if (phase !== 'racing' || paused || speed !== 4 || !speed4Confirmed) return
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
  }, [phase, paused, speed, speed4Confirmed])

  // Speeds 1-3: recursive setTimeout so pause/resume preserves remaining delay
  useEffect(() => {
    if (phase !== 'racing' || speed === 4) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }
    if (paused) {
      // Just clear; nextTickAtRef already holds when the next tick was due
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }

    const ms = SPEED_INTERVALS[speed]
    // Resume from remaining time if we have a future tick scheduled, otherwise fresh interval
    const remaining = nextTickAtRef.current > Date.now()
      ? Math.min(nextTickAtRef.current - Date.now(), ms)
      : ms

    const schedule = (delay: number) => {
      nextTickAtRef.current = Date.now() + delay
      tickTimerRef.current = setTimeout(() => {
        doTickRef.current()
        const s = useRaceStore.getState().raceState
        if (s?.phase === 'racing' && !s.paused && s.speed !== 4) {
          schedule(SPEED_INTERVALS[s.speed as SimSpeed])
        }
      }, delay)
    }

    schedule(remaining)
    return () => { if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null } }
  }, [phase, paused, speed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Progress bar animation (50ms ticks)
  useEffect(() => {
    if (phase !== 'racing' || paused || speed === 4) {
      setLapProgress(paused ? Math.max(0, Math.min(100,
        (1 - (nextTickAtRef.current - Date.now()) / SPEED_INTERVALS[speed]) * 100
      )) : 0)
      return
    }
    const timer = setInterval(() => {
      const ms = SPEED_INTERVALS[speed]
      const remaining = nextTickAtRef.current - Date.now()
      setLapProgress(Math.max(0, Math.min(100, (1 - remaining / ms) * 100)))
    }, 50)
    return () => clearInterval(timer)
  }, [phase, paused, speed])

  const handleSpeedClick = (s: SimSpeed) => {
    if (s === 4) { setShowSpeed4Modal(true); return }
    setSpeed4Confirmed(false)
    setSpeed(s)
  }

  const confirmSpeed4 = () => {
    setShowSpeed4Modal(false)
    setSpeed4Confirmed(true)
    setSpeed(4)
  }

  const handleGodModeAction = (actions: GodModeAction[]) => {
    setPendingGodModeActions((prev) => [...prev, ...actions])
  }

  const handleStartRace = () => {
    if (!raceState) return
    useRaceStore.setState({ raceState: { ...raceState, phase: 'racing' } })
  }

  // Compute race results from finished raceState
  function computeResults(): RaceResult[] {
    if (!raceState) return []
    return raceState.drivers
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((ds) => {
        const driver = drivers.find((d) => d.id === ds.driverId)
        const team = driver ? teams.find((t) => t.id === driver.teamId) : undefined
        const qr = raceState.qualifyingResults.find((q) => q.driverId === ds.driverId)
        const finishPos = ds.retired ? null : ds.position
        return {
          driverId: ds.driverId,
          driverName: driver?.name ?? ds.driverId,
          teamId: driver?.teamId ?? '',
          teamName: team?.name ?? '',
          gridPosition: qr?.gridPosition ?? 0,
          finishPosition: finishPos,
          points: getPoints(finishPos),
          lapsCompleted: ds.lapTimes.length,
          totalTime: ds.retired ? null : ds.totalTime,
          dnf: ds.retired,
          stints: ds.stintHistory,
          q1Time: qr?.q1Time ?? null,
          q2Time: qr?.q2Time ?? null,
          q3Time: qr?.q3Time ?? null,
        } satisfies RaceResult
      })
  }

  async function handleSaveAndContinue() {
    if (saving || !currentCircuit) return
    setSaving(true)

    const results = computeResults()
    season.recordRaceResult(results)

    // Ensure season exists in DB; create it on first race
    let dbSeasonId = season.dbSeasonId
    if (!dbSeasonId) {
      dbSeasonId = await actionCreateSeason(season.year)
      season.setDbSeasonId(dbSeasonId)
    }

    await actionFlushRaceResult(
      dbSeasonId,
      season.currentRound,
      currentCircuit.id,
      currentCircuit.name,
      results,
    )

    const isLastRound = season.currentRound >= calendar2026.length

    if (isLastRound) {
      season.endSeason()
      router.push('/standings')
    } else {
      season.advanceRound()
      const nextCircuit = calendar2026[season.currentRound] // currentRound hasn't incremented yet in store
      resetSession(season.drivers, season.teams, nextCircuit?.id ?? currentCircuit.id)
      setSaving(false)
    }
  }

  const resultsForDisplay = phase === 'finished' ? computeResults() : []

  if (!hydrated) return null

  return (
    <div className="h-full bg-[#0F1419] text-[#E8EAED] flex flex-col overflow-hidden">

      {/* Race header bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-2 bg-[#1E2431] border-b border-[#2A3142]">
        <div className="flex items-center gap-3">
          {(phase === 'racing' || phase === 'finished') && raceState ? (
            <>
              <div className="relative overflow-hidden rounded px-3 py-1 bg-[#2A3142]">
                <div
                  className="absolute inset-y-0 left-0 bg-[#00D9FF]/20"
                  style={{ width: `${phase === 'racing' ? lapProgress : 100}%` }}
                />
                <span className="relative font-display text-sm tracking-widest uppercase text-[#E8EAED]">
                  Lap {Math.max(1, raceState.currentLap - 1)}/{raceState.totalLaps}
                </span>
              </div>
              <span className="text-[#FFFFFF] text-sm">{currentCircuit?.name}</span>
              {phase === 'finished' && (
                <span className="font-semibold text-xs tracking-wider text-[#00D9FF] uppercase animate-pulse ml-1">
                  Finished
                </span>
              )}
            </>
          ) : (
            <span className="text-[#FFFFFF] text-sm">
              {currentCircuit?.name ?? '—'}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowRestartConfirm(true)}
          className="text-xs text-[#FFFFFF] hover:text-[#DC143C] tracking-wider uppercase transition-colors cursor-pointer"
        >
          Restart Weekend
        </button>
      </div>

      {/* Main — fills remaining height */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel 60% */}
        <div className="w-[60%] border-r border-[#2A3142] flex flex-col min-h-0 overflow-hidden">

          {/* Pre-qualifying: season context + driver forms */}
          {phase === 'pre-qualifying' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="shrink-0 flex items-end gap-4 px-6 pt-5 pb-4 border-b border-[#2A3142]">
                <div className="flex-1">
                  <p className="text-xs text-[#FFFFFF] uppercase tracking-wider mb-1">Race Weekend</p>
                  <h2 className="font-display text-xl tracking-wider uppercase text-[#E8EAED]">
                    {currentCircuit?.name ?? '—'}
                  </h2>
                  <p className="text-sm text-[#FFFFFF] mt-0.5">
                    {currentCircuit?.location} · {currentCircuit?.laps} laps
                  </p>
                </div>
                <div className="shrink-0">
                  <label className="block text-xs font-bold tracking-wider text-[#FFFFFF] uppercase mb-2">
                    Strategy Noise <span className="text-[#00D9FF]">{Math.round(strategyNoise * 100)}%</span>
                  </label>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={strategyNoise}
                    onChange={(e) => setStrategyNoise(Number(e.target.value))}
                    className="w-32 accent-[#00D9FF]"
                  />
                </div>
                <button
                  onClick={initSession}
                  className="px-6 py-2.5 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors shrink-0"
                >
                  Begin Race Weekend
                </button>
              </div>

              {/* Driver form editors */}
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="px-6 py-3">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
                    <h2 className="font-semibold text-sm tracking-widest text-[#E8EAED] uppercase">Driver Forms</h2>
                    <span className="text-xs text-[#FFFFFF]">(randomised — edit before qualifying)</span>
                  </div>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
                        <th className="text-left py-1 pr-2">Driver</th>
                        <th className="text-center py-1 px-2 w-36">Form</th>
                        <th className="text-center py-1 px-2 w-16">Car</th>
                        <th className="text-center py-1 px-2 w-16">Pace</th>
                        <th className="text-center py-1 px-2 w-16">Wet</th>
                        <th className="text-center py-1 px-2 w-16">Ovt</th>
                        <th className="text-center py-1 px-2 w-16">Smt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((d) => {
                        const team = teams.find((t) => t.id === d.teamId)
                        const form = forms[d.id] ?? 5
                        return (
                          <tr key={d.id} className="border-b border-[#1a2030] hover:bg-[#1E2431] transition-colors">
                            <td className="py-1 pr-2">
                              <div className="flex items-center gap-2">
                                <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: team?.color }} />
                                <span className="text-sm font-medium text-[#E8EAED]">{d.name}</span>
                                <span className="text-xs text-[#FFFFFF]">{team?.shortName}</span>
                              </div>
                            </td>
                            <td className="py-1 px-2">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="range" min={0} max={10} step={0.5}
                                  value={form}
                                  onChange={(e) => updateDriverForm(d.id, Number(e.target.value))}
                                  className="w-20 accent-[#00D9FF]"
                                />
                                <span className={`text-xs w-6 text-right ${form > 5 ? 'text-[#10B981]' : form < 5 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}`}>
                                  {form.toFixed(1)}
                                </span>
                              </div>
                            </td>
                            <td className="py-1 px-2 text-center text-sm font-semibold text-[#FFFFFF]">
                              {team?.carPace ?? '—'}
                            </td>
                            {(['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const).map((stat) => (
                              <td key={stat} className="py-1 px-2 text-center text-sm font-semibold text-[#E8EAED]">
                                {d[stat]}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Qualifying in progress */}
          {phase === 'qualifying' && (
            <div className="flex items-center justify-center h-full">
              <p className="text-[#FFFFFF] text-xl tracking-widest uppercase animate-pulse">
                Qualifying in progress...
              </p>
            </div>
          )}

          {/* Pre-race: qualifying results */}
          {phase === 'pre-race' && raceState && (
            <div className="flex flex-col h-full min-h-0">
              <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#2A3142]">
                <h2 className="font-display text-lg tracking-widest uppercase text-[#E8EAED]">
                  Qualifying — {currentCircuit?.name}
                </h2>
                <button
                  onClick={handleStartRace}
                  className="px-6 py-2.5 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors"
                >
                  Start Race
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
                      <th className="text-left py-1 px-2 w-10">Pos</th>
                      <th className="text-left py-1 px-2">Driver</th>
                      <th className="text-left py-1 px-2">Team</th>
                      <th className="text-right py-1 px-2">Q1</th>
                      <th className="text-right py-1 px-2">Q2</th>
                      <th className="text-right py-1 px-2">Q3</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceState.qualifyingResults.map((qr) => {
                      const driver = drivers.find((d) => d.id === qr.driverId)
                      const team = driver ? teams.find((t) => t.id === driver.teamId) : undefined
                      return (
                        <tr key={qr.driverId} className="border-b border-[#1E2431] text-[#E8EAED] hover:bg-[#2A3142] transition-colors">
                          <td className="py-1 px-2 font-bold">{qr.gridPosition}</td>
                          <td className="py-1 px-2">
                            <div className="flex items-center gap-2.5">
                              {team && <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                              <span>{driver?.name ?? qr.driverId}</span>
                            </div>
                          </td>
                          <td className="py-1 px-2 text-sm text-[#FFFFFF]">{team?.shortName ?? '---'}</td>
                          <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{formatQualTime(qr.q1Time)}</td>
                          <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{formatQualTime(qr.q2Time)}</td>
                          <td className="py-1 px-2 text-right font-mono text-sm font-bold">{formatQualTime(qr.q3Time)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Racing / finished */}
          {(phase === 'racing' || phase === 'finished') && raceState && (
            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2">
              <RaceTable
                drivers={drivers} teams={teams}
                states={raceState.drivers}
                currentLap={raceState.currentLap}
                totalLaps={raceState.totalLaps}
                phase={phase}
                selectedDriverId={selectedDriverId}
                onSelectDriver={setGodModeDriver}
              />
            </div>
          )}
        </div>

        {/* Right panel 40% */}
        <div className="w-[40%] flex flex-col min-h-0 overflow-hidden">

          {/* Post-race results summary */}
          {phase === 'finished' ? (
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-6 bg-[#00D9FF] rounded-sm" />
                  <h2 className="font-semibold text-sm tracking-widest uppercase text-[#E8EAED]">Race Results</h2>
                </div>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-[#FFFFFF] text-xs tracking-wider uppercase border-b border-[#2A3142]">
                      <th className="text-left py-1 px-1 w-8">Pos</th>
                      <th className="text-left py-1 px-1">Driver</th>
                      <th className="text-right py-1 px-1 w-8">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultsForDisplay.map((r) => {
                      const team = teams.find((t) => t.id === r.teamId)
                      return (
                        <tr key={r.driverId} className="border-b border-[#1a2030]">
                          <td className="py-1 px-1 font-bold text-[#E8EAED]">
                            {r.dnf ? <span className="text-[#C084FC] text-xs">DNF</span> : r.finishPosition}
                          </td>
                          <td className="py-1 px-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-0.5 h-4 rounded-full" style={{ backgroundColor: team?.color ?? '#FFFFFF' }} />
                              <span className="text-[#E8EAED] truncate">{r.driverName}</span>
                            </div>
                          </td>
                          <td className="py-1 px-1 text-right font-bold">
                            {r.points > 0 ? (
                              <span className="text-[#00D9FF]">{r.points}</span>
                            ) : (
                              <span className="text-[#FFFFFF]">0</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Save CTA */}
              <div className="shrink-0 p-4 border-t border-[#2A3142]">
                <p className="text-xs text-[#FFFFFF] mb-3">
                  Round {season.currentRound}/{calendar2026.length} complete
                </p>
                <button
                  onClick={handleSaveAndContinue}
                  disabled={saving}
                  className="w-full py-3 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] font-bold text-sm uppercase tracking-wider rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving
                    ? 'Saving...'
                    : season.currentRound >= calendar2026.length
                    ? 'End Season →'
                    : `Save & Continue to Round ${season.currentRound + 1}`}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Commentary — top 40% */}
              <div className="h-[40%] min-h-0 p-4 border-b border-[#2A3142] flex flex-col overflow-hidden">
                <CommentaryFeed entries={raceState?.commentary ?? []} />
              </div>
              {/* God mode — bottom 60% */}
              <div className="h-[60%] min-h-0 p-4 overflow-y-auto">
                {raceState && (phase === 'racing') ? (
                  <GodModePanel
                    drivers={drivers} teams={teams}
                    states={raceState.drivers}
                    raceState={raceState}
                    selectedDriverId={selectedDriverId ?? drivers[0]?.id ?? ''}
                    onAction={handleGodModeAction}
                  />
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
                      <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">God Mode</h2>
                    </div>
                    <p className="text-[#FFFFFF] text-sm">Available during race.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom bar — speed controls during race */}
      {phase === 'racing' && raceState && (
        <div className="shrink-0 bg-[#1E2431] border-t border-[#2A3142] px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {([1, 2, 3, 4] as SimSpeed[]).map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedClick(s)}
                className={`px-4 py-2 text-sm font-bold rounded transition-colors ${
                  speed === s ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <div className="w-px h-5 bg-[#2A3142]" />
          <button
            onClick={() => setPaused(!paused)}
            className={`px-5 py-2 text-sm font-bold tracking-widest uppercase rounded transition-colors ${
              paused ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'
            }`}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <div className="ml-auto text-sm text-[#FFFFFF]">Space · 1 2 3 4</div>
        </div>
      )}

      {/* Restart confirmation modal */}
      {showRestartConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-sm tracking-widest uppercase text-[#E8EAED] mb-3">Restart Weekend?</h3>
            <p className="text-[#FFFFFF] text-sm mb-6">
              This will discard the current session and restart qualifying for Round {season.currentRound}. Race results will not be saved.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (currentCircuit) resetSession(season.drivers, season.teams, currentCircuit.id)
                  setShowRestartConfirm(false)
                }}
                className="flex-1 py-3 bg-[#DC143C] hover:bg-[#b01030] text-white text-sm font-black tracking-widest uppercase rounded transition-colors cursor-pointer"
              >
                Restart
              </button>
              <button
                onClick={() => setShowRestartConfirm(false)}
                className="flex-1 py-3 bg-[#2A3142] hover:bg-[#303848] text-[#FFFFFF] text-sm font-bold tracking-widest uppercase rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speed 4 modal */}
      {showSpeed4Modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-sm tracking-widest uppercase text-[#E8EAED] mb-3">Simulate to End?</h3>
            <p className="text-[#FFFFFF] text-sm mb-6">The race will be simulated to the end without delay.</p>
            <div className="flex gap-3">
              <button onClick={confirmSpeed4} className="flex-1 py-3 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors">
                Confirm
              </button>
              <button onClick={() => setShowSpeed4Modal(false)} className="flex-1 py-3 bg-[#2A3142] hover:bg-[#303848] text-[#FFFFFF] text-sm font-bold tracking-widest uppercase rounded transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
