import { describe, it, expect, vi, afterEach } from 'vitest'
import { initRaceState, simulateLap, rollForms } from './race'
import type { Driver, Team, Circuit, QualifyingResult, RaceState, GodModeAction } from './types'

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

  // Driver-mode pace tools. Both runs share the RNG sequence (back-off adds no draws), so the only
  // differences are the ones the tool introduces: a flat +2s/lap and halved tyre wear.
  describe('driver pace modes', () => {
    function lapOne(modes?: Record<string, 'normal' | 'defend' | 'backoff'>) {
      vi.spyOn(Math, 'random').mockImplementation(lcg(2))
      const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
      let state = initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025)
      state = simulateLap(state, DRIVERS, TEAMS, CIRCUIT, 2025, undefined, false, modes)
      return state.drivers.find((d) => d.driverId === 'd1')! // d1 leads (pole), so it runs in clean air
    }

    it('back-off adds ~2s/lap and roughly halves the tyre wear', () => {
      const normal = lapOne()
      const backoff = lapOne({ d1: 'backoff' })
      expect(backoff.lapTimes[0] - normal.lapTimes[0]).toBeCloseTo(2.0, 5)
      const normalWear = 100 - normal.currentTyre.condition
      const backoffWear = 100 - backoff.currentTyre.condition
      expect(backoffWear).toBeLessThan(normalWear)            // wore less
      expect(backoffWear).toBeGreaterThan(0)                  // but still wore some
    })

    // A much faster car stuck behind a slow leader: free racing closes it into dirty air (or it passes),
    // but in Defend it backs off and never tucks inside DIRTY_RANGE + buffer (1.4s).
    const LEAD = makeDriver('lead', 'tSlow', 60)
    const CHASE = makeDriver('chase', 'tFast', 99)
    const ARC_DRIVERS = [LEAD, CHASE]
    const ARC_TEAMS = [makeTeam('tSlow', 60), makeTeam('tFast', 96)]
    const arcQuali = (): QualifyingResult[] => [
      { driverId: 'lead', gridPosition: 1, bestTime: 80, q1Time: null, q2Time: null, q3Time: null },
      { driverId: 'chase', gridPosition: 2, bestTime: 80.1, q1Time: null, q2Time: null, q3Time: null },
    ]
    // Seed 1 + a 4-lap window keeps both cars out (no retirement) and before any pit stop, so the gap
    // reflects pure on-track pace management — exactly what Defend governs.
    function chaseArc(modes?: Record<string, 'normal' | 'defend' | 'backoff'>) {
      vi.spyOn(Math, 'random').mockImplementation(lcg(1))
      let state = initRaceState(ARC_DRIVERS, ARC_TEAMS, CIRCUIT, arcQuali(), [], { lead: 5, chase: 5 }, 2025)
      const out: { pos: number; gap: number }[] = []
      for (let lap = 1; lap <= 4; lap++) {
        state = simulateLap(state, ARC_DRIVERS, ARC_TEAMS, CIRCUIT, 2025, undefined, false, modes)
        const c = state.drivers.find((d) => d.driverId === 'chase')!
        if (!c.retired) out.push({ pos: c.position, gap: c.gap })
      }
      return out
    }

    it('defend holds the gap to the car ahead outside dirty air (>= DIRTY_RANGE + buffer)', () => {
      const defend = chaseArc({ chase: 'defend' })
      let behindLaps = 0
      for (const { pos, gap } of defend) {
        if (pos === 2) { behindLaps++; expect(gap).toBeGreaterThanOrEqual(1.4 - 0.02) } // never inside dirty air
      }
      expect(behindLaps).toBe(4) // it held station behind for the whole window, never tucked in or passed
    })

    it('without defend, the faster car does NOT sit politely outside dirty air', () => {
      const free = chaseArc()
      const passed = free.some((g) => g.pos === 1)
      const enteredDirtyAir = free.some((g) => g.pos === 2 && g.gap < 1.4)
      expect(passed || enteredDirtyAir).toBe(true) // it closed up or went by — the opposite of defending
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
