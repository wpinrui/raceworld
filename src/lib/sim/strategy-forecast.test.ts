import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Driver, Team, Circuit, QualifyingResult, RaceState } from './types'
import { initRaceState, simulateLap } from './race'
import {
  buildCandidates,
  candKey,
  candidateActions,
  forecastSingleRun,
  gatherForecast,
  summarizeForecast,
  type ForecastSample,
} from './strategy-forecast'

// Seeded LCG (same shape as race.test.ts) so the engine is deterministic under a given seed.
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
    confidence: 5, age: 25, peakPotential: 80, primeEnd: 30,
    narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}
function makeTeam(id: string, carPace: number): Team {
  return { id, name: id, shortName: id.slice(0, 3).toUpperCase(), nationality: 'GB', color: '#FF0000', carPace }
}
const CIRCUIT: Circuit = { id: 'testring', name: 'Testring', code: 'TST', location: 'Testville', country: 'GB', laps: 16, flatModifier: 0, sundayOfYear: 1 }
const DRIVERS: Driver[] = [
  makeDriver('d1', 'tA', 90), makeDriver('d2', 'tA', 84),
  makeDriver('d3', 'tB', 80), makeDriver('d4', 'tB', 76),
  makeDriver('d5', 'tC', 72), makeDriver('d6', 'tC', 66),
]
const TEAMS: Team[] = [makeTeam('tA', 88), makeTeam('tB', 80), makeTeam('tC', 70)]
const QUALI: QualifyingResult[] = DRIVERS.map((d, i) => ({ driverId: d.id, gridPosition: i + 1, bestTime: 80 + i * 0.1, q1Time: null, q2Time: null, q3Time: null }))

// A fresh racing-phase state at lap 1, mirroring how the app reaches the pit wall (race running, paused).
function racingState(seed: number): RaceState {
  vi.spyOn(Math, 'random').mockImplementation(lcg(seed))
  const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
  return { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, QUALI, [], forms, 2025), phase: 'racing' }
}

afterEach(() => vi.restoreAllMocks())

describe('buildCandidates by weather', () => {
  const pitCompounds = (m: number) => buildCandidates(m, 'racing').flatMap((c) => (c.kind === 'pit' ? [c.compound] : []))

  it('offers slicks (and a hold) in the dry, no wets and no auto', () => {
    const c = buildCandidates(0, 'racing')
    expect(pitCompounds(0)).toEqual(['soft', 'medium', 'hard'])
    expect(c.some((x) => x.kind === 'hold')).toBe(true)
    expect(c.some((x) => x.kind === 'auto')).toBe(false)
  })

  it('switches to intermediates/wets once it is wet and drops slicks', () => {
    expect(pitCompounds(0.3)).toContain('intermediate')
    expect(pitCompounds(0.3)).not.toContain('soft')
    expect(pitCompounds(0.6)).toContain('wet')
    expect(pitCompounds(0.6)).not.toContain('soft')
  })

  it('pre-race offers the grid tyres as start options', () => {
    const c = buildCandidates(0, 'pre-race')
    expect(c.every((x) => x.kind === 'start')).toBe(true)
    expect(c.flatMap((x) => (x.kind === 'start' ? [x.compound] : []))).toEqual(['soft', 'medium', 'hard'])
  })
})

describe('gatherForecast', () => {
  it('fills every option to target — round-robin, no starvation', async () => {
    const start = racingState(3) // already phase 'racing', seeds Math.random
    const cands = buildCandidates(0, 'racing') // soft/medium/hard pits + hold
    const { acc } = await gatherForecast(start, DRIVERS, TEAMS, CIRCUIT, 'd1', cands, { target: 4 })
    // The bug left every option after the first at 0; fair round-robin must bring them all to target.
    for (const c of cands) expect(acc[candKey(c)].length).toBe(4)
  })

  it('short-circuits before target when shouldStop fires', async () => {
    const start = racingState(3)
    const cands = buildCandidates(0, 'racing')
    const { acc } = await gatherForecast(start, DRIVERS, TEAMS, CIRCUIT, 'd1', cands, { target: 50, shouldStop: () => true })
    // Decisive after the first burst → far short of the full 50-per-option sample.
    expect(Math.max(...cands.map((c) => acc[candKey(c)].length))).toBeLessThan(50)
  })
})

describe('candidateActions', () => {
  it('maps each pit-wall button to the right god-mode override', () => {
    expect(candidateActions({ kind: 'auto' }, 'd1')).toBeUndefined()
    expect(candidateActions({ kind: 'hold' }, 'd1')).toEqual([{ type: 'cancel-pit', driverId: 'd1' }])
    expect(candidateActions({ kind: 'pit', compound: 'soft' }, 'd1')).toEqual([{ type: 'force-pit', driverId: 'd1', compound: 'soft' }])
    expect(candidateActions({ kind: 'start', compound: 'hard' }, 'd1')).toBeUndefined() // tyre fitted in the seed state, not via an override
  })
})

describe('forecastSingleRun', () => {
  it('runs to the flag and returns a classified outcome for the player', () => {
    const start = racingState(2)
    const sample = forecastSingleRun(start, DRIVERS, TEAMS, CIRCUIT, 2025, 'd1', { kind: 'auto' })
    expect(sample.position).toBeGreaterThanOrEqual(1)
    expect(sample.position).toBeLessThanOrEqual(DRIVERS.length)
    expect(typeof sample.retired).toBe('boolean')
  })

  it('runs a pre-race grid-tyre (start) candidate to the flag', () => {
    // Pre-race seed: phase flipped to racing exactly as the green light does, lap 1.
    const start: RaceState = { ...racingState(2), phase: 'racing' }
    const sample = forecastSingleRun(start, DRIVERS, TEAMS, CIRCUIT, 2025, 'd1', { kind: 'start', compound: 'hard' })
    expect(sample.position).toBeGreaterThanOrEqual(1)
    expect(sample.position).toBeLessThanOrEqual(DRIVERS.length)
  })

  it('does not mutate the seed state, so it is safe to reuse across runs', () => {
    const start = racingState(2)
    const before = JSON.stringify(start)
    forecastSingleRun(start, DRIVERS, TEAMS, CIRCUIT, 2025, 'd1', { kind: 'pit', compound: 'soft' })
    expect(JSON.stringify(start)).toBe(before)
  })

  it('threads the candidate through: forcing a pit makes the player stop, holding does not', () => {
    // Drive the engine directly with the same overrides the forecast applies, and confirm the effect lands.
    vi.spyOn(Math, 'random').mockImplementation(lcg(5))
    const start: RaceState = { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, QUALI, [], Object.fromEntries(DRIVERS.map((d) => [d.id, 5])), 2025), phase: 'racing' }
    const pitted = simulateLap(start, DRIVERS, TEAMS, CIRCUIT, 2025, candidateActions({ kind: 'pit', compound: 'hard' }, 'd1'))
    const held = simulateLap(start, DRIVERS, TEAMS, CIRCUIT, 2025, candidateActions({ kind: 'hold' }, 'd1'))
    const pd = pitted.drivers.find((d) => d.driverId === 'd1')!
    const hd = held.drivers.find((d) => d.driverId === 'd1')!
    expect(pd.pitStops).toBe(1)
    expect(pd.currentTyre.compound).toBe('hard')
    expect(hd.pitStops).toBe(0)
  })
})

describe('summarizeForecast', () => {
  const mk = (position: number, retired = false): ForecastSample => ({ position, retired })

  it('returns zeros for no runs', () => {
    expect(summarizeForecast([], 6, 2025).runs).toBe(0)
  })

  it('computes expected finish, win/podium/points and DNF rate', () => {
    const samples = [mk(1), mk(2), mk(3), mk(8)]
    const stats = summarizeForecast(samples, 20, 2025)
    expect(stats.runs).toBe(4)
    expect(stats.expectedFinish).toBeCloseTo((1 + 2 + 3 + 8) / 4, 6)
    expect(stats.pWin).toBeCloseTo(0.25, 6)
    expect(stats.pPodium).toBeCloseTo(0.75, 6)
    expect(stats.pPoints).toBeCloseTo(1, 6) // P8 scores in 2025 (top 10)
    expect(stats.dnfRate).toBe(0)
  })

  it('counts a DNF as one place worse than last and never as a points finish', () => {
    // A retiree with a stale top-3 position must not count as a podium/points; its score is fieldSize+1.
    const stats = summarizeForecast([mk(1), mk(2, true)], 6, 2025)
    expect(stats.pPodium).toBeCloseTo(0.5, 6) // only the genuine P1
    expect(stats.pPoints).toBeCloseTo(0.5, 6)
    expect(stats.dnfRate).toBeCloseTo(0.5, 6)
    expect(stats.expectedFinish).toBeCloseTo((1 + 7) / 2, 6) // DNF scored as 6+1
  })

  it('bad-day figure is the mean of the worst quartile (and feels DNFs)', () => {
    // 8 runs: positions 1..6 plus two DNFs. Worst quartile = ceil(8×0.25)=2 worst scores = both DNFs (7).
    const samples = [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), mk(1, true), mk(2, true)]
    const stats = summarizeForecast(samples, 6, 2025)
    expect(stats.badDayFinish).toBeCloseTo(7, 6)
    expect(stats.expectedFinish).toBeLessThan(stats.badDayFinish) // the bad day is worse than the average
  })
})
