import type { Team, TeamDevPlan, DevUpgradeEvent, FundingTier, ConstructorSeasonRecord } from './types'
import { sampleNormal } from './rng-utils'

// Per-race funding penalty (subtracted from the upgrade delta as penalty × cycleLength).
const TIER_PENALTY_PER_RACE: Record<FundingTier, number> = { 1: 0, 2: 0.1, 3: 0.15, 4: 0.2 }

// 3-race cycle: median +3, Q1 +1.5, Q3 +4.5. For a normal curve Q1 = μ − 0.6745σ,
// so σ = (3 − 1.5) / 0.6745 ≈ 2.224.
const BASE_MEDIAN = 3
const BASE_SIGMA = 1.5 / 0.6745

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function randomCycleLength(rng: () => number): number {
  return Math.floor(rng() * 4) + 3 // 3–6
}

// Roll the outcome of a single upgrade ahead of time so the player can inspect and
// god-mode edit it before it lands. The funding-tier penalty is baked in, so the
// returned paceDelta is the final pace gain (clamped ≥ 0). 5% chance of a total
// failure (no benefit at all).
export function rollUpgrade(
  cycleLength: number,
  fundingTier: FundingTier,
  rng: () => number,
): { paceDelta: number; failed: boolean } {
  if (rng() < 0.05) return { paceDelta: 0, failed: true }
  const scale = Math.pow(1.05, cycleLength - 3)
  const raw = Math.max(0, sampleNormal(BASE_MEDIAN, BASE_SIGMA, rng)) * scale
  const penalty = TIER_PENALTY_PER_RACE[fundingTier] * cycleLength
  return { paceDelta: round1(Math.max(0, raw - penalty)), failed: false }
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
  // Counter starts in Australia (round 1); the first upgrade lands cycleLength races later.
  return teams.map((team) => {
    const cycleLength = randomCycleLength(rng)
    const fundingTier = tiers.get(team.id) ?? 2
    const pending = rollUpgrade(cycleLength, fundingTier, rng)
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

  const updatedDevPlans = devPlans.map((plan) => {
    if (round !== plan.nextUpgradeRound) return plan

    // Deliver the upgrade rolled ahead of time (and possibly god-mode edited).
    // Saves from before pre-rolling won't have it — roll lazily as a fallback.
    const prerolled = plan.pendingPaceDelta === undefined && plan.pendingFailed === undefined
      ? rollUpgrade(plan.cycleLength, plan.fundingTier, rng)
      : { paceDelta: plan.pendingPaceDelta ?? 0, failed: plan.pendingFailed ?? false }
    const failed = prerolled.failed
    const paceDelta = failed ? 0 : prerolled.paceDelta

    upgradeEvents.push({ teamId: plan.teamId, round, paceDelta, failed })

    const team = teamMap.get(plan.teamId)
    if (team && paceDelta > 0) {
      team.carPace = round1(Math.min(100, team.carPace + paceDelta))
      teamMap.set(plan.teamId, team)
    }

    // Pick a fresh cycle for the next upgrade and pre-roll its outcome.
    const nextCycle = randomCycleLength(rng)
    const nextPending = rollUpgrade(nextCycle, plan.fundingTier, rng)
    return {
      ...plan,
      cycleLength: nextCycle,
      nextUpgradeRound: plan.nextUpgradeRound + nextCycle,
      cumulativePenalty: plan.cumulativePenalty + TIER_PENALTY_PER_RACE[plan.fundingTier] * plan.cycleLength,
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

// End of season: number teams by car pace (fastest = 1), add a Uniform(−1.5, +3) modifier
// to that rank, re-rank by the total (smallest = best), then redistribute 75/70/65…
export function computeCarReshuffle(
  teams: Team[],
  rng: () => number,
): { updatedTeams: Team[]; oldPaces: Record<string, number>; newPaces: Record<string, number> } {
  const oldPaces: Record<string, number> = {}
  for (const t of teams) oldPaces[t.id] = t.carPace

  const byPace = [...teams].sort((a, b) => b.carPace - a.carPace)
  const scored = byPace.map((t, i) => ({
    id: t.id,
    total: (i + 1) + (rng() * 4.5 - 1.5), // rank + Uniform(−1.5, +3)
  }))
  scored.sort((a, b) => a.total - b.total)

  const newPaces: Record<string, number> = {}
  scored.forEach((s, i) => {
    newPaces[s.id] = Math.max(5, 75 - i * 5)
  })

  const updatedTeams = teams.map((t) => ({ ...t, carPace: newPaces[t.id] }))
  return { updatedTeams, oldPaces, newPaces }
}
