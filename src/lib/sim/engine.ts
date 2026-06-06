import type { Driver, Team, TyreState, WeatherPoint } from './types'
import { getMoistureAtLap } from './weather'
import { tyreStepsOutOfWindow } from './tyres'
import { getConsistency } from './progression'

export interface LapInput {
  driver: Driver
  team: Team
  tyre: TyreState
  form: number
  fuelLaps: number
  lap: number
  weather: WeatherPoint[]
  gapToCarAhead: number       // Infinity if leading
  carAheadLapTime: number | null
  circuitFlatModifier: number
  defenderDriver?: Driver     // car ahead (for overtake crash logic, issue #60)
}

export interface LapResult {
  lapTime: number
  overtook: boolean
  crash?: {
    happened: boolean
    attacker: boolean           // attacker retires
    defender: boolean           // defender retires
  }
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

  // 4. effectiveStat
  const effectiveStat =
    (1 - moisture) * driver.pace + moisture * driver.wetWeatherPace + (form - 5)

  // 5. driverMod
  const driverMod = -((effectiveStat - 75) / 5) * 0.1

  // 6. tyreWearMod
  const tyreWearMod = ((100 - tyre.condition) / 8) * 0.1

  // 7. tyreCliff
  const tyreCliff = tyre.condition <= 0 ? 5.0 : 0

  // 8. weatherMod
  const weatherMod = moisture * 20

  // 9. wrongTyrePenalty
  const wrongTyrePenalty = tyreStepsOutOfWindow(tyre.compound, moisture) * 15

  // 10. fuelMod
  const fuelMod = fuelLaps * 0.05

  // 11. compoundDelta
  const compoundDeltas: Record<string, number> = {
    soft: 0,
    medium: 0.7,
    hard: 1.5,
    intermediate: 2.5,
    wet: 4.0,
  }
  const compoundDelta = compoundDeltas[tyre.compound]

  // 12. noise: a per-lap time PENALTY scaled by consistency (issue #59). Uniform over
  //     [0, 1.2 - 0.01*c]: c=90 -> 0-0.30s (the old flat range), c=75 -> 0-0.45s, c=65 -> 0-0.55s.
  //     Always a slow-down, so low consistency is systematically slower, not just noisier.
  const noise = Math.random() * (1.2 - 0.01 * getConsistency(driver))

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

  // gap <= 1: contested overtake (issue #60 — overtake crashes driven by consistency)
  if (rawTime < carAheadLapTime) {
    // Incident probability depends on both drivers' consistency. P(incident) = f(c_a) + f(c_d) - f(c_a)*f(c_d),
    // where f(c) = k * (100 - c)^2. Calibrated k=0.00012: per-season overtake crash budget is
    // c=65→~1 crash, c=75→~0.5, c=90→~0.1 (assumes ~10 contested attempts per driver-season).
    let crashHappened = false
    let crashAttacker = false
    let crashDefender = false

    if (input.defenderDriver) {
      const k = 0.00012
      const attackerConsistency = getConsistency(driver)
      const defenderConsistency = getConsistency(input.defenderDriver)
      const f = (c: number) => k * (100 - c) ** 2
      const fA = f(attackerConsistency)
      const fD = f(defenderConsistency)
      const incidentProb = fA + fD - fA * fD

      if (Math.random() < incidentProb) {
        crashHappened = true
        // Split outcome: equal thirds (attacker out / defender out / both out)
        const outcome = Math.random()
        if (outcome < 1 / 3) {
          crashAttacker = true
        } else if (outcome < 2 / 3) {
          crashDefender = true
        } else {
          crashAttacker = true
          crashDefender = true
        }
      }
    }

    // If crash happens, return immediately (don't attempt overtake, don't clamp time)
    if (crashHappened) {
      return { lapTime: rawTime, overtook: false, crash: { happened: true, attacker: crashAttacker, defender: crashDefender } }
    }

    // No crash: roll for normal overtake success
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
