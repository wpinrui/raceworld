import { describe, it, expect, vi, afterEach } from 'vitest'
import { initRaceState } from './race'
import { LiveRace, runLiveRaceToEnd, LIVE_DT } from './live'
import type { Driver, Team, Circuit, QualifyingResult, RaceState } from './types'

// The live engine (#live-engine): continuous positions, physical pits, per-car lap crossings. These
// lock the core invariants — a full race reaches a valid classification, bookkeeping matches the
// whole-lap engine's shapes (lapTimes/totalTime/stints), pits are physical and commandable, and the
// same seed reproduces the same race.

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

const DRIVERS: Driver[] = [
  makeDriver('d1', 'tA', 90), makeDriver('d2', 'tA', 84),
  makeDriver('d3', 'tB', 80), makeDriver('d4', 'tB', 76),
  makeDriver('d5', 'tC', 72), makeDriver('d6', 'tC', 66),
]
const TEAMS: Team[] = [makeTeam('tA', 88), makeTeam('tB', 80), makeTeam('tC', 70)]

function quali(): QualifyingResult[] {
  return DRIVERS.map((d, i) => ({ driverId: d.id, gridPosition: i + 1, bestTime: 80 + i * 0.1, q1Time: null, q2Time: null, q3Time: null }))
}

function freshState(seed: number): RaceState {
  vi.spyOn(Math, 'random').mockImplementation(lcg(seed))
  const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
  return { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025), phase: 'racing' }
}

const project = (s: RaceState) =>
  s.drivers.map((d) => ({
    id: d.driverId, pos: d.position, t: Math.round(d.totalTime * 1000), laps: d.lapTimes.length,
    retired: d.retired, stops: d.pitStops, down: d.lapsDown,
  }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LiveRace', () => {
  it('runs a full seeded race to a valid classification', () => {
    const final = runLiveRaceToEnd(freshState(2), DRIVERS, TEAMS, CIRCUIT, 2025)
    expect(final.phase).toBe('finished')
    expect([...final.drivers.map((d) => d.position)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    for (const d of final.drivers) {
      expect(Number.isFinite(d.totalTime)).toBe(true)
      if (!d.retired) {
        // Lapping is physical: a lapped car takes the flag early, completing totalLaps − lapsDown(±1).
        expect(d.lapTimes.length).toBeLessThanOrEqual(CIRCUIT.laps)
        expect(d.lapTimes.length).toBeGreaterThanOrEqual(CIRCUIT.laps - d.lapsDown - 1)
        for (const t of d.lapTimes) expect(t).toBeGreaterThan(0)
        // totalTime = grid seed + sum of laps (the shared bookkeeping the results pipeline reads).
        const sum = d.lapTimes.reduce((a, b) => a + b, 0)
        expect(d.totalTime - sum).toBeGreaterThanOrEqual(-1e-9)
        expect(d.totalTime - sum).toBeLessThan(10)
      }
    }
    // The winner did the full distance.
    const winner = final.drivers.find((d) => d.position === 1)!
    expect(winner.retired).toBe(false)
    expect(winner.lapTimes.length).toBe(CIRCUIT.laps)
  })

  it('is deterministic: the same seed yields the identical final state', () => {
    const a = project(runLiveRaceToEnd(freshState(2), DRIVERS, TEAMS, CIRCUIT, 2025))
    vi.restoreAllMocks()
    const b = project(runLiveRaceToEnd(freshState(2), DRIVERS, TEAMS, CIRCUIT, 2025))
    expect(a).toEqual(b)
  })

  it('pits somewhere in a full race, with lap-engine-shaped bookkeeping', () => {
    const final = runLiveRaceToEnd(freshState(2), DRIVERS, TEAMS, CIRCUIT, 2025)
    const stopped = final.drivers.filter((d) => d.pitStops > 0)
    expect(stopped.length).toBeGreaterThan(0)
    for (const d of stopped) {
      expect(d.stintHistory.length).toBe(d.pitStops)
      expect(d.lastPitLap).toBeGreaterThan(0)
      expect(d.lastPitLap).toBeLessThanOrEqual(d.lapTimes.length)
    }
  })

  it('obeys a pit command: called before the entry, the car boxes that lap', () => {
    const live = new LiveRace(freshState(7), DRIVERS, TEAMS, CIRCUIT, 2025, ['d1'])
    // Run until d1 is early in lap 2, then call it in.
    let guard = 0
    while (guard++ < 100000) {
      live.step(LIVE_DT)
      const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
      if (d1.ds.lapTimes.length === 1 && d1.pos - Math.floor(d1.pos) > 0.1 && d1.pos - Math.floor(d1.pos) < 0.5) break
    }
    live.commandPit('d1', 'hard')
    // Wait for the stop to fully COMPLETE (car back out of the lane): the counter ticks at box
    // arrival, but the fresh set is only fitted when the stationary work is done.
    let pitted = false
    guard = 0
    while (guard++ < 100000 && !pitted) {
      live.step(LIVE_DT)
      const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
      if (d1.ds.pitStops === 1 && d1.pit === null) pitted = true
      if (d1.ds.lapTimes.length > 3) break
    }
    const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
    expect(pitted).toBe(true)
    expect(d1.ds.lastPitLap).toBe(2) // the lap it was driving when called
    expect(d1.ds.currentTyre.compound).toBe('hard')
    expect(d1.ds.stintLap).toBe(0)
  })

  it('a cancelled call stays out', () => {
    const live = new LiveRace(freshState(7), DRIVERS, TEAMS, CIRCUIT, 2025, ['d1'])
    let guard = 0
    while (guard++ < 100000) {
      live.step(LIVE_DT)
      const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
      if (d1.ds.lapTimes.length === 1 && d1.pos - Math.floor(d1.pos) > 0.1) break
    }
    live.commandPit('d1', 'hard')
    live.commandStay('d1')
    let guard2 = 0
    while (guard2++ < 100000) {
      live.step(LIVE_DT)
      const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
      if (d1.ds.lapTimes.length >= 3) break
    }
    const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
    // The AI may still pit it later for strategy, but not on the cancelled lap.
    expect(d1.ds.lastPitLap === 0 || d1.ds.lastPitLap > 2).toBe(true)
  })

  it('player push bites: max push from lap 2 beats the same seed at normal push', () => {
    const run = (push: boolean) => {
      const live = new LiveRace(freshState(11), DRIVERS, TEAMS, CIRCUIT, 2025, ['d1'])
      let guard = 0
      let applied = false
      while (live.phase === 'racing' && guard++ < 200000) {
        const d1 = live.cars.find((c) => c.ds.driverId === 'd1')!
        if (push && !applied && d1.ds.lapTimes.length === 1) {
          d1.ds.push = { kind: 'manual', level: 2 }
          applied = true
        }
        live.step(LIVE_DT)
        if (d1.ds.lapTimes.length >= 4) return d1.ds.lapTimes.slice(1, 4).reduce((a, b) => a + b, 0)
      }
      return Infinity
    }
    const normal = run(false)
    vi.restoreAllMocks()
    const pushed = run(true)
    expect(pushed).toBeLessThan(normal)
  })

  it('emits events the commentary can consume', () => {
    vi.spyOn(Math, 'random').mockImplementation(lcg(2))
    const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
    const state: RaceState = { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025), phase: 'racing' }
    const live = new LiveRace(state, DRIVERS, TEAMS, CIRCUIT, 2025)
    let guard = 0
    const types = new Set<string>()
    while (live.phase === 'racing' && guard++ < 200000) {
      live.step(LIVE_DT)
      for (const e of live.drainEvents()) types.add(e.type)
    }
    expect(types.has('finish')).toBe(true)
    expect(types.has('pit-in')).toBe(true)
  })

  it('snapshot gaps are non-negative and ordered by the live positions', () => {
    const live = new LiveRace(freshState(3), DRIVERS, TEAMS, CIRCUIT, 2025)
    for (let i = 0; i < 2000; i++) live.step(LIVE_DT)
    const snap = live.snapshot()
    const running = snap.drivers.filter((d) => !d.retired)
    for (const d of running) expect(d.gap).toBeGreaterThanOrEqual(0)
    expect([...snap.drivers.map((d) => d.position)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })
})
