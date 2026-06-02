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

export function computeFundingTiers(
  teams: Team[],
  history: ConstructorSeasonRecord[],
): Map<string, FundingTier> {
  const n = teams.length

  // No/partial history: fill missing years assuming the fastest-paced team finished
  // 1st, second-fastest 2nd, and so on (GDD §Funding tier).
  const paceOrder = [...teams].sort((a, b) => b.carPace - a.carPace)
  const assumedPos = new Map<string, number>()
  paceOrder.forEach((t, i) => assumedPos.set(t.id, i + 1))

  // Average constructors' championship position over the last 5 seasons.
  const avgPos = new Map<string, number>()
  for (const team of teams) {
    const recs = history
      .filter((r) => r.teamId === team.id)
      .sort((a, b) => b.seasonYear - a.seasonYear)
      .slice(0, 5)
    const positions: number[] = []
    for (let i = 0; i < 5; i++) {
      positions.push(i < recs.length ? recs[i].finalPosition : (assumedPos.get(team.id) ?? n))
    }
    avgPos.set(team.id, positions.reduce((a, b) => a + b, 0) / positions.length)
  }

  // Rank best→worst. Tier 1 = top 3, Tier 4 = bottom 3, remaining split evenly between T2/T3.
  const ranked = [...teams].sort((a, b) => avgPos.get(a.id)! - avgPos.get(b.id)!)
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
    return {
      teamId: team.id,
      cycleLength,
      nextUpgradeRound: cycleLength,
      fundingTier: tiers.get(team.id) ?? 2,
      cumulativePenalty: 0,
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

    let paceDelta = 0
    let failed = false

    if (rng() < 0.05) {
      // 5% chance of a total failure — no benefit at all.
      failed = true
    } else {
      const scale = Math.pow(1.05, plan.cycleLength - 3)
      const raw = Math.max(0, sampleNormal(BASE_MEDIAN, BASE_SIGMA, rng)) * scale
      const penalty = TIER_PENALTY_PER_RACE[plan.fundingTier] * plan.cycleLength
      paceDelta = round1(Math.max(0, raw - penalty))
    }

    upgradeEvents.push({ teamId: plan.teamId, round, paceDelta, failed })

    const team = teamMap.get(plan.teamId)
    if (team && paceDelta > 0) {
      team.carPace = round1(Math.min(100, team.carPace + paceDelta))
      teamMap.set(plan.teamId, team)
    }

    // Pick a fresh cycle length for the next upgrade.
    const nextCycle = randomCycleLength(rng)
    return {
      ...plan,
      cycleLength: nextCycle,
      nextUpgradeRound: plan.nextUpgradeRound + nextCycle,
      cumulativePenalty: plan.cumulativePenalty + TIER_PENALTY_PER_RACE[plan.fundingTier] * plan.cycleLength,
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
