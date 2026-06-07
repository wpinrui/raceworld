import type { TyreCompound, WeatherPoint } from './types'
import { tyreStepsOutOfWindow, recommendTyre } from './tyres'
import { DEFAULT_COMPOUND_DELTAS, DEFAULT_TYRE_LIFE } from './tyres'
import { forecastMoistureAtLap } from './weather'

// ============================================================================================
// Pit strategy with imperfect information.
//
// A perfect-information optimiser exists (the god-mode "Perfect strategy" panel, fed truthBelief()).
// The RACING AI instead plans on a per-team BELIEF that starts as an educated guess and sharpens as
// the team runs each compound. Two things are hidden from the pit wall:
//   1. The per-race truth (pace deltas + base life) is randomised each race, so priors are only roughly
//      right and must be learned by running.
//   2. Live tyre CONDITION is read only in coarse 15% buckets — so the team can't read exact wear and
//      must infer the wear rate from how the bucketed condition has moved, which sharpens with laps.
// Both garages feed one team belief (pooled), normalised by each driver's own (known) smoothness.
//
// The plan yields a pit WINDOW (its width = the team's current wear uncertainty); within the window the
// car pits for an undercut or for clear air, and is forced out at the real cliff / window end.
// ============================================================================================

export interface PitDecision {
  shouldPit: boolean
  targetCompound: TyreCompound
}

const WEAR_PENALTY = 0.1 / 4 // seconds per 1% condition lost (matches engine lap-time model)
const CLIFF_PENALTY = 5 // extra seconds/lap once a tyre is dead
const MOISTURE_PENALTY = 15 // seconds/lap per step the compound is out of its moisture window (engine)
const EFFECTIVE_CLIFF_PCT = 10 // teams treat a tyre as dead a bit before 0% — a planning buffer
const REAL_CLIFF_BUFFER = 4 // force a stop once the REAL condition is this close to falling off
const ALL_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']

// In-window execution thresholds (sim-and-tune).
const UNDERCUT_GAP = 2.5 // a car this close ahead is undercuttable
const CLEAR_AIR_GAP = 2.0 // rejoin counts as clean if the nearest car ahead is at least this far
const TARGET_PIT_PCT = 14 // aim to pit at ~this projected condition (lands in the 10-15% band)
const UNDERCUT_EARLY_PCT = 4 // may pit this much earlier (higher condition) to undercut a rival
const CLEAR_AIR_GRACE_PCT = 5 // with no clear air, pit by (TARGET − this) rather than ride to the cliff
const WINDOW_MAX = 8 // widest half-window (laps) when the team is most uncertain

// --- condition buckets ------------------------------------------------------------------------
// The pit wall reads live condition only to a coarse 25-wide bucket (0-25, 25-50, 50-75, 75-100); it
// never knows finer. We hand the optimiser the bucket midpoint.
export function bucketCondition(cond: number): number {
  const c = Math.max(0, Math.min(100, cond))
  if (c >= 75) return 87.5
  return Math.floor(c / 25) * 25 + 12.5
}

// --- belief model -----------------------------------------------------------------------------
interface CompoundBelief {
  baseWearRate: number // believed condition %/lap BEFORE smoothness (pooled across both drivers)
  wearObs: number // effective observation weight (confidence) — higher = tighter window
  delta: number // believed pace delta (s/lap)
  deltaObs: number
}
export type TeamBelief = Record<TyreCompound, CompoundBelief>

const PRIOR_WEIGHT = 2 // how many "laps" of confidence the opening guess is worth

// One team's opening guess for a race: priors from the generic GDD anchors, knocked off-true by a
// modest random offset (flat quality across teams — just randomness, no skill tiers).
export function initTeamBelief(totalLaps: number): TeamBelief {
  const belief = {} as TeamBelief
  for (const c of ALL_COMPOUNDS) {
    const priorLaps = Math.max(1, DEFAULT_TYRE_LIFE[c] * totalLaps)
    const priorRate = 100 / priorLaps
    belief[c] = {
      baseWearRate: priorRate * (1 + (Math.random() - 0.5) * 0.5), // ±25%
      wearObs: PRIOR_WEIGHT,
      delta: Math.max(0, DEFAULT_COMPOUND_DELTAS[c] + (Math.random() - 0.5) * 0.6),
      deltaObs: PRIOR_WEIGHT,
    }
  }
  return belief
}

// Fold one car's lap into the team belief. Wear is inferred from the (bucketed) condition seen so far
// this stint, normalised by the driver's own smoothness to recover the driver-independent base rate;
// pace converges toward the race's true delta the longer the compound is run. Returns a new belief.
const FRESH_BUCKET = 87.5 // a fresh tyre (100%) reads as this bucket midpoint

export function observeTyre(
  belief: TeamBelief,
  compound: TyreCompound,
  bucketedCondition: number,
  stintLap: number,
  smoothness: number,
  trueDelta: number,
): TeamBelief {
  const cb = belief[compound]
  // Pace converges toward the race's true delta the longer the compound is run.
  const deltaObs = Math.min(cb.deltaObs + 1, 40)
  const delta = (cb.delta * cb.deltaObs + trueDelta) / (cb.deltaObs + 1)

  // Wear can only be READ once condition has dropped out of the fresh (top) bucket — before that there
  // is no signal, so the prior stands (wide window, no premature stop). Measuring the drop from the
  // fresh bucket (not a notional 100%) avoids over-reading deg in the first few laps.
  let baseWearRate = cb.baseWearRate
  let wearObs = cb.wearObs
  if (stintLap >= 2 && bucketedCondition < FRESH_BUCKET) {
    const smoothMult = 0.5 + smoothness / 100
    const observedBaseRate = Math.max(0.1, ((100 - bucketedCondition) / stintLap) / smoothMult)
    wearObs = Math.min(cb.wearObs + 1, 40)
    baseWearRate = (cb.baseWearRate * cb.wearObs + observedBaseRate) / (cb.wearObs + 1)
  }
  return { ...belief, [compound]: { baseWearRate, wearObs, delta, deltaObs } }
}

// A perfect-information belief (no noise, full confidence) from the race's true deltas + base life.
// Feeds the god-mode "Perfect strategy" benchmark.
export function truthBelief(
  compoundDeltas: Record<TyreCompound, number>,
  tyreBaseLife: Record<TyreCompound, number>,
  totalLaps: number,
): TeamBelief {
  const belief = {} as TeamBelief
  for (const c of ALL_COMPOUNDS) {
    belief[c] = {
      baseWearRate: 100 / Math.max(1, tyreBaseLife[c] * totalLaps),
      wearObs: 999,
      delta: compoundDeltas[c],
      deltaObs: 999,
    }
  }
  return belief
}

// --- the optimiser ----------------------------------------------------------------------------
export interface StrategyStint {
  fromLap: number
  toLap: number
  compound: TyreCompound
}
export interface StrategyPlan {
  targetPitLap: number | null
  targetNextCompound: TyreCompound
  windowStart: number | null
  windowEnd: number | null
  stints: StrategyStint[]
}

// Believed cost of running `laps` laps on `compound` from `startCond`, using the team's believed wear
// rate (× smoothness) and pace delta, plus the projected moisture penalty from the team's forecast.
function stintCost(
  laps: number,
  fromLap: number,
  compound: TyreCompound,
  startCond: number,
  belief: TeamBelief,
  smoothness: number,
  currentLap: number,
  projMoisture: number[],
): number {
  const rate = belief[compound].baseWearRate * (0.5 + smoothness / 100)
  const delta = belief[compound].delta
  let cost = 0
  let cond = startCond
  for (let i = 0; i < laps; i++) {
    const idx = fromLap + i - currentLap
    const moisture = projMoisture[idx] ?? projMoisture[projMoisture.length - 1] ?? 0
    const cliff = cond <= EFFECTIVE_CLIFF_PCT ? CLIFF_PENALTY : 0
    const wrongTyre = tyreStepsOutOfWindow(compound, moisture) * MOISTURE_PENALTY
    cost += delta + (100 - cond) * WEAR_PENALTY + cliff + wrongTyre
    cond = Math.max(0, cond - rate)
  }
  return cost
}

// Compounds worth considering for a stint at a given projected moisture — keeps the 2-stop search
// tractable and stops teams planning slicks in a downpour or wets in the dry.
function sensibleCompounds(moisture: number): TyreCompound[] {
  return ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) <= 1)
}

// Solve the believed-optimal strategy from the current (bucketed) state, weather-aware, then express
// the first stop as a window whose width reflects how confident the team is in its wear read.
export function planStrategy(
  currentLap: number,
  totalLaps: number,
  bucketedCondition: number,
  currentCompound: TyreCompound,
  smoothness: number,
  belief: TeamBelief,
  weather: WeatherPoint[],
  forecast: WeatherPoint[],
  pitCost: number, // era pit-lane loss (issue #101); same source the runtime applies
): StrategyPlan {
  const lapsRemaining = totalLaps - currentLap
  if (lapsRemaining <= 1) {
    return { targetPitLap: null, targetNextCompound: currentCompound, windowStart: null, windowEnd: null, stints: [{ fromLap: currentLap, toLap: totalLaps, compound: currentCompound }] }
  }

  // Project this race's (forecast) moisture once per call so the cost search doesn't recompute it.
  const projMoisture: number[] = []
  for (let lap = currentLap; lap <= totalLaps; lap++) projMoisture[lap - currentLap] = forecastMoistureAtLap(weather, forecast, lap, currentLap)
  const midMoisture = projMoisture[Math.floor(projMoisture.length / 2)] ?? 0
  const candidates = sensibleCompounds(midMoisture)

  // Best compound to fit if we had to pit now for the rest of the race — the forced/late-stop choice.
  let forcedC: TyreCompound = currentCompound
  let forcedCost = Infinity
  for (const c of candidates) {
    const cost = stintCost(lapsRemaining, currentLap, c, 100, belief, smoothness, currentLap, projMoisture)
    if (cost < forcedCost) { forcedCost = cost; forcedC = c }
  }
  // 0-stop is only on the table if the current tyre would actually reach the flag above the cliff —
  // otherwise riding it to the end just earns a forced cliff stop anyway.
  const wearRate = belief[currentCompound].baseWearRate * (0.5 + smoothness / 100)
  const zeroStopViable = bucketedCondition - wearRate * lapsRemaining > REAL_CLIFF_BUFFER
  let bestCost = zeroStopViable ? stintCost(lapsRemaining, currentLap, currentCompound, bucketedCondition, belief, smoothness, currentLap, projMoisture) : Infinity
  let bestP1: number | null = null
  let bestC2: TyreCompound = currentCompound
  let bestP2: number | null = null
  let bestC3: TyreCompound | null = null

  // 1-stop
  for (let offset = 3; offset <= lapsRemaining - 3; offset++) {
    const s1 = stintCost(offset, currentLap, currentCompound, bucketedCondition, belief, smoothness, currentLap, projMoisture)
    for (const c2 of candidates) {
      const cost = s1 + pitCost + stintCost(lapsRemaining - offset, currentLap + offset, c2, 100, belief, smoothness, currentLap, projMoisture)
      if (cost < bestCost) { bestCost = cost; bestP1 = currentLap + offset; bestC2 = c2; bestP2 = null; bestC3 = null }
    }
  }

  // 2-stop (longer races only)
  if (lapsRemaining >= 40) {
    for (let p1 = 3; p1 <= lapsRemaining - 6; p1++) {
      const s1 = stintCost(p1, currentLap, currentCompound, bucketedCondition, belief, smoothness, currentLap, projMoisture)
      for (let p2 = p1 + 3; p2 <= lapsRemaining - 3; p2++) {
        for (const c2 of candidates) {
          const s2 = stintCost(p2 - p1, currentLap + p1, c2, 100, belief, smoothness, currentLap, projMoisture)
          for (const c3 of candidates) {
            const cost = s1 + pitCost + s2 + pitCost + stintCost(lapsRemaining - p2, currentLap + p2, c3, 100, belief, smoothness, currentLap, projMoisture)
            if (cost < bestCost) { bestCost = cost; bestP1 = currentLap + p1; bestC2 = c2; bestP2 = currentLap + p2; bestC3 = c3 }
          }
        }
      }
    }
  }

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

  // Window: half-width shrinks as the team gathers wear observations on the current compound; capped
  // before the believed cliff so the plan never rides past where it thinks the tyre dies.
  let windowStart: number | null = null
  let windowEnd: number | null = null
  if (bestP1 !== null) {
    const obsBeyondPrior = Math.max(0, belief[currentCompound].wearObs - PRIOR_WEIGHT)
    const halfWidth = Math.max(1, Math.round(WINDOW_MAX * (3 / (3 + obsBeyondPrior))))
    const rate = belief[currentCompound].baseWearRate * (0.5 + smoothness / 100)
    const believedCliffLap = currentLap + Math.max(1, (bucketedCondition - EFFECTIVE_CLIFF_PCT) / Math.max(0.1, rate))
    windowStart = Math.max(currentLap, bestP1 - halfWidth)
    windowEnd = Math.min(totalLaps, Math.round(Math.min(bestP1 + halfWidth, believedCliffLap)))
    if (windowEnd < windowStart) windowEnd = windowStart
  }

  return { targetPitLap: bestP1, targetNextCompound: bestP1 !== null ? bestC2 : forcedC, windowStart, windowEnd, stints }
}

// --- execution --------------------------------------------------------------------------------
export interface FieldCar {
  driverId: string
  position: number
  totalTime: number // cumulative race time (s) — for the rejoin projection
  condition: number // REAL condition (the team can see a rival's tyre age)
  retired: boolean
}

// Decide whether to box THIS lap. Forced by a badly wrong tyre for the conditions or the real cliff.
// Otherwise the car aims to pit at ~TARGET_PIT_PCT projected condition (which lands ~10-15% real),
// PREFERRING clear air on rejoin (a preference, not a veto) and taking an undercut when one is on.
export function decidePit(
  plan: StrategyPlan,
  realCondition: number,
  projectedCond: number,
  currentCompound: TyreCompound,
  currentMoisture: number,
  self: FieldCar,
  field: FieldCar[],
  pitCost: number, // era pit-lane loss (issue #101), for the rejoin projection
): PitDecision {
  const target = plan.targetNextCompound

  // Forced: wrong tyre for the actual weather — fit what suits NOW (not the strategy's mid-race pick,
  // which may be dry if the shower passes, else we'd pit straight back).
  if (tyreStepsOutOfWindow(currentCompound, currentMoisture) >= 2) return { shouldPit: true, targetCompound: recommendTyre(currentMoisture) }
  // Forced: real tyre about to fall off the cliff.
  if (realCondition <= REAL_CLIFF_BUFFER) return { shouldPit: true, targetCompound: target }
  // Optimiser plans no stop (the current tyre reaches the flag above the cliff) — sit out.
  if (plan.targetPitLap === null) return { shouldPit: false, targetCompound: target }

  // Real rejoin projection: slot the car back in by race time (its totalTime + the pit loss) and read
  // the gap to whoever it would come out behind.
  const rejoinTime = self.totalTime + pitCost
  let aheadTime = -Infinity
  for (const c of field) {
    if (c.driverId === self.driverId || c.retired) continue
    if (c.totalTime <= rejoinTime && c.totalTime > aheadTime) aheadTime = c.totalTime
  }
  const clearAir = aheadTime === -Infinity || rejoinTime - aheadTime >= CLEAR_AIR_GAP

  // Undercut: tyre worn enough, a beatable car directly ahead (close in race time, on tyres no fresher),
  // and a clean rejoin → pit early to jump it.
  const carAhead = field.find((c) => c.position === self.position - 1 && !c.retired)
  const gapAhead = carAhead ? self.totalTime - carAhead.totalTime : Infinity
  const beatable = !!carAhead && gapAhead <= UNDERCUT_GAP && carAhead.condition <= self.condition + 5
  if (beatable && clearAir && projectedCond <= TARGET_PIT_PCT + UNDERCUT_EARLY_PCT) return { shouldPit: true, targetCompound: target }

  // Normal stop: aim for ~TARGET_PIT_PCT projected. Clear air is a PREFERENCE, not a veto — with none,
  // pit a little past target rather than ride to the cliff.
  if (projectedCond <= TARGET_PIT_PCT && clearAir) return { shouldPit: true, targetCompound: target }
  if (projectedCond <= TARGET_PIT_PCT - CLEAR_AIR_GRACE_PCT) return { shouldPit: true, targetCompound: target }
  return { shouldPit: false, targetCompound: target }
}
