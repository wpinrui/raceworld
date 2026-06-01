'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRaceStore } from '@/lib/store/race-store'
import type { GodModeAction, SimSpeed } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'
import RaceTable from '@/components/race/RaceTable'
import GodModePanel from '@/components/race/GodModePanel'
import CommentaryFeed from '@/components/race/CommentaryFeed'

const SPEED_INTERVALS: Record<SimSpeed, number> = {
  1: 5000,
  2: 2000,
  3: 500,
  4: 0,
}

function formatQualTime(t: number | null): string {
  if (t === null) return '--'
  const mins = Math.floor(t / 60)
  const secs = (t % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

export default function RacePage() {
  const {
    raceState,
    drivers,
    teams,
    selectedCircuitId,
    setCircuit,
    initSession,
    tickLap,
    setSpeed,
    setPaused,
    resetSession,
  } = useRaceStore()

  const phase = raceState?.phase ?? 'pre-qualifying'
  const speed = raceState?.speed ?? 1
  const paused = raceState?.paused ?? false

  const [pendingGodModeActions, setPendingGodModeActions] = useState<GodModeAction[]>([])
  const [showSpeed4Modal, setShowSpeed4Modal] = useState(false)
  const [speed4Confirmed, setSpeed4Confirmed] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedCircuit = calendar2026.find((c) => c.id === selectedCircuitId)

  // Spacebar toggle pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ' && (phase === 'racing' || phase === 'finished')) {
        e.preventDefault()
        setPaused(!paused)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, paused, setPaused])

  // Drain queued god mode actions on tick
  const doTick = useCallback(() => {
    const actions = pendingGodModeActions.length > 0 ? [...pendingGodModeActions] : undefined
    if (actions) setPendingGodModeActions([])
    tickLap(actions)
  }, [pendingGodModeActions, tickLap])

  // Speed 4 synchronous loop
  useEffect(() => {
    if (phase !== 'racing' || paused || speed !== 4 || !speed4Confirmed) return
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Run the loop asynchronously so React can still update between chunks
    let cancelled = false
    const run = async () => {
      while (!cancelled) {
        const current = useRaceStore.getState().raceState
        if (!current || current.phase !== 'racing') break
        useRaceStore.getState().tickLap()
        // yield to event loop every few laps
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    run()

    return () => {
      cancelled = true
    }
  }, [phase, paused, speed, speed4Confirmed])

  // Normal interval loop for speeds 1-3
  useEffect(() => {
    if (phase !== 'racing' || paused || speed === 4) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const ms = SPEED_INTERVALS[speed]
    intervalRef.current = setInterval(() => {
      doTick()
    }, ms)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [phase, paused, speed, doTick])

  const handleSpeedClick = (s: SimSpeed) => {
    if (s === 4) {
      setShowSpeed4Modal(true)
      return
    }
    setSpeed4Confirmed(false)
    setSpeed(s)
  }

  const confirmSpeed4 = () => {
    setShowSpeed4Modal(false)
    setSpeed4Confirmed(true)
    setSpeed(4)
  }

  const handleGodModeAction = (action: GodModeAction) => {
    setPendingGodModeActions((prev) => [...prev, action])
  }

  const handleStartRace = () => {
    if (!raceState) return
    useRaceStore.setState({
      raceState: { ...raceState, phase: 'racing' },
    })
  }

  return (
    <div className="min-h-screen bg-[#0F1419] text-[#E8EAED] flex flex-col">
      {/* Nav bar */}
      <nav className="bg-[#1E2431] border-b border-[#2A3142] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#00D9FF] font-black tracking-widest text-sm uppercase">
            RaceWorld
          </span>
          <div className="w-px h-4 bg-[#2A3142]" />
          <span className="text-[#A0A9B8] text-xs tracking-widest uppercase">Race</span>
        </div>
        <button
          onClick={resetSession}
          className="text-[10px] text-[#6B7280] hover:text-[#A0A9B8] tracking-widest uppercase transition-colors"
        >
          Reset
        </button>
      </nav>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel 60% */}
        <div className="w-[60%] border-r border-[#2A3142] p-6 overflow-y-auto">
          {/* Pre-qualifying */}
          {phase === 'pre-qualifying' && (
            <div className="flex flex-col gap-6 max-w-md">
              <div>
                <label className="block text-[10px] font-bold tracking-widest text-[#6B7280] uppercase mb-2">
                  Select Circuit
                </label>
                <select
                  value={selectedCircuitId}
                  onChange={(e) => setCircuit(e.target.value)}
                  className="w-full bg-[#1E2431] text-[#E8EAED] px-3 py-2 rounded border border-[#2A3142] focus:outline-none focus:border-[#00D9FF] text-sm"
                >
                  {calendar2026.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.location} ({c.laps} laps)
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={initSession}
                className="px-6 py-3 bg-[#00D9FF] hover:bg-[#00b8d9] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors"
              >
                Start Qualifying
              </button>
            </div>
          )}

          {/* Qualifying in progress */}
          {phase === 'qualifying' && (
            <div className="flex items-center justify-center h-40">
              <p className="text-[#A0A9B8] text-lg tracking-widest uppercase animate-pulse">
                Qualifying in progress...
              </p>
            </div>
          )}

          {/* Pre-race: qualifying results */}
          {phase === 'pre-race' && raceState && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold tracking-widest uppercase text-[#E8EAED]">
                  Qualifying Results — {selectedCircuit?.name}
                </h2>
                <button
                  onClick={handleStartRace}
                  className="px-5 py-2 bg-[#00D9FF] hover:bg-[#00b8d9] text-[#0F1419] text-xs font-black tracking-widest uppercase rounded transition-colors"
                >
                  Start Race
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B7280] text-[10px] tracking-widest uppercase border-b border-[#2A3142]">
                      <th className="text-left py-1.5 px-2 w-8">Pos</th>
                      <th className="text-left py-1.5 px-2">Driver</th>
                      <th className="text-left py-1.5 px-2">Team</th>
                      <th className="text-right py-1.5 px-2">Q1</th>
                      <th className="text-right py-1.5 px-2">Q2</th>
                      <th className="text-right py-1.5 px-2">Q3</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceState.qualifyingResults.map((qr) => {
                      const driver = drivers.find((d) => d.id === qr.driverId)
                      const team = driver
                        ? teams.find((t) => t.id === driver.teamId)
                        : undefined
                      return (
                        <tr
                          key={qr.driverId}
                          className="border-b border-[#1E2431] text-[#E8EAED] hover:bg-[#2A3142] transition-colors"
                        >
                          <td className="py-1.5 px-2 font-mono font-bold">
                            {qr.gridPosition}
                          </td>
                          <td className="py-1.5 px-2">
                            <div className="flex items-center gap-2">
                              {team && (
                                <div
                                  className="w-0.5 h-4 rounded-full"
                                  style={{ backgroundColor: team.color }}
                                />
                              )}
                              <span>{driver?.name ?? qr.driverId}</span>
                            </div>
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[10px] text-[#A0A9B8]">
                            {team?.shortName ?? '---'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#A0A9B8]">
                            {formatQualTime(qr.q1Time)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#A0A9B8]">
                            {formatQualTime(qr.q2Time)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono font-bold text-[#E8EAED]">
                            {formatQualTime(qr.q3Time)}
                          </td>
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
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-black tracking-widest uppercase">
                    LAP {Math.max(1, raceState.currentLap - 1)} / {raceState.totalLaps}
                  </div>
                  <div className="text-[#6B7280] text-xs tracking-wide">
                    {selectedCircuit?.name}
                  </div>
                </div>
                {phase === 'finished' && (
                  <div className="text-[#00D9FF] text-xs font-bold tracking-widest uppercase animate-pulse">
                    Race Finished
                  </div>
                )}
              </div>

              <RaceTable
                drivers={drivers}
                teams={teams}
                states={raceState.drivers}
                currentLap={raceState.currentLap}
                totalLaps={raceState.totalLaps}
                phase={phase}
              />
            </div>
          )}
        </div>

        {/* Right panel 40% */}
        <div className="w-[40%] flex flex-col overflow-hidden">
          {/* Commentary feed — 60% of right panel */}
          <div className="h-[60%] p-4 border-b border-[#2A3142] overflow-hidden flex flex-col">
            <CommentaryFeed entries={raceState?.commentary ?? []} />
          </div>

          {/* God mode panel — 40% of right panel */}
          <div className="h-[40%] p-4 overflow-y-auto">
            {raceState && (phase === 'racing' || phase === 'finished') ? (
              <GodModePanel
                drivers={drivers}
                states={raceState.drivers}
                onAction={handleGodModeAction}
              />
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 bg-[#DC143C]" />
                  <h2 className="text-xs font-bold tracking-widest text-[#6B7280] uppercase">
                    God Mode
                  </h2>
                </div>
                <p className="text-[#6B7280] text-xs italic">Available during race.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      {(phase === 'racing' || phase === 'finished') && raceState && (
        <div className="bg-[#1E2431] border-t border-[#2A3142] px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4] as SimSpeed[]).map((s) => (
              <button
                key={s}
                onClick={() => handleSpeedClick(s)}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                  speed === s
                    ? 'bg-[#00D9FF] text-[#0F1419]'
                    : 'bg-[#2A3142] text-[#A0A9B8] hover:bg-[#3a4255]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[#2A3142]" />

          <button
            onClick={() => setPaused(!paused)}
            className={`px-4 py-1.5 text-xs font-bold tracking-widest uppercase rounded transition-colors ${
              paused
                ? 'bg-[#00D9FF] text-[#0F1419]'
                : 'bg-[#2A3142] text-[#A0A9B8] hover:bg-[#3a4255]'
            }`}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>

          <div className="ml-auto text-[10px] text-[#6B7280]">
            Space to pause/resume
          </div>
        </div>
      )}

      {/* Speed 4 confirmation modal */}
      {showSpeed4Modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-bold tracking-widest uppercase text-[#E8EAED] mb-3">
              Simulate to End?
            </h3>
            <p className="text-[#A0A9B8] text-xs mb-5">
              Simulate race to end? Press confirm to continue.
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmSpeed4}
                className="flex-1 py-2 bg-[#00D9FF] hover:bg-[#00b8d9] text-[#0F1419] text-xs font-black tracking-widest uppercase rounded transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowSpeed4Modal(false)}
                className="flex-1 py-2 bg-[#2A3142] hover:bg-[#3a4255] text-[#A0A9B8] text-xs font-bold tracking-widest uppercase rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
