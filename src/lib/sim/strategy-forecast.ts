import type { TyreCompound, TyreState } from './types'
import { tyreStepsOutOfWindow } from './tyres'

// Candidate pit/start options and the cheap pre-check that feed the deterministic race projector
// (race-projector.ts). (These supported an earlier Monte-Carlo forecaster, since replaced by the projector.)

const ALL_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']

// A candidate decision for the player's car: in-race, box now on a compound or hold (stay out); pre-race,
// which grid tyre to start on.
export type ForecastCandidate =
  | { kind: 'pit'; compound: TyreCompound }
  | { kind: 'hold' }
  | { kind: 'start'; compound: TyreCompound }

// The compounds that suit the track at a given moisture — those in their window (no slicks in the wet, no
// wets in the dry). Falls back to within-one-step if a transitional moisture leaves nothing perfectly in
// window, so there's always at least one option.
export function suitableCompounds(moisture: number): TyreCompound[] {
  const inWindow = ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) === 0)
  return inWindow.length ? inWindow : ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) <= 1)
}

// The options worth evaluating at a given moisture. Pre-race: which grid tyre to start on. In-race: box now
// for a suitable compound, or hold (stay out). Intermediates/wets appear once it's actually wet.
export function buildCandidates(moisture: number, mode: 'pre-race' | 'racing'): ForecastCandidate[] {
  const compounds = suitableCompounds(moisture)
  if (mode === 'pre-race') return compounds.map((c) => ({ kind: 'start', compound: c }) as ForecastCandidate)
  return [...compounds.map((c) => ({ kind: 'pit', compound: c }) as ForecastCandidate), { kind: 'hold' }]
}

// Zero-sim guard (deliberately conservative): a tyre that suits the conditions and is still this healthy is
// never worth boxing in this model — the AI doesn't even consider a stop until ~22% condition, so 70% leaves
// a 3x margin. Below this, or a tyre wrong for the weather (e.g. slicks in the rain), gets the full projection.
const HEALTHY_SKIP_CONDITION = 70

// Whether boxing a car is even worth projecting now. False only when the tyre is in its weather window AND
// comfortably healthy — the obvious no-stop case the auto-mode skips outright. A wrong-for-weather tyre always
// returns true, so a rain change immediately re-arms the projection.
export function shouldEvaluatePit(tyre: TyreState, moisture: number): boolean {
  return !(tyreStepsOutOfWindow(tyre.compound, moisture) === 0 && tyre.condition >= HEALTHY_SKIP_CONDITION)
}
