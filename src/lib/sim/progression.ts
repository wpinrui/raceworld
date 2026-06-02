import type { Driver, DriverProgressionEvent } from './types'
import { sampleNormal } from './rng-utils'

type ProgressStat = 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness'
const STATS: ProgressStat[] = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness']

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Cosmetic overall used to test whether a driver has reached their potential.
export function overall(d: Pick<Driver, 'pace' | 'smoothness' | 'overtaking' | 'wetWeatherPace'>): number {
  return 0.6 * d.pace + 0.2 * d.smoothness + 0.1 * d.overtaking + 0.1 * d.wetWeatherPace
}

// Driver development applies AFTER EACH RACE (GDD §Driver progression curve).
// Pre-prime: improve toward potential at a rate that fills the remaining gap over
// (20 × years-till-prime) races. That per-race value is the lower quartile of a normal
// curve whose median is 1.5× larger. Post-prime: decline, accelerating with age.
export function applyRaceProgression(
  drivers: Driver[],
  rng: () => number,
): { updatedDrivers: Driver[]; events: DriverProgressionEvent[] } {
  const events: DriverProgressionEvent[] = []

  const updatedDrivers = drivers.map((driver) => {
    // Development is age-based maturation toward potential (GDD §Driver progression
    // curve), applied once per race tick to EVERY driver — free agents included.
    const ov = overall(driver)
    const next = { ...driver }

    if (driver.age < driver.primeEnd) {
      // Developing — stop once potential is reached (plateau until prime end).
      if (ov >= driver.peakPotential) return driver

      const yearsTillPrime = Math.max(0.001, driver.primeEnd - driver.age)
      const racesToPotential = Math.max(1, 20 * yearsTillPrime)
      const gap = driver.peakPotential - ov

      const q1 = gap / racesToPotential       // lower quartile
      const median = q1 * 1.5                  // median = 1.5 × Q1
      const sigma = (median - q1) / 0.6745     // Q1 = μ − 0.6745σ
      const improvement = Math.max(0, sampleNormal(median, sigma, rng))

      // Don't overshoot potential on average.
      const actualGain = Math.min(improvement, gap)
      for (const stat of STATS) {
        const jitter = Math.max(0, sampleNormal(1, 0.15, rng)) // small per-stat noise
        next[stat] = Math.min(100, round1(driver[stat] + actualGain * jitter))
      }
    } else {
      // Declining — accelerates the further past prime end.
      const yearsPast = driver.age - driver.primeEnd + 1
      const declineMedian = 0.04 * yearsPast
      for (const stat of STATS) {
        const drop = Math.max(0, sampleNormal(declineMedian, declineMedian * 0.3 + 0.02, rng))
        next[stat] = Math.max(20, round1(driver[stat] - drop))
      }
    }

    for (const stat of STATS) {
      if (Math.abs(next[stat] - driver[stat]) >= 0.05) {
        events.push({
          driverId: driver.id,
          driverName: driver.name,
          stat,
          before: driver[stat],
          after: next[stat],
          direction: next[stat] > driver[stat] ? 'improved' : 'declined',
        })
      }
    }

    return next
  })

  return { updatedDrivers, events }
}

// Age every driver by one year (runs once at end of season).
export function ageDrivers(drivers: Driver[]): Driver[] {
  return drivers.map((d) => ({ ...d, age: d.age + 1 }))
}
