import type { Driver, Team, TyreState, WeatherPoint } from './types'
import { getMoistureAtLap } from './weather'
import { tyreStepsOutOfWindow } from './tyres'

export interface LapInput {
  driver: Driver
  team: Team
  tyre: TyreState
  form: number
  fuelLaps: number
  lap: number
  totalLaps: number
  weather: WeatherPoint[]
  gapToCarAhead: number       // Infinity if leading
  carAheadLapTime: number | null
  circuitFlatModifier: number
}

export interface LapResult {
  lapTime: number
  overtook: boolean
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

  // 12. noise: random float in [0, 0.3]
  const noise = Math.random() * 0.3

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

  // gap <= 1
  if (rawTime < carAheadLapTime) {
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
