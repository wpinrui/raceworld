import type { Driver, Team, TyreState, WeatherPoint, TyreCompound } from './types'
import { getMoistureAtLap } from './weather'
import { tyreStepsOutOfWindow } from './tyres'

export interface LapInput {
  driver: Driver
  team: Team
  tyre: TyreState
  form: number
  fuelLaps: number
  lap: number
  weather: WeatherPoint[]
  compoundDeltas: Record<TyreCompound, number>  // this race's per-compound pace deltas
  gapToCarAhead: number       // Infinity if leading
  carAheadLapTime: number | null  // the car ahead's EFFECTIVE lap time this lap (drives the gap evolution)
  carAheadFreeAir?: number | null // the car ahead's CLEAN-AIR pace this lap (drives the pace-edge gate)
  circuitFlatModifier: number
  defenderDriver?: Driver     // car directly ahead, for the contested-overtake crash roll (issue #60)
  noiseOverride?: number      // qualifying supplies its own noise model (more quali variation); races use the default
}

export interface LapResult {
  lapTime: number
  overtook: boolean
  freeAir: number             // this car's clean-air pace this lap (the next car back gates its pass on it)
  defenderPenalty?: number    // on a completed pass, the time the overtaken car loses (race.ts applies it)
  // A contested-overtake collision (issue #60). attacker/defender flag who retires (33/33/33).
  crash?: { happened: boolean; attacker: boolean; defender: boolean }
}

// Traffic / dirty-air model (make qualifying matter — overtaking was far too easy). Tunables:
const DIRTY_RANGE = 1.0       // s: a follower within this loses pace to dirty air
const MAX_DIRTY = 0.7         // s: pace lost right on the gearbox (gap 0); fades to 0 at DIRTY_RANGE
const SLIPSTREAM = 0.3        // s: tow a chasing car gets within DIRTY_RANGE — eases the pass, offsets dirty air
const STRIKE_RANGE = 1.0      // s: within this (~DRS range) a faster car gets a per-lap chance to pass
const PASS_MARGIN = 3.0       // s: only a car whose pace would leave it this far AHEAD blows straight by (rare)
const CONTEST_GAP = 0.15      // s: a car closing past this from beyond range arrives right behind, contests next lap
const OVERTAKE_SENS = 0.12    // per-lap pass chance per second of clean-air pace edge (overtaking is HARD:
                             //   a 0.4s/lap edge ≈ 5%/lap ≈ 20 laps to clear; a 2s edge ≈ 24%/lap ≈ 4 laps)
const MAX_CONTEST = 0.5       // cap on the per-lap pass chance from within range (no certain passes)
const ATTACKER_PENALTY = 0.2  // s: a completed pass costs the attacker this
const DEFENDER_PENALTY = 0.4  // s: ...and the overtaken car this (applied in race.ts)
const HOLD_GAP = 0.3          // s: a car that can't get by harries around this far behind, tyres cooking
const HOLD_JITTER = 0.3       // s: spread on the harry distance so a train isn't a column of identical +0.300s

// Same tunables, exported so the deterministic race projector (race-projector.ts) resolves traffic with the
// engine's exact numbers — its only difference is replacing the per-lap random pass roll with an accumulator.
export const TRAFFIC = { DIRTY_RANGE, MAX_DIRTY, SLIPSTREAM, STRIKE_RANGE, PASS_MARGIN, OVERTAKE_SENS, MAX_CONTEST, ATTACKER_PENALTY, DEFENDER_PENALTY, HOLD_GAP } as const

export function computeLapTime(input: LapInput): LapResult {
  const {
    driver,
    team,
    tyre,
    form,
    fuelLaps,
    lap,
    weather,
    gapToCarAhead,
    carAheadLapTime,
    circuitFlatModifier,
  } = input

  // 1. base
  const base = 100

  // 2. carMod = (75 - team.carPace) / 25
  const carMod = (75 - team.carPace) / 25

  // 3. moisture at this lap
  const moisture = getMoistureAtLap(weather, lap)

  // 4-5. driverMod — the driver's skill delta to lap time, from a 75 baseline. Pace and wet-weather pace
  // blend by moisture, each worth 0.03s/lap per rating point; the WET rating counts DOUBLE in the wet
  // (issue #102), so at full wet a wet-rating point is worth 0.06s/lap. Per-race form keeps its own
  // 0.02s/lap weight (unchanged).
  const WET_EFFECT_MULTIPLIER = 2
  const skillDelta =
    (1 - moisture) * (driver.pace - 75) +
    WET_EFFECT_MULTIPLIER * moisture * (driver.wetWeatherPace - 75)
  const driverMod = -(skillDelta * 0.03 + (form - 5) * 0.02)

  // 6. tyreWearMod — every 4% of wear adds 0.1s/lap (fresh tyres matter; #pit-strategy)
  const tyreWearMod = ((100 - tyre.condition) / 4) * 0.1

  // 7. tyreCliff
  const tyreCliff = tyre.condition <= 0 ? 5.0 : 0

  // 8. weatherMod
  const weatherMod = moisture * 20

  // 9. wrongTyrePenalty
  const wrongTyrePenalty = tyreStepsOutOfWindow(tyre.compound, moisture) * 15

  // 10. fuelMod
  const fuelMod = fuelLaps * 0.05

  // 11. compoundDelta — this race's randomised per-compound pace delta
  const compoundDelta = input.compoundDeltas[tyre.compound]

  // 12. noise: a per-lap time PENALTY scaled by consistency (issue #59). Uniform over
  //     [0, 1.2 - 0.01*c]: c=90 -> 0-0.30s (the old flat range), c=75 -> 0-0.45s, c=65 -> 0-0.55s.
  //     Always a slow-down, so low consistency is systematically slower, not just noisier.
  //     Qualifying supplies its own symmetric + compromised-lap model via noiseOverride (can be 0 or
  //     negative, so this must be ?? not ||); races leave it undefined and use the default.
  const noise = input.noiseOverride ?? Math.random() * (1.2 - 0.01 * driver.consistency)

  // 13. rawTime
  const flatModifier = circuitFlatModifier
  const rawTime =
    base +
    carMod +
    driverMod +
    tyreWearMod +
    tyreCliff +
    weatherMod +
    wrongTyrePenalty +
    fuelMod +
    compoundDelta +
    flatModifier +
    noise

  // FREE-AIR PACE is rawTime. Traffic — dirty air, the contested pass, its crash roll, and the time a
  // pass costs both cars — is resolved here from the car AHEAD's clean-air pace, which race.ts threads in
  // (carAheadFreeAir) as it walks the field front-to-back.
  const freeAir = rawTime

  if (gapToCarAhead === Infinity || carAheadLapTime === null || input.carAheadFreeAir == null) {
    return { lapTime: rawTime, overtook: false, freeAir }
  }

  // DIRTY AIR: a follower within DIRTY_RANGE loses pace, worse the closer it sits. A car only slightly
  // quicker has its edge eaten and settles into a train; a much-quicker car keeps enough to reach the car
  // ahead and contest. This is the emergent "trains form unless you're much faster" mechanism.
  const dirty = gapToCarAhead < DIRTY_RANGE ? MAX_DIRTY * (1 - gapToCarAhead / DIRTY_RANGE) : 0
  // SLIPSTREAM: a chasing car within DIRTY_RANGE gets a tow off the car ahead, applied BEFORE the overtake
  // calculations — it runs this much faster, easing the pass (bigger pace edge, closes the gap quicker) and
  // partly offsetting dirty air. Its own clean-air pace (freeAir, what the next car back gates on) is unchanged.
  const tow = gapToCarAhead < DIRTY_RANGE ? SLIPSTREAM : 0
  const dirtyLapTime = rawTime + dirty - tow
  const wouldGap = gapToCarAhead + (dirtyLapTime - carAheadLapTime) // gap after running this (towed) pace
  const paceEdge = input.carAheadFreeAir - freeAir + tow            // clean-air pace edge, plus the tow

  // A pass happens this lap in one of two ways:
  //  (a) BLOW-PAST (rare) — the car is so much faster than the gap that running its own pace leaves it
  //      well AHEAD of the car in front (past PASS_MARGIN). It just drives by, from any distance: a
  //      backmarker being lapped, or a car on the wrong tyres. The big overshoot makes this rare.
  //  (b) CONTEST — it's within striking range (~1s) and quicker. Passing is HARD: a LOW per-lap chance
  //      that scales with how much faster it is (and its overtaking), capped well under 1. A marginally
  //      quicker car still gets a small chance every lap (never walled to zero); a clearly-but-not-hugely
  //      faster car doesn't simply breeze by. It harries in the dirty air until a chance comes off.
  const blowPast = wouldGap < -PASS_MARGIN && paceEdge > 0
  const inRange = gapToCarAhead <= STRIKE_RANGE && paceEdge > 0
  // Where a car that can't pass settles: HOLD_GAP with per-lap jitter, so a train shows living, varied
  // intervals (+0.27, +0.41, +0.19…) instead of every car pinned to an identical +0.300.
  const harryGap = HOLD_GAP + (Math.random() - 0.5) * HOLD_JITTER
  if (blowPast || inRange) {
    // Crash roll (issue #60), driven by both drivers' consistency (f(c) = 2e-6·(100-c)²).
    if (input.defenderDriver) {
      const k = 0.000002
      const f = (c: number) => k * (100 - c) ** 2
      const fa = f(driver.consistency)
      const fd = f(input.defenderDriver.consistency)
      if (Math.random() < fa + fd - fa * fd) {
        const r = Math.random()
        return { lapTime: dirtyLapTime, overtook: false, crash: { happened: true, attacker: r < 2 / 3, defender: r >= 1 / 3 }, freeAir }
      }
    }
    // Blow-past goes through; a contest is a hard, edge-scaled roll (overtaking rated against a 75 baseline).
    const prob = Math.min(MAX_CONTEST, paceEdge * OVERTAKE_SENS * (driver.overtaking / 75))
    if (blowPast || Math.random() < prob) {
      // A completed pass costs both cars time: the attacker a little, the defender more.
      return { lapTime: freeAir + ATTACKER_PENALTY, overtook: true, defenderPenalty: DEFENDER_PENALTY, freeAir }
    }
    // No way through this lap: hold station in the dirty air, no closer than the (jittered) harry gap.
    const heldGap = Math.max(harryGap, wouldGap)
    return { lapTime: carAheadLapTime + heldGap - gapToCarAhead, overtook: false, freeAir }
  }

  // Closing from beyond striking range and this pace would overshoot the car ahead → arrive right behind
  // instead (no pass this lap; it gets its chances next lap, now in range).
  if (wouldGap < CONTEST_GAP) {
    return { lapTime: carAheadLapTime + harryGap - gapToCarAhead, overtook: false, freeAir }
  }

  // Approaching slowly, or sitting at the dirty-air equilibrium (a train).
  return { lapTime: dirtyLapTime, overtook: false, freeAir }
}
