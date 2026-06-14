import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Driver, Team, Circuit, QualifyingResult, RaceState } from './types'
import { initRaceState } from './race'
import { evaluatePitOptions } from './race-projector'

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
function makeDriver(id: string, teamId: string, pace: number): Driver {
  return {
    id, name: id, teamId, nationality: 'GB', gender: 'male',
    pace, wetWeatherPace: pace, overtaking: pace, smoothness: pace, consistency: pace,
    confidence: 5, age: 25, peakPotential: 80, primeEnd: 30, narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}
function makeTeam(id: string, carPace: number): Team {
  return { id, name: id, shortName: id.slice(0, 3).toUpperCase(), nationality: 'GB', color: '#FF0000', carPace }
}
const CIRCUIT: Circuit = { id: 'c', name: 'c', code: 'CCC', location: 'x', country: 'GB', laps: 45, flatModifier: 0, sundayOfYear: 1 }
const DRIVERS: Driver[] = [
  makeDriver('d1', 'tA', 90), makeDriver('d2', 'tA', 84),
  makeDriver('d3', 'tB', 80), makeDriver('d4', 'tB', 76),
  makeDriver('d5', 'tC', 72), makeDriver('d6', 'tC', 66),
]
const TEAMS: Team[] = [makeTeam('tA', 88), makeTeam('tB', 80), makeTeam('tC', 70)]
const QUALI: QualifyingResult[] = DRIVERS.map((d, i) => ({ driverId: d.id, gridPosition: i + 1, bestTime: 80 + i * 0.1, q1Time: null, q2Time: null, q3Time: null }))

function racingState(seed: number): RaceState {
  vi.spyOn(Math, 'random').mockImplementation(lcg(seed))
  const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
  return { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, QUALI, [], forms, 2025), phase: 'racing' }
}

afterEach(() => vi.restoreAllMocks())

describe('evaluatePitOptions', () => {
  it('is deterministic — identical results on a repeat call', () => {
    const s = racingState(2)
    vi.restoreAllMocks() // the projection itself uses no RNG; prove it
    const a = evaluatePitOptions(s, DRIVERS, TEAMS, CIRCUIT, 2025, 'd1')
    const b = evaluatePitOptions(s, DRIVERS, TEAMS, CIRCUIT, 2025, 'd1')
    expect(a).toEqual(b)
  })

  it('returns a valid finishing place for every option', () => {
    const opts = evaluatePitOptions(racingState(2), DRIVERS, TEAMS, CIRCUIT, 2025, 'd1')
    expect(opts.length).toBeGreaterThan(0)
    for (const o of opts) {
      expect(o.finishPosition).toBeGreaterThanOrEqual(1)
      expect(o.finishPosition).toBeLessThanOrEqual(DRIVERS.length)
    }
    // sorted best-first
    for (let i = 1; i < opts.length; i++) expect(opts[i].finishPosition).toBeGreaterThanOrEqual(opts[i - 1].finishPosition)
  })

  it('a fresh-tyre leader is told to STAY OUT (boxing now costs time)', () => {
    const opts = evaluatePitOptions(racingState(2), DRIVERS, TEAMS, CIRCUIT, 2025, 'd1') // d1 = pole, fastest car
    expect(opts[0].candidate.kind).toBe('hold') // staying out is the best option
    for (const o of opts) if (o.candidate.kind === 'pit') expect(o.deltaVsBaseline).toBeGreaterThan(0) // every pit loses time
  })

  it('a near-dead tyre with no planned stop is told to BOX (pitting beats riding the cliff)', () => {
    const s = racingState(2)
    // Player on a dying tyre and the AI plan says no stop → "stay out" means riding it to the flag (cliff).
    const drivers = s.drivers.map((d) => (d.driverId === 'd1' ? { ...d, currentTyre: { ...d.currentTyre, condition: 8 }, targetPitLap: null } : d))
    const opts = evaluatePitOptions({ ...s, drivers }, DRIVERS, TEAMS, CIRCUIT, 2025, 'd1')
    expect(opts[0].candidate.kind).toBe('pit') // the best option is to box
    expect(opts[0].deltaVsBaseline).toBeLessThan(0) // and it's faster than staying out
  })
})
