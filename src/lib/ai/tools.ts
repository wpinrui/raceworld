import type Anthropic from '@anthropic-ai/sdk'
import {
  getAllSeasons, getSeasonIdByYear, getRaceInSeasonByRound, getResultsForRace,
  getSeasonStandings, getDriverTotals, getDriverCareerBySeason, getDriverRacesInSeason,
  getTeamTotals, getTeamCareerBySeason, getTeamRacesInSeason,
  getAllSeasonChampions, getAllTimeLeaders, getSearchIndex,
} from '@/lib/db/queries'
import { getDriverHonours, getTeamHonours, detectRaceFeats } from '@/lib/stats/feats'

// Tools exposed to Claude for grounding newsroom copy in the stats DB. Stable, deterministic
// order so the prompt-cache prefix (tools render first) stays valid across requests.
export const NEWSROOM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_seasons',
    description: 'List every season with its year and status ("active" = in progress, "archived" = finished). Call this first to learn which years exist and which one is current.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_race_classification',
    description: 'Full finishing order for one race: each driver\'s grid position, finish position (null = DNF), points, and team. Works for the in-progress season too. Use this for race reviews.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer' }, round: { type: 'integer', description: '1-indexed round number' } },
      required: ['year', 'round'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_race_feats',
    description: 'Notable programmatic feats detected in a race (pole-to-win, dominant margin, photo finish, 1-2 finish, comeback drive, attrition, etc.). Use to find the story angle.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer' }, round: { type: 'integer' } },
      required: ['year', 'round'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_season_standings',
    description: 'Drivers\' and constructors\' championship standings for a season as of its latest completed round. Use to describe championship implications.',
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer' } },
      required: ['year'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_driver_season',
    description: 'A single driver\'s race-by-race results within one season (archived seasons).',
    input_schema: {
      type: 'object',
      properties: { driverId: { type: 'string' }, year: { type: 'integer' } },
      required: ['driverId', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_team_season',
    description: 'A single team\'s race-by-race results within one season (archived seasons).',
    input_schema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, year: { type: 'integer' } },
      required: ['teamId', 'year'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_driver_career',
    description: 'A driver\'s career totals (wins, podiums, poles, points, seasons) and per-season breakdown, across archived seasons.',
    input_schema: {
      type: 'object',
      properties: { driverId: { type: 'string' } },
      required: ['driverId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_team_career',
    description: 'A team\'s career totals and per-season breakdown, across archived seasons.',
    input_schema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_driver_honours',
    description: 'A driver\'s honours and records (titles, all-time records, milestones, streaks).',
    input_schema: {
      type: 'object',
      properties: { driverId: { type: 'string' } },
      required: ['driverId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_team_honours',
    description: 'A team\'s honours and records.',
    input_schema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_all_time_leaders',
    description: 'All-time leaderboards (top drivers and teams by wins, podiums, points, titles) across archived seasons.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_champions',
    description: 'The full roll of past champions: each archived season\'s drivers\' and constructors\' champions.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_index',
    description: 'List every driver and team that has ever raced, with their id and name. Call this FIRST to resolve a name mentioned by the player into the id the other tools need.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

// Everything needed to write a race review, gathered up front so the model never has to
// guess: full classification (with real gaps), detected feats, championship standings, and
// the season's earlier races for context.
export function gatherRaceReviewContext(year: number, round: number) {
  const seasonId = getSeasonIdByYear(year)
  const thisRace = classificationFor(year, round)
  const feats = seasonId == null ? [] : detectRaceFeats(seasonId, round)
  const standings = seasonId == null ? null : getSeasonStandings(seasonId)
  const previousRaces = []
  for (let r = Math.max(1, round - 3); r < round; r++) {
    const c = classificationFor(year, r)
    if (c) previousRaces.push(c)
  }
  return { thisRace, feats, standingsAfterRound: standings, previousRaces }
}

type ToolInput = Record<string, unknown>

function classificationFor(year: number, round: number) {
  const seasonId = getSeasonIdByYear(year)
  if (seasonId == null) return null
  const race = getRaceInSeasonByRound(seasonId, round)
  if (!race) return null
  const rows = getResultsForRace(race.id)
  const finisherTimes = rows.filter((r) => !r.dnf && r.total_time_ms != null).map((r) => r.total_time_ms as number)
  const leaderTime = finisherTimes.length ? Math.min(...finisherTimes) : null
  return {
    year, round, circuit: race.circuit_name,
    results: rows.map((r) => ({
      driver: r.driver_name, team: r.team_name, grid: r.grid_position,
      finish: r.dnf ? null : r.finish_position, dnf: !!r.dnf, points: r.points,
      lapsCompleted: r.laps_completed,
      // Gap to the winner in seconds (null for the winner and for DNFs). This is the ONLY
      // source of finishing margins; the model must not invent gaps.
      // NB: total_time_ms is misnamed — it stores SECONDS, not milliseconds.
      gapToWinnerSeconds: !r.dnf && r.total_time_ms != null && leaderTime != null && r.total_time_ms > leaderTime
        ? Math.round((r.total_time_ms - leaderTime) * 1000) / 1000
        : null,
    })),
  }
}

// Execute a tool call against the stats DB. Never throws — returns a JSON string and an
// error flag so a bad id can't crash the loop.
export function executeTool(name: string, input: ToolInput): { content: string; isError: boolean } {
  try {
    let result: unknown
    switch (name) {
      case 'list_seasons':
        result = getAllSeasons(); break
      case 'get_race_classification':
        result = classificationFor(Number(input.year), Number(input.round)); break
      case 'get_race_feats': {
        const seasonId = getSeasonIdByYear(Number(input.year))
        result = seasonId == null ? null : detectRaceFeats(seasonId, Number(input.round))
        break
      }
      case 'get_season_standings': {
        const seasonId = getSeasonIdByYear(Number(input.year))
        result = seasonId == null ? null : getSeasonStandings(seasonId)
        break
      }
      case 'get_driver_season': {
        const seasonId = getSeasonIdByYear(Number(input.year))
        result = seasonId == null ? null : getDriverRacesInSeason(seasonId, String(input.driverId))
        break
      }
      case 'get_team_season': {
        const seasonId = getSeasonIdByYear(Number(input.year))
        result = seasonId == null ? null : getTeamRacesInSeason(seasonId, String(input.teamId))
        break
      }
      case 'get_driver_career':
        result = { totals: getDriverTotals(String(input.driverId)), seasons: getDriverCareerBySeason(String(input.driverId)) }
        break
      case 'get_team_career':
        result = { totals: getTeamTotals(String(input.teamId)), seasons: getTeamCareerBySeason(String(input.teamId)) }
        break
      case 'get_driver_honours':
        result = getDriverHonours(String(input.driverId)); break
      case 'get_team_honours':
        result = getTeamHonours(String(input.teamId)); break
      case 'get_all_time_leaders':
        result = getAllTimeLeaders(getAllSeasonChampions()); break
      case 'get_champions':
        result = getAllSeasonChampions(); break
      case 'search_index':
        result = getSearchIndex(); break
      default:
        return { content: `Unknown tool: ${name}`, isError: true }
    }
    if (result == null) return { content: 'No data found for that query.', isError: false }
    return { content: JSON.stringify(result), isError: false }
  } catch (e) {
    return { content: `Tool error: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}
