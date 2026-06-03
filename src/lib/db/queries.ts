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
    db.prepare('DELETE FROM driver_race_form').run()
    db.prepare('DELETE FROM driver_race_attributes').run()
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

// Persist each driver's pre-race form for a race (idempotent per race+driver).
export function insertDriverRaceForm(raceId: number, rows: { driverId: string; form: number }[]): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO driver_race_form (race_id, driver_id, form) VALUES (?, ?, ?)
    ON CONFLICT(race_id, driver_id) DO UPDATE SET form = excluded.form
  `)
  const insertMany = db.transaction((rs: { driverId: string; form: number }[]) => {
    for (const r of rs) stmt.run(raceId, r.driverId, r.form)
  })
  insertMany(rows)
}

export interface DbRecentFormRow {
  year: number
  round: number
  circuitName: string
  gridPosition: number
  finishPosition: number | null
  points: number
  dnf: number
  form: number
}

// The driver's most recent archived races that have a recorded form, newest first.
export function getDriverRecentForm(driverId: string, limit: number): DbRecentFormRow[] {
  return getDb().prepare(`
    SELECT s.year AS year, r.round AS round, r.circuit_name AS circuitName,
      rr.grid_position AS gridPosition, rr.finish_position AS finishPosition,
      rr.points AS points, rr.dnf AS dnf, drf.form AS form
    FROM driver_race_form drf
    JOIN race_results rr ON rr.race_id = drf.race_id AND rr.driver_id = drf.driver_id
    JOIN races r ON r.id = drf.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE drf.driver_id = ? AND s.status = 'archived'
    ORDER BY s.year DESC, r.round DESC
    LIMIT ?
  `).all(driverId, limit) as DbRecentFormRow[]
}

export interface DriverAttributeSnapshot {
  driverId: string
  pace: number
  wetWeatherPace: number
  overtaking: number
  smoothness: number
}

// Persist each driver's post-race attributes for the round. Idempotent per
// (season, round, driver) so re-flushing a round doesn't duplicate rows.
export function insertDriverRaceAttributes(
  seasonId: number,
  round: number,
  snapshots: DriverAttributeSnapshot[],
): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO driver_race_attributes (season_id, round, driver_id, pace, wet_weather_pace, overtaking, smoothness)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(season_id, round, driver_id) DO UPDATE SET
      pace = excluded.pace, wet_weather_pace = excluded.wet_weather_pace,
      overtaking = excluded.overtaking, smoothness = excluded.smoothness
  `)
  const insertMany = db.transaction((rows: DriverAttributeSnapshot[]) => {
    for (const s of rows) stmt.run(seasonId, round, s.driverId, s.pace, s.wetWeatherPace, s.overtaking, s.smoothness)
  })
  insertMany(snapshots)
}

export interface DbRatingsPointRow {
  year: number
  round: number
  pace: number
  wet_weather_pace: number
  overtaking: number
  smoothness: number
}

// A driver's attribute timeline across all archived seasons, ordered chronologically.
export function getDriverRatingsHistory(driverId: string): DbRatingsPointRow[] {
  return getDb().prepare(`
    SELECT s.year AS year, dra.round AS round,
      dra.pace AS pace, dra.wet_weather_pace AS wet_weather_pace,
      dra.overtaking AS overtaking, dra.smoothness AS smoothness
    FROM driver_race_attributes dra
    JOIN seasons s ON s.id = dra.season_id
    WHERE dra.driver_id = ? AND s.status = 'archived'
    ORDER BY s.year, dra.round
  `).all(driverId) as DbRatingsPointRow[]
}

export interface DbTeammateRaceRow {
  year: number
  round: number
  teamName: string
  teammateId: string
  teammateName: string
  myGrid: number
  myFinish: number | null
  myDnf: number
  myPoints: number
  mateGrid: number
  mateFinish: number | null
  mateDnf: number
  matePoints: number
}

// Every archived race where this driver had a teammate, paired with that teammate's row.
export function getDriverTeammateRaces(driverId: string): DbTeammateRaceRow[] {
  return getDb().prepare(`
    SELECT s.year AS year, r.round AS round, a.team_name AS teamName,
      b.driver_id AS teammateId, b.driver_name AS teammateName,
      a.grid_position AS myGrid, a.finish_position AS myFinish, a.dnf AS myDnf, a.points AS myPoints,
      b.grid_position AS mateGrid, b.finish_position AS mateFinish, b.dnf AS mateDnf, b.points AS matePoints
    FROM race_results a
    JOIN race_results b ON b.race_id = a.race_id AND b.team_id = a.team_id AND b.driver_id <> a.driver_id
    JOIN races r ON r.id = a.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE a.driver_id = ? AND s.status = 'archived'
    ORDER BY s.year, r.round
  `).all(driverId) as DbTeammateRaceRow[]
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

export function getArchivedSeasonIdByYear(year: number): number | null {
  const row = getDb()
    .prepare("SELECT id FROM seasons WHERE year = ? AND status = 'archived' ORDER BY id DESC LIMIT 1")
    .get(year) as { id: number } | undefined
  return row?.id ?? null
}

// A race result row joined to its round/circuit — used for drill-down detail.
export interface DbRaceResultRow extends DbRaceResult {
  round: number
  circuit_id: string
  circuit_name: string
}

export function getDriverRacesInSeason(seasonId: number, driverId: string): DbRaceResultRow[] {
  return getDb().prepare(`
    SELECT rr.*, r.round AS round, r.circuit_id AS circuit_id, r.circuit_name AS circuit_name
    FROM race_results rr JOIN races r ON r.id = rr.race_id
    WHERE r.season_id = ? AND rr.driver_id = ?
    ORDER BY r.round
  `).all(seasonId, driverId) as DbRaceResultRow[]
}

export function getTeamRacesInSeason(seasonId: number, teamId: string): DbRaceResultRow[] {
  return getDb().prepare(`
    SELECT rr.*, r.round AS round, r.circuit_id AS circuit_id, r.circuit_name AS circuit_name
    FROM race_results rr JOIN races r ON r.id = rr.race_id
    WHERE r.season_id = ? AND rr.team_id = ?
    ORDER BY r.round, rr.finish_position
  `).all(seasonId, teamId) as DbRaceResultRow[]
}

export function getRaceInSeasonByRound(seasonId: number, round: number): DbRace | null {
  const row = getDb()
    .prepare('SELECT * FROM races WHERE season_id = ? AND round = ? LIMIT 1')
    .get(seasonId, round) as DbRace | undefined
  return row ?? null
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

// Per-driver F1 career aggregates across every archived season up to and including `year`. Powers
// the newsroom's career-driven producers (retirement obituaries, driver-to-watch). Titles are
// layered on separately by the caller from getAllSeasonChampions (drivers' champion is tie-break
// reconstructed, not stored as a flag).
export interface DbDriverCareerAgg {
  driverId: string; starts: number; wins: number; podiums: number; poles: number
  points: number; seasons: number; debutYear: number | null; bestFinish: number | null
}
export function getDriverCareersUpToYear(year: number): DbDriverCareerAgg[] {
  return getDb().prepare(`
    SELECT rr.driver_id AS driverId,
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END) AS podiums,
      SUM(CASE WHEN rr.grid_position = 1 THEN 1 ELSE 0 END) AS poles,
      SUM(rr.points) AS points,
      COUNT(DISTINCT s.id) AS seasons,
      MIN(s.year) AS debutYear,
      MIN(rr.finish_position) AS bestFinish
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE s.status = 'archived' AND s.year <= ?
    GROUP BY rr.driver_id
  `).all(year) as DbDriverCareerAgg[]
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

export function getTeamFinalPositionInSeason(seasonId: number, teamId: string): number | null {
  const row = getDb()
    .prepare('SELECT final_position AS pos FROM season_constructor_standings WHERE season_id = ? AND team_id = ? LIMIT 1')
    .get(seasonId, teamId) as { pos: number } | undefined
  return row?.pos ?? null
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

// --- Stats-engine aggregates (archived seasons only) ---
// Per (season, driver) and (season, team) tallies for the whole world, plus a
// driver's ordered race log — the raw material the feat detector reduces over.

export interface DriverSeasonTally {
  driverId: string; driverName: string; seasonId: number; year: number
  races: number; wins: number; poles: number; podiums: number; points: number; dnfs: number
}

export function getAllDriverSeasonTallies(): DriverSeasonTally[] {
  return getDb().prepare(`
    SELECT rr.driver_id AS driverId, MAX(rr.driver_name) AS driverName,
      s.id AS seasonId, s.year AS year,
      COUNT(*) AS races,
      SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.grid_position = 1 THEN 1 ELSE 0 END) AS poles,
      SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END) AS podiums,
      SUM(rr.points) AS points,
      SUM(rr.dnf) AS dnfs
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE s.status = 'archived'
    GROUP BY s.id, rr.driver_id
    ORDER BY s.year
  `).all() as DriverSeasonTally[]
}

export interface TeamSeasonTally {
  teamId: string; teamName: string; seasonId: number; year: number
  wins: number; podiums: number; points: number; finalPosition: number | null
}

export function getAllTeamSeasonTallies(): TeamSeasonTally[] {
  return getDb().prepare(`
    SELECT rr.team_id AS teamId, MAX(rr.team_name) AS teamName,
      s.id AS seasonId, s.year AS year,
      SUM(CASE WHEN rr.finish_position = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.finish_position IN (1,2,3) THEN 1 ELSE 0 END) AS podiums,
      SUM(rr.points) AS points,
      scs.final_position AS finalPosition
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    LEFT JOIN season_constructor_standings scs ON scs.season_id = s.id AND scs.team_id = rr.team_id
    WHERE s.status = 'archived'
    GROUP BY s.id, rr.team_id
    ORDER BY s.year
  `).all() as TeamSeasonTally[]
}

// One row per archived race a driver started, in chronological order — used to
// compute consecutive-race streaks (wins, podiums, points finishes).
export interface DriverRaceLite {
  year: number; round: number; gridPosition: number; finishPosition: number | null; dnf: number; points: number
}

export function getDriverArchivedRaces(driverId: string): DriverRaceLite[] {
  return getDb().prepare(`
    SELECT s.year AS year, r.round AS round, rr.grid_position AS gridPosition,
      rr.finish_position AS finishPosition, rr.dnf AS dnf, rr.points AS points
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN seasons s ON s.id = r.season_id
    WHERE rr.driver_id = ? AND s.status = 'archived'
    ORDER BY s.year, r.round
  `).all(driverId) as DriverRaceLite[]
}
