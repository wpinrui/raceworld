'use server'

// Server actions for the newsroom's multi-season selector. The live season is generated
// client-side from the store; PAST seasons live only in the archive DB, so we rebuild a
// (results-only) NewsContext from SQLite here and run the same `generateNews` over it.
// Archived contexts have no car pace / contracts / upgrades, so the attribute-dependent
// producers (team trajectory, silly-season) stand down via `live: false`.

import {
  getArchivedSeasons, getArchivedSeasonIdByYear, getRacesForSeason, getResultsForRace,
  type DbRaceResult,
} from '@/lib/db/queries'
import { generateNews, type NewsContext, type NewsArticle } from './engine'
import type { Driver, Team, RaceResult, Circuit } from '@/lib/sim/types'

function toRaceResult(r: DbRaceResult): RaceResult {
  let stints: RaceResult['stints'] = []
  try { stints = JSON.parse(r.stints_json) } catch { stints = [] }
  return {
    driverId: r.driver_id,
    driverName: r.driver_name,
    teamId: r.team_id,
    teamName: r.team_name,
    gridPosition: r.grid_position,
    finishPosition: r.finish_position,
    points: r.points,
    form: 0,
    lapsCompleted: r.laps_completed,
    totalTime: r.total_time_ms,   // stored in seconds despite the column name
    dnf: !!r.dnf,
    stints,
    q1Time: r.q1_time_ms,
    q2Time: r.q2_time_ms,
    q3Time: r.q3_time_ms,
  }
}

// A minimal Driver, enough for the results-only producers. Attribute fields are placeholders
// (archived seasons don't persist them); `live: false` keeps attribute-dependent producers off.
function stubDriver(id: string, name: string, teamId: string): Driver {
  return {
    id, name, teamId, nationality: '', gender: 'male',
    pace: 0, wetWeatherPace: 0, overtaking: 0, smoothness: 0,
    age: 0, peakPotential: 0, primeEnd: 0, narrativeModifier: 0,
    contractExpiresAfterSeason: 9999,
  }
}

export async function actionGetNewsSeasonYears(): Promise<number[]> {
  return getArchivedSeasons().map((s) => s.year).sort((a, b) => b - a)
}

export async function actionGetSeasonNews(year: number): Promise<NewsArticle[]> {
  const seasonId = getArchivedSeasonIdByYear(year)
  if (seasonId == null) return []

  const races = [...getRacesForSeason(seasonId)].sort((a, b) => a.round - b.round)
  if (races.length === 0) return []

  const raceResults: RaceResult[][] = races.map((race) => getResultsForRace(race.id).map(toRaceResult))

  const driverMap = new Map<string, Driver>()
  const teamMap = new Map<string, Team>()
  for (const round of raceResults) {
    for (const r of round) {
      if (!driverMap.has(r.driverId)) driverMap.set(r.driverId, stubDriver(r.driverId, r.driverName, r.teamId))
      if (!teamMap.has(r.teamId)) {
        teamMap.set(r.teamId, { id: r.teamId, name: r.teamName, shortName: r.teamName, color: '#888888', carPace: 0 })
      }
    }
  }

  const calendar: Circuit[] = races.map((race) => ({
    id: race.circuit_id, name: race.circuit_name, code: '', location: '', country: '', laps: 0, flatModifier: 0,
  }))

  const ctx: NewsContext = {
    year,
    phase: 'idle',
    completedRounds: raceResults.length,
    drivers: [...driverMap.values()],
    teams: [...teamMap.values()],
    raceResults,
    upgradeEvents: [],
    constructorHistory: [],
    endOfSeason: null,
    calendar,
    live: false,
  }
  return generateNews(ctx)
}
