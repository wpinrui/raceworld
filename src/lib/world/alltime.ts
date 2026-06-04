import type { RaceResult } from '@/lib/sim/types'
import type { AllTimeDriverStat, AllTimeTeamStat } from '@/lib/db/queries'

// The all-time stats come from the archive DB (archived seasons only). The in-progress season lives in
// the store and isn't archived yet, so we fold its per-entity tallies in here, client-side, to make the
// all-time tables reflect the current season too. No double-count: the live season is never in the DB,
// and its year is always later than any archived year.

export interface LiveSeasonForAllTime {
  year: number
  raceResults: RaceResult[][]
  driverChampionId: string | null      // set only once the season is decided (end-of-season)
  constructorChampionId: string | null
  driverChampionTeamId: string | null  // team the drivers' champion raced for (for the team's WDC tally)
}

export function foldLiveDriverStats(rows: AllTimeDriverStat[], live: LiveSeasonForAllTime): AllTimeDriverStat[] {
  if (live.raceResults.length === 0) return rows
  type Tally = { name: string; races: number; wins: number; poles: number; podiums: number; points: number; retirements: number }
  const tallies = new Map<string, Tally>()
  for (const round of live.raceResults) for (const r of round) {
    const t = tallies.get(r.driverId) ?? { name: r.driverName, races: 0, wins: 0, poles: 0, podiums: 0, points: 0, retirements: 0 }
    t.name = r.driverName
    t.races++
    if (r.finishPosition === 1) t.wins++
    if (r.gridPosition === 1) t.poles++
    if (r.finishPosition != null && r.finishPosition <= 3) t.podiums++
    t.points += r.points
    if (r.dnf) t.retirements++
    tallies.set(r.driverId, t)
  }
  const byId = new Map(rows.map((r) => [r.id, { ...r }]))
  for (const [id, t] of tallies) {
    const wdc = live.driverChampionId === id ? 1 : 0
    const ex = byId.get(id)
    if (ex) {
      ex.name = t.name
      ex.seasons += 1
      ex.races += t.races
      ex.firstYear = Math.min(ex.firstYear, live.year)
      ex.lastYear = Math.max(ex.lastYear, live.year)
      ex.wins += t.wins; ex.poles += t.poles; ex.podiums += t.podiums; ex.points += t.points; ex.retirements += t.retirements; ex.wdc += wdc
    } else {
      byId.set(id, { id, name: t.name, seasons: 1, races: t.races, firstYear: live.year, lastYear: live.year, wins: t.wins, poles: t.poles, podiums: t.podiums, points: t.points, retirements: t.retirements, wdc })
    }
  }
  return [...byId.values()]
}

export function foldLiveTeamStats(rows: AllTimeTeamStat[], live: LiveSeasonForAllTime): AllTimeTeamStat[] {
  if (live.raceResults.length === 0) return rows
  type Tally = { name: string; rounds: Set<number>; wins: number; poles: number; podiums: number; points: number; retirements: number }
  const tallies = new Map<string, Tally>()
  live.raceResults.forEach((round, i) => {
    for (const r of round) {
      const t = tallies.get(r.teamId) ?? { name: r.teamName, rounds: new Set<number>(), wins: 0, poles: 0, podiums: 0, points: 0, retirements: 0 }
      t.name = r.teamName
      t.rounds.add(i) // races = distinct rounds the team entered (mirrors the SQL's COUNT(DISTINCT race))
      if (r.finishPosition === 1) t.wins++
      if (r.gridPosition === 1) t.poles++
      if (r.finishPosition != null && r.finishPosition <= 3) t.podiums++
      t.points += r.points
      if (r.dnf) t.retirements++
      tallies.set(r.teamId, t)
    }
  })
  const byId = new Map(rows.map((r) => [r.id, { ...r }]))
  for (const [id, t] of tallies) {
    const wcc = live.constructorChampionId === id ? 1 : 0
    const wdc = live.driverChampionTeamId === id ? 1 : 0
    const races = t.rounds.size
    const ex = byId.get(id)
    if (ex) {
      ex.name = t.name
      ex.seasons += 1
      ex.races += races
      ex.firstYear = Math.min(ex.firstYear, live.year)
      ex.lastYear = Math.max(ex.lastYear, live.year)
      ex.wins += t.wins; ex.poles += t.poles; ex.podiums += t.podiums; ex.points += t.points; ex.retirements += t.retirements; ex.wcc += wcc; ex.wdc += wdc
    } else {
      byId.set(id, { id, name: t.name, seasons: 1, races, firstYear: live.year, lastYear: live.year, wins: t.wins, poles: t.poles, podiums: t.podiums, points: t.points, retirements: t.retirements, wdc, wcc })
    }
  }
  return [...byId.values()]
}
