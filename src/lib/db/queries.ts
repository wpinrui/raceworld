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
  const clear = db.prepare('DELETE FROM season_constructor_standings WHERE season_id = ?')
  const insert = db.prepare(
    'INSERT INTO season_constructor_standings (season_id, team_id, final_position, points) VALUES (?, ?, ?, ?)',
  )
  // Idempotent: clear any existing rows for this season first, so re-running the
  // off-season archive (e.g. after a reload mid-transition) can't double-insert and
  // inflate a team's season count in computeFundingTiers.
  const insertAll = db.transaction(
    (rows: Array<{ teamId: string; finalPosition: number; points: number }>) => {
      clear.run(seasonId)
      for (const r of rows) insert.run(seasonId, r.teamId, r.finalPosition, r.points)
    },
  )
  insertAll(standings)
}

export function getRecentConstructorHistory(maxSeasons: number): ConstructorSeasonRecord[] {
  // Limit by the N most recent archived SEASONS, not by row count — the grid can
  // grow or shrink via god mode, so rows-per-season is not a fixed number.
  const rows = getDb()
    .prepare(
      `SELECT s.year AS seasonYear, cs.team_id AS teamId, cs.final_position AS finalPosition, cs.points
       FROM season_constructor_standings cs
       JOIN seasons s ON s.id = cs.season_id
       WHERE s.id IN (
         SELECT id FROM seasons WHERE status = 'archived' ORDER BY year DESC, id DESC LIMIT ?
       )
       ORDER BY s.year DESC`,
    )
    .all(maxSeasons) as Array<{
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

// --- Career / world history queries (archived seasons only) ---
// The in-progress season is stored as status='active' and double-counts with the
// live store, so every aggregation below filters on status='archived'.

export interface DbDriverCareerRow {
  seasonYear: number; seasonId: number; teamId: string; teamName: string
  races: number; wins: number; podiums: number; points: number; poles: number; dnfs: number
}

export function getDriverCareerBySeason(driverId: string): DbDriverCareerRow[] {
  return getDb().prepare(`
    SELECT s.year AS seasonYear, s.id AS seasonId, rr.team_id AS teamId,
      MAX(rr.team_name) AS teamName, COUNT(*) AS races,
      SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END) AS podiums,
      SUM(rr.points) AS points,
      SUM(CASE WHEN rr.grid_position = 1 THEN 1 ELSE 0 END) AS poles,
      SUM(rr.dnf) AS dnfs
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE rr.driver_id = ? AND s.status = 'archived'
    GROUP BY s.id, rr.team_id
    ORDER BY s.year DESC, s.id DESC
  `).all(driverId) as DbDriverCareerRow[]
}

export interface DbCareerTotals {
  races: number; wins: number; podiums: number; points: number; poles: number; dnfs: number; seasons: number
}

function aggregateCareer(idColumn: 'driver_id' | 'team_id', id: string): (DbCareerTotals & { name: string }) | null {
  const row = getDb().prepare(`
    SELECT MAX(rr.${idColumn === 'driver_id' ? 'driver_name' : 'team_name'}) AS name,
      COUNT(*) AS races,
      SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END) AS podiums,
      SUM(rr.points) AS points,
      SUM(CASE WHEN rr.grid_position = 1 THEN 1 ELSE 0 END) AS poles,
      SUM(rr.dnf) AS dnfs,
      COUNT(DISTINCT s.id) AS seasons
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE rr.${idColumn} = ? AND s.status = 'archived'
  `).get(id) as (DbCareerTotals & { name: string }) | undefined
  return row && row.races > 0 ? row : null
}

export interface DbDriverTotals extends DbCareerTotals { driverId: string; driverName: string }
export function getDriverTotals(driverId: string): DbDriverTotals | null {
  const r = aggregateCareer('driver_id', driverId)
  return r ? { ...r, driverId, driverName: r.name } : null
}

export interface DbTeamCareerRow {
  seasonYear: number; seasonId: number; teamName: string
  races: number; wins: number; podiums: number; points: number
  finalPosition: number | null; driverIds: string | null; driverNames: string | null
}

export function getTeamCareerBySeason(teamId: string): DbTeamCareerRow[] {
  return getDb().prepare(`
    SELECT s.year AS seasonYear, s.id AS seasonId, MAX(rr.team_name) AS teamName,
      COUNT(*) AS races,
      SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END) AS podiums,
      SUM(rr.points) AS points,
      scs.final_position AS finalPosition,
      GROUP_CONCAT(DISTINCT rr.driver_id) AS driverIds,
      GROUP_CONCAT(DISTINCT rr.driver_name) AS driverNames
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    LEFT JOIN season_constructor_standings scs ON scs.season_id = s.id AND scs.team_id = rr.team_id
    WHERE rr.team_id = ? AND s.status = 'archived'
    GROUP BY s.id
    ORDER BY s.year DESC
  `).all(teamId) as DbTeamCareerRow[]
}

export interface DbTeamTotals extends DbCareerTotals {
  teamId: string; teamName: string; constructorTitles: number; bestFinish: number | null; titleYears: number[]
}
export function getTeamTotals(teamId: string): DbTeamTotals | null {
  const agg = aggregateCareer('team_id', teamId)
  if (!agg) return null
  const standings = getDb().prepare(`
    SELECT s.year AS year, scs.final_position AS pos
    FROM season_constructor_standings scs
    JOIN seasons s ON s.id = scs.season_id
    WHERE scs.team_id = ? AND s.status = 'archived'
  `).all(teamId) as { year: number; pos: number }[]
  const titleYears = standings.filter((r) => r.pos === 1).map((r) => r.year).sort((a, b) => b - a)
  const bestFinish = standings.length ? Math.min(...standings.map((r) => r.pos)) : null
  return { ...agg, teamId, teamName: agg.name, constructorTitles: titleYears.length, bestFinish, titleYears }
}

export function getSeasonDriversForTeam(seasonId: number, teamId: string): { driverId: string; driverName: string }[] {
  return getDb().prepare(`
    SELECT DISTINCT rr.driver_id AS driverId, rr.driver_name AS driverName
    FROM race_results rr JOIN races r ON r.id = rr.race_id
    WHERE r.season_id = ? AND rr.team_id = ?
  `).all(seasonId, teamId) as { driverId: string; driverName: string }[]
}

export function getMostRecentTeamName(teamId: string): string | null {
  const row = getDb().prepare(
    'SELECT team_name FROM race_results WHERE team_id = ? ORDER BY race_id DESC LIMIT 1',
  ).get(teamId) as { team_name: string } | undefined
  return row?.team_name ?? null
}

export function getDistinctTeamIds(): { teamId: string; teamName: string }[] {
  return getDb().prepare(
    'SELECT team_id AS teamId, MAX(team_name) AS teamName FROM race_results GROUP BY team_id ORDER BY teamName',
  ).all() as { teamId: string; teamName: string }[]
}

export interface SeasonChampions {
  seasonId: number; year: number
  driverChampionId: string | null; driverChampionName: string | null; driverChampionTeamId: string | null
  constructorChampionId: string | null; constructorChampionName: string | null
}

// Drivers' champion is reconstructed (tie-break-correct) from getSeasonStandings;
// constructors' champion is read from the stored final_position = 1.
export function getAllSeasonChampions(): SeasonChampions[] {
  const seasons = getArchivedSeasons() // year DESC
  return seasons.map((s) => {
    const dc = getSeasonStandings(s.id).driverStandings[0]
    const cc = getDb().prepare(
      'SELECT team_id FROM season_constructor_standings WHERE season_id = ? AND final_position = 1 LIMIT 1',
    ).get(s.id) as { team_id: string } | undefined
    return {
      seasonId: s.id, year: s.year,
      driverChampionId: dc?.driverId ?? null,
      driverChampionName: dc?.driverName ?? null,
      driverChampionTeamId: dc?.teamId ?? null,
      constructorChampionId: cc?.team_id ?? null,
      constructorChampionName: cc ? getMostRecentTeamName(cc.team_id) : null,
    }
  })
}

export function getDriverFinishInSeason(seasonId: number, driverId: string): number | null {
  const idx = getSeasonStandings(seasonId).driverStandings.findIndex((d) => d.driverId === driverId)
  return idx >= 0 ? idx + 1 : null
}

export interface LeaderboardEntry { id: string; name: string; value: number }
export interface AllTimeLeaders {
  driverWins: LeaderboardEntry[]; driverPodiums: LeaderboardEntry[]; driverPoints: LeaderboardEntry[]; driverTitles: LeaderboardEntry[]
  teamWins: LeaderboardEntry[]; teamPodiums: LeaderboardEntry[]; teamPoints: LeaderboardEntry[]; teamTitles: LeaderboardEntry[]
}

export function getAllTimeLeaders(champions: SeasonChampions[], limit = 8): AllTimeLeaders {
  const db = getDb()
  const board = (idCol: 'driver_id' | 'team_id', nameCol: 'driver_name' | 'team_name', metric: string) =>
    db.prepare(`
      SELECT rr.${idCol} AS id, MAX(rr.${nameCol}) AS name, ${metric} AS value
      FROM race_results rr JOIN races r ON r.id = rr.race_id JOIN seasons s ON s.id = r.season_id
      WHERE s.status = 'archived' GROUP BY rr.${idCol} HAVING value > 0 ORDER BY value DESC LIMIT ?
    `).all(limit) as LeaderboardEntry[]

  const WINS = 'SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END)'
  const PODIUMS = 'SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END)'
  const POINTS = 'SUM(rr.points)'

  const titleCount = new Map<string, { name: string; value: number }>()
  for (const c of champions) {
    if (!c.driverChampionId) continue
    const e = titleCount.get(c.driverChampionId) ?? { name: c.driverChampionName ?? c.driverChampionId, value: 0 }
    e.value++
    titleCount.set(c.driverChampionId, e)
  }
  const driverTitles = [...titleCount.entries()]
    .map(([id, e]) => ({ id, name: e.name, value: e.value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

  const teamTitles = db.prepare(`
    SELECT scs.team_id AS id,
      (SELECT team_name FROM race_results WHERE team_id = scs.team_id ORDER BY race_id DESC LIMIT 1) AS name,
      COUNT(*) AS value
    FROM season_constructor_standings scs JOIN seasons s ON s.id = scs.season_id
    WHERE scs.final_position = 1 AND s.status = 'archived'
    GROUP BY scs.team_id ORDER BY value DESC LIMIT ?
  `).all(limit) as LeaderboardEntry[]

  return {
    driverWins: board('driver_id', 'driver_name', WINS),
    driverPodiums: board('driver_id', 'driver_name', PODIUMS),
    driverPoints: board('driver_id', 'driver_name', POINTS),
    driverTitles,
    teamWins: board('team_id', 'team_name', WINS),
    teamPodiums: board('team_id', 'team_name', PODIUMS),
    teamPoints: board('team_id', 'team_name', POINTS),
    teamTitles,
  }
}

export interface SearchIndexEntry { id: string; name: string; kind: 'driver' | 'team' }
export function getSearchIndex(): SearchIndexEntry[] {
  const db = getDb()
  const drivers = db.prepare('SELECT driver_id AS id, MAX(driver_name) AS name FROM race_results GROUP BY driver_id').all() as { id: string; name: string }[]
  const teams = db.prepare('SELECT team_id AS id, MAX(team_name) AS name FROM race_results GROUP BY team_id').all() as { id: string; name: string }[]
  return [
    ...drivers.map((d) => ({ ...d, kind: 'driver' as const })),
    ...teams.map((t) => ({ ...t, kind: 'team' as const })),
  ]
}
