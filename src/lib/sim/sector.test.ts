import { describe, it, expect, vi, afterEach } from 'vitest'
import { initRaceState } from './race'
import { simulateSector, SECTORS_PER_LAP, SECTOR_FRAC } from './sector'
import { perSliceProb } from './rng-utils'
import { pitLaneLoss } from './pit-loss'
import type { Driver, Team, Circuit, QualifyingResult, RaceState, PushState } from './types'

// Sector-engine tests (#sector-engine): the played-race tick that resolves a lap in 8 slices through
// the same core as simulateLap. These lock the sector-specific bookkeeping — splits summing into lap
// times, the sector/lap counters, the pit landing in the final sector — plus a characterization
// snapshot of a full seeded race so sector-path drift is caught the same way race.test.ts catches
// lap-path drift.

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

const DRIVERS: Driver[] = [
  makeDriver('d1', 'tA', 90), makeDriver('d2', 'tA', 84),
  makeDriver('d3', 'tB', 80), makeDriver('d4', 'tB', 76),
  makeDriver('d5', 'tC', 72), makeDriver('d6', 'tC', 66),
]
const TEAMS: Team[] = [makeTeam('tA', 88), makeTeam('tB', 80), makeTeam('tC', 70)]

function quali(): QualifyingResult[] {
  return DRIVERS.map((d, i) => ({ driverId: d.id, gridPosition: i + 1, bestTime: 80 + i * 0.1, q1Time: null, q2Time: null, q3Time: null }))
}

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

// Run a full race one SECTOR at a time with a seeded RNG, invoking onTick after every sector.
function runSectorRace(seed: number, onTick?: (state: RaceState, tick: number) => RaceState): RaceState {
  vi.spyOn(Math, 'random').mockImplementation(lcg(seed))
  const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
  let state = initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025)
  state = { ...state, phase: 'racing' }
  let tick = 0
  while (state.phase === 'racing' && tick < CIRCUIT.laps * SECTORS_PER_LAP + 8) {
    state = simulateSector(state, DRIVERS, TEAMS, CIRCUIT, 2025)
    tick++
    if (onTick) state = onTick(state, tick)
  }
  return state
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('perSliceProb', () => {
  it('is the identity at frac = 1 and compounds back to the per-lap rate at 1/8', () => {
    expect(perSliceProb(0.37, 1)).toBe(0.37)
    const p = 0.12
    const per = perSliceProb(p, SECTOR_FRAC)
    expect(1 - (1 - per) ** SECTORS_PER_LAP).toBeCloseTo(p, 12)
  })
})

describe('simulateSector', () => {
  it('runs a full seeded race to a valid classification', () => {
    const state = runSectorRace(2)
    expect(state.phase).toBe('finished')
    expect(state.currentLap).toBe(CIRCUIT.laps + 1)
    expect([...state.drivers.map((d) => d.position)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    for (const d of state.drivers) {
      expect(Number.isFinite(d.totalTime)).toBe(true)
      if (!d.retired) expect(d.lapTimes.length).toBe(CIRCUIT.laps)
      for (const t of d.lapTimes) expect(t).toBeGreaterThan(0)
    }
  })

  it('locks the sector path with a characterization snapshot', () => {
    expect(project(runSectorRace(2))).toMatchSnapshot()
  })

  it('is deterministic: the same seed yields the identical final state', () => {
    expect(project(runSectorRace(2))).toEqual(project(runSectorRace(2)))
  })

  it('sums each lap\'s eight splits exactly into the appended lap time', () => {
    runSectorRace(2, (state, tick) => {
      if (tick % SECTORS_PER_LAP === 0) {
        for (const d of state.drivers) {
          if (d.retired || !d.sectorTimes) continue
          expect(d.sectorTimes.length).toBe(SECTORS_PER_LAP)
          const sum = d.sectorTimes.reduce((a, b) => a + b, 0)
          expect(sum).toBeCloseTo(d.lapTimes[d.lapTimes.length - 1], 9)
          for (const t of d.sectorTimes) expect(t).toBeGreaterThan(0)
        }
      }
      return state
    })
  })

  it('cycles currentSector 0..7, advances currentLap every 8th tick, and keeps the grid anchor', () => {
    const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
    vi.spyOn(Math, 'random').mockImplementation(lcg(2))
    let state: RaceState = { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025), phase: 'racing' }
    const seeds = new Map(state.drivers.map((d) => [d.driverId, d.totalTime]))
    for (let tick = 1; tick <= SECTORS_PER_LAP * 3; tick++) {
      const beforeLap = state.currentLap
      state = simulateSector(state, DRIVERS, TEAMS, CIRCUIT, 2025)
      expect(state.currentSector).toBe(tick % SECTORS_PER_LAP)
      expect(state.currentLap).toBe(tick % SECTORS_PER_LAP === 0 ? beforeLap + 1 : beforeLap)
      for (const d of state.drivers) {
        if (d.retired) continue
        const resolved = d.lapTimes.reduce((a, b) => a + b, 0)
        // Mid-lap the splits are the in-progress remainder; on a lap boundary they duplicate the lap.
        const splits = state.currentSector === 0 ? 0 : (d.sectorTimes ?? []).reduce((a, b) => a + b, 0)
        expect(d.totalTime - resolved - splits).toBeCloseTo(seeds.get(d.driverId)!, 6)
      }
    }
  })

  it('condition wears monotonically as a float between pit stops', () => {
    let last = new Map<string, { cond: number; stops: number }>()
    runSectorRace(2, (state) => {
      for (const d of state.drivers) {
        if (d.retired) continue
        const prev = last.get(d.driverId)
        // Condition only rises when a stop fitted a fresh set (worn the same slice, so ~100, not exactly).
        if (prev != null && d.currentTyre.condition > prev.cond) expect(d.pitStops).toBe(prev.stops + 1)
        expect(d.currentTyre.condition).toBeGreaterThanOrEqual(0)
      }
      last = new Map(state.drivers.map((d) => [d.driverId, { cond: d.currentTyre.condition, stops: d.pitStops }]))
      return state
    })
  })

  it('applies a mid-lap push change from the very next sector', () => {
    // d1 leads from pole in clean air, player-controlled: its sector times reflect only its own push.
    // Two runs share the RNG; the push curve draws nothing, so sectors before the change are identical.
    const run = (push: PushState | null) => {
      const forms = Object.fromEntries(DRIVERS.map((d) => [d.id, 5]))
      vi.spyOn(Math, 'random').mockImplementation(lcg(2))
      let state: RaceState = { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, quali(), [], forms, 2025), phase: 'racing' }
      const splits: number[] = []
      for (let tick = 1; tick <= 6; tick++) {
        if (tick === 4 && push) {
          state = { ...state, drivers: state.drivers.map((d) => (d.driverId === 'd1' ? { ...d, push } : d)) }
        }
        state = simulateSector(state, DRIVERS, TEAMS, CIRCUIT, 2025, undefined, ['d1'])
        splits.push(state.drivers.find((d) => d.driverId === 'd1')!.sectorTimes!.at(-1)!)
      }
      vi.restoreAllMocks()
      return splits
    }
    const normal = run(null)
    const pushed = run({ kind: 'manual', level: 2 })
    expect(pushed.slice(0, 3)).toEqual(normal.slice(0, 3)) // before the command: identical
    expect(pushed[3]).toBeLessThan(normal[3])              // the sector after it: already quicker
  })

  it('lands the pit stop in the final sector of its lap', () => {
    const pitLoss = pitLaneLoss(2025)
    let checked = 0
    runSectorRace(2, (state, tick) => {
      if (tick % SECTORS_PER_LAP === 0) {
        const lapJustDone = state.currentLap - 1
        for (const d of state.drivers) {
          if (d.retired || d.lastPitLap !== lapJustDone || !d.sectorTimes) continue
          // The stop's time loss sits in the last split: it dwarfs every other split of the lap.
          const rest = d.sectorTimes.slice(0, -1)
          const last = d.sectorTimes[d.sectorTimes.length - 1]
          expect(last).toBeGreaterThan(Math.max(...rest) + pitLoss * 0.5)
          expect(d.stintLap).toBe(0)
          checked++
        }
      }
      return state
    })
    expect(checked).toBeGreaterThan(0) // the seed really pits — the assertions above ran
  })
})
