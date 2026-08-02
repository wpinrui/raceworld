import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeLapTime } from './engine'
import { DEFAULT_COMPOUND_DELTAS } from './tyres'
import type { Driver, Team } from './types'

const driver = (over: Partial<Driver> = {}): Driver => ({
  id: 'a', name: 'a', teamId: 'tA', nationality: 'GB', gender: 'male',
  pace: 75, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 75,
  age: 25, peakPotential: 80, primeEnd: 30, narrativeModifier: 0, contractExpiresAfterSeason: 2030, ...over,
})
const team = (carPace: number): Team => ({ id: 'tA', name: 'tA', shortName: 'TA', nationality: 'GB', color: '#f00', carPace })

afterEach(() => vi.restoreAllMocks())

// A faster car (clean-air pace ~1.8s better than the one ahead) right behind, contesting. With every RNG
// draw pinned to `roll`, the only thing that moves the pass outcome is the circuit's straightness factor.
function passes(straightness: number, roll: number): boolean {
  vi.spyOn(Math, 'random').mockImplementation(() => roll)
  return computeLapTime({
    driver: driver(), team: team(80),
    tyre: { compound: 'medium', condition: 100, maxLifeLaps: 30 },
    form: 5, fuelLaps: 0, lap: 1,
    weather: [{ lap: 1, moisture: 0 }], compoundDeltas: DEFAULT_COMPOUND_DELTAS,
    gapToCarAhead: 0.5, carAheadLapTime: 100, carAheadFreeAir: 102,
    circuitFlatModifier: 0, circuitStraightness: straightness, noiseOverride: 0,
    defenderDriver: driver({ id: 'b' }),
  }).overtook
}

describe('overtaking × circuit straightness (#sim-overhaul)', () => {
  it('a marginal pass lands on a straight-heavy track but not a corner-heavy one', () => {
    // A ~2.2s clean edge: roll 0.2 passes at Monza-straightness (prob caps at 0.5) but not at Monaco (prob ≈ 0.11).
    expect(passes(0.95, 0.2)).toBe(true)
    expect(passes(0.05, 0.2)).toBe(false)
  })

  it('an easy pass lands on both, a hopeless roll on neither', () => {
    expect(passes(0.95, 0.01)).toBe(true)
    expect(passes(0.05, 0.01)).toBe(true)
    expect(passes(0.95, 0.99)).toBe(false)
    expect(passes(0.05, 0.99)).toBe(false)
  })
})
