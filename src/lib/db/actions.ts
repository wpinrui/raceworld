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
  type DbSeason,
} from './queries'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import type { DriverCareer, TeamCareer, WorldOverview, SearchEntry, CareerSeason, TeamSeason } from '@/lib/world/types'

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
