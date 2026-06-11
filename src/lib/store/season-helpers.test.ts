import { describe, it, expect } from 'vitest'
import {
  seasonStartDate,
  roundDate,
  snapshotStats,
  seedStatHistory,
  appendStatHistory,
  snapshotCarPaces,
  reconstructCarPaceHistory,
  resolveDraft,
} from './season-helpers'
import type { Driver, Team, DevUpgradeEvent } from '@/lib/sim/types'
import type { DraftPick, DraftSeat } from '@/lib/sim/driver-market'

// --- minimal fixtures: only the fields these pure helpers read carry meaning -------------------

function makeDriver(id: string, teamId: string, patch: Partial<Driver> = {}): Driver {
  return {
    id, name: id, teamId,
    nationality: 'GB', gender: 'male',
    pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, consistency: 70,
    age: 25, peakPotential: 80, primeEnd: 30,
    narrativeModifier: 0, contractExpiresAfterSeason: 2030,
    ...patch,
  }
}

function makeTeam(id: string, carPace: number): Team {
  return { id, name: id, shortName: id.slice(0, 3).toUpperCase(), nationality: 'GB', color: '#FF0000', carPace }
}

// resolveDraft reads only driverId, driverName, teamId, teamName, years off a pick.
function makePick(driverId: string, teamId: string, years: number): DraftPick {
  return {
    teamId, teamName: teamId, teamColor: '#FFF',
    driverId, driverName: driverId,
    prevTeamName: '', faRank: 1, seatRank: 0, pickPct: 100, realizedProb: 1, years,
    flavour: 'lock', odds: [],
  } as unknown as DraftPick
}

function makeEvent(teamId: string, round: number, paceDelta: number): DevUpgradeEvent {
  return { teamId, round, paceDelta, failed: false }
}

describe('seasonStartDate', () => {
  it('anchors to 1 January of the season year', () => {
    expect(seasonStartDate(2025)).toBe('2025-01-01')
  })
})

describe('roundDate', () => {
  it('falls back to the season start when the round is out of the calendar range', () => {
    // A round far beyond any real calendar length has no circuit, so it degrades to the start date.
    expect(roundDate(2025, 999)).toBe(seasonStartDate(2025))
  })
})

describe('snapshotCarPaces', () => {
  it('maps every team id to its current car pace', () => {
    const teams = [makeTeam('a', 70), makeTeam('b', 82.5)]
    expect(snapshotCarPaces(teams)).toEqual({ a: 70, b: 82.5 })
  })
})

describe('snapshotStats', () => {
  it('keys the four shown stats by seated driver, excluding free agents', () => {
    const seated = makeDriver('d1', 't1', { pace: 71, wetWeatherPace: 72, overtaking: 73, smoothness: 74 })
    const freeAgent = makeDriver('fa', '')
    const snap = snapshotStats([seated, freeAgent])
    expect(snap).toEqual({ d1: { pace: 71, wetWeatherPace: 72, overtaking: 73, smoothness: 74 } })
    expect(snap.fa).toBeUndefined()
  })
})

describe('seedStatHistory', () => {
  it('seeds a round-0 baseline for each seated driver', () => {
    const hist = seedStatHistory([makeDriver('d1', 't1', { pace: 71 }), makeDriver('fa', '')])
    expect(hist.d1).toEqual([{ round: 0, pace: 71, wetWeatherPace: 70, overtaking: 70, smoothness: 70 }])
    expect(hist.fa).toBeUndefined()
  })
})

describe('appendStatHistory', () => {
  it('appends a post-race point while preserving prior rounds', () => {
    const prev = seedStatHistory([makeDriver('d1', 't1')])
    const next = appendStatHistory(prev, [makeDriver('d1', 't1', { pace: 75 })], 1)
    expect(next.d1.map((p) => p.round)).toEqual([0, 1])
    expect(next.d1[1].pace).toBe(75)
  })

  it('replaces an existing point at the same round rather than duplicating it', () => {
    let hist = seedStatHistory([makeDriver('d1', 't1')])
    hist = appendStatHistory(hist, [makeDriver('d1', 't1', { pace: 75 })], 1)
    hist = appendStatHistory(hist, [makeDriver('d1', 't1', { pace: 80 })], 1)
    const round1 = hist.d1.filter((p) => p.round === 1)
    expect(round1).toHaveLength(1)
    expect(round1[0].pace).toBe(80)
  })

  it('does not mutate the previous history object', () => {
    const prev = seedStatHistory([makeDriver('d1', 't1')])
    appendStatHistory(prev, [makeDriver('d1', 't1', { pace: 99 })], 1)
    expect(prev.d1).toHaveLength(1) // still just the round-0 baseline
  })
})

describe('reconstructCarPaceHistory', () => {
  it('returns the current pace for every round when there are no upgrades', () => {
    const teams = [makeTeam('a', 70)]
    const hist = reconstructCarPaceHistory(teams, [], 3)
    expect(hist.map((s) => s.paces.a)).toEqual([70, 70, 70, 70])
  })

  it('rolls back upgrades delivered AFTER each round, leaving rounds at/after the upgrade at current pace', () => {
    const teams = [makeTeam('a', 75)]
    const events = [makeEvent('a', 3, 2)] // a +2 upgrade arriving at round 3
    const hist = reconstructCarPaceHistory(teams, events, 5)
    // rounds 0-2 predate the upgrade (rolled back to 73); rounds 3-5 include it (75)
    expect(hist.map((s) => s.paces.a)).toEqual([73, 73, 73, 75, 75, 75])
  })

  it('rounds reconstructed paces to one decimal place', () => {
    const teams = [makeTeam('a', 75)]
    const hist = reconstructCarPaceHistory(teams, [makeEvent('a', 2, 1.25)], 2)
    expect(hist[0].paces.a).toBe(73.8) // 75 - 1.25 = 73.75 -> 73.8
    expect(hist[2].paces.a).toBe(75)
  })
})

describe('resolveDraft', () => {
  // All seats are filled by picks (picks.length === seats.length), so the rookie-generation path
  // (the only source of randomness) never runs and the result is fully deterministic.
  function run() {
    const d1 = makeDriver('d1', 'tA') // re-signs at tA
    const d2 = makeDriver('d2', 'tB') // moves to tA
    const d3 = makeDriver('d3', 'tA') // stays (not in the draft)
    const d4 = makeDriver('d4', 'tB') // had a seat, signs nowhere -> dropped
    const d5 = makeDriver('d5', '')   // free agent, signs nowhere -> stays a free agent
    const allDrivers = [d1, d2, d3, d4, d5]
    const teams = [makeTeam('tA', 70), makeTeam('tB', 70)]
    const picks: DraftPick[] = [makePick('d1', 'tA', 2), makePick('d2', 'tA', 3)]
    const seats: DraftSeat[] = [
      { teamId: 'tA', teamName: 'tA', teamColor: '#FFF' },
      { teamId: 'tA', teamName: 'tA', teamColor: '#FFF' },
    ]
    const mediaMap = new Map([['d1', 10], ['d2', 20], ['d4', 5]])
    const stayingIds = new Set(['d3'])
    return resolveDraft(picks, allDrivers, stayingIds, seats, mediaMap, teams, 2025, 2026)
  }

  it('emits one market move per pick, flagging a same-team pick as a re-signation', () => {
    const { marketMoves } = run()
    expect(marketMoves).toHaveLength(2)
    const m1 = marketMoves.find((m) => m.driverId === 'd1')!
    expect(m1).toMatchObject({ fromTeamId: 'tA', toTeamId: 'tA', isResignation: true, contractLength: 2, contractExpiresAfterSeason: 2027, mediaScore: 10 })
    const m2 = marketMoves.find((m) => m.driverId === 'd2')!
    expect(m2).toMatchObject({ fromTeamId: 'tB', toTeamId: 'tA', isResignation: false, contractLength: 3, contractExpiresAfterSeason: 2028, mediaScore: 20 })
  })

  it('seats picked drivers, keeps stayers, and frees everyone else', () => {
    const { updatedDrivers } = run()
    const by = new Map(updatedDrivers.map((d) => [d.id, d]))
    expect(by.get('d1')).toMatchObject({ teamId: 'tA', contractExpiresAfterSeason: 2027, seasonsSinceF1Seat: 0 })
    expect(by.get('d2')).toMatchObject({ teamId: 'tA', contractExpiresAfterSeason: 2028, seasonsSinceF1Seat: 0 })
    expect(by.get('d3')!.teamId).toBe('tA') // stayer, untouched
    expect(by.get('d4')!.teamId).toBe('')   // dropped -> freed
    expect(by.get('d5')!.teamId).toBe('')   // free agent stays free
    expect(updatedDrivers).toHaveLength(5)  // no rookies generated (all seats filled by picks)
  })

  it('lists only drivers who lost a real seat as dropped', () => {
    const { droppedDrivers } = run()
    expect(droppedDrivers).toHaveLength(1)
    expect(droppedDrivers[0]).toMatchObject({ driverId: 'd4', fromTeamId: 'tB', fromTeamName: 'tB', mediaScore: 5 })
  })
})
