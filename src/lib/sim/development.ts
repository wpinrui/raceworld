import type { Team, TeamDevPlan, DevUpgradeEvent, FundingTier, ConstructorSeasonRecord } from './types'
import { sampleNormal } from './rng-utils'

const TIER_PENALTY: Record<FundingTier, number> = { 1: 0, 2: -0.1, 3: -0.15, 4: -0.2 }

const UPGRADE_PARAMS: Record<number, { mean: number; stddev: number }> = {
  3: { mean: 1.2, stddev: 0.5 },
  4: { mean: 1.5, stddev: 0.5 },
  5: { mean: 1.8, stddev: 0.5 },
  6: { mean: 2.2, stddev: 0.6 },
}

export function computeFundingTiers(
  teams: Team[],
  history: ConstructorSeasonRecord[],
): Map<string, FundingTier> {
  const result = new Map<string, FundingTier>()

  for (const team of teams) {
    const records = history
      .filter((r) => r.teamId === team.id)
      .sort((a, b) => b.seasonYear - a.seasonYear)
      .slice(0, 5)

    if (records.length === 0) {
      result.set(team.id, 2)
      continue
    }

    const weights = [5, 4, 3, 2, 1].slice(0, records.length)
    const weightSum = weights.reduce((a, b) => a + b, 0)
    const weightedAvg =
      records.reduce((sum, r, i) => sum + r.finalPosition * weights[i], 0) / weightSum

    let tier: FundingTier
    if (weightedAvg <= 3) tier = 1
    else if (weightedAvg <= 6) tier = 2
    else if (weightedAvg <= 8) tier = 3
    else tier = 4

    result.set(team.id, tier)
  }

  return result
}

export function initDevPlans(
  teams: Team[],
  tiers: Map<string, FundingTier>,
  rng: () => number,
): TeamDevPlan[] {
  return teams.map((team) => {
    const cycleLength = Math.floor(rng() * 4) + 3  // [3, 6]
    const fundingTier = tiers.get(team.id) ?? 2
    return {
      teamId: team.id,
      cycleLength,
      nextUpgradeRound: cycleLength,
      fundingTier,
      cumulativePenalty: 0,
    }
  })
}

export function applyFundingPenalties(
  teams: Team[],
  devPlans: TeamDevPlan[],
): { updatedTeams: Team[]; updatedDevPlans: TeamDevPlan[] } {
  const updatedTeams = teams.map((team) => {
    const plan = devPlans.find((p) => p.teamId === team.id)
    if (!plan) return team
    const penalty = TIER_PENALTY[plan.fundingTier]
    return { ...team, carPace: Math.max(5, team.carPace + penalty) }
  })

  const updatedDevPlans = devPlans.map((plan) => {
    const penalty = Math.abs(TIER_PENALTY[plan.fundingTier])
    return { ...plan, cumulativePenalty: plan.cumulativePenalty + penalty }
  })

  return { updatedTeams, updatedDevPlans }
}

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

    let paceDelta: number
    let failed: boolean

    if (rng() < 0.05) {
      // Failure
      paceDelta = Math.max(-1, Math.min(0, sampleNormal(-0.3, 0.2, rng)))
      failed = true
    } else {
      const params = UPGRADE_PARAMS[plan.cycleLength] ?? UPGRADE_PARAMS[4]
      paceDelta = Math.max(0.1, Math.min(4, sampleNormal(params.mean, params.stddev, rng)))
      failed = false
    }

    upgradeEvents.push({ teamId: plan.teamId, round, paceDelta, failed })

    const team = teamMap.get(plan.teamId)
    if (team) {
      team.carPace = Math.max(5, Math.min(100, team.carPace + paceDelta))
      teamMap.set(plan.teamId, team)
    }

    return { ...plan, nextUpgradeRound: plan.nextUpgradeRound + plan.cycleLength }
  })

  return {
    upgradeEvents,
    updatedTeams: teams.map((t) => teamMap.get(t.id) ?? t),
    updatedDevPlans,
  }
}

export function computeCarReshuffle(
  teams: Team[],
  rng: () => number,
): { updatedTeams: Team[]; oldPaces: Record<string, number>; newPaces: Record<string, number> } {
  const oldPaces: Record<string, number> = {}
  for (const t of teams) oldPaces[t.id] = t.carPace

  const scored = teams.map((t) => ({
    ...t,
    score: t.carPace + sampleNormal(0.75, 1.5, rng),  // N(0.75, 1.5), slight positive skew
  }))

  scored.sort((a, b) => b.score - a.score)

  const newPaces: Record<string, number> = {}
  const updatedTeams = scored.map((t, idx) => {
    const newPace = Math.max(5, 75 - idx * 5)
    newPaces[t.id] = newPace
    return { id: t.id, name: t.name, shortName: t.shortName, color: t.color, carPace: newPace }
  })

  // Restore original order (by original index) to keep array order stable
  const orderedTeams = teams.map((orig) => updatedTeams.find((u) => u.id === orig.id)!)

  return { updatedTeams: orderedTeams, oldPaces, newPaces }
}
