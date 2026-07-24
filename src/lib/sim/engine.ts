import type { Driver, Team, TyreState, WeatherPoint, TyreCompound } from './types'
import { getMoistureAtLap } from './weather'
import { tyreStepsOutOfWindow } from './tyres'
import { effectiveCarPace } from './car-rating'
import { perSliceProb } from './rng-utils'

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
  circuitStraightness?: number // 0-1; weights the car's straight-line vs cornering pace. Absent → 0.5.
  paceDelta?: number          // driver push + cold-tyre pace adjustment (#sim-overhaul), baked into clean-air
                              // pace so pushing genuinely helps attack/defend and cold tyres are easy to pass
  defenderDriver?: Driver     // car directly ahead, for the contested-overtake crash roll (issue #60)
  noiseOverride?: number      // qualifying supplies its own noise model (more quali variation); races use the default
  frac?: number               // fraction of a lap this call covers (#sector-engine): 1 = whole lap (default,
                              // bit-compatible), 1/8 = one sector. Gates stay lap-scale (paceEdge, ranges);
                              // emitted times scale by frac and probabilities rescale via perSliceProb.
}

export interface LapResult {
  lapTime: number             // time for the slice this call covers (the whole lap at frac = 1)
  overtook: boolean
  freeAir: number             // this car's clean-air pace this lap (the next car back gates its pass on it)
  defenderPenalty?: number    // on a completed pass, the time the overtaken car loses (race.ts applies it)
  // A contested-overtake collision (issue #60). attacker/defender flag who retires (33/33/33).
  crash?: { happened: boolean; attacker: boolean; defender: boolean }
}

// Traffic / dirty-air model (make qualifying matter — overtaking was far too easy). Tunables:
const DIRTY_RANGE = 1.0       // s: a follower within this loses pace to dirty air
const MAX_DIRTY = 0.7         // s: pace lost right on the gearbox (gap 0); fades to 0 at DIRTY_RANGE
const SLIPSTREAM = 0.3        // s: tow a chasing car gets within DIRTY_RANGE — eases the pass, offsets dirty air.
                             //   Scaled by straightness (less of a tow in the corners) at the use site below.
const STRIKE_RANGE = 1.0      // s: within this (~DRS range) a faster car gets a per-lap chance to pass
const PASS_MARGIN = 3.0       // s: only a car whose pace would leave it this far AHEAD blows straight by (rare)
const CONTEST_GAP = 0.15      // s: a car closing past this from beyond range arrives right behind, contests next lap
// Per-lap pass chance per second of CLEAN pace edge. The CIRCUIT'S STRAIGHTNESS sets it, EXPONENTIALLY
// interpolated between these two ends, so the pace delta a pass needs differs ~7× from Monaco to Monza:
//   Monaco (s≈0.05, ~0.051): 0.5s edge ≈ 3%/lap (no way past), 1s ≈ 5% (~no way in a race), 2s ≈ 10% (maybe, late).
//   Monza  (s≈0.95, ~0.32):  0.3s ≈ 9%/lap (after some tries), 0.5s ≈ 16% (reasonably quick), 1s ≈ 32% (a couple).
const OVERTAKE_SENS_MIN = 0.046 // most corner-heavy track
const OVERTAKE_SENS_MAX = 0.35  // most straight-heavy track
const MAX_CONTEST = 0.5       // cap on the per-lap pass chance from within range (no certain passes)
const ATTACKER_PENALTY = 0.2  // s: a completed pass costs the attacker this
const DEFENDER_PENALTY = 0.4  // s: ...and the overtaken car this (applied in race.ts)
const HOLD_GAP = 0.3          // s: a car that can't get by harries around this far behind, tyres cooking
const HOLD_JITTER = 0.3       // s: spread on the harry distance so a train isn't a column of identical +0.300s

// The traffic tunables, exported so race.ts (and the pace-mode logic) share the engine's exact numbers.
export const TRAFFIC = { DIRTY_RANGE, MAX_DIRTY, SLIPSTREAM, STRIKE_RANGE, PASS_MARGIN, OVERTAKE_SENS_MIN, OVERTAKE_SENS_MAX, MAX_CONTEST, ATTACKER_PENALTY, DEFENDER_PENALTY, HOLD_GAP } as const

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

  // 2. carMod from the EFFECTIVE pace (straight-line/cornering blended by the track's straightness).
  const carMod = (75 - effectiveCarPace(team, input.circuitStraightness)) / 25

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

  // 13. rawTime — the driver's push / cold-tyre adjustment (#sim-overhaul) is part of clean-air pace, so it
  // flows through dirty air + the overtake gate below (pushing helps you pass; cold tyres make you easy prey).
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
    (input.paceDelta ?? 0) +
    noise

  // FREE-AIR PACE is rawTime, always LAP-scale — paceEdge below keeps its per-lap meaning in both modes.
  // Traffic — dirty air, the contested pass, its crash roll, and the time a pass costs both cars — is
  // resolved here from the car AHEAD's clean-air pace, which the slice core threads in (carAheadFreeAir)
  // as it walks the field front-to-back. Emitted times scale by frac; carAheadLapTime arrives slice-scale.
  const freeAir = rawTime
  const frac = input.frac ?? 1

  if (gapToCarAhead === Infinity || carAheadLapTime === null || input.carAheadFreeAir == null) {
    return { lapTime: rawTime * frac, overtook: false, freeAir }
  }

  // DIRTY AIR: a follower within DIRTY_RANGE loses pace, worse the closer it sits. A car only slightly
  // quicker has its edge eaten and settles into a train; a much-quicker car keeps enough to reach the car
  // ahead and contest. This is the emergent "trains form unless you're much faster" mechanism.
  const dirty = gapToCarAhead < DIRTY_RANGE ? MAX_DIRTY * (1 - gapToCarAhead / DIRTY_RANGE) : 0
  // SLIPSTREAM: a chasing car within DIRTY_RANGE gets a tow off the car ahead, applied BEFORE the overtake
  // calculations — it runs this much faster, easing the pass (bigger pace edge, closes the gap quicker) and
  // partly offsetting dirty air. Its own clean-air pace (freeAir, what the next car back gates on) is unchanged.
  const tow = gapToCarAhead < DIRTY_RANGE ? SLIPSTREAM * (0.3 + 0.7 * (input.circuitStraightness ?? 0.5)) : 0
  const dirtySliceTime = (rawTime + dirty - tow) * frac
  const wouldGap = gapToCarAhead + (dirtySliceTime - carAheadLapTime) // gap after running this (towed) pace
  // The pass is gated on the CLEAN pace edge — raw pace delta, no tow. The tow's job is to help you close up
  // and hang on in the dirty air (via dirtyLapTime above), not to manufacture a pass you don't have the legs for.
  const paceEdge = input.carAheadFreeAir - freeAir

  // A pass happens this lap in one of two ways:
  //  (a) BLOW-PAST (rare) — the car is so much faster than the gap that running its own pace leaves it
  //      well AHEAD of the car in front (past PASS_MARGIN). It just drives by, from any distance: a
  //      backmarker being lapped, or a car on the wrong tyres. The big overshoot makes this rare.
  //  (b) CONTEST — it's within striking range (~1s) and quicker. Passing is HARD: a LOW per-lap chance
  //      that scales with how much faster it is (and its overtaking), capped well under 1. A marginally
  //      quicker car still gets a small chance every lap (never walled to zero); a clearly-but-not-hugely
  //      faster car doesn't simply breeze by. It harries in the dirty air until a chance comes off.
  // The overshoot a blow-past needs scales with the slice (a slice only closes frac of a lap's worth).
  const blowPast = wouldGap < -PASS_MARGIN * frac && paceEdge > 0
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
      if (Math.random() < perSliceProb(fa + fd - fa * fd, frac)) {
        const r = Math.random()
        return { lapTime: dirtySliceTime, overtook: false, crash: { happened: true, attacker: r < 2 / 3, defender: r >= 1 / 3 }, freeAir }
      }
    }
    // Blow-past goes through; a contest is a hard, edge-scaled roll (overtaking rated against a 75 baseline).
    // The track's straightness sets HOW MUCH pace edge a pass needs, exponentially: a corner-heavy track walls
    // out all but a huge edge, a straight-heavy one lets a small edge through (DRS/slipstream effect).
    const s = input.circuitStraightness ?? 0.5
    const sens = OVERTAKE_SENS_MIN * (OVERTAKE_SENS_MAX / OVERTAKE_SENS_MIN) ** s
    const prob = Math.min(MAX_CONTEST, paceEdge * sens * (driver.overtaking / 75))
    if (blowPast || Math.random() < perSliceProb(prob, frac)) {
      // A completed pass costs both cars time: the attacker a little, the defender more.
      return { lapTime: freeAir * frac + ATTACKER_PENALTY, overtook: true, defenderPenalty: DEFENDER_PENALTY, freeAir }
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
  return { lapTime: dirtySliceTime, overtook: false, freeAir }
}
