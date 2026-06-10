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
const CONTEST_GAP = 0.15      // s: a pass is contested when the running pace would close inside this
const OVERTAKE_SENS = 0.8     // pass prob per second of clean-air pace edge
const ATTACKER_PENALTY = 0.2  // s: a completed pass costs the attacker this
const DEFENDER_PENALTY = 0.4  // s: ...and the overtaken car this (applied in race.ts)
const HOLD_GAP = 0.3          // s: a failed move tucks in this far behind (no free pass)

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
  const dirtyLapTime = rawTime + dirty
  const wouldGap = gapToCarAhead + (dirtyLapTime - carAheadLapTime) // gap after running this pace
  const paceEdge = input.carAheadFreeAir - freeAir                  // clean-air pace advantage over the car ahead

  // If this pace would bring the car onto or past the one ahead THIS lap — already on the gearbox, or
  // having just caught it from range — and it's genuinely quicker, contest the pass NOW. A much-faster
  // car (e.g. a sitting duck on the wrong tyres) catches AND passes in the same lap; a marginally-quicker
  // car settles at the dirty-air equilibrium and never reaches this branch.
  if (wouldGap < CONTEST_GAP && paceEdge > 0) {
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
    // Pass chance scales with the clean-air pace edge (you must be clearly faster), nudged by overtaking.
    const prob = Math.min(0.92, paceEdge * OVERTAKE_SENS + (driver.overtaking / 100) * 0.2)
    if (Math.random() < prob) {
      // A completed pass costs both cars time: the attacker a little, the defender more.
      return { lapTime: freeAir + ATTACKER_PENALTY, overtook: true, defenderPenalty: DEFENDER_PENALTY, freeAir }
    }
    // Failed move: tuck in right behind (no free pass — must contest again next lap).
    return { lapTime: carAheadLapTime + HOLD_GAP - gapToCarAhead, overtook: false, freeAir }
  }

  // Approaching slowly, or sitting at the dirty-air equilibrium (a train).
  return { lapTime: dirtyLapTime, overtook: false, freeAir }
}
