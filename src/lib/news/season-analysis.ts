import type { NewsContext } from './engine'
import { overall } from '@/lib/sim/progression'

// Season-long analysis layer (#88). One pass over the NewsContext produces the reusable facts the
// narrative producers (season preview, championship arc, race-report coda, expectation-vs-actual,
// season review, tier coverage) all draw on, so each reads aggregated state rather than a point-in-time
// snapshot. PURE and side-effect free: same context in, same analysis out.
//
// Grounding rule (see memory): every figure here is an in-game aggregated stat. Copy may add texture,
// but the numbers it cites must come from this module.

export type Tier = 'front' | 'midfield' | 'backmarker'

// Expectation basis (the issue leaves this to the implementer): start-of-season CAR PACE is the primary
// signal — it dominates results and is the thing that actually shifts over a season (via upgrades) — with
// driver overall as a secondary splitter between a team's two cars and near tier boundaries. Anchored to
// round-0 pace when available (ctx.seasonStartCarPace), else current pace (identical at round 0).
const DRIVER_WEIGHT = 0.3 // how much driver quality nudges the car-derived expectation (tunable; calibrate vs simmed seasons)
const DRIVER_BASE = 78 // ~midfield-driver overall; the pivot so an average driver neither lifts nor drags the car

export interface DriverExpectation {
  driverId: string
  teamId: string
  score: number // blended expectation score (higher = expected to finish higher)
  expectedRank: number // 1 = expected best in the drivers' table (seated drivers only)
  tier: Tier
}

export interface TeamExpectation {
  teamId: string
  startPace: number
  expectedRank: number // 1 = expected best constructor
  tier: Tier
}

// A points gap between the championship leader and second place after a given round.
export interface GapPoint {
  round: number
  leaderId: string
  secondId: string | null
  gap: number // leader points − P2 points (>= 0)
}

export interface TitleTrajectory {
  series: GapPoint[] // one entry per completed round
  currentLeaderId: string | null
  currentGap: number
  leadChanges: number // how many times the round-by-round leader changed
  wireToWire: boolean // same leader every completed round (needs >= 2 rounds)
  peakGap: number // largest lead any leader has held this season
  recentSlope: number // gap change over the trailing window (negative = the lead is closing)
}

// Expectation vs actual for one entity. delta > 0 means finishing BETTER than expected.
export interface PerfDelta {
  id: string
  expectedRank: number
  actualRank: number
  delta: number
}

export interface SeasonAnalysis {
  year: number
  completedRounds: number
  totalRounds: number
  driverExpectations: Map<string, DriverExpectation>
  teamExpectations: Map<string, TeamExpectation>
  tiers: { front: string[]; midfield: string[]; backmarker: string[] } // teamIds by expected tier
  driverTitle: TitleTrajectory
  constructorTitle: TitleTrajectory
  driverDeltas: PerfDelta[] // seated drivers, sorted by |delta| desc (biggest over/under-performers first)
  teamDeltas: PerfDelta[]
}

// ----- standings reducers (mirror engine.ts's driver/constructorStandingsAfter; kept local so this
// module stays decoupled. TODO unify into a shared standings module when producers are wired). -----

interface PointRow {
  id: string
  points: number
  wins: number
}

function driverPointsAfter(ctx: NewsContext, round: number): PointRow[] {
  const map = new Map<string, PointRow>()
  for (let r = 0; r < round && r < ctx.raceResults.length; r++) {
    for (const res of ctx.raceResults[r] ?? []) {
      let s = map.get(res.driverId)
      if (!s) { s = { id: res.driverId, points: 0, wins: 0 }; map.set(res.driverId, s) }
      s.points += res.points
      if (res.finishPosition === 1) s.wins++
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins)
}

function teamPointsAfter(ctx: NewsContext, round: number): PointRow[] {
  const map = new Map<string, PointRow>()
  for (let r = 0; r < round && r < ctx.raceResults.length; r++) {
    for (const res of ctx.raceResults[r] ?? []) {
      let s = map.get(res.teamId)
      if (!s) { s = { id: res.teamId, points: 0, wins: 0 }; map.set(res.teamId, s) }
      s.points += res.points
      if (res.finishPosition === 1) s.wins++
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins)
}

function tierOf(rank: number, total: number): Tier {
  if (rank <= Math.max(2, total / 3)) return 'front'
  if (rank <= (2 * total) / 3) return 'midfield'
  return 'backmarker'
}

function buildTrajectory(pointsAfter: (round: number) => PointRow[], completedRounds: number): TitleTrajectory {
  const series: GapPoint[] = []
  let leadChanges = 0
  let prevLeader: string | null = null
  let peakGap = 0
  for (let r = 1; r <= completedRounds; r++) {
    const rows = pointsAfter(r)
    if (rows.length === 0) continue
    const leader = rows[0]
    const second = rows[1] ?? null
    const gap = second ? leader.points - second.points : leader.points
    series.push({ round: r, leaderId: leader.id, secondId: second?.id ?? null, gap })
    if (prevLeader !== null && leader.id !== prevLeader) leadChanges++
    prevLeader = leader.id
    if (gap > peakGap) peakGap = gap
  }
  const last = series[series.length - 1] ?? null
  // Trailing window: gap now vs up to 4 rounds ago (negative slope = the lead is being eroded).
  const window = Math.min(4, series.length - 1)
  const recentSlope = window > 0 ? last!.gap - series[series.length - 1 - window].gap : 0
  const wireToWire = series.length >= 2 && leadChanges === 0
  return {
    series,
    currentLeaderId: last?.leaderId ?? null,
    currentGap: last?.gap ?? 0,
    leadChanges,
    wireToWire,
    peakGap,
    recentSlope,
  }
}

export function buildSeasonAnalysis(ctx: NewsContext): SeasonAnalysis {
  const totalRounds = ctx.calendar.length
  const completedRounds = ctx.completedRounds
  const seated = ctx.drivers.filter((d) => d.teamId !== '')
  const teams = ctx.teams
  const totalTeams = teams.length || 1

  // --- team expectations from start-of-season pace ---
  const startPaceOf = (teamId: string): number =>
    ctx.seasonStartCarPace?.[teamId] ?? teams.find((t) => t.id === teamId)?.carPace ?? 0
  const teamsByPace = [...teams].sort((a, b) => startPaceOf(b.id) - startPaceOf(a.id))
  const teamExpectations = new Map<string, TeamExpectation>()
  const tiers = { front: [] as string[], midfield: [] as string[], backmarker: [] as string[] }
  teamsByPace.forEach((t, i) => {
    const rank = i + 1
    const tier = tierOf(rank, totalTeams)
    teamExpectations.set(t.id, { teamId: t.id, startPace: startPaceOf(t.id), expectedRank: rank, tier })
    tiers[tier].push(t.id)
  })

  // --- driver expectations: car pace primary, driver overall a secondary splitter ---
  const scored = seated.map((d) => ({
    driverId: d.id,
    teamId: d.teamId,
    score: startPaceOf(d.teamId) + DRIVER_WEIGHT * (overall(d) - DRIVER_BASE),
  }))
  scored.sort((a, b) => b.score - a.score)
  const driverExpectations = new Map<string, DriverExpectation>()
  scored.forEach((s, i) => {
    driverExpectations.set(s.driverId, {
      driverId: s.driverId,
      teamId: s.teamId,
      score: s.score,
      expectedRank: i + 1,
      tier: teamExpectations.get(s.teamId)?.tier ?? 'midfield',
    })
  })

  // --- championship trajectories ---
  const driverTitle = buildTrajectory((r) => driverPointsAfter(ctx, r), completedRounds)
  const constructorTitle = buildTrajectory((r) => teamPointsAfter(ctx, r), completedRounds)

  // --- expectation vs actual (only meaningful once racing has started) ---
  const driverActual = driverPointsAfter(ctx, completedRounds)
  const driverActualRank = new Map(driverActual.map((row, i) => [row.id, i + 1]))
  const lastDriverRank = scored.length // unraced/not-yet-scored drivers sort to the back
  const driverDeltas: PerfDelta[] = scored.map((s) => {
    const expectedRank = driverExpectations.get(s.driverId)!.expectedRank
    const actualRank = driverActualRank.get(s.driverId) ?? lastDriverRank
    return { id: s.driverId, expectedRank, actualRank, delta: expectedRank - actualRank }
  })
  driverDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const teamActual = teamPointsAfter(ctx, completedRounds)
  const teamActualRank = new Map(teamActual.map((row, i) => [row.id, i + 1]))
  const teamDeltas: PerfDelta[] = teamsByPace.map((t) => {
    const expectedRank = teamExpectations.get(t.id)!.expectedRank
    const actualRank = teamActualRank.get(t.id) ?? totalTeams
    return { id: t.id, expectedRank, actualRank, delta: expectedRank - actualRank }
  })
  teamDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    year: ctx.year,
    completedRounds,
    totalRounds,
    driverExpectations,
    teamExpectations,
    tiers,
    driverTitle,
    constructorTitle,
    driverDeltas,
    teamDeltas,
  }
}
