// Stats-engine feat / record detector (server-side; reads the archived DB).
//
// Pure reductions over the structured race data — no LLM. `getDriverHonours` /
// `getTeamHonours` feed the world entity pages; `detectSeasonFeats` /
// `detectRaceFeats` are the headless API the M5 newsroom will call ("any records
// this weekend?"), which is usually fruitless and that's fine.
//
// Everything is computed from ARCHIVED seasons only — the in-progress season folds
// in once it is archived, matching how career totals already behave.

import {
  getAllDriverSeasonTallies,
  getAllTeamSeasonTallies,
  getDriverArchivedRaces,
  getAllSeasonChampions,
  getRacesForSeason,
  getResultsForRace,
  getRaceInSeasonByRound,
  type DriverSeasonTally,
  type TeamSeasonTally,
} from '@/lib/db/queries'
import type { Feat } from './types'

// --- thresholds (see chat summary) ---
const WIN_MILESTONES = [10, 25, 50, 100, 150, 200]
const POLE_MILESTONES = [10, 25, 50, 100]
const PODIUM_MILESTONES = [25, 50, 100, 150, 200]
const POINTS_MILESTONES = [500, 1000, 2500, 5000, 10000]
const START_MILESTONES = [50, 100, 150, 200, 250, 300]
const WIN_STREAK_MIN = 3
const PODIUM_STREAK_MIN = 5
const POINTS_STREAK_MIN = 10
const DOMINANT_MARGIN_S = 20
const PHOTO_FINISH_S = 1
const ATTRITION_FRACTION = 0.4
const COMEBACK_GAIN = 10
const TOP_RANK_BADGE = 5

const highestCrossed = (total: number, thresholds: number[]): number | null => {
  let hit: number | null = null
  for (const t of thresholds) if (total >= t) hit = t
  return hit
}

// 1-based rank of `value` among all `values` with value > 0 (ties share the better rank).
const rankOf = (value: number, values: number[]): number =>
  values.filter((v) => v > value).length + 1

const longestRun = <T>(rows: T[], pred: (r: T) => boolean): number => {
  let best = 0, cur = 0
  for (const r of rows) {
    if (pred(r)) { cur++; best = Math.max(best, cur) } else cur = 0
  }
  return best
}

interface DriverCareer {
  driverId: string; driverName: string
  races: number; wins: number; poles: number; podiums: number; points: number
}

function foldDriverCareers(tallies: DriverSeasonTally[]): Map<string, DriverCareer> {
  const m = new Map<string, DriverCareer>()
  for (const t of tallies) {
    const c = m.get(t.driverId) ?? { driverId: t.driverId, driverName: t.driverName, races: 0, wins: 0, poles: 0, podiums: 0, points: 0 }
    c.races += t.races; c.wins += t.wins; c.poles += t.poles; c.podiums += t.podiums; c.points += t.points
    c.driverName = t.driverName
    m.set(t.driverId, c)
  }
  return m
}

export function getDriverHonours(driverId: string): Feat[] {
  const tallies = getAllDriverSeasonTallies()
  const careers = foldDriverCareers(tallies)
  const me = careers.get(driverId)
  if (!me || me.races === 0) return []

  const all = [...careers.values()]
  const feats: Feat[] = []

  // Championships
  const champions = getAllSeasonChampions()
  const titleYears = champions.filter((c) => c.driverChampionId === driverId).map((c) => c.year).sort((a, b) => a - b)
  if (titleYears.length > 0) {
    feats.push({
      id: 'driver-titles', category: 'title', priority: 100,
      title: `${titleYears.length}× World Champion`,
      detail: titleYears.join(' · '), value: titleYears.length,
    })
  }

  // All-time leaderboard standing per metric
  const metrics: Array<{ key: keyof DriverCareer; label: string }> = [
    { key: 'wins', label: 'wins' },
    { key: 'poles', label: 'poles' },
    { key: 'podiums', label: 'podiums' },
    { key: 'points', label: 'points' },
  ]
  for (const { key, label } of metrics) {
    const value = me[key] as number
    if (value <= 0) continue
    const rank = rankOf(value, all.map((c) => c[key] as number))
    if (rank === 1) {
      feats.push({
        id: `driver-record-${label}`, category: 'record', priority: 90, allTime: true,
        title: `All-time record: most ${label}`, detail: `${value} career ${label}`, value,
      })
    } else if (rank <= TOP_RANK_BADGE) {
      feats.push({
        id: `driver-rank-${label}`, category: 'record', priority: 60,
        title: `P${rank} all-time in ${label}`, detail: `${value} career ${label}`, value,
      })
    }
  }

  // Volume milestones (the classic "clubs")
  const milestoneSpecs: Array<{ key: keyof DriverCareer; thresholds: number[]; noun: string }> = [
    { key: 'wins', thresholds: WIN_MILESTONES, noun: 'Grand Prix wins' },
    { key: 'poles', thresholds: POLE_MILESTONES, noun: 'pole positions' },
    { key: 'podiums', thresholds: PODIUM_MILESTONES, noun: 'podiums' },
    { key: 'points', thresholds: POINTS_MILESTONES, noun: 'career points' },
    { key: 'races', thresholds: START_MILESTONES, noun: 'race starts' },
  ]
  for (const { key, thresholds, noun } of milestoneSpecs) {
    const hit = highestCrossed(me[key] as number, thresholds)
    if (hit != null) {
      feats.push({
        id: `driver-milestone-${String(key)}`, category: 'milestone', priority: 55,
        title: `${hit}+ ${noun}`, value: hit,
      })
    }
  }

  // Single-season records (best season + all-time season records held)
  const myBestWins = tallies.filter((t) => t.driverId === driverId).reduce<DriverSeasonTally | null>(
    (b, t) => (b == null || t.wins > b.wins ? t : b), null,
  )
  if (myBestWins && myBestWins.wins >= 3) {
    feats.push({
      id: 'driver-best-season-wins', category: 'season', priority: 70,
      title: `Career-best season: ${myBestWins.wins} wins`, detail: `${myBestWins.year}`,
      value: myBestWins.wins, year: myBestWins.year,
    })
  }
  for (const spec of [
    { metric: 'wins' as const, noun: 'wins' },
    { metric: 'poles' as const, noun: 'poles' },
    { metric: 'points' as const, noun: 'points' },
  ]) {
    const topSeason = tallies.reduce<DriverSeasonTally | null>(
      (b, t) => (b == null || t[spec.metric] > b[spec.metric] ? t : b), null,
    )
    if (topSeason && topSeason.driverId === driverId && topSeason[spec.metric] > 0) {
      feats.push({
        id: `driver-season-record-${spec.metric}`, category: 'record', priority: 80, allTime: true,
        title: `Most ${spec.noun} in a season`, detail: `${topSeason[spec.metric]} in ${topSeason.year}`,
        value: topSeason[spec.metric], year: topSeason.year,
      })
    }
  }

  // Consecutive-race streaks
  const races = getDriverArchivedRaces(driverId)
  const winStreak = longestRun(races, (r) => r.finishPosition === 1 && !r.dnf)
  const podiumStreak = longestRun(races, (r) => !r.dnf && r.finishPosition != null && r.finishPosition <= 3)
  const pointsStreak = longestRun(races, (r) => r.points > 0)
  if (winStreak >= WIN_STREAK_MIN)
    feats.push({ id: 'driver-streak-wins', category: 'streak', priority: 65, title: `${winStreak} straight wins`, value: winStreak })
  if (podiumStreak >= PODIUM_STREAK_MIN)
    feats.push({ id: 'driver-streak-podiums', category: 'streak', priority: 50, title: `${podiumStreak} straight podiums`, value: podiumStreak })
  if (pointsStreak >= POINTS_STREAK_MIN)
    feats.push({ id: 'driver-streak-points', category: 'streak', priority: 45, title: `${pointsStreak} straight points finishes`, value: pointsStreak })

  return feats.sort((a, b) => b.priority - a.priority)
}

interface TeamCareer { teamId: string; teamName: string; wins: number; podiums: number; points: number }

export function getTeamHonours(teamId: string): Feat[] {
  const tallies = getAllTeamSeasonTallies()
  const careers = new Map<string, TeamCareer>()
  for (const t of tallies) {
    const c = careers.get(t.teamId) ?? { teamId: t.teamId, teamName: t.teamName, wins: 0, podiums: 0, points: 0 }
    c.wins += t.wins; c.podiums += t.podiums; c.points += t.points; c.teamName = t.teamName
    careers.set(t.teamId, c)
  }
  const me = careers.get(teamId)
  if (!me) return []

  const all = [...careers.values()]
  const feats: Feat[] = []

  // Constructors' titles (+ consecutive-title streak)
  const titleYears = tallies.filter((t) => t.teamId === teamId && t.finalPosition === 1).map((t) => t.year).sort((a, b) => a - b)
  if (titleYears.length > 0) {
    feats.push({
      id: 'team-titles', category: 'title', priority: 100,
      title: `${titleYears.length}× Constructors' Champion`, detail: titleYears.join(' · '), value: titleYears.length,
    })
    let bestRun = 1, run = 1
    for (let i = 1; i < titleYears.length; i++) {
      run = titleYears[i] === titleYears[i - 1] + 1 ? run + 1 : 1
      bestRun = Math.max(bestRun, run)
    }
    if (bestRun >= 2)
      feats.push({ id: 'team-title-streak', category: 'streak', priority: 75, title: `${bestRun} consecutive titles`, value: bestRun })
  } else {
    const best = tallies.filter((t) => t.teamId === teamId && t.finalPosition != null)
      .reduce<number | null>((b, t) => (b == null ? t.finalPosition! : Math.min(b, t.finalPosition!)), null)
    if (best != null)
      feats.push({ id: 'team-best-finish', category: 'season', priority: 40, title: `Best finish: P${best}` })
  }

  // All-time team leaderboard standing
  for (const { key, label } of [
    { key: 'wins' as const, label: 'wins' },
    { key: 'points' as const, label: 'points' },
    { key: 'podiums' as const, label: 'podiums' },
  ]) {
    const value = me[key]
    if (value <= 0) continue
    const rank = rankOf(value, all.map((c) => c[key]))
    if (rank === 1) {
      feats.push({ id: `team-record-${label}`, category: 'record', priority: 90, allTime: true, title: `All-time record: most ${label}`, detail: `${value} ${label}`, value })
    } else if (rank <= TOP_RANK_BADGE) {
      feats.push({ id: `team-rank-${label}`, category: 'record', priority: 60, title: `P${rank} all-time in ${label}`, detail: `${value} ${label}`, value })
    }
  }

  // Single-season team records held
  for (const spec of [
    { metric: 'wins' as const, noun: 'wins' },
    { metric: 'points' as const, noun: 'points' },
  ]) {
    const topSeason = tallies.reduce<TeamSeasonTally | null>(
      (b, t) => (b == null || t[spec.metric] > b[spec.metric] ? t : b), null,
    )
    if (topSeason && topSeason.teamId === teamId && topSeason[spec.metric] > 0) {
      feats.push({
        id: `team-season-record-${spec.metric}`, category: 'record', priority: 80, allTime: true,
        title: `Most ${spec.noun} in a season`, detail: `${topSeason[spec.metric]} in ${topSeason.year}`,
        value: topSeason[spec.metric], year: topSeason.year,
      })
    }
  }

  return feats.sort((a, b) => b.priority - a.priority)
}

// --- Headless newsroom API (not yet wired to UI; ready for M5) ---

// Season-level records and landmarks for one archived season.
export function detectSeasonFeats(seasonId: number): Feat[] {
  const tallies = getAllDriverSeasonTallies()
  const season = tallies.filter((t) => t.seasonId === seasonId)
  if (season.length === 0) return []
  const year = season[0].year
  const rounds = getRacesForSeason(seasonId).length
  const feats: Feat[] = []

  const topWinner = season.reduce((b, t) => (t.wins > b.wins ? t : b), season[0])
  if (topWinner.wins > 0) {
    const allTimeMax = Math.max(...tallies.map((t) => t.wins))
    feats.push({
      id: `season-${year}-top-winner`, category: 'season', year,
      priority: topWinner.wins === allTimeMax ? 85 : 60, allTime: topWinner.wins === allTimeMax,
      title: `${topWinner.driverName}: ${topWinner.wins} wins in ${year}`, value: topWinner.wins,
    })
    if (rounds > 0 && topWinner.wins === rounds) {
      feats.push({
        id: `season-${year}-perfect`, category: 'record', year, priority: 99, allTime: true,
        title: `Perfect season — ${topWinner.driverName} won every race`, value: rounds,
      })
    }
  }

  // Whitewash: one team won every round.
  const teamSeason = getAllTeamSeasonTallies().filter((t) => t.seasonId === seasonId)
  const topTeam = teamSeason.reduce<TeamSeasonTally | null>((b, t) => (b == null || t.wins > b.wins ? t : b), null)
  if (topTeam && rounds > 0 && topTeam.wins === rounds) {
    feats.push({
      id: `season-${year}-whitewash`, category: 'constructor', year, priority: 95, allTime: true,
      title: `${topTeam.teamName} won all ${rounds} races in ${year}`, value: rounds,
    })
  }

  return feats.sort((a, b) => b.priority - a.priority)
}

// Self-contained feats from a single archived race (no cross-race history needed).
export function detectRaceFeats(seasonId: number, round: number): Feat[] {
  const race = getRaceInSeasonByRound(seasonId, round)
  if (!race) return []
  const rows = getResultsForRace(race.id)
  if (rows.length === 0) return []
  const feats: Feat[] = []
  const at = (pos: number) => rows.find((r) => !r.dnf && r.finish_position === pos)
  const winner = at(1)
  const second = at(2)
  const third = at(3)

  // Pole-to-win
  if (winner && winner.grid_position === 1) {
    feats.push({ id: `race-${race.id}-pole-win`, category: 'race', round, priority: 50, title: `${winner.driver_name} converted pole to victory at ${race.circuit_name}` })
  }

  // Victory margin (needs classified P1 + P2 with total times)
  if (winner?.total_time_ms != null && second?.total_time_ms != null) {
    const marginS = (second.total_time_ms - winner.total_time_ms) / 1000
    if (marginS > DOMINANT_MARGIN_S)
      feats.push({ id: `race-${race.id}-dominant`, category: 'race', round, priority: 60, title: `Dominant win — ${winner.driver_name} by ${marginS.toFixed(1)}s`, value: marginS })
    else if (marginS >= 0 && marginS < PHOTO_FINISH_S)
      feats.push({ id: `race-${race.id}-photo`, category: 'race', round, priority: 65, title: `Photo finish — ${winner.driver_name} by ${marginS.toFixed(3)}s`, value: marginS })
  }

  // Constructor 1-2 + front-row lockout + double podium
  if (winner && second && winner.team_id === second.team_id)
    feats.push({ id: `race-${race.id}-one-two`, category: 'constructor', round, priority: 70, title: `${winner.team_name} 1-2 finish` })
  const frontRow = rows.filter((r) => r.grid_position <= 2)
  if (frontRow.length === 2 && frontRow[0].team_id === frontRow[1].team_id)
    feats.push({ id: `race-${race.id}-lockout`, category: 'constructor', round, priority: 55, title: `${frontRow[0].team_name} front-row lockout` })
  if (winner && second && third) {
    const podiumTeams = [winner, second, third].map((r) => r.team_id)
    const dbl = podiumTeams.find((t) => podiumTeams.filter((x) => x === t).length === 2)
    if (dbl && !(winner.team_id === second.team_id)) // a 1-2 already covers the top two
      feats.push({ id: `race-${race.id}-double-podium`, category: 'constructor', round, priority: 50, title: `${[winner, second, third].find((r) => r.team_id === dbl)!.team_name} double podium` })
  }

  // Comeback drive (most places gained / win from deep)
  const finishers = rows.filter((r) => !r.dnf && r.finish_position != null)
  const gains = finishers.map((r) => ({ r, gain: r.grid_position - (r.finish_position as number) }))
  const bestGain = gains.reduce<{ r: typeof rows[number]; gain: number } | null>((b, g) => (b == null || g.gain > b.gain ? g : b), null)
  if (bestGain && bestGain.gain >= COMEBACK_GAIN)
    feats.push({ id: `race-${race.id}-comeback`, category: 'race', round, priority: 60, title: `${bestGain.r.driver_name} climbed ${bestGain.gain} places (P${bestGain.r.grid_position}→P${bestGain.r.finish_position})`, value: bestGain.gain })

  // Race of attrition
  const dnfs = rows.filter((r) => r.dnf).length
  if (rows.length > 0 && dnfs / rows.length >= ATTRITION_FRACTION)
    feats.push({ id: `race-${race.id}-attrition`, category: 'race', round, priority: 55, title: `Race of attrition — ${dnfs} of ${rows.length} retired`, value: dnfs })

  return feats.sort((a, b) => b.priority - a.priority)
}
