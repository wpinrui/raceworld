import type { DriverRaceState, TyreCompound, TeamTyreAssumptions } from './types'

export interface PitDecision {
  shouldPit: boolean
  targetCompound: TyreCompound
}

const WEAR_PENALTY = 0.1 / 8   // seconds per 1% condition loss
const CLIFF_PENALTY = 5        // extra seconds/lap when condition = 0
const PIT_COST = 22            // seconds lost in the pit lane

const COMPOUND_DELTAS: Record<TyreCompound, number> = {
  soft: 0, medium: 0.7, hard: 1.5, intermediate: 2.5, wet: 4.0,
}

// True base wear rates: condition lost per lap = 100 / (basePct * totalLaps * 1.1)
// 1.1 = average smoothness multiplier assumption
const BASE_LIFE_PCT: Record<TyreCompound, number> = {
  soft: 0.16, medium: 0.275, hard: 0.425, intermediate: 0.275, wet: 0.425,
}

// Called once per team at race start. Both drivers share these assumptions.
// noiseLevel 0 = perfect information, 1 = ±30% error on wear rates.
export function sampleTeamAssumptions(totalLaps: number, noiseLevel: number): TeamTyreAssumptions {
  const result = {} as TeamTyreAssumptions
  for (const compound of ['soft', 'medium', 'hard', 'intermediate', 'wet'] as TyreCompound[]) {
    const trueLife = BASE_LIFE_PCT[compound] * totalLaps * 1.1
    const trueWearRate = 100 / trueLife
    const noise = 1 + noiseLevel * (Math.random() - 0.5) * 0.6  // ±30% at noise=1
    result[compound] = trueWearRate * noise
  }
  return result
}

// Cost of running `laps` laps on `compound` starting at `startCondition`
// using the given assumed wear rate.
// Teams model the tyre as effectively dead at 10% condition, not 0%.
// This builds in a conservative buffer — the optimizer plans to pit before
// condition hits 10%, avoiding both the real cliff and the degradation spike near it.
const EFFECTIVE_CLIFF_PCT = 10

function stintCost(
  laps: number,
  compound: TyreCompound,
  startCondition: number,
  wearRate: number,
): number {
  let cost = 0
  let cond = startCondition
  for (let i = 0; i < laps; i++) {
    const cliffPenalty = cond <= EFFECTIVE_CLIFF_PCT ? CLIFF_PENALTY : 0
    cost += COMPOUND_DELTAS[compound] + (100 - cond) * WEAR_PENALTY + cliffPenalty
    cond = Math.max(0, cond - wearRate)
  }
  return cost
}

export interface StrategyStint {
  fromLap: number
  toLap: number        // inclusive (last lap of this stint before pit/end)
  compound: TyreCompound
}

export interface StrategyPlan {
  targetPitLap: number | null
  targetNextCompound: TyreCompound
  stints: StrategyStint[]
}

// Solve for the optimal pit strategy from the current race state.
// Re-run every lap so the plan adapts to changing conditions (weather, actual wear).
// Returns the full sequence of stints for the remainder of the race.
export function planStrategy(
  currentLap: number,
  totalLaps: number,
  currentCondition: number,
  currentCompound: TyreCompound,
  currentMaxLifeLaps: number,
  assumptions: TeamTyreAssumptions,
): StrategyPlan {
  const lapsRemaining = totalLaps - currentLap
  const currentWearRate = 100 / currentMaxLifeLaps

  const dryCandidates: TyreCompound[] = ['soft', 'medium', 'hard']

  // Baseline: no pit
  let bestCost = stintCost(lapsRemaining, currentCompound, currentCondition, currentWearRate)
  let bestP1: number | null = null
  let bestC2: TyreCompound = currentCompound
  let bestP2: number | null = null
  let bestC3: TyreCompound | null = null

  // 1-stop
  for (let offset = 3; offset <= lapsRemaining - 3; offset++) {
    const stint1Cost = stintCost(offset, currentCompound, currentCondition, currentWearRate)
    const remaining = lapsRemaining - offset
    for (const c2 of dryCandidates) {
      const cost = stint1Cost + PIT_COST + stintCost(remaining, c2, 100, assumptions[c2])
      if (cost < bestCost) {
        bestCost = cost
        bestP1 = currentLap + offset
        bestC2 = c2
        bestP2 = null
        bestC3 = null
      }
    }
  }

  // 2-stop
  if (lapsRemaining >= 40) {
    for (let p1 = 3; p1 <= lapsRemaining - 6; p1++) {
      const stint1Cost = stintCost(p1, currentCompound, currentCondition, currentWearRate)
      for (let p2 = p1 + 3; p2 <= lapsRemaining - 3; p2++) {
        const stint3Laps = lapsRemaining - p2
        for (const c2 of dryCandidates) {
          const stint2Cost = stintCost(p2 - p1, c2, 100, assumptions[c2])
          for (const c3 of dryCandidates) {
            const cost = stint1Cost + PIT_COST + stint2Cost + PIT_COST + stintCost(stint3Laps, c3, 100, assumptions[c3])
            if (cost < bestCost) {
              bestCost = cost
              bestP1 = currentLap + p1
              bestC2 = c2
              bestP2 = currentLap + p2
              bestC3 = c3
            }
          }
        }
      }
    }
  }

  // Build full stint sequence
  const stints: StrategyStint[] = []
  if (bestP1 === null) {
    stints.push({ fromLap: currentLap, toLap: totalLaps, compound: currentCompound })
  } else if (bestP2 === null) {
    stints.push({ fromLap: currentLap, toLap: bestP1 - 1, compound: currentCompound })
    stints.push({ fromLap: bestP1, toLap: totalLaps, compound: bestC2 })
  } else {
    stints.push({ fromLap: currentLap, toLap: bestP1 - 1, compound: currentCompound })
    stints.push({ fromLap: bestP1, toLap: bestP2 - 1, compound: bestC2 })
    stints.push({ fromLap: bestP2, toLap: totalLaps, compound: bestC3! })
  }

  return {
    targetPitLap: bestP1,
    targetNextCompound: bestC2,
    stints,
  }
}

// Per-lap decision: cliff emergency, then execute the plan.
export function decidePit(
  state: DriverRaceState,
  currentLap: number,
  totalLaps: number,
): PitDecision {
  const lapsRemaining = totalLaps - currentLap

  if (lapsRemaining <= 2) {
    return { shouldPit: false, targetCompound: state.targetNextCompound }
  }

  // Tyre completely dead — must pit
  if (state.currentTyre.condition <= 0) {
    return { shouldPit: true, targetCompound: state.targetNextCompound }
  }

  // Execute the plan
  if (state.targetPitLap !== null && currentLap >= state.targetPitLap) {
    return { shouldPit: true, targetCompound: state.targetNextCompound }
  }

  return { shouldPit: false, targetCompound: state.targetNextCompound }
}
