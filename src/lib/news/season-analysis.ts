import type { NewsContext } from './engine'

// Season-long analysis layer (#88). One pass over the NewsContext produces the reusable facts the
// narrative producers (season preview, championship arc, race-report coda, expectation-vs-actual,
// season review, tier coverage) all draw on, so each reads aggregated state rather than a point-in-time
// snapshot. PURE and side-effect free: same context in, same analysis out.
//
// Grounding rule (see memory): every figure here is an in-game aggregated stat. Copy may add texture,
// but the numbers it cites must come from this module.

export type Tier = 'front' | 'midfield' | 'backmarker'

// Expectation basis (#88). The MEDIA's fallible preseason view, deliberately distinct from true car pace so
// teams/drivers can beat or miss it (that gap is the story engine):
//   - Car projection: anchored on LAST SEASON's constructors' finish (ctx.constructorHistory). New teams
//     project to the back; if there is no prior season at all (first year of a save), fall back to car pace.
//   - Driver projection: LAST SEASON's media score (ctx.priorDriverMediaScores); no prior data (rookies,
//     returnees) falls back to pace + narrative modifier — the shape media-scores.ts gives a free agent.
// Combination is CAR-DOMINANT: the car sets the tier and base grid slot (team's projected rank, two seats
// each, spanning the whole grid); the driver shifts that by a bounded swing in PLAIN POSITIONS — the better
// teammate takes the better seat and a standout edges ahead of the car just above, but no driver jumps tiers.
const DRIVER_POSITION_SWING = 4 // a ±2σ driver spans this many expected grid positions (≈ ±2 around the car's slot)
const PACE_PIVOT = 68 // pace that reads as neutral in the no-prior-data fallback (mirrors media-scores' free-agent pace term)

export interface DriverExpectation {
  driverId: string
  teamId: string
  score: number // combined car+driver position score (LOWER = stronger); expectedRank is this, ranked
  driverScore: number // raw driver projection (last-season media score, or pace+narrative fallback)
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

  // --- car projection: the media's preseason view, anchored on last season's constructors' finish ---
  const startPaceOf = (teamId: string): number =>
    ctx.seasonStartCarPace?.[teamId] ?? teams.find((t) => t.id === teamId)?.carPace ?? 0
  const hist = ctx.constructorHistory ?? []
  let teamOrder: string[] // teamIds, best-projected first
  if (hist.length === 0) {
    // First season of the save — no media history to project from; fall back to raw car pace.
    teamOrder = [...teams].sort((a, b) => startPaceOf(b.id) - startPaceOf(a.id)).map((t) => t.id)
  } else {
    const latestYear = Math.max(...hist.map((h) => h.seasonYear))
    const lastSeason = hist.filter((h) => h.seasonYear === latestYear)
    const finishByTeam = new Map(lastSeason.map((h) => [h.teamId, h.finalPosition]))
    // Established teams in last season's finishing order; teams with no prior record (newcomers) project to
    // the back, ordered among themselves by raw pace as a weak prior.
    const established = teams.filter((t) => finishByTeam.has(t.id)).sort((a, b) => finishByTeam.get(a.id)! - finishByTeam.get(b.id)!)
    const newcomers = teams.filter((t) => !finishByTeam.has(t.id)).sort((a, b) => startPaceOf(b.id) - startPaceOf(a.id))
    teamOrder = [...established, ...newcomers].map((t) => t.id)
  }
  const teamRankOf = new Map(teamOrder.map((id, i) => [id, i + 1]))
  const teamExpectations = new Map<string, TeamExpectation>()
  const tiers = { front: [] as string[], midfield: [] as string[], backmarker: [] as string[] }
  teamOrder.forEach((id, i) => {
    const rank = i + 1
    const tier = tierOf(rank, totalTeams)
    teamExpectations.set(id, { teamId: id, startPace: startPaceOf(id), expectedRank: rank, tier })
    tiers[tier].push(id)
  })

  // --- driver projection: last season's media score, else pace + narrative modifier ---
  const driverProj = (d: (typeof seated)[number]): number => {
    const prior = ctx.priorDriverMediaScores?.[d.id]
    if (prior != null) return prior
    return (d.pace - PACE_PIVOT) * 0.8 + (d.narrativeModifier ?? 0)
  }
  const projByDriver = new Map(seated.map((d) => [d.id, driverProj(d)]))
  const projVals = [...projByDriver.values()]
  const mean = projVals.length ? projVals.reduce((s, v) => s + v, 0) / projVals.length : 0
  const std = Math.sqrt(projVals.length ? projVals.reduce((s, v) => s + (v - mean) ** 2, 0) / projVals.length : 0)
  // Driver shift in plain positions: a z-score clamped to ±2σ maps to ±SWING/2 places (robust to outliers and
  // to ties, unlike min/max). Best projections lift toward the car just ahead; the car still sets the tier.
  const driverShift = (proj: number): number => {
    if (std === 0) return 0
    const z = Math.max(-2, Math.min(2, (proj - mean) / std))
    return -z * (DRIVER_POSITION_SWING / 4)
  }
  const combined = seated.map((d) => ({
    driverId: d.id,
    teamId: d.teamId,
    score: 2 * ((teamRankOf.get(d.teamId) ?? totalTeams) - 1) + driverShift(projByDriver.get(d.id)!),
  }))
  combined.sort((a, b) => a.score - b.score)
  const driverExpectations = new Map<string, DriverExpectation>()
  combined.forEach((s, i) => {
    driverExpectations.set(s.driverId, {
      driverId: s.driverId,
      teamId: s.teamId,
      score: s.score,
      driverScore: projByDriver.get(s.driverId) ?? 0,
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
  const lastDriverRank = combined.length // unraced/not-yet-scored drivers sort to the back
  const driverDeltas: PerfDelta[] = combined.map((s) => {
    const expectedRank = driverExpectations.get(s.driverId)!.expectedRank
    const actualRank = driverActualRank.get(s.driverId) ?? lastDriverRank
    return { id: s.driverId, expectedRank, actualRank, delta: expectedRank - actualRank }
  })
  driverDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  const teamActual = teamPointsAfter(ctx, completedRounds)
  const teamActualRank = new Map(teamActual.map((row, i) => [row.id, i + 1]))
  const teamDeltas: PerfDelta[] = teamOrder.map((id) => {
    const expectedRank = teamExpectations.get(id)!.expectedRank
    const actualRank = teamActualRank.get(id) ?? totalTeams
    return { id, expectedRank, actualRank, delta: expectedRank - actualRank }
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

// The season preview's cast (#88): who the media frames as this season's protagonists, across tiers.
// IDs only — copy decides the words. All derived from the expectation model, so the preview's claims are
// the same aggregated facts the season then confirms or subverts.
export interface PreviewCast {
  titleFavourites: string[] // driverIds — best-projected drivers in a front-tier car
  darkHorses: string[] // driverIds — a strongly-rated driver stuck in a non-front car
  bestOfRest: string[] // teamIds — top midfield projections
  rookies: string[] // driverIds — no prior F1 starts
  veterans: { driverId: string; kind: 'resurgent' | 'twilight' }[] // 35+, still up front vs slipped back
  newTeams: string[] // teamIds new to the grid this season
  reigningChampion?: string // driverId of last season's drivers' champion — must be credited even if a favourite
  reigningConstructor?: string // teamId of last season's constructors' champion
}

export function previewCast(ctx: NewsContext, analysis: SeasonAnalysis): PreviewCast {
  const seated = ctx.drivers.filter((d) => d.teamId !== '')
  const exp = analysis.driverExpectations
  const byRank = [...exp.values()].sort((a, b) => a.expectedRank - b.expectedRank)

  // Title favourites: the best-projected drivers in a front-tier car.
  const titleFavourites = byRank.filter((e) => e.tier === 'front').slice(0, 3).map((e) => e.driverId)

  // Dark horses: a top-of-the-field driver (personal projection) stuck in a non-front car.
  const byDriverScore = [...exp.values()].sort((a, b) => b.driverScore - a.driverScore)
  const eliteIds = new Set(byDriverScore.slice(0, Math.max(4, Math.round(seated.length / 4))).map((e) => e.driverId))
  const darkHorses = byDriverScore.filter((e) => eliteIds.has(e.driverId) && e.tier !== 'front').slice(0, 2).map((e) => e.driverId)

  // Best of the rest: the top midfield-projected teams.
  const bestOfRest = analysis.tiers.midfield
    .slice()
    .sort((a, b) => (analysis.teamExpectations.get(a)?.expectedRank ?? 99) - (analysis.teamExpectations.get(b)?.expectedRank ?? 99))
    .slice(0, 3)

  // Rookies: no prior F1 starts (careers when present; else a debut dated to this season).
  const isRookie = (d: (typeof seated)[number]): boolean => {
    const c = ctx.careers?.[d.id]
    return c ? (c.starts ?? 0) === 0 : d.debutYear === ctx.year
  }
  const rookies = byRank.map((e) => seated.find((x) => x.id === e.driverId)).filter((d): d is (typeof seated)[number] => !!d && isRookie(d)).slice(0, 3).map((d) => d.id)

  // Veterans: the grid's elder statesmen (35+), most-decorated first; resurgent if still front/midfield,
  // twilight if their projection has slipped to the back.
  const veterans = seated
    .filter((d) => d.age >= 35)
    .sort((a, b) => (ctx.careers?.[b.id]?.titles ?? 0) - (ctx.careers?.[a.id]?.titles ?? 0) || (ctx.careers?.[b.id]?.starts ?? 0) - (ctx.careers?.[a.id]?.starts ?? 0))
    .slice(0, 3)
    .map((d) => ({ driverId: d.id, kind: (exp.get(d.id)?.tier === 'backmarker' ? 'twilight' : 'resurgent') as 'resurgent' | 'twilight' }))

  // New teams: on the grid this season but absent from every prior constructors' record.
  const everRaced = new Set((ctx.constructorHistory ?? []).map((h) => h.teamId))
  const newTeams = ctx.teams.filter((t) => !everRaced.has(t.id)).map((t) => t.id)

  // Reigning champions: drivers' title-holder via careers (titleYears includes last season), constructors'
  // via last season's P1 finish. Both must be credited by the copy even when already named elsewhere.
  const reigningChampion = seated.find((d) => (ctx.careers?.[d.id]?.titleYears ?? []).includes(ctx.year - 1))?.id
  const lastYear = (ctx.constructorHistory ?? []).reduce((m, h) => Math.max(m, h.seasonYear), -Infinity)
  const champRec = (ctx.constructorHistory ?? []).find((h) => h.seasonYear === lastYear && h.finalPosition === 1)
  const reigningConstructor = champRec && ctx.teams.some((t) => t.id === champRec.teamId) ? champRec.teamId : undefined

  return { titleFavourites, darkHorses, bestOfRest, rookies, veterans, newTeams, reigningChampion, reigningConstructor }
}
