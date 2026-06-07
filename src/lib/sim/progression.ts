import type { Driver, DriverProgressionEvent } from './types'
import { sampleNormal } from './rng-utils'

// The DEVELOPABLE stats — all five rated attributes grow toward peakPotential and decline past prime.
// Consistency develops like any other rating (issue #59); the plateau check (overall >= peakPotential)
// targets the re-weighted five-stat overall.
type ProgressStat = 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness' | 'consistency'
const STATS: ProgressStat[] = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness', 'consistency']

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Overall rating weights across the five rated attributes (issue #59). Sum = 1.0.
export const OVERALL_WEIGHTS = {
  pace: 0.5,
  consistency: 0.18,
  overtaking: 0.15,
  wetWeatherPace: 0.1,
  smoothness: 0.07,
} as const

// Cosmetic overall used to test whether a driver has reached their potential and for display.
export function overall(
  d: Pick<Driver, 'pace' | 'smoothness' | 'overtaking' | 'wetWeatherPace' | 'consistency'>,
): number {
  return (
    OVERALL_WEIGHTS.pace * d.pace +
    OVERALL_WEIGHTS.consistency * d.consistency +
    OVERALL_WEIGHTS.overtaking * d.overtaking +
    OVERALL_WEIGHTS.wetWeatherPace * d.wetWeatherPace +
    OVERALL_WEIGHTS.smoothness * d.smoothness
  )
}

// Per-attribute develop / decline multipliers on the base curve (issue #66). The ORDERING is the spec
// (pace grows & fades fastest; smoothness/wet slowest to build and only slowly lost); magnitudes tunable.
// Shared with the historical projection (compose.ts) so composed grids and live development stay in step.
export const DEVELOP_RATES: Record<ProgressStat, number> = {
  pace: 1.3, consistency: 1.0, smoothness: 1.0, overtaking: 0.8, wetWeatherPace: 0.7,
}
export const DECLINE_RATES: Record<ProgressStat, number> = {
  pace: 1.2, consistency: 1.0, smoothness: 0.6, overtaking: 0.8, wetWeatherPace: 0.6,
}

// Season form (issue #66): a once-per-season offset added to every rating, modelling up-and-down years.
// The STORED ratings are the hidden, smoothly-developing TRUE values; the SHOWN ratings the player sees
// and the sim races are true + seasonForm, clamped. Normal(0, ~2), clamped to +/-10.
export const SEASON_FORM_SIGMA = 2
export const SEASON_FORM_CAP = 10
export function rollSeasonForm(rng: () => number): number {
  return round1(Math.max(-SEASON_FORM_CAP, Math.min(SEASON_FORM_CAP, sampleNormal(0, SEASON_FORM_SIGMA, rng))))
}

type Ratings = Pick<Driver, 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness' | 'consistency'>
const clamp100 = (n: number): number => round1(Math.max(0, Math.min(100, n)))

// The SHOWN ratings = hidden true ratings + this season's form offset, clamped. Used by display and the
// race/qualifying sim; the stored values stay the smooth career trajectory (so form never compounds into
// development). seasonForm absent (e.g. pre-roll at setup) reads as 0, i.e. shown == true.
export function shownStats(d: Ratings & { seasonForm?: number }): Ratings {
  const f = d.seasonForm ?? 0
  if (f === 0) return { pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness, consistency: d.consistency }
  return {
    pace: clamp100(d.pace + f),
    wetWeatherPace: clamp100(d.wetWeatherPace + f),
    overtaking: clamp100(d.overtaking + f),
    smoothness: clamp100(d.smoothness + f),
    consistency: clamp100(d.consistency + f),
  }
}
export function shownOverall(d: Ratings & { seasonForm?: number }): number {
  return overall(shownStats(d))
}

// Driver development applies AFTER EACH RACE (GDD §Driver progression curve).
// Pre-prime: improve toward potential at a rate that fills the remaining gap over
// (15 × years-till-prime) races. That per-race value is the lower quartile of a normal
// curve whose median is 1.5× larger. Post-prime: decline, accelerating with age.
// (15, down from 20: a slightly steeper approach so young drivers reach their peak sooner.)
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
      const racesToPotential = Math.max(1, 15 * yearsTillPrime)
      const gap = driver.peakPotential - ov

      const q1 = gap / racesToPotential       // lower quartile
      const median = q1 * 1.5                  // median = 1.5 × Q1
      const sigma = (median - q1) / 0.6745     // Q1 = μ − 0.6745σ
      const improvement = Math.max(0, sampleNormal(median, sigma, rng))

      // Don't overshoot potential on average.
      const actualGain = Math.min(improvement, gap)
      for (const stat of STATS) {
        const jitter = Math.max(0, sampleNormal(1, 0.15, rng)) // small per-stat noise
        next[stat] = Math.min(100, round1(driver[stat] + actualGain * DEVELOP_RATES[stat] * jitter))
      }
    } else {
      // Declining — accelerates the further past prime end.
      const yearsPast = driver.age - driver.primeEnd + 1
      const declineMedian = 0.04 * yearsPast
      for (const stat of STATS) {
        const drop = Math.max(0, sampleNormal(declineMedian, declineMedian * 0.3 + 0.02, rng))
        next[stat] = Math.max(20, round1(driver[stat] - drop * DECLINE_RATES[stat]))
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
