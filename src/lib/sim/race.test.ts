import { describe, it, expect, vi, afterEach } from 'vitest'
import { initRaceState, simulateLap, rollForms } from './race'
import type { Driver, Team, Circuit, QualifyingResult, RaceState, GodModeAction, PushState } from './types'

// Characterization test for the race-lap simulation. simulateLap is the hot path every race runs
// through, and it consumes Math.random heavily (lap-time noise, mistakes, reliability, tyre wear). To
// lock its behaviour ahead of a step-extraction refactor, we drive it with a seeded, deterministic RNG
// and snapshot a stable projection of the field after a full race. Any change to the lap logic OR to
// the order in which it draws random numbers will move the snapshot. The seed is chosen so the race
// includes retirements, so the snapshot also locks the retirement + classification paths.

// A tiny deterministic LCG so the whole sim is reproducible regardless of how many draws it makes.
// (raceConditions seeds weather/tyres separately off (saveSeed, year, circuit), so it's stable too.)
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const round3 = (x: number) => Math.round(x * 1000) / 1000
const round1 = (x: number) => Math.round(x * 10) / 10

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

// A compact, meaningful projection of the field — enough to catch behavioural drift (positions,
// times, gaps, tyre/stint state, retirements) without snapshotting the entire noisy RaceState.
function project(state: RaceState) {
  return state.drivers.map((d) => ({
    driverId: d.driverId,
    position: d.position,
    totalTime: round3(d.totalTime),
    gap: round3(d.gap),
    laps: d.lapTimes.length,
    lapsDown: d.lapsDown,
    retired: d.retired,
    retirementLap: d.retirementLap,
    tyre: d.currentTyre.compound,
    condition: round1(d.currentTyre.condition),
    pitStops: d.pitStops,
    stints: d.stintHistory.length,
    mistakeCount: d.mistakeCount,
  }))
}

// Run a full race with a seeded RNG. godModeByLap optionally injects god-mode actions on a given lap.
function runRace(seed: number, godModeByLap: Record<number, GodModeAction[]> = {}): RaceState {
  vi.spyOn(Math, 'random').mockImplementation(lcg(seed))
  const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
  let state = initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025)
  for (let lap = 1; lap <= CIRCUIT.laps; lap++) state = simulateLap(state, DRIVERS, TEAMS, CIRCUIT, 2025, godModeByLap[lap])
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
  it('produces a stable final classification, including retirements, for a seeded race', () => {
    const state = runRace(2) // this seed retires cars naturally — locks the DNF path too
    expect(state.drivers.some((d) => d.retired)).toBe(true)
    expect(project(state)).toMatchSnapshot()
  })

  it('records a god-mode forced retirement and classifies the car out of the running', () => {
    // d3 finishes naturally under seed 2, so forcing it out makes the retirement unambiguously the
    // god-mode one — retirementLap is exactly the injected lap, not a coincidental natural DNF.
    const state = runRace(2, { 5: [{ type: 'force-retire', driverId: 'd3' }] })
    const d3 = state.drivers.find((d) => d.driverId === 'd3')!
    expect(d3.retired).toBe(true)
    expect(d3.retirementLap).toBe(5)
    expect(d3.retirementReason).not.toBeNull()
    expect(d3.lapTimes.length).toBeLessThan(CIRCUIT.laps)
    // A retiree classifies behind every car still running.
    const finishers = state.drivers.filter((d) => !d.retired)
    expect(d3.position).toBeGreaterThan(finishers.length)
    expect(project(state)).toMatchSnapshot()
  })

  it('is deterministic: the same seed yields the identical final state', () => {
    expect(project(runRace(2))).toEqual(project(runRace(2)))
  })

  // Push controls (#sim-overhaul). d1 leads (pole), so it runs in clean air — its lap reflects ONLY its own
  // push. Both runs share the RNG sequence (the push curve adds no draws), so the only differences are the
  // ones intensity introduces: pace, heat, and wear.
  describe('push controls', () => {
    function lapOne(push: PushState) {
      vi.spyOn(Math, 'random').mockImplementation(lcg(2))
      const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
      let state = initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025)
      state = { ...state, drivers: state.drivers.map((d) => (d.driverId === 'd1' ? { ...d, push } : d)) }
      state = simulateLap(state, DRIVERS, TEAMS, CIRCUIT, 2025, undefined, false, ['d1']) // d1 player-driven
      return state.drivers.find((d) => d.driverId === 'd1')!
    }
    const normal = () => lapOne({ kind: 'manual', level: 0 })

    it('max push is quicker, heats the tyre, and wears it more than normal', () => {
      const n = normal(), max = lapOne({ kind: 'manual', level: 2 })
      expect(max.lapTimes[0]).toBeLessThan(n.lapTimes[0])
      expect(max.tyreTemp!).toBeGreaterThan(n.tyreTemp!)
      expect(100 - max.currentTyre.condition).toBeGreaterThan(100 - n.currentTyre.condition)
    })

    it('backing off is slower, cools the tyre, and conserves it', () => {
      const n = normal(), back = lapOne({ kind: 'manual', level: -2 })
      expect(back.lapTimes[0]).toBeGreaterThan(n.lapTimes[0])
      expect(back.tyreTemp!).toBeLessThan(n.tyreTemp!)
      expect(100 - back.currentTyre.condition).toBeLessThan(100 - n.currentTyre.condition)
    })

    // The careful #push-auto case: a player car in Normal with auto-defend armed, a genuine threat right behind.
    // The sim pushes to defend FOR the lap, but that is NOT the driver changing push — the Normal selection and
    // the armed toggle must both survive untouched, so it keeps defending lap after lap.
    it('auto-defend defends without altering the driver\'s Normal intent', () => {
      vi.spyOn(Math, 'random').mockImplementation(lcg(2))
      const P = makeDriver('p', 'tA', 75), C = makeDriver('c', 'tA', 85) // same team → chaser edge is pure driver pace
      const ds = [P, C], ts = [makeTeam('tA', 75)]
      const q: QualifyingResult[] = [
        { driverId: 'p', gridPosition: 1, bestTime: 80, q1Time: null, q2Time: null, q3Time: null },
        { driverId: 'c', gridPosition: 2, bestTime: 80.1, q1Time: null, q2Time: null, q3Time: null },
      ]
      let state = initRaceState(ds, ts, CIRCUIT, q, [], { p: 5, c: 5 }, 2025)
      state = { ...state, drivers: state.drivers.map((d) => (d.driverId === 'p' ? { ...d, autoDefend: true, push: { kind: 'manual', level: 0 } } : d)) }
      state = simulateLap(state, ds, ts, CIRCUIT, 2025, undefined, false, ['p'])
      const p = state.drivers.find((d) => d.driverId === 'p')!
      expect(p.defending).toBe(true)                       // it actually defended this lap
      expect(p.autoDefend).toBe(true)                      // ...and the toggle is still armed
      expect(p.push).toEqual({ kind: 'manual', level: 0 }) // ...and the driver's intent is untouched
    })
  })

  it('keeps the field physically consistent, finishers and retirees alike', () => {
    const state = runRace(2)
    // Positions are a permutation of 1..N.
    expect([...state.drivers.map((d) => d.position)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    // The race ran to the full distance.
    expect(state.currentLap).toBe(CIRCUIT.laps + 1)
    let retirees = 0
    for (const d of state.drivers) {
      // No NaN/Infinity leaked into the running times.
      expect(Number.isFinite(d.totalTime)).toBe(true)
      // A car that finished logged a lap time for every lap; a retiree logged fewer.
      if (!d.retired) expect(d.lapTimes.length).toBe(CIRCUIT.laps)
      else { retirees++; expect(d.lapTimes.length).toBeLessThan(CIRCUIT.laps) }
    }
    expect(retirees).toBeGreaterThan(0) // the retiree branch above is actually exercised
  })
})
