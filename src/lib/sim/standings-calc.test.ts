import { describe, it, expect } from 'vitest'
import {
  sortDriverStandings,
  sortConstructorStandings,
  computeDriverStandings,
  computeConstructorStandings,
} from './standings-calc'
import type { Driver, Team, RaceResult, DriverStanding, ConstructorStanding } from './types'

// --- minimal fixtures: only the fields these pure functions read carry meaning ----------------

function makeDriver(id: string, teamId: string, name = id): Driver {
  return {
    id, name, teamId,
    nationality: 'GB', gender: 'male',
    pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, consistency: 70,
    age: 25, peakPotential: 80, primeEnd: 30,
    narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}

function makeTeam(id: string, name = id): Team {
  return { id, name, shortName: id.slice(0, 3).toUpperCase(), nationality: 'GB', color: '#FF0000', carPace: 70 }
}

function makeResult(
  driverId: string, teamId: string, finishPosition: number | null, points: number,
  extra: Partial<RaceResult> = {},
): RaceResult {
  return {
    driverId, driverName: driverId, teamId, teamName: teamId,
    gridPosition: 1, finishPosition, points, form: 7, lapsCompleted: 50,
    totalTime: finishPosition === null ? null : 5000, dnf: finishPosition === null,
    stints: [], q1Time: null, q2Time: null, q3Time: null,
    ...extra,
  }
}

function standing(driverId: string, points: number, results: (number | null)[]): DriverStanding {
  return { driverId, driverName: driverId, teamId: 't', teamName: 't', points, wins: 0, results }
}

function teamStanding(teamId: string, points: number, wins: number): ConstructorStanding {
  return { teamId, teamName: teamId, points, wins, results: [] }
}

describe('sortDriverStandings', () => {
  it('orders by points descending', () => {
    const out = sortDriverStandings([standing('a', 10, []), standing('b', 25, []), standing('c', 15, [])])
    expect(out.map((s) => s.driverId)).toEqual(['b', 'c', 'a'])
  })

  it('breaks a points tie by countback of best finishing positions', () => {
    // equal points; A has a win (P1), B has none -> A ranks ahead
    const a = standing('a', 25, [1, 3])
    const b = standing('b', 25, [2, 2])
    expect(sortDriverStandings([b, a]).map((s) => s.driverId)).toEqual(['a', 'b'])
  })

  it('goes deeper into the countback when the higher positions are level', () => {
    // equal points, both one P1; A has a P2 where B has a P3 -> A ranks ahead
    const a = standing('a', 25, [1, 2])
    const b = standing('b', 25, [1, 3])
    expect(sortDriverStandings([b, a]).map((s) => s.driverId)).toEqual(['a', 'b'])
  })
})

describe('sortConstructorStandings', () => {
  it('orders by points, then breaks ties by wins', () => {
    const out = sortConstructorStandings([teamStanding('a', 30, 1), teamStanding('b', 30, 3), teamStanding('c', 40, 0)])
    expect(out.map((s) => s.teamId)).toEqual(['c', 'b', 'a'])
  })
})

describe('computeDriverStandings', () => {
  it('sums points and wins across rounds and records each round finish', () => {
    const drivers = [makeDriver('d1', 't1'), makeDriver('d2', 't1')]
    const results: RaceResult[][] = [
      [makeResult('d1', 't1', 1, 25), makeResult('d2', 't1', 2, 18)],
      [makeResult('d1', 't1', 1, 25), makeResult('d2', 't1', 3, 15)],
    ]
    const out = computeDriverStandings(drivers, [makeTeam('t1')], results)
    const d1 = out.find((s) => s.driverId === 'd1')!
    expect(d1.points).toBe(50)
    expect(d1.wins).toBe(2)
    expect(d1.results).toEqual([1, 1])
    const d2 = out.find((s) => s.driverId === 'd2')!
    expect(d2.points).toBe(33)
    expect(d2.wins).toBe(0)
    expect(d2.results).toEqual([2, 3])
  })

  it('includes a currently-seated driver who has not scored', () => {
    const out = computeDriverStandings([makeDriver('d1', 't1')], [makeTeam('t1')], [])
    expect(out.map((s) => s.driverId)).toEqual(['d1'])
    expect(out[0].points).toBe(0)
  })

  it('keeps points with a released driver, shown as a free agent', () => {
    const drivers = [makeDriver('d2', 't1')] // d1 no longer seated
    const results: RaceResult[][] = [[makeResult('d1', 't1', 1, 25)]]
    const out = computeDriverStandings(drivers, [makeTeam('t1')], results)
    const d1 = out.find((s) => s.driverId === 'd1')!
    expect(d1.points).toBe(25)
    expect(d1.teamName).toBe('Free agent')
  })

  it('records a DNF as null in the results row', () => {
    const results: RaceResult[][] = [[makeResult('d1', 't1', null, 0, { dnf: true })]]
    const out = computeDriverStandings([makeDriver('d1', 't1')], [makeTeam('t1')], results)
    expect(out[0].results).toEqual([null])
  })
})

describe('computeConstructorStandings', () => {
  it('aggregates both cars points to the team', () => {
    const teams = [makeTeam('t1'), makeTeam('t2')]
    const drivers = [makeDriver('d1', 't1'), makeDriver('d2', 't1'), makeDriver('d3', 't2'), makeDriver('d4', 't2')]
    const results: RaceResult[][] = [[
      makeResult('d1', 't1', 1, 25), makeResult('d2', 't1', 3, 15),
      makeResult('d3', 't2', 2, 18), makeResult('d4', 't2', 4, 12),
    ]]
    const out = computeConstructorStandings(teams, drivers, results)
    expect(out[0].teamId).toBe('t1')
    expect(out.find((s) => s.teamId === 't1')!.points).toBe(40)
    expect(out.find((s) => s.teamId === 't1')!.wins).toBe(1)
    expect(out.find((s) => s.teamId === 't2')!.points).toBe(30)
  })

  it('attributes points to the team a driver scored for, not their current seat', () => {
    const teams = [makeTeam('t1'), makeTeam('t2')]
    const drivers = [makeDriver('d1', 't1')] // d1 now at t1...
    const results: RaceResult[][] = [[makeResult('d1', 't2', 1, 25)]] // ...but scored for t2
    const out = computeConstructorStandings(teams, drivers, results)
    expect(out.find((s) => s.teamId === 't2')!.points).toBe(25)
    expect(out.find((s) => s.teamId === 't1')!.points).toBe(0)
  })
})
