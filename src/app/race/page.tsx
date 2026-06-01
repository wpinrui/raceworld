'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRaceStore } from '@/lib/store/race-store'
import type { GodModeAction, SimSpeed } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'
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
  const {
    raceState, drivers, teams, selectedCircuitId, forms, strategyNoise,
    setCircuit, updateDriverForm, updateDriverStat, setStrategyNoise,
    initSession, tickLap, setSpeed, setPaused, resetSession,
  } = useRaceStore()

  const phase = raceState?.phase ?? 'pre-qualifying'
  const speed = raceState?.speed ?? 1
  const paused = raceState?.paused ?? false

  const [pendingGodModeActions, setPendingGodModeActions] = useState<GodModeAction[]>([])
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [showSpeed4Modal, setShowSpeed4Modal] = useState(false)
  const [speed4Confirmed, setSpeed4Confirmed] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedCircuit = calendar2026.find((c) => c.id === selectedCircuitId)

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

  // Speed 4 loop
  useEffect(() => {
    if (phase !== 'racing' || paused || speed !== 4 || !speed4Confirmed) return
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
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

  // Interval loop speeds 1-3
  useEffect(() => {
    if (phase !== 'racing' || paused || speed === 4) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      return
    }
    const ms = SPEED_INTERVALS[speed]
    intervalRef.current = setInterval(doTick, ms)
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }
  }, [phase, paused, speed, doTick])

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

  return (
    <div className="h-screen bg-[#0F1419] text-[#E8EAED] flex flex-col overflow-hidden">

      {/* Nav */}
      <nav className="bg-[#1E2431] border-b border-[#2A3142] px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-f1 text-[#00D9FF] tracking-widest text-xl uppercase">RaceWorld</span>
          <div className="w-px h-5 bg-[#2A3142]" />
          <span className="text-[#A0A9B8] text-base tracking-widest uppercase">Race</span>
          {(phase === 'racing' || phase === 'finished') && raceState && (
            <>
              <div className="w-px h-5 bg-[#2A3142]" />
              <span className="font-f1 text-[#E8EAED] text-base tracking-widest uppercase">
                LAP {Math.max(1, raceState.currentLap - 1)} / {raceState.totalLaps}
              </span>
              <span className="text-[#6B7280] text-sm">{selectedCircuit?.name}</span>
              {phase === 'finished' && (
                <span className="font-f1 text-[#00D9FF] text-sm tracking-widest uppercase animate-pulse ml-2">
                  Finished
                </span>
              )}
            </>
          )}
        </div>
        <button onClick={resetSession} className="text-sm text-[#6B7280] hover:text-[#A0A9B8] tracking-widest uppercase transition-colors">
          Reset
        </button>
      </nav>

      {/* Main — fills remaining height, no overflow */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel 60% */}
        <div className="w-[60%] border-r border-[#2A3142] flex flex-col min-h-0 overflow-hidden">

          {/* Pre-qualifying: circuit selector + driver god mode */}
          {phase === 'pre-qualifying' && (
            <div className="flex flex-col h-full min-h-0">
              {/* Top bar: circuit + start button */}
              <div className="shrink-0 flex items-end gap-4 px-6 pt-5 pb-4 border-b border-[#2A3142]">
                <div className="flex-1">
                  <label className="block text-sm font-bold tracking-widest text-[#6B7280] uppercase mb-2">
                    Circuit
                  </label>
                  <select
                    value={selectedCircuitId}
                    onChange={(e) => setCircuit(e.target.value)}
                    className="w-full bg-[#1E2431] text-[#E8EAED] px-4 py-2.5 rounded border border-[#2A3142] focus:outline-none focus:border-[#00D9FF] text-base"
                  >
                    {calendar2026.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.location} ({c.laps} laps)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="shrink-0">
                  <label className="block text-sm font-bold tracking-widest text-[#6B7280] uppercase mb-2">
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
                  className="px-6 py-2.5 bg-[#00D9FF] hover:bg-[#00b8d9] text-[#0F1419] text-base font-black tracking-widest uppercase rounded transition-colors shrink-0"
                >
                  Start Qualifying
                </button>
              </div>

              {/* Driver god mode table */}
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="px-6 py-3">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
                    <h2 className="font-f1 text-base tracking-widest text-[#E8EAED] uppercase">Driver Setup</h2>
                  </div>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-[#6B7280] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
                        <th className="text-left py-1 pr-2">Driver</th>
                        <th className="text-center py-1 px-2 w-28">Form</th>
                        <th className="text-center py-1 px-2 w-20">Pace</th>
                        <th className="text-center py-1 px-2 w-20">Wet</th>
                        <th className="text-center py-1 px-2 w-20">Ovt</th>
                        <th className="text-center py-1 px-2 w-20">Smt</th>
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
                                <span className="text-xs text-[#6B7280]">{team?.shortName}</span>
                              </div>
                            </td>
                            {/* Form slider */}
                            <td className="py-1 px-2">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="range" min={0} max={10} step={0.5}
                                  value={form}
                                  onChange={(e) => updateDriverForm(d.id, Number(e.target.value))}
                                  className="w-16 accent-[#00D9FF]"
                                />
                                <span className={`text-sm font-mono w-6 text-right ${form > 5 ? 'text-[#10B981]' : form < 5 ? 'text-[#DC143C]' : 'text-[#6B7280]'}`}>
                                  {form.toFixed(1)}
                                </span>
                              </div>
                            </td>
                            {/* Stat inputs */}
                            {(['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const).map((stat) => (
                              <td key={stat} className="py-1 px-2">
                                <input
                                  type="number" min={0} max={100}
                                  value={d[stat]}
                                  onChange={(e) => updateDriverStat(d.id, stat, Number(e.target.value))}
                                  className="w-16 bg-[#2A3142] text-[#E8EAED] text-sm font-mono text-center px-1.5 py-1 rounded border border-[#3a4255] focus:outline-none focus:border-[#00D9FF]"
                                />
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
              <p className="text-[#A0A9B8] text-xl tracking-widest uppercase animate-pulse">
                Qualifying in progress...
              </p>
            </div>
          )}

          {/* Pre-race: qualifying results */}
          {phase === 'pre-race' && raceState && (
            <div className="flex flex-col h-full min-h-0">
              <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#2A3142]">
                <h2 className="font-f1 text-lg tracking-widest uppercase text-[#E8EAED]">
                  Qualifying — {selectedCircuit?.name}
                </h2>
                <button
                  onClick={handleStartRace}
                  className="px-6 py-2.5 bg-[#00D9FF] hover:bg-[#00b8d9] text-[#0F1419] text-base font-black tracking-widest uppercase rounded transition-colors"
                >
                  Start Race
                </button>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[#6B7280] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
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
                          <td className="py-1 px-2 font-mono font-bold text-base">{qr.gridPosition}</td>
                          <td className="py-1 px-2">
                            <div className="flex items-center gap-2.5">
                              {team && <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                              <span className="text-base">{driver?.name ?? qr.driverId}</span>
                            </div>
                          </td>
                          <td className="py-1 px-2 font-mono text-sm text-[#A0A9B8]">{team?.shortName ?? '---'}</td>
                          <td className="py-1 px-2 text-right font-mono text-base text-[#A0A9B8]">{formatQualTime(qr.q1Time)}</td>
                          <td className="py-1 px-2 text-right font-mono text-base text-[#A0A9B8]">{formatQualTime(qr.q2Time)}</td>
                          <td className="py-1 px-2 text-right font-mono text-base font-bold">{formatQualTime(qr.q3Time)}</td>
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
                onSelectDriver={setSelectedDriverId}
              />
            </div>
          )}
        </div>

        {/* Right panel 40% */}
        <div className="w-[40%] flex flex-col min-h-0 overflow-hidden">
          {/* Commentary — top 40% */}
          <div className="h-[40%] min-h-0 p-4 border-b border-[#2A3142] flex flex-col overflow-hidden">
            <CommentaryFeed entries={raceState?.commentary ?? []} />
          </div>
          {/* God mode — bottom 60% */}
          <div className="h-[60%] min-h-0 p-4 overflow-y-auto">
            {raceState && (phase === 'racing' || phase === 'finished') ? (
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
                  <h2 className="font-f1 text-base tracking-widest text-[#6B7280] uppercase">God Mode</h2>
                </div>
                <p className="text-[#6B7280] text-base italic">Available during race.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      {(phase === 'racing' || phase === 'finished') && raceState && (
        <div className="shrink-0 bg-[#1E2431] border-t border-[#2A3142] px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {([1, 2, 3, 4] as SimSpeed[]).map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedClick(s)}
                className={`px-4 py-2 text-sm font-bold rounded transition-colors ${
                  speed === s ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#A0A9B8] hover:bg-[#3a4255]'
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
              paused ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#A0A9B8] hover:bg-[#3a4255]'
            }`}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <div className="ml-auto text-sm text-[#6B7280]">Space · 1 2 3 4</div>
        </div>
      )}

      {/* Speed 4 modal */}
      {showSpeed4Modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="font-f1 text-base tracking-widest uppercase text-[#E8EAED] mb-3">Simulate to End?</h3>
            <p className="text-[#A0A9B8] text-base mb-6">The race will be simulated to the end. This cannot be paused.</p>
            <div className="flex gap-3">
              <button onClick={confirmSpeed4} className="flex-1 py-3 bg-[#00D9FF] hover:bg-[#00b8d9] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors">
                Confirm
              </button>
              <button onClick={() => setShowSpeed4Modal(false)} className="flex-1 py-3 bg-[#2A3142] hover:bg-[#3a4255] text-[#A0A9B8] text-sm font-bold tracking-widest uppercase rounded transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
