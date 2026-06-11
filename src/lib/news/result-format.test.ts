import { describe, it, expect } from 'vitest'
import { sortedResults, marginWord, poleMargin, strategyPhrase, startingTyre } from './result-format'
import type { RaceResult } from '@/lib/sim/types'

function res(opts: Partial<RaceResult>): RaceResult {
  return {
    driverId: 'd', driverName: 'd', teamId: 't', teamName: 't',
    gridPosition: 1, finishPosition: 1, points: 0, form: 7, lapsCompleted: 50,
    totalTime: 5000, dnf: false, stints: [], q1Time: null, q2Time: null, q3Time: null,
    ...opts,
  }
}

describe('sortedResults', () => {
  it('orders finishers by position and pushes DNFs last', () => {
    const out = sortedResults([
      res({ driverId: 'b', finishPosition: 2 }),
      res({ driverId: 'x', finishPosition: null, dnf: true }),
      res({ driverId: 'a', finishPosition: 1 }),
    ])
    expect(out.map((r) => r.driverId)).toEqual(['a', 'b', 'x'])
  })
})

describe('marginWord', () => {
  it('is empty when unknown', () => expect(marginWord(null)).toBe(''))
  it('uses 3dp with "just" under a second', () => expect(marginWord(0.849)).toBe('just 0.849s'))
  it('uses 1dp at a second or more', () => expect(marginWord(13.37)).toBe('13.4s'))
})

describe('poleMargin', () => {
  const grid = (g: number, q3: number) => res({ gridPosition: g, q3Time: q3 })
  it('reports the P1-P2 qualifying gap', () => {
    expect(poleMargin([grid(1, 80.0), grid(2, 80.3)])).toBe('0.300s')
  })
  it('is null when P2 is missing', () => expect(poleMargin([grid(1, 80.0)])).toBeNull())
  it('is null for an implausible gap (>5s)', () => {
    expect(poleMargin([grid(1, 80.0), grid(2, 86.0)])).toBeNull()
  })
})

describe('strategyPhrase / startingTyre', () => {
  it('names the stop count', () => {
    expect(strategyPhrase([{ compound: 'soft', laps: 50 }])).toBe('a no-stop run')
    expect(strategyPhrase([{ compound: 'soft', laps: 20 }, { compound: 'hard', laps: 30 }])).toBe('a one-stop strategy')
  })
  it('is null without stints', () => expect(strategyPhrase([])).toBeNull())
  it('pluralises the opening compound', () => {
    expect(startingTyre([{ compound: 'medium', laps: 20 }])).toBe('mediums')
    expect(startingTyre([])).toBeNull()
  })
})
