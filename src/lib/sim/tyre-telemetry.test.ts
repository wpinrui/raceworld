import { describe, it, expect } from 'vitest'
import type { Driver, Team } from './types'
import { computeLapTime } from './engine'
import { DIRTY_AIR_WEAR_MULT } from './tyres'
import {
  expectedStintLaps,
  trafficStintLaps,
  currentSetRemainingLaps,
  tyreLapTimeLoss,
} from './tyre-telemetry'

function makeDriver(): Driver {
  return {
    id: 'd', name: 'd', teamId: 't',
    nationality: 'GB', gender: 'male',
    pace: 75, wetWeatherPace: 75, overtaking: 75, smoothness: 50, consistency: 75,
    confidence: 5, age: 25, peakPotential: 80, primeEnd: 30,
    narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}
const TEAM: Team = { id: 't', name: 't', shortName: 'TTT', nationality: 'GB', color: '#FFF', carPace: 75 }

describe('tyreLapTimeLoss matches the engine', () => {
  // Lead the field (no traffic) and zero the noise so computeLapTime is deterministic; with carPace 75,
  // pace 75, form 5, dry, no fuel, the lap time is base + compoundDelta + the tyre wear/cliff terms only.
  const base = {
    driver: makeDriver(), team: TEAM, form: 5, fuelLaps: 0, lap: 1,
    weather: [{ lap: 1, moisture: 0 }],
    compoundDeltas: { soft: 0, medium: 0.7, hard: 1.5, intermediate: 2.5, wet: 4.0 },
    gapToCarAhead: Infinity, carAheadLapTime: null, circuitFlatModifier: 0, noiseOverride: 0,
  }
  const lapAt = (condition: number) =>
    computeLapTime({ ...base, tyre: { compound: 'medium' as const, condition, maxLifeLaps: 20 } }).lapTime

  it('reproduces the per-lap loss difference between two wear levels', () => {
    const engineDelta = lapAt(50) - lapAt(100)
    const telemetryDelta = tyreLapTimeLoss(0.7, 50) - tyreLapTimeLoss(0.7, 100)
    expect(telemetryDelta).toBeCloseTo(engineDelta, 6)
    expect(telemetryDelta).toBeCloseTo(1.25, 6) // 50% wear × 0.1s per 4%
  })

  it('reproduces the absolute tyre contribution (base 100s cancels out)', () => {
    expect(lapAt(100) - 100).toBeCloseTo(tyreLapTimeLoss(0.7, 100), 6)
    expect(lapAt(40) - 100).toBeCloseTo(tyreLapTimeLoss(0.7, 40), 6)
  })

  it('adds the cliff at 0%', () => {
    expect(tyreLapTimeLoss(0.7, 0)).toBeCloseTo(0.7 + 100 * 0.025 + 5, 6)
  })
})

describe('stint life', () => {
  it('scales with base life, smoothness and distance', () => {
    expect(expectedStintLaps(0.3, 50, 60)).toBe(18) // 0.3 × 60 × (0.5 + 0.5)
    expect(expectedStintLaps(0.3, 100, 60)).toBe(27) // 1.5× at max smoothness
    expect(expectedStintLaps(0.3, 0, 60)).toBe(9) // 0.5× at min smoothness
  })

  it('runs shorter in traffic by the dirty-air multiplier', () => {
    expect(trafficStintLaps(18)).toBe(Math.round(18 / DIRTY_AIR_WEAR_MULT)) // 16
    expect(trafficStintLaps(18)).toBeLessThan(18)
  })

  it('reads the current set from exact condition and rolled life', () => {
    const { clear, traffic } = currentSetRemainingLaps({ compound: 'medium', condition: 50, maxLifeLaps: 20 })
    expect(clear).toBe(10) // 50% at 5%/lap
    expect(traffic).toBe(Math.round(10 / DIRTY_AIR_WEAR_MULT)) // 9
  })
})
