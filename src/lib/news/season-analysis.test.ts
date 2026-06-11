import { describe, it, expect } from 'vitest'
import { driverPointsAfter, teamPointsAfter } from './season-analysis'
import type { NewsContext } from './engine'
import type { RaceResult, Team, Driver } from '@/lib/sim/types'

function team(id: string): Team {
  return { id, name: id, shortName: id.toUpperCase(), nationality: 'GB', color: '#FF0000', carPace: 70 }
}

function driver(id: string, teamId: string): Driver {
  return {
    id, name: id, teamId, nationality: 'GB', gender: 'male',
    pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, consistency: 70,
    age: 25, peakPotential: 80, primeEnd: 30, narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}

// driverPointsAfter materialises driver standings from the results; team standings are seeded from
// ctx.teams (the season roster always contains every team that races), so the team test supplies them.
// drivers only matters for the "seated but hasn't raced" exclusion path.
function ctxOf(raceResults: RaceResult[][], teams: Team[] = [], drivers: Driver[] = []): NewsContext {
  return { drivers, teams, raceResults } as unknown as NewsContext
}

// points is set explicitly (decoupled from finishPosition) so a tie on points+wins can be engineered.
function res(driverId: string, teamId: string, finishPosition: number, points: number): RaceResult {
  return {
    driverId, driverName: driverId, teamId, teamName: teamId,
    gridPosition: 1, finishPosition, points, form: 7, lapsCompleted: 50,
    totalTime: 5000, dnf: false, stints: [], q1Time: null, q2Time: null, q3Time: null,
  }
}

describe('driverPointsAfter', () => {
  it('breaks an equal points-and-wins tie by countback (lower-position frequency)', () => {
    // a and b: equal points (40) and equal wins (one P1 each), but a has a P2 where b has a P3.
    const results: RaceResult[][] = [
      [res('a', 't1', 1, 20), res('b', 't2', 1, 20)],
      [res('a', 't1', 2, 20), res('b', 't2', 3, 20)],
    ]
    const out = driverPointsAfter(ctxOf(results), 2)
    expect(out.map((r) => r.id)).toEqual(['a', 'b']) // countback puts a ahead; old points||wins left it a tie
    expect(out.every((r) => r.points === 40)).toBe(true)
  })

  it('excludes a seated driver who has not raced', () => {
    const results: RaceResult[][] = [[res('a', 't1', 1, 25)]]
    const ctx = ctxOf(results, [], [driver('b', 't1')]) // b is seated but absent from the results
    expect(driverPointsAfter(ctx, 1).map((r) => r.id)).toEqual(['a'])
  })

  it('counts only drivers who have raced, and respects the round cut', () => {
    const results: RaceResult[][] = [
      [res('a', 't1', 1, 25)],
      [res('a', 't1', 1, 25), res('b', 't2', 2, 18)],
    ]
    expect(driverPointsAfter(ctxOf(results), 1).map((r) => r.id)).toEqual(['a']) // b hasn't raced after R1
    const afterTwo = driverPointsAfter(ctxOf(results), 2)
    expect(afterTwo.find((r) => r.id === 'a')!.points).toBe(50)
    expect(afterTwo.find((r) => r.id === 'b')!.points).toBe(18)
  })
})

describe('teamPointsAfter', () => {
  it('orders by points then wins (unchanged from before the unification)', () => {
    const results: RaceResult[][] = [
      [res('a', 't1', 1, 25), res('b', 't2', 2, 25), res('c', 't3', 3, 40)],
    ]
    // t1 & t2 tie on 25; t1 has the win -> t1 ahead. t3 leads on points.
    const ctx = ctxOf(results, [team('t1'), team('t2'), team('t3')])
    expect(teamPointsAfter(ctx, 1).map((r) => r.id)).toEqual(['t3', 't1', 't2'])
  })
})
