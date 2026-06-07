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
  carAheadLapTime: number | null
  circuitFlatModifier: number
  defenderDriver?: Driver     // car directly ahead, for the contested-overtake crash roll (issue #60)
}

export interface LapResult {
  lapTime: number
  overtook: boolean
  // A contested-overtake collision (issue #60). attacker/defender flag who retires (33/33/33).
  crash?: { happened: boolean; attacker: boolean; defender: boolean }
}

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
  const noise = Math.random() * (1.2 - 0.01 * driver.consistency)

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

  // GAP LOGIC
  if (gapToCarAhead === Infinity || carAheadLapTime === null) {
    return { lapTime: rawTime, overtook: false }
  }

  if (gapToCarAhead > 2) {
    return { lapTime: rawTime, overtook: false }
  }

  if (gapToCarAhead > 1) {
    // 1 < gap <= 2
    const timeDiff = carAheadLapTime - rawTime
    if (timeDiff > 2 * gapToCarAhead) {
      return { lapTime: rawTime, overtook: false }
    } else {
      const clampedTime = carAheadLapTime + 0.5 + Math.random() * 0.5
      return { lapTime: clampedTime, overtook: false }
    }
  }

  // gap <= 1: a contested overtake attempt.
  if (rawTime < carAheadLapTime) {
    // Crash roll (issue #60), driven purely by BOTH drivers' consistency (not overtaking). Either
    // unsafe driver can cause it; it's only clean when both are: P = f(a) + f(d) - f(a)·f(d), with
    // f(c) = k·(100 - c)². k=2e-6 calibrated by headless measurement to ~1 / 0.5 / 0.1 overtake
    // crash-outs per 24-race season at consistency 65 / 75 / 90 (the sim produces ~150 contested
    // attempts per driver-season, so the per-attempt rate is small and the (100-c)² keeps the tiers
    // ~12:6:1, close to the budget's 10:5:1).
    if (input.defenderDriver) {
      const k = 0.000002
      const f = (c: number) => k * (100 - c) ** 2
      const fa = f(driver.consistency)
      const fd = f(input.defenderDriver.consistency)
      if (Math.random() < fa + fd - fa * fd) {
        // Equal thirds: attacker out / defender out / both out.
        const r = Math.random()
        return { lapTime: rawTime, overtook: false, crash: { happened: true, attacker: r < 2 / 3, defender: r >= 1 / 3 } }
      }
    }
    const prob = ((1 - gapToCarAhead) + driver.overtaking / 100) / 2
    const overtook = Math.random() < prob
    if (overtook) {
      return { lapTime: rawTime, overtook: true }
    } else {
      const clampedTime = carAheadLapTime + Math.random() * 0.5
      return { lapTime: clampedTime, overtook: false }
    }
  }

  return { lapTime: rawTime, overtook: false }
}
