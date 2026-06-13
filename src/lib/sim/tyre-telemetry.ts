import type { TyreState } from './types'
import { DIRTY_AIR_WEAR_MULT } from './tyres'

// Perfect tyre information for the Tyre Telemetry talent. Everything here is derived straight from the
// engine's own lap-time and wear maths (engine.ts / tyres.ts), so the reveal can never drift from what
// the sim actually does — the tests pin each figure against computeLapTime / the wear formula.

// The tyre's contribution to lap time, per the engine: every 4% of wear costs 0.1s/lap, and a dead tyre
// adds a 5s/lap cliff. Mirrors the tyreWearMod / tyreCliff terms of computeLapTime.
export const TYRE_WEAR_LOSS_PER_PCT = 0.1 / 4 // s/lap per 1% condition lost
export const TYRE_CLIFF_LOSS = 5 // s/lap once a tyre is at 0%

// Mean laps a FRESH set of a compound lasts (100% → 0%) for a driver's smoothness. Mirrors computeTyreLife
// but drops the per-set good/duff luck (mean 1), since the reveal is the expectation, not this set's roll.
// This is the clear-air life; divide by the dirty-air multiplier for a full stint spent in traffic.
export function expectedStintLaps(baseLifeFraction: number, smoothness: number, totalLaps: number): number {
  return Math.max(1, Math.round(baseLifeFraction * totalLaps * (0.5 + smoothness / 100)))
}

// The same stint run entirely within ~1s of the car ahead, where tyres wear DIRTY_AIR_WEAR_MULT faster.
// Clear air and full traffic are the two bounds; a real stint sits between them.
export function trafficStintLaps(clearLaps: number): number {
  return Math.max(1, Math.round(clearLaps / DIRTY_AIR_WEAR_MULT))
}

// Laps left on the CURRENT set before it falls off, from its exact condition and already-rolled life —
// the figure the pit wall normally reads only to a coarse 25% bucket. Clear air and a worst-case stint
// spent entirely in traffic.
export function currentSetRemainingLaps(tyre: TyreState): { clear: number; traffic: number } {
  const perLapClear = 100 / tyre.maxLifeLaps
  const clear = tyre.condition / perLapClear
  return { clear: Math.max(0, Math.round(clear)), traffic: Math.max(0, Math.round(clear / DIRTY_AIR_WEAR_MULT)) }
}

// The tyre's own lap-time loss at a given condition, relative to a fresh soft: compound pace delta + wear
// loss + the cliff. The delta is this race's value (raceState.compoundDeltas[compound]).
export function tyreLapTimeLoss(compoundDelta: number, condition: number): number {
  const cliff = condition <= 0 ? TYRE_CLIFF_LOSS : 0
  return compoundDelta + (100 - condition) * TYRE_WEAR_LOSS_PER_PCT + cliff
}
