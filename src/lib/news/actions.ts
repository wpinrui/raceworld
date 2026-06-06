'use server'

// Server actions for the newsroom's multi-season selector. The live season is generated
// client-side from the store; PAST seasons live only in the archive DB, so we rebuild a
// (results-only) NewsContext from SQLite here and run the same `generateNews` over it.
// Archived contexts have no car pace / contracts / upgrades, so the attribute-dependent
// producers (team trajectory, silly-season) stand down via `live: false`.

import {
  getArchivedSeasons, getArchivedSeasonIdByYear, getRacesForSeason, getResultsForRace,
  getDriverCareersUpToYear, getTeamCareersUpToYear, getAllSeasonChampions, getSeasonTeamIds, getTeamFinalPositionInSeason,
  getTeamConstructorRecordsUpToYear, getTeamDriverTalliesUpToYear,
  saveSeasonNews, getSeasonNews, getAllDriverSeasonTallies, getAllTeamSeasonTallies,
  type DbRaceResult,
} from '@/lib/db/queries'
import { generateNews, type NewsArticle, type DriverCareer, type TeamCareer, type TeamDriverTally, type RecordsContext, type RecordMetric, type SeasonRecordMark } from './engine'
import type { Driver, Team, RaceResult, Circuit } from '@/lib/sim/types'
import { calendarForYear } from '@/data/calendars'

// Reconstruct the grid changes from an archived season to the NEXT one by diffing rosters: a team gone
// next year departed, a team new next year joined, a same-id team with a new name rebranded. Fed to the
// newsroom as `nextSeasonChanges` so the team-transition articles announce them ~4/5 through THIS season
// (the same model as the live game). undefined when nothing changed (or there is no next season yet).
type ArchiveNextSeasonChanges = {
  rebrands: { teamId: string; fromName: string; toName: string }[]
  additions: { teamId: string; teamName: string }[]
  removals: { teamId: string; teamName: string; finalPosition: number | null }[]
}
function nextSeasonChangesForYear(year: number, thisTeams: Map<string, string>): ArchiveNextSeasonChanges | undefined {
  const nextId = getArchivedSeasonIdByYear(year + 1)
  if (nextId == null) return undefined
  const seasonId = getArchivedSeasonIdByYear(year)
  const nextTeams = new Map(getSeasonTeamIds(nextId).map((t) => [t.teamId, t.teamName]))
  const additions: { teamId: string; teamName: string }[] = []
  const removals: { teamId: string; teamName: string; finalPosition: number | null }[] = []
  const rebrands: { teamId: string; fromName: string; toName: string }[] = []
  for (const [id, name] of nextTeams) if (!thisTeams.has(id)) additions.push({ teamId: id, teamName: name })
  for (const [id, name] of thisTeams) {
    if (!nextTeams.has(id)) {
      removals.push({ teamId: id, teamName: name, finalPosition: seasonId != null ? getTeamFinalPositionInSeason(seasonId, id) : null })
    } else {
      const toName = nextTeams.get(id)!
      if (toName !== name) rebrands.push({ teamId: id, fromName: name, toName }) // same lineage, new name = rebrand
    }
  }
  if (additions.length === 0 && removals.length === 0 && rebrands.length === 0) return undefined
  return { rebrands, additions, removals }
}

// Per-driver F1 career totals from the archive, up to and including `throughYear`. Titles are
// layered on from the champions list (drivers' champion is tie-break reconstructed, not a stored
// flag). Shared by the archived-season news and the live newsroom's career fetch.
function buildCareers(throughYear: number): Record<string, DriverCareer> {
  const titleYears = new Map<string, number[]>()
  for (const c of getAllSeasonChampions()) {
    if (c.driverChampionId && c.year <= throughYear) {
      const arr = titleYears.get(c.driverChampionId) ?? []
      arr.push(c.year); titleYears.set(c.driverChampionId, arr)
    }
  }
  const out: Record<string, DriverCareer> = {}
  for (const a of getDriverCareersUpToYear(throughYear)) {
    const years = (titleYears.get(a.driverId) ?? []).sort((x, y) => x - y)
    out[a.driverId] = {
      driverId: a.driverId, starts: a.starts, wins: a.wins, podiums: a.podiums, poles: a.poles,
      points: a.points, seasons: a.seasons, titles: years.length, titleYears: years,
      debutYear: a.debutYear, bestFinish: a.bestFinish,
    }
  }
  return out
}

// Career totals for the live newsroom (client-side). Returns every driver's archived F1 record up
// to `throughYear`, which the live store's drivers/free agents are keyed against.
export async function actionGetDriverCareers(throughYear: number): Promise<Record<string, DriverCareer>> {
  return buildCareers(throughYear)
}

// Per-team constructor career totals from the archive, up to and including `throughYear`. The basis
// for team milestones; the live newsroom folds the current season on top via foldLiveSeasonTeams.
function buildTeamCareers(throughYear: number): Record<string, TeamCareer> {
  const record = new Map(getTeamConstructorRecordsUpToYear(throughYear).map((r) => [r.teamId, r]))
  const out: Record<string, TeamCareer> = {}
  for (const a of getTeamCareersUpToYear(throughYear)) {
    const rec = record.get(a.teamId)
    out[a.teamId] = {
      teamId: a.teamId, races: a.races, seasons: a.seasons, wins: a.wins, podiums: a.podiums,
      poles: a.poles, points: a.points,
      bestConstructorsFinish: rec?.bestFinish ?? null, constructorTitles: rec?.titles ?? 0,
    }
  }
  return out
}

export async function actionGetTeamCareers(throughYear: number): Promise<Record<string, TeamCareer>> {
  return buildTeamCareers(throughYear)
}

// Per-lineage driver tallies from the archive up to `throughYear`, grouped by team id, for the
// {top_driver} slot. The live newsroom folds the current season on top via foldLiveSeasonTeamDrivers.
function buildTeamDriverTallies(throughYear: number): Record<string, TeamDriverTally[]> {
  const out: Record<string, TeamDriverTally[]> = {}
  for (const t of getTeamDriverTalliesUpToYear(throughYear)) {
    ;(out[t.teamId] ??= []).push({ driverId: t.driverId, driverName: t.driverName, wins: t.wins, podiums: t.podiums, points: t.points, firstYear: t.firstYear, lastYear: t.lastYear })
  }
  return out
}

export async function actionGetTeamDriverTallies(throughYear: number): Promise<Record<string, TeamDriverTally[]>> {
  return buildTeamDriverTallies(throughYear)
}

// Prior all-time single-season records (the max per metric across archived seasons, with holder + year)
// plus id->name maps, for the records-driven news producer. Archived-only, so the live season is the
// challenger. Empty marks (e.g. season one) leave the producer with nothing to break.
export async function actionGetSeasonRecords(): Promise<RecordsContext> {
  const driverTallies = getAllDriverSeasonTallies()
  const teamTallies = getAllTeamSeasonTallies()
  const driverNames: Record<string, string> = {}
  const teamNames: Record<string, string> = {}
  for (const t of driverTallies) driverNames[t.driverId] = t.driverName
  for (const t of teamTallies) teamNames[t.teamId] = t.teamName

  function bestMark<T extends { year: number }>(rows: T[], value: (r: T) => number, holder: (r: T) => string): SeasonRecordMark | undefined {
    let best: T | undefined
    for (const r of rows) if (best === undefined || value(r) > value(best)) best = r
    if (!best || value(best) < 1) return undefined // no meaningful prior record to beat
    return { value: value(best), holderName: holder(best), year: best.year }
  }

  const seasonDriver: Partial<Record<RecordMetric, SeasonRecordMark>> = {
    wins: bestMark(driverTallies, (r) => r.wins, (r) => r.driverName),
    poles: bestMark(driverTallies, (r) => r.poles, (r) => r.driverName),
    podiums: bestMark(driverTallies, (r) => r.podiums, (r) => r.driverName),
    points: bestMark(driverTallies, (r) => r.points, (r) => r.driverName),
    dnfs: bestMark(driverTallies, (r) => r.dnfs, (r) => r.driverName),
  }
  const seasonTeam: Partial<Record<RecordMetric, SeasonRecordMark>> = {
    wins: bestMark(teamTallies, (r) => r.wins, (r) => r.teamName),
    podiums: bestMark(teamTallies, (r) => r.podiums, (r) => r.teamName),
    points: bestMark(teamTallies, (r) => r.points, (r) => r.teamName),
  }
  const archivedSeasons = new Set(driverTallies.map((t) => t.seasonId)).size
  return { archivedSeasons, seasonDriver, seasonTeam, driverNames, teamNames }
}

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
    pace: 0, wetWeatherPace: 0, overtaking: 0, smoothness: 0, consistency: 0,
    age: 0, peakPotential: 0, primeEnd: 0, narrativeModifier: 0,
    contractExpiresAfterSeason: 9999,
  }
}

export async function actionGetNewsSeasonYears(): Promise<number[]> {
  return getArchivedSeasons().map((s) => s.year).sort((a, b) => b - a)
}

// Archived-season news plus the roster needed to hyperlink names in the article text (drivers and
// teams by id, circuits by round). The live newsroom builds the same roster from the store instead.
interface SeasonNews {
  articles: NewsArticle[]
  drivers: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  circuits: { name: string; round: number }[]
}
const EMPTY_SEASON_NEWS: SeasonNews = { articles: [], drivers: [], teams: [], circuits: [] }

export async function actionGetSeasonNews(year: number): Promise<SeasonNews> {
  const seasonId = getArchivedSeasonIdByYear(year)
  if (seasonId == null) return EMPTY_SEASON_NEWS

  const races = [...getRacesForSeason(seasonId)].sort((a, b) => a.round - b.round)
  if (races.length === 0) return EMPTY_SEASON_NEWS

  const raceResults: RaceResult[][] = races.map((race) => getResultsForRace(race.id).map(toRaceResult))

  const driverMap = new Map<string, Driver>()
  const teamMap = new Map<string, Team>()
  for (const round of raceResults) {
    for (const r of round) {
      if (!driverMap.has(r.driverId)) driverMap.set(r.driverId, stubDriver(r.driverId, r.driverName, r.teamId))
      if (!teamMap.has(r.teamId)) {
        teamMap.set(r.teamId, { id: r.teamId, name: r.teamName, shortName: r.teamName, nationality: '', color: '#888888', carPace: 0 })
      }
    }
  }

  const calendar: Circuit[] = races.map((race) => ({
    id: race.circuit_id, name: race.circuit_name, code: '', location: '', country: '', laps: 0, flatModifier: 0,
    // Pull the real Sunday-ordinal from the live calendar by id so archived article dates resolve to
    // the correct date for that season's year (the DB doesn't store scheduling).
    sundayOfYear: calendarForYear(year).find((c) => c.id === race.circuit_id)?.sundayOfYear ?? 0,
  }))

  // Prefer the feed snapshotted when the season archived (carries the live-only producers, e.g.
  // silly-season and driver-to-watch, that can't be rebuilt from results). Fall back to regenerating
  // from results for seasons archived before snapshots existed.
  const snapshot = getSeasonNews(seasonId)
  const articles: NewsArticle[] = snapshot
    ? (JSON.parse(snapshot) as NewsArticle[])
    : generateNews({
        year,
        phase: 'idle',
        completedRounds: raceResults.length,
        drivers: [...driverMap.values()],
        teams: [...teamMap.values()],
        raceResults,
        upgradeEvents: [],
        constructorHistory: [],
        // Synthesized purely to carry grid changes (arrivals/farewells) reconstructed from the DB;
        // its market arrays are empty, so market() emits only the team_entry/team_exit announcements.
        endOfSeason: null,
        nextSeasonChanges: nextSeasonChangesForYear(year, new Map([...teamMap].map(([id, t]) => [id, t.name]))),
        calendar,
        live: false,
        careers: buildCareers(year),
        teamCareers: buildTeamCareers(year),
        teamDriverTallies: buildTeamDriverTallies(year),
      })
  return {
    articles,
    drivers: [...driverMap.values()].map((d) => ({ id: d.id, name: d.name })),
    teams: [...teamMap.values()].map((t) => ({ id: t.id, name: t.name })),
    circuits: races.map((race) => ({ name: race.circuit_name.replace(/\bGP\b/, 'Grand Prix'), round: race.round })),
  }
}

// Persist the complete live news feed for a season at archive time. Generated client-side (the live
// producers need the store's full driver attributes), passed here as a JSON array of articles.
export async function actionSaveSeasonNews(seasonId: number, articlesJson: string): Promise<void> {
  saveSeasonNews(seasonId, articlesJson)
}

export interface AllSeasonNews {
  articles: (NewsArticle & { year: number })[]
  drivers: { id: string; name: string }[]
  teams: { id: string; name: string }[]
}

// Every archived season's news in one shot, each article tagged with its year, for the newsroom's
// cross-season ("all seasons") search/filter. Live-season articles are folded in client-side. The
// returned roster is the union of drivers/teams across the archive, for hyperlinking article text.
export async function actionGetAllSeasonNews(): Promise<AllSeasonNews> {
  const years = getArchivedSeasons().map((s) => s.year).sort((a, b) => b - a)
  const articles: (NewsArticle & { year: number })[] = []
  const driverMap = new Map<string, string>()
  const teamMap = new Map<string, string>()
  for (const year of years) {
    const res = await actionGetSeasonNews(year)
    for (const a of res.articles) articles.push({ ...a, year })
    for (const d of res.drivers) driverMap.set(d.id, d.name)
    for (const t of res.teams) teamMap.set(t.id, t.name)
  }
  return {
    articles,
    drivers: [...driverMap].map(([id, name]) => ({ id, name })),
    teams: [...teamMap].map(([id, name]) => ({ id, name })),
  }
}
