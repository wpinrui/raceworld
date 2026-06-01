import { getDb } from './client'
import type { RaceResult, DriverStanding, ConstructorStanding, ConstructorSeasonRecord } from '@/lib/sim/types'
import { sortDriverStandings, sortConstructorStandings } from '@/lib/sim/standings-calc'

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

// Wipe all season/race data. The DB is a single file that outlives a localStorage
// save, so a new game must clear it or archived seasons pile up across playthroughs.
export function resetDatabase(): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM race_results').run()
    db.prepare('DELETE FROM races').run()
    db.prepare('DELETE FROM season_constructor_standings').run()
    db.prepare('DELETE FROM seasons').run()
  })()
}

export function createRace(seasonId: number, round: number, circuitId: string, circuitName: string): number {
  const result = getDb()
    .prepare('INSERT INTO races (season_id, round, circuit_id, circuit_name, status) VALUES (?, ?, ?, ?, ?)')
    .run(seasonId, round, circuitId, circuitName, 'upcoming')
  return result.lastInsertRowid as number
}

function completeRace(raceId: number): void {
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

export function insertConstructorStandings(
  seasonId: number,
  standings: Array<{ teamId: string; finalPosition: number; points: number }>,
): void {
  const db = getDb()
  const insert = db.prepare(
    'INSERT INTO season_constructor_standings (season_id, team_id, final_position, points) VALUES (?, ?, ?, ?)',
  )
  const insertAll = db.transaction(
    (rows: Array<{ teamId: string; finalPosition: number; points: number }>) => {
      for (const r of rows) insert.run(seasonId, r.teamId, r.finalPosition, r.points)
    },
  )
  insertAll(standings)
}

export function getRecentConstructorHistory(maxSeasons: number): ConstructorSeasonRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT s.year AS seasonYear, cs.team_id AS teamId, cs.final_position AS finalPosition, cs.points
       FROM season_constructor_standings cs
       JOIN seasons s ON s.id = cs.season_id
       WHERE s.status = 'archived'
       ORDER BY s.year DESC
       LIMIT ?`,
    )
    .all(maxSeasons * 11) as Array<{
    seasonYear: number
    teamId: string
    finalPosition: number
    points: number
  }>

  return rows.map((r) => ({
    seasonYear: r.seasonYear,
    teamId: r.teamId,
    finalPosition: r.finalPosition,
    points: r.points,
  }))
}

export function getSeasonStandings(seasonId: number): {
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
} {
  const races = getRacesForSeason(seasonId)
  const totalRounds = races.length

  // Fetch all results up front and do a pre-pass to discover driver order per team
  const raceResults = races.map((race) => ({ race, results: getResultsForRace(race.id) }))

  const teamDriverOrder = new Map<string, string[]>()
  for (const { results } of raceResults) {
    for (const r of results) {
      if (!teamDriverOrder.has(r.team_id)) teamDriverOrder.set(r.team_id, [])
      const drivers = teamDriverOrder.get(r.team_id)!
      if (!drivers.includes(r.driver_id)) drivers.push(r.driver_id)
    }
  }

  const driverMap = new Map<string, DriverStanding>()
  const constructorMap = new Map<string, ConstructorStanding>()

  for (const { race, results } of raceResults) {
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
        const driverOrder = teamDriverOrder.get(r.team_id) ?? []
        constructorMap.set(r.team_id, {
          teamId: r.team_id,
          teamName: r.team_name,
          points: 0,
          wins: 0,
          results: driverOrder.map(() => Array(totalRounds).fill(null)),
        })
      }
      const c = constructorMap.get(r.team_id)!
      c.points += r.points
      if (r.finish_position === 1) c.wins++
      const driverOrder = teamDriverOrder.get(r.team_id) ?? []
      const driverIdx = driverOrder.indexOf(r.driver_id)
      if (driverIdx >= 0) {
        c.results[driverIdx][race.round - 1] = r.dnf ? null : r.finish_position
      }
    }
  }

  const driverStandings = sortDriverStandings([...driverMap.values()])
  const constructorStandings = sortConstructorStandings([...constructorMap.values()])

  return { driverStandings, constructorStandings }
}
