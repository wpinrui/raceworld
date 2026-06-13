'use client'

import { useMemo } from 'react'
import type { Driver, DriverRaceState, RaceState, TyreCompound } from '@/lib/sim/types'
import { planStrategy, truthBelief, type StrategyStint } from '@/lib/sim/pit-ai'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { getMoistureAtLap } from '@/lib/sim/weather'
import { expectedStintLaps, trafficStintLaps, currentSetRemainingLaps, tyreLapTimeLoss } from '@/lib/sim/tyre-telemetry'
import TyreIndicator from './TyreIndicator'

const ALL_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']
const DRY_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard']
const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1)

// Tyre Telemetry talent: the true tyre picture the pit wall is normally blind to — the current set's exact
// remaining laps (clear air vs traffic), each compound's expected life and pace-vs-wear, and the
// perfect-information strategy. Every number comes straight from the engine maths (see tyre-telemetry.ts),
// so the reveal can't drift from what the sim actually does. Used on the pit wall and the pre-race grid.
export function TyreTelemetry({ driver, ds, raceState }: { driver: Driver; ds: DriverRaceState; raceState: RaceState }) {
  // Showing wet rows in the dry would leak the forecast; the CURRENT moisture is already observable (it's
  // raining now), so it's fair to surface wet data once it's actually wet.
  const wet = getMoistureAtLap(raceState.weather, raceState.currentLap) >= 0.1
  const compounds: TyreCompound[] = wet ? ALL_COMPOUNDS : DRY_COMPOUNDS
  const set = currentSetRemainingLaps(ds.currentTyre)

  const perfect = useMemo(
    () =>
      planStrategy(
        raceState.currentLap, raceState.totalLaps,
        ds.currentTyre.condition, ds.currentTyre.compound, driver.smoothness,
        truthBelief(raceState.compoundDeltas, raceState.tyreBaseLife, raceState.totalLaps),
        raceState.weather, raceState.weatherForecast, pitLaneLoss(raceState.year),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driver.id, raceState.currentLap, ds.currentTyre.condition, ds.currentTyre.compound],
  )

  return (
    <div className="bg-[#0d2230] rounded p-2.5 border border-[#00D9FF]/20 flex flex-col gap-2">
      <div className="text-[10px] font-bold tracking-widest text-[#00D9FF] uppercase">Tyre Telemetry</div>

      <div className="text-xs text-[#FFFFFF]">
        This set: <span className="font-bold">{set.clear}</span> laps clear · <span className="font-bold">{set.traffic}</span> in traffic
      </div>

      <table className="w-full text-xs text-[#FFFFFF]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[#FFFFFF]">
            <th className="text-left font-medium" />
            <th className="text-right font-medium">Life</th>
            <th className="text-right font-medium">Fresh</th>
            <th className="text-right font-medium">50%</th>
            <th className="text-right font-medium">Dead</th>
          </tr>
        </thead>
        <tbody>
          {compounds.map((c) => {
            const clear = expectedStintLaps(raceState.tyreBaseLife[c], driver.smoothness, raceState.totalLaps)
            const delta = raceState.compoundDeltas[c]
            return (
              <tr key={c}>
                <td className="py-0.5"><TyreIndicator compound={c} size="sm" /></td>
                <td className="text-right font-mono">{clear}/{trafficStintLaps(clear)}</td>
                <td className="text-right font-mono">{signed(tyreLapTimeLoss(delta, 100))}</td>
                <td className="text-right font-mono">{signed(tyreLapTimeLoss(delta, 50))}</td>
                <td className="text-right font-mono text-[#DC143C]">{signed(tyreLapTimeLoss(delta, 0))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-[#FFFFFF]">Life: laps clear/traffic. Pace: s/lap vs fresh soft.</div>

      {perfect && (
        <div className="flex flex-col gap-1 pt-1.5 border-t border-[#00D9FF]/10">
          <div className="text-[10px] font-bold tracking-widest text-[#00D9FF] uppercase">Perfect strategy</div>
          {perfect.stints.map((s: StrategyStint, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs text-[#FFFFFF]">
              <TyreIndicator compound={s.compound} size="sm" />
              <span>L{s.fromLap}–{s.toLap}</span>
              <span>({s.toLap - s.fromLap + 1})</span>
              {i < perfect.stints.length - 1 && <span className="text-[#00D9FF] ml-auto">pit →</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
