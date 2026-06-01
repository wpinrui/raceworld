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
  type DbSeason,
} from './queries'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'

export async function actionCreateSeason(year: number): Promise<number> {
  return createSeason(year)
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
