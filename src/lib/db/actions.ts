'use server'

import type { RaceResult, ConstructorSeasonRecord } from '@/lib/sim/types'
import {
  createSeason,
  createRace,
  insertRaceResults,
  archiveSeason,
  getArchivedSeasons,
  getSeasonStandings,
  insertConstructorStandings,
  getRecentConstructorHistory,
  resetDatabase,
  getDriverTotals,
  getDriverCareerBySeason,
  getDriverFinishInSeason,
  getTeamTotals,
  getTeamCareerBySeason,
  getSeasonDriversForTeam,
  getMostRecentTeamName,
  getDistinctTeamIds,
  getAllSeasonChampions,
  getAllTimeLeaders,
  getSearchIndex,
  getArchivedSeasonIdByYear,
  getDriverRacesInSeason,
  getTeamRacesInSeason,
  getRaceInSeasonByRound,
  getResultsForRace,
  getTeamFinalPositionInSeason,
  type DbSeason,
  type DbRaceResultRow,
} from './queries'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import type {
  DriverCareer, TeamCareer, WorldOverview, SearchEntry, CareerSeason, TeamSeason,
  DriverSeasonDetail, DriverSeasonRace, TeamSeasonDetail, TeamSeasonRace,
  RaceClassification, RaceClassificationRow, Stint,
} from '@/lib/world/types'

function parseStints(json: string): Stint[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? (v as Stint[]) : []
  } catch {
    return []
  }
}

function toDriverSeasonRace(r: DbRaceResultRow): DriverSeasonRace {
  return {
    round: r.round, circuitId: r.circuit_id, circuitName: r.circuit_name,
    gridPosition: r.grid_position, finishPosition: r.dnf ? null : r.finish_position,
    dnf: !!r.dnf, points: r.points, lapsCompleted: r.laps_completed,
    q1: r.q1_time_ms, q2: r.q2_time_ms, q3: r.q3_time_ms, stints: parseStints(r.stints_json),
  }
}

export async function actionCreateSeason(year: number): Promise<number> {
  return createSeason(year)
}

export async function actionResetDatabase(): Promise<void> {
  resetDatabase()
}

export async function actionFlushRaceResult(
  seasonId: number,
  round: number,
  circuitId: string,
  circuitName: string,
  results: RaceResult[],
): Promise<void> {
  const raceId = createRace(seasonId, round, circuitId, circuitName)
  insertRaceResults(raceId, results)
}

export async function actionArchiveSeason(seasonId: number): Promise<void> {
  archiveSeason(seasonId)
}

export async function actionGetArchivedSeasons(): Promise<DbSeason[]> {
  return getArchivedSeasons()
}

export async function actionGetSeasonStandings(seasonId: number): Promise<{
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
}> {
  return getSeasonStandings(seasonId)
}

export async function actionInsertConstructorStandings(
  seasonId: number,
  standings: Array<{ teamId: string; finalPosition: number; points: number }>,
): Promise<void> {
  insertConstructorStandings(seasonId, standings)
}

export async function actionGetRecentConstructorHistory(
  maxSeasons: number,
): Promise<ConstructorSeasonRecord[]> {
  return getRecentConstructorHistory(maxSeasons)
}

// --- World / career pages (DB-only; the live season is layered in client-side) ---

export async function actionGetDriverCareer(driverId: string): Promise<DriverCareer> {
  const totals = getDriverTotals(driverId)
  const careerRows = getDriverCareerBySeason(driverId)
  if (!totals) {
    // No archived history — a shell the client fills from the live grid (or treats as not-found).
    return {
      driverId, driverName: driverId,
      totals: { races: 0, wins: 0, podiums: 0, points: 0, poles: 0, titles: 0, seasons: 0 },
      seasons: [], attributes: null, currentResults: null,
    }
  }
  const champions = getAllSeasonChampions()
  const titles = champions.filter((c) => c.driverChampionId === driverId).length
  const seasons: CareerSeason[] = careerRows.map((r) => ({
    year: r.seasonYear, teamId: r.teamId, teamName: r.teamName,
    races: r.races, wins: r.wins, podiums: r.podiums, points: r.points,
    championshipFinish: getDriverFinishInSeason(r.seasonId, driverId),
    inProgress: false,
  }))
  return {
    driverId, driverName: totals.driverName,
    totals: {
      races: totals.races, wins: totals.wins, podiums: totals.podiums,
      points: totals.points, poles: totals.poles, titles, seasons: totals.seasons,
    },
    seasons, attributes: null, currentResults: null,
  }
}

export async function actionGetTeamCareer(teamId: string): Promise<TeamCareer> {
  const totals = getTeamTotals(teamId)
  const rows = getTeamCareerBySeason(teamId)
  const seasons: TeamSeason[] = rows.map((r) => ({
    year: r.seasonYear, finalPosition: r.finalPosition, points: r.points,
    wins: r.wins, podiums: r.podiums,
    drivers: getSeasonDriversForTeam(r.seasonId, teamId),
    inProgress: false,
  }))
  return {
    teamId,
    teamName: totals?.teamName ?? getMostRecentTeamName(teamId) ?? teamId,
    honours: {
      constructorTitles: totals?.constructorTitles ?? 0,
      titleYears: totals?.titleYears ?? [],
      bestFinish: totals?.bestFinish ?? null,
    },
    totals: {
      races: totals?.races ?? 0, wins: totals?.wins ?? 0,
      podiums: totals?.podiums ?? 0, points: totals?.points ?? 0, seasons: totals?.seasons ?? 0,
    },
    seasons,
    currentSquad: null, teamColor: null, carPace: null, currentPosition: null,
  }
}

export async function actionGetWorldOverview(): Promise<WorldOverview> {
  const champions = getAllSeasonChampions()
  return {
    championsRoll: champions.map((c) => ({
      year: c.year,
      driverChampionId: c.driverChampionId, driverChampionName: c.driverChampionName,
      driverChampionTeamId: c.driverChampionTeamId,
      constructorChampionId: c.constructorChampionId, constructorChampionName: c.constructorChampionName,
    })),
    leaders: getAllTimeLeaders(champions),
    teamsDirectory: getDistinctTeamIds(),
  }
}

export async function actionGetSearchIndex(): Promise<SearchEntry[]> {
  return getSearchIndex()
}

// --- Drill-down detail (archived seasons only; the live season is built client-side) ---

export async function actionGetDriverSeason(driverId: string, year: number): Promise<DriverSeasonDetail | null> {
  const seasonId = getArchivedSeasonIdByYear(year)
  if (seasonId == null) return null
  const rows = getDriverRacesInSeason(seasonId, driverId)
  if (rows.length === 0) return null
  const races = rows.map(toDriverSeasonRace)
  const totals = races.reduce(
    (acc, r) => ({
      races: acc.races + 1,
      wins: acc.wins + (r.finishPosition === 1 ? 1 : 0),
      podiums: acc.podiums + (r.finishPosition != null && r.finishPosition <= 3 ? 1 : 0),
      points: acc.points + r.points,
      poles: acc.poles + (r.gridPosition === 1 ? 1 : 0),
      dnfs: acc.dnfs + (r.dnf ? 1 : 0),
    }),
    { races: 0, wins: 0, podiums: 0, points: 0, poles: 0, dnfs: 0 },
  )
  return {
    driverId, driverName: rows[0].driver_name, year,
    teamId: rows[rows.length - 1].team_id, teamName: rows[rows.length - 1].team_name,
    championshipFinish: getDriverFinishInSeason(seasonId, driverId),
    inProgress: false, totals, races,
  }
}

export async function actionGetTeamSeason(teamId: string, year: number): Promise<TeamSeasonDetail | null> {
  const seasonId = getArchivedSeasonIdByYear(year)
  if (seasonId == null) return null
  const rows = getTeamRacesInSeason(seasonId, teamId)
  if (rows.length === 0) return null

  const byRound = new Map<number, TeamSeasonRace>()
  const driverNames = new Map<string, string>()
  let wins = 0, podiums = 0, points = 0
  for (const r of rows) {
    driverNames.set(r.driver_id, r.driver_name)
    if (r.finish_position === 1) wins++
    if (!r.dnf && r.finish_position != null && r.finish_position <= 3) podiums++
    points += r.points
    if (!byRound.has(r.round)) {
      byRound.set(r.round, { round: r.round, circuitId: r.circuit_id, circuitName: r.circuit_name, cars: [], points: 0 })
    }
    const entry = byRound.get(r.round)!
    entry.cars.push({
      driverId: r.driver_id, driverName: r.driver_name, gridPosition: r.grid_position,
      finishPosition: r.dnf ? null : r.finish_position, dnf: !!r.dnf, points: r.points,
    })
    entry.points += r.points
  }

  return {
    teamId, teamName: rows[rows.length - 1].team_name, year,
    finalPosition: getTeamFinalPositionInSeason(seasonId, teamId),
    inProgress: false,
    totals: { races: byRound.size, wins, podiums, points },
    drivers: [...driverNames].map(([driverId, driverName]) => ({ driverId, driverName })),
    races: [...byRound.values()].sort((a, b) => a.round - b.round),
  }
}

export async function actionGetRaceClassification(year: number, round: number): Promise<RaceClassification | null> {
  const seasonId = getArchivedSeasonIdByYear(year)
  if (seasonId == null) return null
  const race = getRaceInSeasonByRound(seasonId, round)
  if (!race) return null
  const rows: RaceClassificationRow[] = getResultsForRace(race.id).map((r) => ({
    driverId: r.driver_id, driverName: r.driver_name, teamId: r.team_id, teamName: r.team_name,
    gridPosition: r.grid_position, finishPosition: r.dnf ? null : r.finish_position, dnf: !!r.dnf,
    points: r.points, lapsCompleted: r.laps_completed, totalTime: r.total_time_ms,
    q1: r.q1_time_ms, q2: r.q2_time_ms, q3: r.q3_time_ms, stints: parseStints(r.stints_json),
  }))
  return {
    year, round, circuitId: race.circuit_id, circuitName: race.circuit_name, inProgress: false, rows,
  }
}
