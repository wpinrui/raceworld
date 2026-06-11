import type { Driver, Team, DevUpgradeEvent, MarketMove, DroppedDriver, DriverProgressionEvent, ConstructorSeasonRecord, PendingGridChanges, TeamMediaScore } from '@/lib/sim/types'
import type { DraftPick, DraftSeat } from '@/lib/sim/driver-market'
import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate } from '@/lib/sim/calendar-dates'
import { shownStats } from '@/lib/sim/progression'
import { generateRookie } from '@/lib/sim/market'

// The game clock starts on 1 January of the season year — a pre-season window (launches,
// testing) ahead of the opening round. Stored as a serialisable 'YYYY-MM-DD' string.
export const seasonStartDate = (year: number) => `${year}-01-01`
// Race day (ISO date string) for a 1-based round in a given season year.
export const roundDate = (year: number, round: number): string => {
  const c = calendarForYear(year)[round - 1]
  return c ? toISODate(raceDate(year, c)) : seasonStartDate(year)
}

export type StatSnapshot = Record<string, { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }>

// One sampled point on a driver's in-progress-season attribute timeline. round 0 = season
// start; rounds 1..N = post-race. Past seasons live in the DB; this carries only the
// current (unarchived) season, which the DB career query excludes.
export type StatPoint = { round: number; pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }
export type StatHistory = Record<string, StatPoint[]>

// Snapshot the four SHOWN stats (true + season form, #66) of every grid driver, keyed by id — the
// ratings timeline is what the player saw, so it carries the form wobble.
export function snapshotStats(drivers: Driver[]): StatSnapshot {
  const snap: StatSnapshot = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    const s = shownStats(d)
    snap[d.id] = {
      pace: s.pace,
      wetWeatherPace: s.wetWeatherPace,
      overtaking: s.overtaking,
      smoothness: s.smoothness,
    }
  }
  return snap
}

// Seed the per-race stat history with a round-0 baseline (shown stats) for every grid driver.
export function seedStatHistory(drivers: Driver[]): StatHistory {
  const hist: StatHistory = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    const s = shownStats(d)
    hist[d.id] = [{ round: 0, pace: s.pace, wetWeatherPace: s.wetWeatherPace, overtaking: s.overtaking, smoothness: s.smoothness }]
  }
  return hist
}

// Append a post-race point (shown stats) for each grid driver at the given round.
export function appendStatHistory(prev: StatHistory, drivers: Driver[], round: number): StatHistory {
  const next: StatHistory = { ...prev }
  for (const d of drivers) {
    if (d.teamId === '') continue
    const s = shownStats(d)
    const point: StatPoint = { round, pace: s.pace, wetWeatherPace: s.wetWeatherPace, overtaking: s.overtaking, smoothness: s.smoothness }
    const series = (next[d.id] ?? []).filter((p) => p.round !== round)
    next[d.id] = [...series, point]
  }
  return next
}

// Per-round snapshot of every car's pace, for the home Car Development chart. Round 0 = season start;
// one entry is appended per completed round. A god-mode pace edit refreshes the latest (current) entry,
// so the chart stays accurate without reconstructing from the upgrade log (which can't see edits).
export interface CarPaceSnapshot { round: number; paces: Record<string, number> }

export function snapshotCarPaces(teams: Team[]): Record<string, number> {
  const paces: Record<string, number> = {}
  for (const t of teams) paces[t.id] = t.carPace
  return paces
}

// One-time backfill for saves that predate carPaceHistory: rebuild it from the current pace minus the
// upgrades delivered after each round (best-effort; can't see past god-mode edits, which weren't logged).
export function reconstructCarPaceHistory(teams: Team[], events: DevUpgradeEvent[], completedRounds: number): CarPaceSnapshot[] {
  const out: CarPaceSnapshot[] = []
  for (let r = 0; r <= completedRounds; r++) {
    const paces: Record<string, number> = {}
    for (const t of teams) {
      const future = events.reduce((s, e) => (e.teamId === t.id && e.round > r ? s + e.paceDelta : s), 0)
      paces[t.id] = Math.round((t.carPace - future) * 10) / 10
    }
    out.push({ round: r, paces })
  }
  return out
}

// Turn an ordered set of draft picks (one per seat, in seat order) into next-season state: market moves,
// the updated grid (winners seated, the unpicked freed), rookies for any seat the pool couldn't fill, and
// the dropped (had a seat, signed nowhere) list. Shared by the auto-draft and the Team Manager player draft.
export function resolveDraft(
  picks: DraftPick[], allDrivers: Driver[], stayingIds: Set<string>, seats: DraftSeat[],
  mediaMap: Map<string, number>, teams: Team[], year: number, newYear: number,
): { marketMoves: MarketMove[]; updatedDrivers: Driver[]; droppedDrivers: DroppedDriver[] } {
  const pickById = new Map(picks.map((p) => [p.driverId, p]))
  const prevTeam = new Map(allDrivers.map((d) => [d.id, d.teamId]))
  const teamNameOf = new Map(teams.map((t) => [t.id, t.name]))
  const marketMoves: MarketMove[] = picks.map((p) => ({
    driverId: p.driverId, driverName: p.driverName,
    fromTeamId: prevTeam.get(p.driverId) || null,
    toTeamId: p.teamId, toTeamName: p.teamName,
    contractLength: p.years, contractExpiresAfterSeason: year + p.years,
    mediaScore: mediaMap.get(p.driverId) ?? 0,
    isResignation: prevTeam.get(p.driverId) === p.teamId,
  }))
  const updatedDrivers: Driver[] = allDrivers.map((d) => {
    const p = pickById.get(d.id)
    if (p) return { ...d, teamId: p.teamId, contractExpiresAfterSeason: year + p.years, seasonsSinceF1Seat: 0 }
    if (stayingIds.has(d.id)) return d
    return { ...d, teamId: '' }
  })
  for (let i = picks.length; i < seats.length; i++) {
    const seat = seats[i]
    const rookie = generateRookie(seat.teamId, newYear, Math.random)
    updatedDrivers.push(rookie)
    marketMoves.push({ driverId: rookie.id, driverName: rookie.name, fromTeamId: null, toTeamId: seat.teamId, toTeamName: seat.teamName, contractLength: 1, contractExpiresAfterSeason: newYear, mediaScore: 0, isResignation: false })
  }
  const droppedDrivers: DroppedDriver[] = allDrivers
    .filter((d) => !pickById.has(d.id) && !stayingIds.has(d.id) && (prevTeam.get(d.id) || '') !== '')
    .map((d) => ({ driverId: d.id, driverName: d.name, fromTeamId: prevTeam.get(d.id)!, fromTeamName: teamNameOf.get(prevTeam.get(d.id)!) ?? prevTeam.get(d.id)!, mediaScore: mediaMap.get(d.id) ?? 0 }))
  return { marketMoves, updatedDrivers, droppedDrivers }
}

// Net development this season = current shown stats vs the season-start snapshot (the actual
// improvement/decline already happened race-by-race). One event per stat that moved >= 0.05.
export function computeProgressionEvents(drivers: Driver[], seasonStartStats: StatSnapshot): DriverProgressionEvent[] {
  const progressionEvents: DriverProgressionEvent[] = []
  for (const d of drivers) {
    const start = seasonStartStats[d.id]
    if (!start) continue
    for (const stat of ['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const) {
      if (Math.abs(d[stat] - start[stat]) >= 0.05) {
        progressionEvents.push({
          driverId: d.id, driverName: d.name, stat,
          before: start[stat], after: d[stat],
          direction: d[stat] > start[stat] ? 'improved' : 'declined',
        })
      }
    }
  }
  return progressionEvents
}

// Prepend this season's constructor results to the history, de-dupe by (year, team) keeping the
// newest, and cap at 55 seasons.
export function updateConstructorHistory(
  year: number,
  constructorRankInfo: { teamId: string; points: number; finalPosition: number }[],
  constructorHistory: ConstructorSeasonRecord[],
): ConstructorSeasonRecord[] {
  const newHistoryEntries: ConstructorSeasonRecord[] = constructorRankInfo.map((cs) => ({
    seasonYear: year,
    teamId: cs.teamId,
    finalPosition: cs.finalPosition,
    points: cs.points,
  }))
  return [
    ...newHistoryEntries,
    ...constructorHistory,
  ]
    .filter(
      (r, idx, arr) =>
        arr.findIndex((x) => x.seasonYear === r.seasonYear && x.teamId === r.teamId) === idx,
    )
    .slice(0, 55)
}

// Real-world transitions approved at THIS season's start, taking effect on next year's grid.
export type ApprovedSeasonChanges = {
  joins: { id: string; name: string; shortName: string; nationality: string; color: string }[]
  leaves: string[]
  rebrands: { id: string; name: string; shortName: string; color: string; nationality: string }[]
}

// Build next season's grid from the just-finished one, applying (in order) god-mode grid changes,
// approved real-world transitions, and the Team Manager inaugural pace rule. Pure: the current season
// has already played out under the old grid, so every change takes effect from next season. Returns the
// new teams + drivers and the team media scores augmented with the zero-score entries for new teams.
export function applyGridTransition(input: {
  teams: Team[]
  drivers: Driver[]           // already aged for next season
  year: number
  pendingGridChanges: PendingGridChanges
  approvedSeasonChanges: ApprovedSeasonChanges | null
  teamManagerMode: boolean
  playerTeamId: string | null
  teamMediaScores: TeamMediaScore[]
}): { nextTeams: Team[]; nextDrivers: Driver[]; teamMediaScores: TeamMediaScore[] } {
  const { year, pendingGridChanges, approvedSeasonChanges, teamManagerMode, playerTeamId } = input
  // God-mode grid changes (GDD §Grid Changes): departing teams leave and their drivers re-enter the
  // market as free agents; new teams join at the lowest car pace, with empty seats the market then
  // fills during contract negotiations.
  let nextTeams = input.teams
  let nextDrivers = input.drivers
  let teamMediaScores = input.teamMediaScores
  const { additions, removals } = pendingGridChanges
  if (removals.length > 0) {
    nextTeams = nextTeams.filter((t) => !removals.includes(t.id))
    nextDrivers = nextDrivers.map((d) =>
      removals.includes(d.teamId) ? { ...d, teamId: '', seasonsSinceF1Seat: 0 } : d,
    )
  }
  if (additions.length > 0) {
    const lowestPace = Math.min(75, ...nextTeams.map((t) => t.carPace))
    const added = additions.map((t, i) => ({
      ...t,
      carPace: Math.max(5, lowestPace - 5 * (i + 1)),
    }))
    nextTeams = [...nextTeams, ...added]
    // A brand-new team has no results — it's the LEAST attractive seat on the grid,
    // not the mid-pack default. Otherwise the market poaches top drivers into it.
    teamMediaScores = [...teamMediaScores, ...added.map((t) => ({ teamId: t.id, score: 0 }))]
  }

  // Real-world transitions APPROVED at the start of this season (and already announced mid-season by
  // the newsroom) now take effect on next year's grid. Applying them here, before the end-of-season
  // market runs, means seats are filled against the confirmed roster.
  if (approvedSeasonChanges) {
    const leaveIds = new Set(approvedSeasonChanges.leaves)
    nextTeams = nextTeams.filter((t) => !leaveIds.has(t.id))
    nextDrivers = nextDrivers.map((d) =>
      leaveIds.has(d.teamId) ? { ...d, teamId: '', contractExpiresAfterSeason: year, seasonsSinceF1Seat: 0 } : d,
    )
    const rebrandById = new Map(approvedSeasonChanges.rebrands.map((r) => [r.id, r]))
    nextTeams = nextTeams.map((t) => {
      const r = rebrandById.get(t.id)
      return r ? { ...t, name: r.name, shortName: r.shortName, color: r.color, nationality: r.nationality } : t
    })
    const lowest = nextTeams.reduce((m, t) => Math.min(m, t.carPace), 75)
    approvedSeasonChanges.joins.forEach((j, i) => {
      if (nextTeams.some((t) => t.id === j.id)) return
      nextTeams = [...nextTeams, { id: j.id, name: j.name, shortName: j.shortName, nationality: j.nationality, color: j.color, carPace: Math.max(5, lowest - 5 * (i + 1)) }]
      teamMediaScores = [...teamMediaScores, { teamId: j.id, score: 0 }]
    })
  }

  // Team Manager: a brand-new player team enters as the strictly slowest car on the grid (exempt from
  // the historical pace assignment), and stays slowest even if real-world teams join the same year.
  // Only on its inaugural rollover (when it's actually among the additions); after that it develops.
  if (teamManagerMode && playerTeamId && additions.some((t) => t.id === playerTeamId)) {
    const slowestOther = nextTeams.reduce((m, t) => (t.id === playerTeamId ? m : Math.min(m, t.carPace)), 75)
    nextTeams = nextTeams.map((t) => (t.id === playerTeamId ? { ...t, carPace: Math.max(1, slowestOther - 5) } : t))
  }
  return { nextTeams, nextDrivers, teamMediaScores }
}
