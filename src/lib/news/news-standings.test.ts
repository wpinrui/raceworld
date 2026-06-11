import { describe, it, expect } from 'vitest'
import { driverStandingsAfter, constructorStandingsAfter, recentFinishesUpTo } from './news-standings'
import type { NewsContext } from './engine'
import type { RaceResult } from '@/lib/sim/types'

function res(driverId: string, teamId: string, teamName: string, finishPosition: number | null, points: number): RaceResult {
  return {
    driverId, driverName: driverId, teamId, teamName,
    gridPosition: 1, finishPosition, points, form: 7, lapsCompleted: 50,
    totalTime: finishPosition == null ? null : 5000, dnf: finishPosition == null,
    stints: [], q1Time: null, q2Time: null, q3Time: null,
  }
}

function ctxOf(raceResults: RaceResult[][]): NewsContext {
  return { raceResults } as unknown as NewsContext
}

describe('driverStandingsAfter', () => {
  it('aggregates points and wins from the result slices through `round`', () => {
    const ctx = ctxOf([
      [res('a', 't1', 'T1', 1, 25), res('b', 't1', 'T1', 2, 18)],
      [res('a', 't1', 'T1', 2, 18), res('b', 't1', 'T1', 1, 25)],
    ])
    const afterOne = driverStandingsAfter(ctx, 1)
    expect(afterOne.map((s) => s.driverId)).toEqual(['a', 'b'])
    expect(afterOne[0]).toMatchObject({ driverId: 'a', points: 25, wins: 1 })
    const afterTwo = driverStandingsAfter(ctx, 2)
    expect(afterTwo.find((s) => s.driverId === 'a')!.points).toBe(43)
    expect(afterTwo.find((s) => s.driverId === 'a')!.wins).toBe(1)
  })

  it('breaks a tie by countback (positions), not just points', () => {
    // equal points (decoupled from finish), both one P1; a has a P2 where b has a P3 -> a ahead
    const ctx = ctxOf([
      [res('a', 't1', 'T1', 1, 20), res('b', 't2', 'T2', 1, 20)],
      [res('a', 't1', 'T1', 2, 20), res('b', 't2', 'T2', 3, 20)],
    ])
    expect(driverStandingsAfter(ctx, 2).map((s) => s.driverId)).toEqual(['a', 'b'])
  })

  it('lets teamName follow the latest result row (mid-season move)', () => {
    const ctx = ctxOf([
      [res('a', 't1', 'Old', 1, 25)],
      [res('a', 't2', 'New', 3, 15)],
    ])
    const a = driverStandingsAfter(ctx, 2).find((s) => s.driverId === 'a')!
    expect(a).toMatchObject({ teamId: 't2', teamName: 'New', points: 40 })
  })
})

describe('constructorStandingsAfter', () => {
  it('sums team points and breaks ties by wins', () => {
    const ctx = ctxOf([
      [res('a', 't1', 'T1', 1, 25), res('b', 't2', 'T2', 2, 25)], // t1 & t2 tie on 25; t1 has the win
    ])
    expect(constructorStandingsAfter(ctx, 1).map((s) => s.teamId)).toEqual(['t1', 't2'])
  })
})

describe('recentFinishesUpTo', () => {
  const ctx = ctxOf([
    [res('a', 't1', 'T1', 5, 10)],
    [res('a', 't1', 'T1', null, 0)], // DNF
    [res('a', 't1', 'T1', 2, 18)],
  ])
  it('lists most-recent-first with a DNF as a notional 30', () => {
    expect(recentFinishesUpTo(ctx, 'a', 3, 5)).toEqual([2, 30, 5])
  })
  it('caps the list at n', () => {
    expect(recentFinishesUpTo(ctx, 'a', 3, 2)).toEqual([2, 30])
  })
})
