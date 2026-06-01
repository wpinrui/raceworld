import { getDb } from './client'
import type { RaceResult, DriverStanding, ConstructorStanding } from '@/lib/sim/types'

export interface DbSeason {
  id: number
  year: number
  status: string
}

export interface DbRace {
  id: number
  season_id: number
  round: number
  circuit_id: string
  circuit_name: string
  status: string
}

export interface DbRaceResult {
  id: number
  race_id: number
  driver_id: string
  driver_name: string
  team_id: string
  team_name: string
  grid_position: number
  finish_position: number | null
  points: number
  laps_completed: number
  total_time_ms: number | null
  dnf: number
  stints_json: string
  q1_time_ms: number | null
  q2_time_ms: number | null
  q3_time_ms: number | null
}

export function createSeason(year: number): number {
  const db = getDb()
  const result = db.prepare('INSERT INTO seasons (year, status) VALUES (?, ?)').run(year, 'active')
  return result.lastInsertRowid as number
}

export function archiveSeason(seasonId: number): void {
  getDb().prepare("UPDATE seasons SET status = 'archived' WHERE id = ?").run(seasonId)
}

export function createRace(seasonId: number, round: number, circuitId: string, circuitName: string): number {
  const result = getDb()
    .prepare('INSERT INTO races (season_id, round, circuit_id, circuit_name, status) VALUES (?, ?, ?, ?, ?)')
    .run(seasonId, round, circuitId, circuitName, 'upcoming')
  return result.lastInsertRowid as number
}

export function completeRace(raceId: number): void {
  getDb().prepare("UPDATE races SET status = 'completed' WHERE id = ?").run(raceId)
}

export function insertRaceResult(raceId: number, result: RaceResult): void {
  getDb()
    .prepare(`
      INSERT INTO race_results
        (race_id, driver_id, driver_name, team_id, team_name, grid_position,
         finish_position, points, laps_completed, total_time_ms, dnf,
         stints_json, q1_time_ms, q2_time_ms, q3_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      raceId,
      result.driverId,
      result.driverName,
      result.teamId,
      result.teamName,
      result.gridPosition,
      result.finishPosition,
      result.points,
      result.lapsCompleted,
      result.totalTime,
      result.dnf ? 1 : 0,
      JSON.stringify(result.stints),
      result.q1Time,
      result.q2Time,
      result.q3Time,
    )
}

export function insertRaceResults(raceId: number, results: RaceResult[]): void {
  const db = getDb()
  const insertMany = db.transaction((rows: RaceResult[]) => {
    for (const r of rows) insertRaceResult(raceId, r)
  })
  insertMany(results)
  completeRace(raceId)
}

export function getArchivedSeasons(): DbSeason[] {
  return getDb().prepare("SELECT * FROM seasons WHERE status = 'archived' ORDER BY year DESC").all() as DbSeason[]
}

export function getAllSeasons(): DbSeason[] {
  return getDb().prepare('SELECT * FROM seasons ORDER BY year DESC').all() as DbSeason[]
}

export function getRacesForSeason(seasonId: number): DbRace[] {
  return getDb()
    .prepare('SELECT * FROM races WHERE season_id = ? ORDER BY round')
    .all(seasonId) as DbRace[]
}

export function getResultsForRace(raceId: number): DbRaceResult[] {
  return getDb()
    .prepare('SELECT * FROM race_results WHERE race_id = ? ORDER BY finish_position, dnf DESC')
    .all(raceId) as DbRaceResult[]
}

export function getSeasonStandings(seasonId: number): {
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
} {
  const races = getRacesForSeason(seasonId)
  const totalRounds = races.length

  // Map: driverId → standing accumulator
  const driverMap = new Map<string, DriverStanding>()
  const constructorMap = new Map<string, ConstructorStanding>()

  for (const race of races) {
    const results = getResultsForRace(race.id)
    for (const r of results) {
      if (!driverMap.has(r.driver_id)) {
        driverMap.set(r.driver_id, {
          driverId: r.driver_id,
          driverName: r.driver_name,
          teamId: r.team_id,
          teamName: r.team_name,
          points: 0,
          wins: 0,
          results: Array(totalRounds).fill(null),
        })
      }
      const d = driverMap.get(r.driver_id)!
      d.points += r.points
      if (r.finish_position === 1) d.wins++
      d.results[race.round - 1] = r.dnf ? null : r.finish_position

      if (!constructorMap.has(r.team_id)) {
        constructorMap.set(r.team_id, {
          teamId: r.team_id,
          teamName: r.team_name,
          points: 0,
          wins: 0,
          results: [],
        })
      }
      const c = constructorMap.get(r.team_id)!
      c.points += r.points
      if (r.finish_position === 1) c.wins++
    }
  }

  const driverStandings = [...driverMap.values()].sort((a, b) => b.points - a.points)
  const constructorStandings = [...constructorMap.values()].sort((a, b) => b.points - a.points)

  return { driverStandings, constructorStandings }
}
