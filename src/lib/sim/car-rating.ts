import type { Team, FocusSplit } from './types'
import { sampleNormal } from './rng-utils'

// Multi-rating car model. A car has two PACE ratings (straight-line, cornering) that blend into an effective
// lap pace per circuit, plus two TYRE ratings (warming, wear) consumed by the tyre model. Everything falls
// back to the legacy single `carPace` when a team predates the model (old saves), so they behave unchanged.

// Effective lap pace at a circuit: straight-heavy tracks weight straight-line speed, corner-heavy tracks
// weight cornering. `straightness` ∈ [0,1] (0 = Monaco corners, 1 = Monza straights); undefined → 0.5.
export function effectiveCarPace(team: Team, straightness: number | undefined): number {
  const sl = team.straightLine ?? team.carPace
  const co = team.cornering ?? team.carPace
  const s = straightness ?? 0.5
  return s * sl + (1 - s) * co
}

// Track-agnostic overall pace (mean of the two pace ratings) — for seat ordering, predictions, funding, and
// the reshuffle, anywhere a single pace number is wanted rather than a per-circuit one.
export function overallCarPace(team: Team): number {
  const sl = team.straightLine ?? team.carPace
  const co = team.cornering ?? team.carPace
  return (sl + co) / 2
}

// Initialise the four ratings from a single carPace. Phase 1 keeps them all equal so the refactor is
// behaviour-neutral; later phases (upgrade focus, reshuffle variance) diverge them.
export function ratingsFromCarPace(carPace: number): Pick<Team, 'straightLine' | 'cornering' | 'tyreWarming' | 'tyreWear'> {
  return { straightLine: carPace, cornering: carPace, tyreWarming: carPace, tyreWear: carPace }
}

// Per-race car-form swing applied to the pace ratings (so it shifts effective pace on every track), keeping
// `carPace` in sync. Used by the race loop where `carForm` shifts a team's pace for the whole race.
export function applyCarForm(team: Team, form: number): Team {
  if (form === 0) return team
  return {
    ...team,
    carPace: team.carPace + form,
    straightLine: (team.straightLine ?? team.carPace) + form,
    cornering: (team.cornering ?? team.carPace) + form,
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// Apply an upgrade's pace gain to a team, split evenly across straight-line + cornering (no tyre gain),
// keeping carPace as their mean. Equivalent to addUpgradeFocused with a pure-pace focus; kept for the
// legacy/default path and existing tests.
export function addUpgradePace(team: Team, delta: number): Team {
  const sl = round1((team.straightLine ?? team.carPace) + delta)
  const co = round1((team.cornering ?? team.carPace) + delta)
  return { ...team, straightLine: sl, cornering: co, carPace: round1((sl + co) / 2) }
}

// A pace-focused upgrade: the legacy split, all of the gain on the two pace ratings (#upgrade-focus default).
export const DEFAULT_FOCUS: FocusSplit = { straightLine: 0.5, cornering: 0.5, tyreWarming: 0, tyreWear: 0 }

// Apply an upgrade's gain allocated by a focus split. An upgrade's rolled `delta` is worth 2·delta rating-
// POINTS (the legacy model spent them as +delta on each of the two pace ratings); the focus split now
// allocates those points across all four ratings. So focus {0.5,0.5,0,0} reproduces addUpgradePace exactly,
// while diverting focus to the tyre ratings trades raw pace for tyre warming/wear. carPace stays the pace mean.
export function addUpgradeFocused(team: Team, delta: number, focus: FocusSplit): Team {
  const budget = 2 * delta
  const sl = round1((team.straightLine ?? team.carPace) + budget * focus.straightLine)
  const co = round1((team.cornering ?? team.carPace) + budget * focus.cornering)
  const tw = round1(clamp((team.tyreWarming ?? team.carPace) + budget * focus.tyreWarming, 0, 100))
  const twr = round1(clamp((team.tyreWear ?? team.carPace) + budget * focus.tyreWear, 0, 100))
  return { ...team, straightLine: sl, cornering: co, tyreWarming: tw, tyreWear: twr, carPace: round1((sl + co) / 2) }
}

// A cheap pace-leaning AI focus split with per-team variation: mostly straight-line + cornering, some tyre
// development, jittered and renormalised so different teams develop with a little character (#upgrade-focus).
export function aiFocusSplit(rng: () => number): FocusSplit {
  const base = [0.35, 0.35, 0.15, 0.15]
  const raw = base.map((b) => Math.max(0.02, b + (rng() - 0.5) * 0.3))
  const sum = raw[0] + raw[1] + raw[2] + raw[3]
  return { straightLine: raw[0] / sum, cornering: raw[1] / sum, tyreWarming: raw[2] / sum, tyreWear: raw[3] / sum }
}

// ---- Season-init rating randomisation (#season-init-random) ---------------------------------------------

// Positive modulo into [0, m): handles a negative normal sample so the fractional part is always in range.
const posMod = (x: number, m: number) => ((x % m) + m) % m

// How widely the four stats spread around the team's overall when split. ~±12 rating points at the spread's
// typical reach; a team can be notably better on straights than tyres, etc. (sim-tunable).
const CAR_STAT_SPREAD = 0.16

// The four car ratings, all present (unlike the optional fields on Team).
export type CarRatings = { straightLine: number; cornering: number; tyreWarming: number; tyreWear: number }

// Split an overall rating across the four car stats so their AVERAGE equals the overall (the "basic overall"
// the performance table shows). Multiply the overall by 4 to get a points budget, roll four normalised
// weights, and hand each stat its share — clamped to [0,100].
export function splitOverallIntoRatings(overall: number, rng: () => number): CarRatings {
  const total = overall * 4
  const raw = [0, 0, 0, 0].map(() => Math.max(0.15, sampleNormal(1, CAR_STAT_SPREAD, rng)))
  const sum = raw[0] + raw[1] + raw[2] + raw[3]
  const stat = (w: number) => clamp(Math.round((total * w) / sum), 0, 100)
  return { straightLine: stat(raw[0]), cornering: stat(raw[1]), tyreWarming: stat(raw[2]), tyreWear: stat(raw[3]) }
}

// Assign each team (given best-first by rank) a randomised OVERALL then a random four-stat split. The fastest
// team is pinned at 75; team i draws within a 5-wide band below the previous one — lower bound 75−5i, plus a
// standard-normal-derived fraction (mod 1) × 5 — so the order is always preserved but the values jitter.
export function randomiseRatingsByRank(
  rankedTeamIds: string[],
  rng: () => number,
): Map<string, CarRatings & { carPace: number }> {
  const out = new Map<string, CarRatings & { carPace: number }>()
  rankedTeamIds.forEach((id, i) => {
    const overall = i === 0 ? 75 : Math.max(5, (75 - 5 * i) + posMod(sampleNormal(0, 1, rng), 1) * 5)
    const ratings = splitOverallIntoRatings(overall, rng)
    out.set(id, { ...ratings, carPace: round1((ratings.straightLine + ratings.cornering) / 2) })
  })
  return out
}
