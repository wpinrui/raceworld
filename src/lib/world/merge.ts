// Pure client-side merge of DB-only career DTOs with the live (current, unarchived)
// season from the Zustand store. DB aggregates exclude the active season, so the
// live slice is additive — no double counting.

import type { Driver, Team, DriverStanding, ConstructorStanding, RaceResult, Circuit } from '@/lib/sim/types'
import type { StatPoint } from '@/lib/store/season-store'
import { overall } from '@/lib/sim/progression'
import type { Feat } from '@/lib/stats/types'
import type { DriverCareer, TeamCareer, CareerSeason, DriverAttributes, DriverCurrentResult, TeamSeason, SeasonChampionRow, RatingsPoint } from './types'

export interface LiveStore {
  year: number
  drivers: Driver[]
  teams: Team[]
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
  raceResults: RaceResult[][]
  calendar: Circuit[]
  statHistory: Record<string, StatPoint[]>
}

// The current (unarchived) season's attribute timeline from the live store.
function liveRatingsHistory(driverId: string, year: number, statHistory: Record<string, StatPoint[]>): RatingsPoint[] {
  const series = statHistory[driverId] ?? []
  return [...series]
    .sort((a, b) => a.round - b.round)
    .map((p) => ({
      year, round: p.round,
      pace: p.pace, wetWeatherPace: p.wetWeatherPace, overtaking: p.overtaking, smoothness: p.smoothness,
      overall: Math.round(overall(p)),
    }))
}

function driverAttributes(d: Driver, teams: Team[]): DriverAttributes {
  const team = teams.find((t) => t.id === d.teamId)
  return {
    pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness,
    overall: Math.round(overall(d)),
    age: d.age, primeEnd: d.primeEnd, nationality: d.nationality,
    teamId: d.teamId, teamName: team?.name ?? 'Free Agent',
    contractExpiresAfterSeason: d.contractExpiresAfterSeason,
    isFreeAgent: d.teamId === '',
  }
}

function liveDriverAgg(driverId: string, raceResults: RaceResult[][]) {
  let races = 0, wins = 0, podiums = 0, points = 0, poles = 0
  for (const round of raceResults) {
    const r = round.find((x) => x.driverId === driverId)
    if (!r) continue
    races++
    points += r.points
    if (r.gridPosition === 1) poles++
    if (!r.dnf && r.finishPosition != null) {
      if (r.finishPosition === 1) wins++
      if (r.finishPosition <= 3) podiums++
    }
  }
  return { races, wins, podiums, points, poles }
}

function liveDriverResults(driverId: string, raceResults: RaceResult[][], calendar: Circuit[]): DriverCurrentResult[] {
  const out: DriverCurrentResult[] = []
  raceResults.forEach((round, i) => {
    const r = round.find((x) => x.driverId === driverId)
    if (!r) return
    out.push({
      round: i + 1,
      circuitName: calendar[i]?.name ?? `Round ${i + 1}`,
      finishPosition: r.dnf ? null : r.finishPosition,
      points: r.points,
      dnf: r.dnf,
    })
  })
  return out
}

// A title counts the moment it's mathematically secured (or the season has ended),
// not only once the season is archived. Max points a rival can still take: 25/race for
// a driver, 25+18=43/race for a constructor (both cars).
const DRIVER_MAX_PER_RACE = 25
const CONSTRUCTOR_MAX_PER_RACE = 43

export function clinchedDriverChampion(store: LiveStore): string | null {
  const ds = store.driverStandings
  if (ds.length === 0 || store.raceResults.length === 0) return null
  const remaining = store.calendar.length - store.raceResults.length
  if (remaining <= 0) return ds[0].driverId // season over — the leader is champion
  const gap = ds[0].points - (ds[1]?.points ?? 0)
  return gap > remaining * DRIVER_MAX_PER_RACE ? ds[0].driverId : null
}

export function clinchedConstructorChampion(store: LiveStore): string | null {
  const cs = store.constructorStandings
  if (cs.length === 0 || store.raceResults.length === 0) return null
  const remaining = store.calendar.length - store.raceResults.length
  if (remaining <= 0) return cs[0].teamId
  const gap = cs[0].points - (cs[1]?.points ?? 0)
  return gap > remaining * CONSTRUCTOR_MAX_PER_RACE ? cs[0].teamId : null
}

export function mergeDriverCareer(db: DriverCareer, store: LiveStore): DriverCareer {
  const live = store.drivers.find((d) => d.id === db.driverId)
  if (!live) return db // historical-only driver, no live data

  const racing = live.teamId !== ''
  const agg = liveDriverAgg(db.driverId, store.raceResults)
  const team = store.teams.find((t) => t.id === live.teamId)
  const champPos = store.driverStandings.findIndex((s) => s.driverId === db.driverId)

  // Only the rounds actually run so far — future rounds stay blank, not shown as DNFs.
  const liveResults = (store.driverStandings.find((s) => s.driverId === db.driverId)?.results ?? [])
    .slice(0, store.raceResults.length)
  const liveSeason: CareerSeason | null = racing
    ? {
        year: store.year, teamId: live.teamId, teamName: team?.name ?? live.teamId,
        races: agg.races, wins: agg.wins, podiums: agg.podiums, points: agg.points,
        championshipFinish: champPos >= 0 ? champPos + 1 : null,
        results: liveResults,
        inProgress: true,
      }
    : null

  return {
    driverId: db.driverId,
    driverName: live.name,
    totals: {
      races: db.totals.races + agg.races,
      wins: db.totals.wins + agg.wins,
      podiums: db.totals.podiums + agg.podiums,
      points: db.totals.points + agg.points,
      poles: db.totals.poles + agg.poles,
      titles: db.totals.titles + (clinchedDriverChampion(store) === db.driverId ? 1 : 0),
      seasons: db.totals.seasons + (racing ? 1 : 0),
    },
    seasons: liveSeason ? [liveSeason, ...db.seasons] : db.seasons,
    ratingsHistory: racing
      ? [...db.ratingsHistory, ...liveRatingsHistory(db.driverId, store.year, store.statHistory)]
      : db.ratingsHistory,
    attributes: driverAttributes(live, store.teams),
    currentResults: racing ? liveDriverResults(db.driverId, store.raceResults, store.calendar) : null,
  }
}

export function mergeTeamCareer(db: TeamCareer, store: LiveStore): TeamCareer {
  const live = store.teams.find((t) => t.id === db.teamId)
  if (!live) return db // historical-only team

  const squad = store.drivers.filter((d) => d.teamId === live.id)
  let races = 0, wins = 0, podiums = 0, points = 0
  for (const round of store.raceResults) {
    for (const r of round) {
      if (r.teamId !== live.id) continue
      races++
      points += r.points
      if (!r.dnf && r.finishPosition != null) {
        if (r.finishPosition === 1) wins++
        if (r.finishPosition <= 3) podiums++
      }
    }
  }
  const ci = store.constructorStandings.findIndex((s) => s.teamId === live.id)

  const liveSeason: TeamSeason = {
    year: store.year, finalPosition: null, points,
    wins, podiums,
    drivers: squad.map((d) => ({ driverId: d.id, driverName: d.name })),
    inProgress: true,
  }

  const titleClinched = clinchedConstructorChampion(store) === db.teamId

  return {
    teamId: db.teamId,
    teamName: live.name,
    honours: titleClinched
      ? {
          constructorTitles: db.honours.constructorTitles + 1,
          titleYears: [store.year, ...db.honours.titleYears],
          bestFinish: 1,
        }
      : db.honours,
    totals: {
      races: db.totals.races + races, wins: db.totals.wins + wins,
      podiums: db.totals.podiums + podiums, points: db.totals.points + points,
      seasons: db.totals.seasons + 1,
    },
    seasons: [liveSeason, ...db.seasons],
    currentSquad: squad.map((d) => ({ driverId: d.id, driverName: d.name, overall: Math.round(overall(d)) })),
    teamColor: live.color,
    carPace: live.carPace,
    currentPosition: ci >= 0 ? ci + 1 : null,
  }
}

// Fold a live-clinched current-season title into the DB honours feats, so the Honours
// panel reflects it before the season is archived (matching the career-totals merge).
export function augmentHonoursWithLiveTitle(feats: Feat[], kind: 'driver' | 'team', id: string, store: LiveStore): Feat[] {
  const champ = kind === 'driver' ? clinchedDriverChampion(store) : clinchedConstructorChampion(store)
  if (champ !== id) return feats
  const featId = kind === 'driver' ? 'driver-titles' : 'team-titles'
  const label = kind === 'driver' ? 'World Champion' : "Constructors' Champion"
  const existing = feats.find((f) => f.id === featId)
  if (existing) {
    const years = (existing.detail ?? '').split(' · ').map(Number).filter((n) => !Number.isNaN(n))
    if (years.includes(store.year)) return feats // already counted (e.g. archived)
    const merged = [...years, store.year].sort((a, b) => a - b)
    const updated: Feat = { ...existing, value: merged.length, title: `${merged.length}× ${label}`, detail: merged.join(' · ') }
    return feats.map((f) => (f.id === featId ? updated : f))
  }
  return [{ id: featId, category: 'title', priority: 100, title: `1× ${label}`, detail: `${store.year}`, value: 1 }, ...feats]
}

// A champions-roll row for the current season if a title is already clinched, so /world
// shows it before archiving. Returns null until at least one title is secured.
export function liveChampionRow(store: LiveStore): SeasonChampionRow | null {
  const dChamp = clinchedDriverChampion(store)
  const cChamp = clinchedConstructorChampion(store)
  if (!dChamp && !cChamp) return null
  const ds = store.driverStandings.find((s) => s.driverId === dChamp)
  const cs = store.constructorStandings.find((s) => s.teamId === cChamp)
  return {
    year: store.year,
    driverChampionId: dChamp,
    driverChampionName: ds?.driverName ?? null,
    driverChampionTeamId: ds?.teamId ?? null,
    constructorChampionId: cChamp,
    constructorChampionName: cs?.teamName ?? null,
  }
}
