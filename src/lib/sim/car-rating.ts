import type { Team } from './types'

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

// Apply an upgrade's pace gain to a team. Phase 1: split evenly across straight-line + cornering, keeping
// carPace as their mean. (Phase 5 will allocate the gain by the team's focus split instead.)
export function addUpgradePace(team: Team, delta: number): Team {
  const sl = round1((team.straightLine ?? team.carPace) + delta)
  const co = round1((team.cornering ?? team.carPace) + delta)
  return { ...team, straightLine: sl, cornering: co, carPace: round1((sl + co) / 2) }
}
