// Pure client-side merge of DB-only career DTOs with the live (current, unarchived)
// season from the Zustand store. DB aggregates exclude the active season, so the
// live slice is additive — no double counting.

import type { Driver, Team, DriverStanding, ConstructorStanding, RaceResult, Circuit } from '@/lib/sim/types'
import { overall } from '@/lib/sim/progression'
import type { DriverCareer, TeamCareer, CareerSeason, DriverAttributes, DriverCurrentResult, TeamSeason } from './types'

export interface LiveStore {
  year: number
  drivers: Driver[]
  teams: Team[]
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
  raceResults: RaceResult[][]
  calendar: Circuit[]
}

function driverAttributes(d: Driver, teams: Team[]): DriverAttributes {
  const team = teams.find((t) => t.id === d.teamId)
  return {
    pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness,
    overall: Math.round(overall(d)),
    age: d.age, primeEnd: d.primeEnd, nationality: d.nationality,
    teamId: d.teamId, teamName: team?.name ?? 'Free Agent',
    contractExpiresAfterSeason: d.contractExpiresAfterSeason,
    isFreeAgent: d.teamId === '',
  }
}

function liveDriverAgg(driverId: string, raceResults: RaceResult[][]) {
  let races = 0, wins = 0, podiums = 0, points = 0, poles = 0
  for (const round of raceResults) {
    const r = round.find((x) => x.driverId === driverId)
    if (!r) continue
    races++
    points += r.points
    if (r.gridPosition === 1) poles++
    if (!r.dnf && r.finishPosition != null) {
      if (r.finishPosition === 1) wins++
      if (r.finishPosition <= 3) podiums++
    }
  }
  return { races, wins, podiums, points, poles }
}

function liveDriverResults(driverId: string, raceResults: RaceResult[][], calendar: Circuit[]): DriverCurrentResult[] {
  const out: DriverCurrentResult[] = []
  raceResults.forEach((round, i) => {
    const r = round.find((x) => x.driverId === driverId)
    if (!r) return
    out.push({
      round: i + 1,
      circuitName: calendar[i]?.name ?? `Round ${i + 1}`,
      finishPosition: r.dnf ? null : r.finishPosition,
      points: r.points,
      dnf: r.dnf,
    })
  })
  return out
}

export function mergeDriverCareer(db: DriverCareer, store: LiveStore): DriverCareer {
  const live = store.drivers.find((d) => d.id === db.driverId)
  if (!live) return db // historical-only driver, no live data

  const racing = live.teamId !== ''
  const agg = liveDriverAgg(db.driverId, store.raceResults)
  const team = store.teams.find((t) => t.id === live.teamId)
  const champPos = store.driverStandings.findIndex((s) => s.driverId === db.driverId)

  const liveSeason: CareerSeason | null = racing
    ? {
        year: store.year, teamId: live.teamId, teamName: team?.name ?? live.teamId,
        races: agg.races, wins: agg.wins, podiums: agg.podiums, points: agg.points,
        championshipFinish: champPos >= 0 ? champPos + 1 : null,
        inProgress: true,
      }
    : null

  return {
    driverId: db.driverId,
    driverName: live.name,
    totals: {
      races: db.totals.races + agg.races,
      wins: db.totals.wins + agg.wins,
      podiums: db.totals.podiums + agg.podiums,
      points: db.totals.points + agg.points,
      poles: db.totals.poles + agg.poles,
      titles: db.totals.titles,
      seasons: db.totals.seasons + (racing ? 1 : 0),
    },
    seasons: liveSeason ? [liveSeason, ...db.seasons] : db.seasons,
    attributes: driverAttributes(live, store.teams),
    currentResults: racing ? liveDriverResults(db.driverId, store.raceResults, store.calendar) : null,
  }
}

export function mergeTeamCareer(db: TeamCareer, store: LiveStore): TeamCareer {
  const live = store.teams.find((t) => t.id === db.teamId)
  if (!live) return db // historical-only team

  const squad = store.drivers.filter((d) => d.teamId === live.id)
  let races = 0, wins = 0, podiums = 0, points = 0
  for (const round of store.raceResults) {
    for (const r of round) {
      if (r.teamId !== live.id) continue
      races++
      points += r.points
      if (!r.dnf && r.finishPosition != null) {
        if (r.finishPosition === 1) wins++
        if (r.finishPosition <= 3) podiums++
      }
    }
  }
  const ci = store.constructorStandings.findIndex((s) => s.teamId === live.id)

  const liveSeason: TeamSeason = {
    year: store.year, finalPosition: null, points,
    wins, podiums,
    drivers: squad.map((d) => ({ driverId: d.id, driverName: d.name })),
    inProgress: true,
  }

  return {
    teamId: db.teamId,
    teamName: live.name,
    honours: db.honours,
    totals: {
      races: db.totals.races + races, wins: db.totals.wins + wins,
      podiums: db.totals.podiums + podiums, points: db.totals.points + points,
      seasons: db.totals.seasons + 1,
    },
    seasons: [liveSeason, ...db.seasons],
    currentSquad: squad.map((d) => ({ driverId: d.id, driverName: d.name, overall: Math.round(overall(d)) })),
    teamColor: live.color,
    carPace: live.carPace,
    currentPosition: ci >= 0 ? ci + 1 : null,
  }
}
