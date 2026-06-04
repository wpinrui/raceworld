'use server'

// Server actions for the newsroom's multi-season selector. The live season is generated
// client-side from the store; PAST seasons live only in the archive DB, so we rebuild a
// (results-only) NewsContext from SQLite here and run the same `generateNews` over it.
// Archived contexts have no car pace / contracts / upgrades, so the attribute-dependent
// producers (team trajectory, silly-season) stand down via `live: false`.

import {
  getArchivedSeasons, getArchivedSeasonIdByYear, getRacesForSeason, getResultsForRace,
  getDriverCareersUpToYear, getTeamCareersUpToYear, getAllSeasonChampions, getSeasonTeamIds, getTeamFinalPositionInSeason,
  type DbRaceResult,
} from '@/lib/db/queries'
import { generateNews, type NewsContext, type NewsArticle, type DriverCareer, type TeamCareer } from './engine'
import type { Driver, Team, RaceResult, Circuit, EndOfSeasonSummary } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'

// Reconstruct the grid changes around an archived season by diffing its team roster against the
// NEXT season's: a team gone next year departed (farewell on this season), a team new next year
// joined (announced here, for next year). Returned as a minimal end-of-season summary so the same
// market() producer emits the announcements — null when nothing changed (or no next season yet).
function gridChangeSummary(year: number, thisTeams: Map<string, string>): EndOfSeasonSummary | null {
  const nextId = getArchivedSeasonIdByYear(year + 1)
  if (nextId == null) return null
  const seasonId = getArchivedSeasonIdByYear(year)
  const nextTeams = new Map(getSeasonTeamIds(nextId).map((t) => [t.teamId, t.teamName]))
  const gridAdditions: { teamId: string; teamName: string }[] = []
  const gridRemovals: { teamId: string; teamName: string; finalPosition: number | null }[] = []
  for (const [id, name] of nextTeams) if (!thisTeams.has(id)) gridAdditions.push({ teamId: id, teamName: name })
  for (const [id, name] of thisTeams) if (!nextTeams.has(id)) {
    gridRemovals.push({ teamId: id, teamName: name, finalPosition: seasonId != null ? getTeamFinalPositionInSeason(seasonId, id) : null })
  }
  if (gridAdditions.length === 0 && gridRemovals.length === 0) return null
  return {
    seasonYear: year, driverChampion: '', constructorChampion: '',
    progressionEvents: [], retiredDriverIds: [], carReshuffleOldPaces: {}, carReshuffleNewPaces: {},
    marketMoves: [], droppedDrivers: [], seatContests: [], driverMediaScores: [], teamMediaScores: [],
    upgradeEvents: [], preSeasonTest: null, gridAdditions, gridRemovals,
  }
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
  const out: Record<string, TeamCareer> = {}
  for (const a of getTeamCareersUpToYear(throughYear)) {
    out[a.teamId] = { teamId: a.teamId, races: a.races, wins: a.wins, podiums: a.podiums, poles: a.poles, points: a.points }
  }
  return out
}

export async function actionGetTeamCareers(throughYear: number): Promise<Record<string, TeamCareer>> {
  return buildTeamCareers(throughYear)
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
    pace: 0, wetWeatherPace: 0, overtaking: 0, smoothness: 0,
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
    sundayOfYear: calendar2026.find((c) => c.id === race.circuit_id)?.sundayOfYear ?? 0,
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
    // Synthesized purely to carry grid changes (arrivals/farewells) reconstructed from the DB;
    // its market arrays are empty, so market() emits only the team_entry/team_exit announcements.
    endOfSeason: gridChangeSummary(year, new Map([...teamMap].map(([id, t]) => [id, t.name]))),
    calendar,
    live: false,
    careers: buildCareers(year),
    teamCareers: buildTeamCareers(year),
  }
  return {
    articles: generateNews(ctx),
    drivers: [...driverMap.values()].map((d) => ({ id: d.id, name: d.name })),
    teams: [...teamMap.values()].map((t) => ({ id: t.id, name: t.name })),
    circuits: races.map((race) => ({ name: race.circuit_name.replace(/\bGP\b/, 'Grand Prix'), round: race.round })),
  }
}
