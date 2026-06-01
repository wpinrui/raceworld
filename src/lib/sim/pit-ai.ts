import type { DriverRaceState, TyreCompound, WeatherPoint } from './types'
import { getMoistureAtLap } from './weather'
import { isTyreInWindow, recommendTyre } from './tyres'

export interface PitDecision {
  shouldPit: boolean
  targetCompound: TyreCompound
}

export function decidePit(
  state: DriverRaceState,
  totalLaps: number,
  currentLap: number,
  weather: WeatherPoint[],
  allDriverStates: DriverRaceState[],
): PitDecision {
  const moisture = getMoistureAtLap(weather, currentLap)
  const lapsRemaining = totalLaps - currentLap
  const tyre = state.currentTyre

  // Helper to select dry compound based on laps remaining
  const selectDryCompound = (): TyreCompound => {
    const racePercentRemaining = lapsRemaining / totalLaps
    if (racePercentRemaining > 0.40) return 'hard'
    if (racePercentRemaining >= 0.20) return 'medium'
    return 'soft'
  }

  const selectCompound = (): TyreCompound => {
    if (moisture >= 0.10) {
      return recommendTyre(moisture)
    }
    return selectDryCompound()
  }

  // Rule 1: Never pit laps 1-5 unless tyre.condition < 5 or wrong tyre
  if (currentLap <= 5) {
    if (tyre.condition < 5 || !isTyreInWindow(tyre.compound, moisture)) {
      return { shouldPit: true, targetCompound: selectCompound() }
    }
    return { shouldPit: false, targetCompound: selectCompound() }
  }

  // Rule 2: Never pit if lapsRemaining < 3 unless condition = 0
  if (lapsRemaining < 3) {
    if (tyre.condition === 0) {
      return { shouldPit: true, targetCompound: selectCompound() }
    }
    return { shouldPit: false, targetCompound: selectCompound() }
  }

  // Rule 3: Weather trigger - wrong tyre -> pit immediately
  if (!isTyreInWindow(tyre.compound, moisture)) {
    return { shouldPit: true, targetCompound: recommendTyre(moisture) }
  }

  // Rule 4 & 5: Estimate remaining tyre laps with ~10% noise
  const noiseFactor = 0.9 + Math.random() * 0.2 // 0.9 to 1.1
  const estimatedRemaining = (tyre.condition / 100) * tyre.maxLifeLaps * noiseFactor

  if (estimatedRemaining < lapsRemaining && state.stintLap > 5) {
    return { shouldPit: true, targetCompound: selectCompound() }
  }

  // Rule 6: Undercut opportunity
  const sortedDrivers = [...allDriverStates]
    .filter((d) => !d.retired)
    .sort((a, b) => a.position - b.position)

  const ownPositionIndex = sortedDrivers.findIndex((d) => d.driverId === state.driverId)

  if (ownPositionIndex !== -1 && tyre.condition < 60) {
    // Check cars within 3 positions ahead
    for (let i = Math.max(0, ownPositionIndex - 3); i < ownPositionIndex; i++) {
      const carAhead = sortedDrivers[i]
      if (carAhead && carAhead.currentTyre.condition < 40) {
        if (Math.random() < 0.4) {
          return { shouldPit: true, targetCompound: selectCompound() }
        }
        break
      }
    }
  }

  return { shouldPit: false, targetCompound: selectCompound() }
}
