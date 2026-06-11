import { describe, it, expect } from 'vitest'
import { wonBefore, podiumBefore, isHomeRace, winsUpTo, teamOneTwoBefore } from './season-history'
import type { NewsContext } from './engine'
import type { RaceResult, Driver, Circuit } from '@/lib/sim/types'

function res(driverId: string, teamId: string, finishPosition: number | null): RaceResult {
  return {
    driverId, driverName: driverId, teamId, teamName: teamId,
    gridPosition: 1, finishPosition, points: 0, form: 7, lapsCompleted: 50,
    totalTime: finishPosition == null ? null : 5000, dnf: finishPosition == null,
    stints: [], q1Time: null, q2Time: null, q3Time: null,
  }
}

function ctxOf(parts: Partial<NewsContext>): NewsContext {
  return { raceResults: [], calendar: [], drivers: [], ...parts } as unknown as NewsContext
}

describe('wonBefore / podiumBefore', () => {
  const ctx = ctxOf({
    raceResults: [
      [res('a', 't1', 1), res('b', 't1', 3)], // round 1: a wins, b on the podium
      [res('a', 't1', 5), res('b', 't1', 8)], // round 2
    ],
  })

  it('detects an earlier win strictly before the round', () => {
    expect(wonBefore(ctx, 'a', 2)).toBe(true) // a won in round 1 (< 2)
    expect(wonBefore(ctx, 'a', 1)).toBe(false) // nothing before round 1
    expect(wonBefore(ctx, 'b', 3)).toBe(false) // b never won
  })

  it('detects an earlier podium (a win counts)', () => {
    expect(podiumBefore(ctx, 'b', 2)).toBe(true) // b P3 in round 1
    expect(podiumBefore(ctx, 'a', 3)).toBe(true) // a P1 is a podium
    expect(podiumBefore(ctx, 'a', 1)).toBe(false)
  })
})

describe('winsUpTo', () => {
  it('counts wins up to and including the round', () => {
    const ctx = ctxOf({ raceResults: [[res('a', 't1', 1)], [res('a', 't1', 2)], [res('a', 't1', 1)]] })
    expect(winsUpTo(ctx, 'a', 1)).toBe(1)
    expect(winsUpTo(ctx, 'a', 3)).toBe(2)
  })
})

describe('teamOneTwoBefore', () => {
  it('detects a prior 1-2 for the team', () => {
    const ctx = ctxOf({ raceResults: [[res('a', 't1', 1), res('b', 't1', 2), res('c', 't2', 3)]] })
    expect(teamOneTwoBefore(ctx, 't1', 2)).toBe(true) // round 1 was a t1 1-2
    expect(teamOneTwoBefore(ctx, 't2', 2)).toBe(false)
    expect(teamOneTwoBefore(ctx, 't1', 1)).toBe(false) // nothing strictly before round 1
  })
})

describe('isHomeRace', () => {
  it('matches driver nationality to circuit country', () => {
    const ctx = ctxOf({
      calendar: [{ country: 'GB' } as unknown as Circuit],
      drivers: [
        { id: 'a', nationality: 'GB' } as unknown as Driver,
        { id: 'b', nationality: 'IT' } as unknown as Driver,
      ],
    })
    expect(isHomeRace(ctx, 'a', 1)).toBe(true)
    expect(isHomeRace(ctx, 'b', 1)).toBe(false)
  })
})
