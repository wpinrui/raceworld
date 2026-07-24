import type { TyreCompound, TyreState } from './types'
import { sampleNormal } from './rng-utils'

// Per-race pace delta (s/lap) anchors and base-life (fraction of race distance) anchors. Life anchors
// follow the GDD figures; the old code ran soft a touch shorter (12-20% vs GDD 15-25%) — now aligned.
export const DEFAULT_COMPOUND_DELTAS: Record<TyreCompound, number> = { soft: 0, medium: 0.7, hard: 1.5, intermediate: 2.5, wet: 4.0 }
export const DEFAULT_TYRE_LIFE: Record<TyreCompound, number> = { soft: 0.20, medium: 0.30, hard: 0.45, intermediate: 0.30, wet: 0.45 }

// Tyres running in dirty air (within ~1s of the car ahead) wear this much faster. Single source for the
// runtime (race.ts applies it per lap) and the Tyre Telemetry reveal (which projects a traffic stint life).
export const DIRTY_AIR_WEAR_MULT = 1.1

// Per-race compound pace deltas. Soft is the 0 reference. The dry trio (soft≤medium≤hard) and the wet
// pair (intermediate≤wet) are each kept in order — softer at least as fast — but the two chains are
// independent (inter/wet aren't "harder" dry tyres). σ/anchors are sim-and-tune knobs.
export function generateCompoundDeltas(rng: () => number = Math.random): Record<TyreCompound, number> {
  const medium = Math.max(0, sampleNormal(DEFAULT_COMPOUND_DELTAS.medium, 0.22, rng))
  const hard = Math.max(medium, sampleNormal(DEFAULT_COMPOUND_DELTAS.hard, 0.30, rng))
  const intermediate = Math.max(0, sampleNormal(DEFAULT_COMPOUND_DELTAS.intermediate, 0.40, rng))
  const wet = Math.max(intermediate, sampleNormal(DEFAULT_COMPOUND_DELTAS.wet, 0.55, rng))
  return { soft: 0, medium, hard, intermediate, wet }
}

// Per-race base tyre life (fraction of race distance), rolled once at lights-out so the whole grid
// shares the day's deg characteristics; per-driver smoothness differentiates from there.
export function generateTyreBaseLife(rng: () => number = Math.random): Record<TyreCompound, number> {
  const roll = (anchor: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, sampleNormal(anchor, 0.035, rng)))
  return {
    soft: roll(DEFAULT_TYRE_LIFE.soft, 0.15, 0.25),
    medium: roll(DEFAULT_TYRE_LIFE.medium, 0.24, 0.40),
    hard: roll(DEFAULT_TYRE_LIFE.hard, 0.38, 0.55),
    intermediate: roll(DEFAULT_TYRE_LIFE.intermediate, 0.24, 0.40),
    wet: roll(DEFAULT_TYRE_LIFE.wet, 0.38, 0.55),
  }
}

// Tyre life in laps for a per-race base-life fraction and a driver's smoothness (0.5x at 0, 1.5x at 100),
// plus a per-SET "good set / duff set" modifier rolled once per fitting — so the exact life of THIS set
// varies around the race's base life. Teams learn the average, never this set, so the cliff is a gamble.
export function computeTyreLife(baseLifeFraction: number, smoothness: number, totalLaps: number): number {
  const smoothnessMultiplier = 0.5 + smoothness / 100
  const setModifier = Math.max(0.8, Math.min(1.2, sampleNormal(1, 0.08, Math.random)))
  return Math.max(1, Math.round(baseLifeFraction * totalLaps * smoothnessMultiplier * setModifier))
}

export function degradeTyre(tyre: TyreState): number {
  return Math.max(0, Math.round(tyre.condition - 100 / tyre.maxLifeLaps))
}

// Actual per-lap wear: the baseline drop jittered ±30% so the real condition path is noisy and the
// exact cliff lap can't be predicted. degradeTyre stays the deterministic preview for the UI.
// `frac` scales the drop to a sub-lap slice (#sector-engine); rounding only applies to whole laps —
// per-slice rounding would erase 1/8-lap wear entirely, so condition runs as a float in sector mode.
export function wearTyre(tyre: TyreState, wearMult = 1, frac = 1): number {
  const baseline = (100 / tyre.maxLifeLaps) * wearMult // wearMult > 1 for dirty air (running close behind)
  const next = tyre.condition - baseline * frac * (0.7 + Math.random() * 0.6)
  return Math.max(0, frac === 1 ? Math.round(next) : next)
}

export function tyreStepsOutOfWindow(compound: TyreCompound, moisture: number): number {
  switch (compound) {
    case 'soft':
    case 'medium':
    case 'hard':
      // Dry tyres
      if (moisture < 0.10) return 0
      if (moisture < 0.35) return 1
      return 2

    case 'intermediate':
      if (moisture >= 0.10 && moisture <= 0.45) return 0
      if (moisture < 0.10) return 1
      if (moisture > 0.45 && moisture <= 0.70) return 1
      // moisture > 0.70
      return 2

    case 'wet':
      if (moisture >= 0.35 && moisture <= 0.80) return 0
      if (moisture >= 0.20 && moisture < 0.35) return 1
      if (moisture > 0.80) return 1
      // moisture < 0.20
      return 2
  }
}

export function recommendTyre(moisture: number): TyreCompound {
  if (moisture < 0.10) return 'medium'
  if (moisture <= 0.35) return 'intermediate'
  return 'wet'
}
