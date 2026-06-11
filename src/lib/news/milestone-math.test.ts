import { describe, it, expect } from 'vitest'
import { careerTotalsThroughRound, teamTotalsThroughRound, teamMilestoneCrossed, milestoneSig } from './milestone-math'
import type { NewsContext } from './engine'
import type { RaceResult } from '@/lib/sim/types'

function res(driverId: string, teamId: string, finishPosition: number, points: number, gridPosition: number): RaceResult {
  return {
    driverId, driverName: driverId, teamId, teamName: teamId,
    gridPosition, finishPosition, points, form: 7, lapsCompleted: 50,
    totalTime: 5000, dnf: false, stints: [], q1Time: null, q2Time: null, q3Time: null,
  }
}

// Loosely typed so career/team-career records can be minimal (only the fields these functions read).
function ctxOf(parts: Record<string, unknown>): NewsContext {
  return { raceResults: [], completedRounds: 0, careers: {}, teamCareers: {}, ...parts } as unknown as NewsContext
}

describe('careerTotalsThroughRound', () => {
  // career totals INCLUDE the whole completed season; the helper strips it and re-adds rounds 1..r.
  const ctx = ctxOf({
    completedRounds: 2,
    careers: { d1: { starts: 10, points: 100, podiums: 5, wins: 2, poles: 3 } },
    raceResults: [
      [res('d1', 't1', 1, 25, 1)], // round 1: win from pole
      [res('d1', 't1', 3, 15, 5)], // round 2: podium
    ],
  })

  it('rewinds the running total to a mid-season round', () => {
    expect(careerTotalsThroughRound(ctx, 'd1', 1)).toEqual({ starts: 9, points: 85, podiums: 4, wins: 2, poles: 3 })
  })
  it('through the final round equals the career total', () => {
    expect(careerTotalsThroughRound(ctx, 'd1', 2)).toEqual({ starts: 10, points: 100, podiums: 5, wins: 2, poles: 3 })
  })
  it('is null without a career record', () => {
    expect(careerTotalsThroughRound(ctx, 'nobody', 2)).toBeNull()
  })
})

describe('teamTotalsThroughRound', () => {
  const ctx = ctxOf({
    completedRounds: 2,
    teamCareers: { t1: { races: 50, points: 300, podiums: 20, wins: 8, poles: 6 } },
    raceResults: [
      [res('d1', 't1', 1, 25, 1), res('d2', 't1', 2, 18, 3)],
      [res('d1', 't1', 3, 15, 2), res('d2', 't1', 5, 10, 4)],
    ],
  })
  it('rewinds the constructor total to a mid-season round (both cars counted)', () => {
    expect(teamTotalsThroughRound(ctx, 't1', 1)).toEqual({ starts: 49, points: 275, podiums: 19, wins: 8, poles: 6 })
  })
})

describe('teamMilestoneCrossed', () => {
  it('returns 1 for the first ever', () => expect(teamMilestoneCrossed('wins', 0, 1)).toBe(1))
  it('returns the step value when a step is crossed', () => {
    expect(teamMilestoneCrossed('wins', 9, 10)).toBe(10)
    expect(teamMilestoneCrossed('points', 199, 205)).toBe(200)
  })
  it('returns null when no step is crossed', () => {
    expect(teamMilestoneCrossed('wins', 10, 11)).toBeNull()
    expect(teamMilestoneCrossed('points', 100, 150)).toBeNull()
  })
})

describe('milestoneSig', () => {
  it('orders categories wins > podiums > poles > points > starts', () => {
    expect(milestoneSig('wins', 5)).toBeGreaterThan(milestoneSig('podiums', 999))
  })
  it('ranks a first-ever above any recurring step in the same category', () => {
    expect(milestoneSig('wins', 1)).toBeGreaterThan(milestoneSig('wins', 100))
  })
})
