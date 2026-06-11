import { describe, it, expect, vi, afterEach } from 'vitest'
import { initRaceState, simulateLap, rollForms } from './race'
import type { Driver, Team, Circuit, QualifyingResult, RaceState } from './types'

// Characterization test for the race-lap simulation. simulateLap is the hot path every race runs
// through, and it consumes Math.random heavily (lap-time noise, mistakes, reliability). To lock its
// behaviour ahead of a step-extraction refactor, we drive it with a seeded, deterministic RNG and
// snapshot a stable projection of the field after a full race. Any change to the lap logic OR to the
// order in which it draws random numbers will move the snapshot.

// A tiny deterministic LCG so the whole sim is reproducible regardless of how many draws it makes.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function makeDriver(id: string, teamId: string, pace: number): Driver {
  return {
    id, name: id, teamId,
    nationality: 'GB', gender: 'male',
    pace, wetWeatherPace: pace, overtaking: pace, smoothness: pace, consistency: pace,
    confidence: 5,
    age: 25, peakPotential: 80, primeEnd: 30,
    narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}

function makeTeam(id: string, carPace: number): Team {
  return { id, name: id, shortName: id.slice(0, 3).toUpperCase(), nationality: 'GB', color: '#FF0000', carPace }
}

const CIRCUIT: Circuit = {
  id: 'testring', name: 'Testring', code: 'TST', location: 'Testville', country: 'GB',
  laps: 12, flatModifier: 0, sundayOfYear: 1,
}

// Six cars across three teams, with a clear pace spread so the order is non-degenerate.
const DRIVERS: Driver[] = [
  makeDriver('d1', 'tA', 90), makeDriver('d2', 'tA', 84),
  makeDriver('d3', 'tB', 80), makeDriver('d4', 'tB', 76),
  makeDriver('d5', 'tC', 72), makeDriver('d6', 'tC', 66),
]
const TEAMS: Team[] = [makeTeam('tA', 88), makeTeam('tB', 80), makeTeam('tC', 70)]

function quali(): QualifyingResult[] {
  // Grid in nominal pace order, fastest on pole.
  return DRIVERS.map((d, i) => ({ driverId: d.id, gridPosition: i + 1, bestTime: 80 + i * 0.1, q1Time: null, q2Time: null, q3Time: null }))
}

// A compact, meaningful projection of the field — enough to catch any behavioural drift without
// snapshotting the entire (large, noisy) RaceState object.
function project(state: RaceState) {
  return state.drivers.map((d) => ({
    driverId: d.driverId,
    position: d.position,
    totalTime: Math.round(d.totalTime * 1000) / 1000,
    laps: d.lapTimes.length,
    retired: d.retired,
    retirementLap: d.retirementLap,
    tyre: d.currentTyre.compound,
    condition: Math.round(d.currentTyre.condition * 10) / 10,
    pitStops: d.pitStops,
    mistakeCount: d.mistakeCount,
  }))
}

function runRace(seed: number): RaceState {
  const rng = lcg(seed)
  vi.spyOn(Math, 'random').mockImplementation(rng)
  const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
  let state = initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025)
  for (let lap = 1; lap <= CIRCUIT.laps; lap++) state = simulateLap(state, DRIVERS, TEAMS, CIRCUIT, 2025)
  return state
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rollForms', () => {
  it('rolls a form in [0, 10] for every driver', () => {
    vi.spyOn(Math, 'random').mockImplementation(lcg(7))
    const forms = rollForms(DRIVERS)
    expect(Object.keys(forms).sort()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])
    for (const id of Object.keys(forms)) {
      expect(forms[id]).toBeGreaterThanOrEqual(0)
      expect(forms[id]).toBeLessThanOrEqual(10)
    }
  })
})

describe('simulateLap (characterization)', () => {
  it('produces a stable final classification for a seeded race', () => {
    const state = runRace(12345)
    expect(project(state)).toMatchSnapshot()
  })

  it('is deterministic: the same seed yields the identical final state', () => {
    expect(project(runRace(999))).toEqual(project(runRace(999)))
  })

  it('keeps the field physically consistent over a full race', () => {
    const state = runRace(2024)
    // Positions are a permutation of 1..N.
    expect([...state.drivers.map((d) => d.position)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    // The race ran to the full distance.
    expect(state.currentLap).toBe(CIRCUIT.laps + 1)
    for (const d of state.drivers) {
      // No NaN/Infinity leaked into the running times.
      expect(Number.isFinite(d.totalTime)).toBe(true)
      // A car that finished logged a lap time for every lap; a retiree logged fewer.
      if (!d.retired) expect(d.lapTimes.length).toBe(CIRCUIT.laps)
      else expect(d.lapTimes.length).toBeLessThan(CIRCUIT.laps)
    }
  })
})
