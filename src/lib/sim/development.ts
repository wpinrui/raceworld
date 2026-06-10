import type { Team, TeamDevPlan, DevUpgradeEvent, FundingTier, ConstructorSeasonRecord } from './types'
import { sampleNormal } from './rng-utils'

// 3-race cycle base gain: median +3, Q1 +1.5, Q3 +4.5. For a normal curve Q1 = μ − 0.6745σ,
// so σ = (3 − 1.5) / 0.6745 ≈ 2.224. This anchors a car ON the pace at a 3-race cycle; longer cycles
// scale the median up linearly with the cycle length (see rollUpgrade).
const BASE_MEDIAN = 3
const BASE_SIGMA = 1.5 / 0.6745

// Catch-up development: a car's expected upgrade grows with how far it sits BEHIND the fastest car
// (deficit in pace points), so slower teams gain more and the field converges over a season. Replaces
// the old funding-tier penalty. 0.125 closes a 1.8s opening spread to ~1.15s by season end (10-team,
// 24-round; see scripts/catchup-sim.ts).
const CATCHUP_PER_POINT = 0.125

// Financial tier's nudge in the end-of-season reshuffle: a small per-tier bonus to the sort so richer
// teams (tier 1) drift up the order. At 0.4 the tier1↔tier4 swing is worth ~1.2 grid slots — enough to
// claw back a one-place on-track result, not a two-place one. Tier only TILTS the jitter, never dictates.
const FUNDING_TIER_STEP = 0.4

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function randomCycleLength(rng: () => number): number {
  return Math.floor(rng() * 4) + 3 // 3–6
}

// Roll the outcome of a single upgrade ahead of time so the player can inspect and god-mode edit it
// before it lands. `deficit` is the car's pace points behind the current fastest car: a bigger deficit
// adds a bigger catch-up bonus, so the returned paceDelta is the final pace gain. 5% chance of a total
// failure (no benefit at all).
export function rollUpgrade(
  cycleLength: number,
  deficit: number,
  rng: () => number,
): { paceDelta: number; failed: boolean } {
  if (rng() < 0.05) return { paceDelta: 0, failed: true }
  // Median base gain scales LINEARLY with the cycle (a longer cycle is more dev time) and compounds 5%
  // per race over the 3-race floor: cycleLength · 1.05^(cycleLength − 3). (The old constant base dropped
  // the linear cycle term — a bug.) Spread keeps the cycle-3 shape via its coefficient of variation.
  const median = cycleLength * Math.pow(1.05, cycleLength - 3)
  const raw = Math.max(0, sampleNormal(median, median * (BASE_SIGMA / BASE_MEDIAN), rng))
  const catchUp = Math.max(0, deficit) * CATCHUP_PER_POINT
  return { paceDelta: round1(raw + catchUp), failed: false }
}

export function computeFundingTiers(
  teams: Team[],
  history: ConstructorSeasonRecord[],
): Map<string, FundingTier> {
  const n = teams.length

  // Pace order is the final tiebreak: fastest current car ranks first. It also drives
  // the all-zero-history bootstrap (every team tied on 0 seasons → ranked purely by
  // pace, i.e. "best-paced team won the last five years" — GDD §Funding tier).
  const paceRank = new Map<string, number>()
  ;[...teams]
    .sort((a, b) => b.carPace - a.carPace)
    .forEach((t, i) => paceRank.set(t.id, i + 1))

  // Count each team's archived seasons (within the recent window) and its average
  // constructors' finish over only those seasons — no backfill of missing years.
  const years = new Map<string, number>()
  const sumPos = new Map<string, number>()
  for (const team of teams) {
    years.set(team.id, 0)
    sumPos.set(team.id, 0)
  }
  for (const r of history) {
    if (!years.has(r.teamId)) continue // team no longer on the grid
    years.set(r.teamId, years.get(r.teamId)! + 1)
    sumPos.set(r.teamId, sumPos.get(r.teamId)! + r.finalPosition)
  }
  const avgPos = (id: string): number | null =>
    years.get(id)! > 0 ? sumPos.get(id)! / years.get(id)! : null

  // Rank best→worst lexicographically:
  //   1. more seasons of history ranks higher — an incomplete record always sits
  //      below a fuller one (4 years above 3, and so on);
  //   2. within equal history length, a better average finish ranks higher;
  //   3. remaining ties (incl. brand-new teams with no history) fall back to car pace.
  const ranked = [...teams].sort((a, b) => {
    const yd = years.get(b.id)! - years.get(a.id)!
    if (yd !== 0) return yd
    const pa = avgPos(a.id)
    const pb = avgPos(b.id)
    if (pa !== null && pb !== null && pa !== pb) return pa - pb
    return paceRank.get(a.id)! - paceRank.get(b.id)!
  })

  // Tier 1 = top 3, Tier 4 = bottom 3, remaining split evenly between T2/T3.
  const middle = Math.max(0, n - 6)
  const t2Count = Math.ceil(middle / 2)

  const result = new Map<string, FundingTier>()
  ranked.forEach((t, i) => {
    let tier: FundingTier
    if (i < 3) tier = 1
    else if (i >= n - 3) tier = 4
    else if (i - 3 < t2Count) tier = 2
    else tier = 3
    result.set(t.id, tier)
  })
  return result
}

export function initDevPlans(
  teams: Team[],
  tiers: Map<string, FundingTier>,
  rng: () => number,
): TeamDevPlan[] {
  // Counter starts in Australia (round 1); the first upgrade lands cycleLength races later. The catch-up
  // bonus is measured against the fastest car, so the cars further back pre-roll bigger gains.
  const leaderPace = Math.max(...teams.map((t) => t.carPace))
  return teams.map((team) => {
    const cycleLength = randomCycleLength(rng)
    const fundingTier = tiers.get(team.id) ?? 2
    const pending = rollUpgrade(cycleLength, leaderPace - team.carPace, rng)
    return {
      teamId: team.id,
      cycleLength,
      nextUpgradeRound: cycleLength,
      fundingTier,
      cumulativePenalty: 0,
      pendingPaceDelta: pending.paceDelta,
      pendingFailed: pending.failed,
    }
  })
}

// Deliver any upgrades due this round. The funding-tier penalty is applied to the
// upgrade amount (not the raw car pace), and the cycle length is re-randomised per upgrade.
export function applyUpgradeEvents(
  round: number,
  teams: Team[],
  devPlans: TeamDevPlan[],
  rng: () => number,
): { upgradeEvents: DevUpgradeEvent[]; updatedTeams: Team[]; updatedDevPlans: TeamDevPlan[] } {
  const upgradeEvents: DevUpgradeEvent[] = []
  const teamMap = new Map(teams.map((t) => [t.id, { ...t }]))
  const leaderPace = () => Math.max(...[...teamMap.values()].map((t) => t.carPace))

  const updatedDevPlans = devPlans.map((plan) => {
    if (round !== plan.nextUpgradeRound) return plan

    const team = teamMap.get(plan.teamId)

    // Deliver the upgrade rolled ahead of time (and possibly god-mode edited). Saves from before
    // pre-rolling won't have it — roll lazily as a fallback, against the current pace deficit.
    const prerolled = plan.pendingPaceDelta === undefined || plan.pendingFailed === undefined
      ? rollUpgrade(plan.cycleLength, leaderPace() - (team?.carPace ?? 75), rng)
      : { paceDelta: plan.pendingPaceDelta, failed: plan.pendingFailed }
    const failed = prerolled.failed
    const paceDelta = failed ? 0 : prerolled.paceDelta

    upgradeEvents.push({ teamId: plan.teamId, round, paceDelta, failed })

    if (team && paceDelta > 0) {
      team.carPace = round1(team.carPace + paceDelta)
      teamMap.set(plan.teamId, team)
    }

    // Pick a fresh cycle for the next upgrade and pre-roll its outcome against the freshly-updated
    // deficit, so a car that has caught up rolls a smaller catch-up next time (it self-limits).
    const nextCycle = randomCycleLength(rng)
    const nextPending = rollUpgrade(nextCycle, leaderPace() - (team?.carPace ?? 75), rng)
    return {
      ...plan,
      cycleLength: nextCycle,
      nextUpgradeRound: plan.nextUpgradeRound + nextCycle,
      cumulativePenalty: 0,
      pendingPaceDelta: nextPending.paceDelta,
      pendingFailed: nextPending.failed,
    }
  })

  return {
    upgradeEvents,
    updatedTeams: teams.map((t) => teamMap.get(t.id) ?? t),
    updatedDevPlans,
  }
}

// End of season: number teams by car pace (fastest = 1), add a Uniform(−1.5, +3) modifier to that rank
// PLUS a small financial-tier nudge (richer teams drift up), re-rank by the total (smallest = best),
// then redistribute 75/70/65… Tier only tilts the existing jitter; it does not dictate the order.
export function computeCarReshuffle(
  teams: Team[],
  tiers: Map<string, FundingTier>,
  rng: () => number,
): { updatedTeams: Team[]; oldPaces: Record<string, number>; newPaces: Record<string, number> } {
  const oldPaces: Record<string, number> = {}
  for (const t of teams) oldPaces[t.id] = t.carPace

  const byPace = [...teams].sort((a, b) => b.carPace - a.carPace)
  const scored = byPace.map((t, i) => ({
    id: t.id,
    total: (i + 1) + (rng() * 4.5 - 1.5) + (tiers.get(t.id) ?? 2) * FUNDING_TIER_STEP, // rank + jitter + tier nudge
  }))
  scored.sort((a, b) => a.total - b.total)

  const newPaces: Record<string, number> = {}
  scored.forEach((s, i) => {
    newPaces[s.id] = Math.max(5, 75 - i * 5)
  })

  const updatedTeams = teams.map((t) => ({ ...t, carPace: newPaces[t.id] }))
  return { updatedTeams, oldPaces, newPaces }
}
