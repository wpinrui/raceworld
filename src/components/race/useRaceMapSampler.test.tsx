import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRaceMapSampler } from './useRaceMapSampler'
import { useRaceStore } from '@/lib/store/race-store'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import type { DriverRaceState, RaceState } from '@/lib/sim/types'

// The 2D sampler's window math (#sector-engine): the playback clock spans the leader's just-resolved
// slice, resolved laps play from the lap table (including pit routing), the lap in progress plays from
// its sector splits, and the grid-seed anchor keeps the map's ordering identical to the standings.

const NOW = 1_000_000

function carState(partial: Partial<DriverRaceState> & { driverId: string }): DriverRaceState {
  return {
    position: 1, totalTime: 0, lapTimes: [], currentTyre: { compound: 'medium', condition: 100, maxLifeLaps: 20 },
    stintLap: 0, fuelLaps: 50, form: 5, retired: false, retirementLap: null, retirementReason: null,
    mistakeCount: 0, worstMistakeLoss: 0, lastPitLap: 0, pitStops: 0, stintHistory: [],
    targetPitLap: null, targetNextCompound: 'medium', gap: 0, lapsDown: 0, dsq: false,
    ...partial,
  }
}

function raceStateWith(drivers: DriverRaceState[]): RaceState {
  return { year: 2025, drivers } as unknown as RaceState
}

// The hook reads the tick window from these refs; frac-through-window = 1 − (nextTickAt − now)/interval.
function refsAtFrac(frac: number) {
  return {
    nextTickAtRef: { current: NOW + (1 - frac) * 1000 },
    intervalRef: { current: 1000 },
  }
}

function sample(drivers: DriverRaceState[], frac: number, gridPos: Record<string, number> = {}) {
  useRaceStore.setState({ raceState: raceStateWith(drivers) })
  const { nextTickAtRef, intervalRef } = refsAtFrac(frac)
  const { result, unmount } = renderHook(() => useRaceMapSampler(gridPos, nextTickAtRef, intervalRef, false))
  const fn = result.current.current
  unmount()
  return fn
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
  useRaceStore.setState({ raceState: null })
})

describe('useRaceMapSampler', () => {
  it('holds the field on the grid before any slice has resolved', () => {
    const fn = sample([carState({ driverId: 'a' }), carState({ driverId: 'b', position: 2, totalTime: 0.5, gap: 0.5 })], 0.5, { a: 1, b: 2 })
    expect(fn('a')).toEqual({ prog: 0, gridSlot: 1 })
    expect(fn('b')).toEqual({ prog: 0, gridSlot: 2 })
  })

  it('keeps the grid-seed anchor: a seeded car launches until the clock reaches its official start', () => {
    // Leader (seed 0) has run one 10s split; P2 (seed 0.5) likewise. Window = [0, 10].
    const a = carState({ driverId: 'a', totalTime: 10, sectorTimes: [10] })
    const b = carState({ driverId: 'b', position: 2, totalTime: 10.5, sectorTimes: [10], gap: 0.5 })
    const early = sample([a, b], 0.02, { a: 1, b: 2 }) // S = 0.2 < b's 0.5s seed
    expect(early('a')!.prog).toBeCloseTo((0.2 / 10) / 8, 9)
    const bs = early('b')!
    expect(bs.gridSlot).toBe(2)
    expect(bs.launch).toBeCloseTo(0.2 / 0.5, 6)
  })

  it('plays the lap in progress from its sector splits, 1/8 of the lap per split', () => {
    // Three 12s splits resolved of the current lap; the clock sits mid-third-split.
    const a = carState({ driverId: 'a', totalTime: 116, lapTimes: [80], sectorTimes: [12, 12, 12] })
    const fn = sample([a], 0.5) // window [104, 116] (last slice 12s), S = 110
    // S − (seed 0 + lap 80 + splits 24) = 6s into split index 2 → prog = (2 + 6/12)/8.
    expect(fn('a')).toEqual({ prog: (2 + 0.5) / 8 })
  })

  it('routes a completed pit lap through the pit lane and ignores length-8 splits as in-progress data', () => {
    // Lap 2 was a 100s pit lap (stint history closes at lap 2); its 8 splits are already summed into
    // lapTimes and must not double-count. The clock sits in the pit window past the entry fraction.
    const splits = new Array(8).fill(12.5)
    const a = carState({
      driverId: 'a', totalTime: 180, lapTimes: [80, 100], sectorTimes: splits,
      stintHistory: [{ compound: 'medium', laps: 2 }], pitStops: 1, lastPitLap: 2,
    })
    const fn = sample([a], 0.5) // window [167.5, 180], S = 173.75; lap 2 spans [80, 180]
    const run = 100 - pitLaneLoss(2025)
    const tau = 173.75 - 80
    expect(tau).toBeGreaterThan(0.93 * run) // inside the pit window — the branch under test
    const s = fn('a')!
    expect(s.pit).toBe(true)
    expect(s.prog).toBeGreaterThanOrEqual(0)
    expect(s.prog).toBeLessThanOrEqual(1)
  })

  it('drops a retired car once the clock passes its last resolved time', () => {
    const a = carState({ driverId: 'a', totalTime: 200, lapTimes: [100], sectorTimes: [100] })
    const gone = carState({ driverId: 'g', position: 2, totalTime: 90, lapTimes: [90], retired: true, retirementLap: 1 })
    const fn = sample([a, gone], 0.5) // window [100, 200], S = 150 > g's extent 90
    expect(fn('g')).toBeNull()
    expect(fn('a')).not.toBeNull()
  })
})
