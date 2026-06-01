import type { Driver, DriverProgressionEvent } from './types'
import { sampleNormal } from './rng-utils'

type ProgressStat = 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness'
const STATS: ProgressStat[] = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness']

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function applyDriverProgression(
  drivers: Driver[],
  rng: () => number,
): { updatedDrivers: Driver[]; events: DriverProgressionEvent[] } {
  const events: DriverProgressionEvent[] = []
  const updatedDrivers = drivers.map((driver) => {
    const newAge = driver.age + 1
    const updated = { ...driver, age: newAge }

    for (const stat of STATS) {
      const before = driver[stat]
      let after = before

      if (newAge <= driver.primeEnd) {
        // Pre-prime: chance to improve toward peakPotential
        const gap = driver.peakPotential - before
        const probability = gap > 10 ? 0.55 : gap > 3 ? 0.35 : 0.15
        if (rng() < probability) {
          const delta = Math.max(0.1, Math.min(gap, sampleNormal(0.8, 0.6, rng)))
          after = round1(Math.min(driver.peakPotential, before + delta))
        }
      } else {
        // Post-prime: decline, accelerating each year past prime
        const yearsOver = newAge - driver.primeEnd
        const baseDrop = 0.4 + (yearsOver - 1) * 0.15
        const delta = Math.max(0, Math.min(3.5, sampleNormal(baseDrop, 0.3, rng)))
        after = round1(Math.max(20, before - delta))
      }

      // Clamp to [20, 100]
      after = Math.max(20, Math.min(100, after))
      updated[stat] = after

      if (Math.abs(after - before) >= 0.05) {
        events.push({
          driverId: driver.id,
          driverName: driver.name,
          stat,
          before,
          after,
          direction: after > before ? 'improved' : after < before ? 'declined' : 'unchanged',
        })
      }
    }

    return updated
  })

  return { updatedDrivers, events }
}
