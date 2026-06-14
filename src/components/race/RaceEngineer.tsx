'use client'

import { useMemo } from 'react'
import type { Driver, RaceState } from '@/lib/sim/types'
import { useRaceStore } from '@/lib/store/race-store'
import { evaluatePitOptions, evaluateStartOptions, type PitOption } from '@/lib/sim/race-projector'
import type { ForecastCandidate } from '@/lib/sim/strategy-forecast'
import TyreIndicator from './TyreIndicator'

const candLabel = (c: ForecastCandidate): string => (c.kind === 'hold' ? 'Stay out' : c.kind === 'start' ? 'Start' : 'Pit')

// Race Engineer talent: a DETERMINISTIC strategy projection (no Monte-Carlo, no DNFs). It projects one
// noiseless race to the flag for each option — rivals pit at their own planned laps, traffic resolved with
// the engine's overtake numbers — and reads the predicted finishing place + time vs staying out. Instant at
// any lap; the lower-bar auto-mode reads the SAME projection, so they can't disagree.
export function RaceEngineer({ driver, raceState, mode }: { driver: Driver; raceState: RaceState; mode: 'pre-race' | 'racing' }) {
  const drivers = useRaceStore((s) => s.drivers)
  const teams = useRaceStore((s) => s.teams)
  const circuit = useRaceStore((s) => s.selectedCircuit)
  const ds = raceState.drivers.find((d) => d.driverId === driver.id)

  const options = useMemo<PitOption[]>(() => {
    if (!circuit) return []
    return mode === 'pre-race'
      ? evaluateStartOptions(raceState, drivers, teams, circuit, raceState.year, driver.id)
      : evaluatePitOptions(raceState, drivers, teams, circuit, raceState.year, driver.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, mode, raceState.currentLap, ds?.currentTyre.condition, ds?.currentTyre.compound, circuit?.id])

  const fmtDelta = (s: number) => (Math.abs(s) < 0.05 ? '—' : `${s > 0 ? '+' : ''}${s.toFixed(1)}s`)

  return (
    <div className="bg-[#1a1326] rounded p-2.5 border border-[#7C3AED]/40 flex flex-col gap-2">
      <div className="text-[10px] font-bold tracking-widest text-[#A78BFA] uppercase">Race Engineer</div>

      {options.length === 0 ? (
        <p className="text-[11px] text-[#FFFFFF]">No projection available.</p>
      ) : (
        <table className="w-full text-[11px] text-[#FFFFFF]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[#FFFFFF]">
              <th className="text-left font-medium">Option</th>
              <th className="text-right font-medium">Finish</th>
              <th className="text-right font-medium">{mode === 'pre-race' ? 'vs best' : 'vs stay'}</th>
              <th className="text-right font-medium">Traffic</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o, i) => (
              <tr key={candLabel(o.candidate) + i} className={i === 0 ? 'bg-[#7C3AED]/25' : ''}>
                <td className="py-0.5">
                  <span className="flex items-center gap-1">
                    {(o.candidate.kind === 'pit' || o.candidate.kind === 'start') && <TyreIndicator compound={o.candidate.compound} size="sm" />}
                    <span className={i === 0 ? 'font-bold' : ''}>{candLabel(o.candidate)}</span>
                  </span>
                </td>
                <td className="text-right font-mono font-bold">P{o.finishPosition}</td>
                <td className="text-right font-mono">{fmtDelta(o.deltaVsBaseline)}</td>
                <td className="text-right font-mono">{o.heldLaps > 0 ? `${o.heldLaps}L` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="text-[9px] text-[#FFFFFF]">Traffic: laps stuck behind a car you can’t pass.</div>
    </div>
  )
}
