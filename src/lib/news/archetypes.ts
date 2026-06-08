import type { NewsContext } from './engine'
import { raceH2H, type SeasonAnalysis } from './season-analysis'
import { driverMaxPerRace, constructorMaxPerRace } from '@/lib/sim/points'

// Season-archetype classifier (#88). Pure detectors over the season-analysis layer + raw results. Each
// returns a KEYED match (ids + numeric signals only — never a dramatic label, so nothing leaks into copy)
// for the targeted producers (driver arcs, teammate battles, cross-team duels) to frame coverage around.
// Detectors gate themselves to data the sim actually models. Wet-aided shapes ARE now detectable — a
// per-race weather summary rides on every result (RaceWeather.rained), so see championModifiers.wetAided.
// What remains deferred depends on signals the sim still doesn't persist — see DEFERRED_ARCHETYPES.

export const DEFERRED_ARCHETYPES = [
  'team orders favouring one car (no orders flag modelled)',
  'incident-driven teammate clash (no incident/contact tracking)',
  'safety-car-aided run (no safety-car flag persisted)',
  'shock-qualifying not matched in the race (no quali-vs-race split in archive)',
] as const

// ---- per-driver season tally over the completed rounds ----
interface SeasonStat {
  started: number
  points: number
  wins: number
  podiums: number
  finishes: number[] // classified finishing positions, in round order
  avgFinish: number // mean of classified finishes (Infinity-safe: 99 when none)
}

function statsUpTo(ctx: NewsContext, driverId: string, fromRound: number, toRound: number): SeasonStat {
  let started = 0, points = 0, wins = 0, podiums = 0
  const finishes: number[] = []
  for (let r = fromRound; r <= toRound; r++) {
    const res = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === driverId)
    if (!res) continue
    started++
    points += res.points
    if (res.finishPosition != null) {
      finishes.push(res.finishPosition)
      if (res.finishPosition <= 3) podiums++
      if (res.finishPosition === 1) wins++
    }
  }
  const avgFinish = finishes.length ? finishes.reduce((s, v) => s + v, 0) / finishes.length : 99
  return { started, points, wins, podiums, finishes, avgFinish }
}

export type DriverArcKey = 'aboveCar' | 'flopPick' | 'fastStart' | 'rookieBeatsVet' | 'rookieEarly' | 'lateSurge'

export interface DriverArcMatch {
  driverId: string
  key: DriverArcKey
  strength: number // higher = more newsworthy; producers surface the top few across the grid
  wins: number
  podiums: number
  teammateId?: string
}

// A driver counts as a rookie when they had no F1 starts BEFORE this season. NB ctx.careers folds this
// season's results in (live end-of-season), so we subtract this season's starts to recover the prior total;
// a raw `careers.starts <= 1` would reject every real rookie by year end. Falls back to a this-year debut
// when no career record exists.
function isRookieSeason(ctx: NewsContext, driverId: string, debutYear: number | undefined, thisSeasonStarts: number): boolean {
  const c = ctx.careers?.[driverId]
  if (c) return Math.max(0, (c.starts ?? 0) - thisSeasonStarts) <= 1
  return debutYear === ctx.year
}

export function driverArcs(ctx: NewsContext, analysis: SeasonAnalysis): DriverArcMatch[] {
  const N = analysis.completedRounds
  if (N < 6) return []
  const seated = ctx.drivers.filter((d) => d.teamId !== '')
  const third = Math.max(2, Math.round(N / 3))
  const teammateOf = (d: (typeof seated)[number]) => seated.find((x) => x.teamId === d.teamId && x.id !== d.id)
  const out: DriverArcMatch[] = []
  const push = (m: DriverArcMatch) => out.push(m)

  for (const d of seated) {
    const st = statsUpTo(ctx, d.id, 1, N)
    if (st.started < Math.max(3, Math.round(N / 2))) continue // needs a real sample of the season
    const exp = analysis.driverExpectations.get(d.id)
    const delta = analysis.driverDeltas.find((x) => x.id === d.id)?.delta ?? 0
    const tm = teammateOf(d)
    const tmSt = tm ? statsUpTo(ctx, tm.id, 1, N) : null
    const rookie = isRookieSeason(ctx, d.id, d.debutYear, st.started)

    // Overachiever: a non-front car, podiums but no wins, finishing clearly above the car's billing.
    if (exp && exp.tier !== 'front' && st.podiums >= 2 && st.wins === 0 && delta >= 4) {
      push({ driverId: d.id, key: 'aboveCar', strength: st.podiums * 2 + delta, wins: 0, podiums: st.podiums })
    }
    // Preseason pick that flopped: highly expected, finished well short, no single cause (no wins/podiums).
    if (exp && exp.expectedRank <= Math.max(4, seated.length / 4) && delta <= -5 && st.wins === 0) {
      push({ driverId: d.id, key: 'flopPick', strength: -delta, wins: 0, podiums: st.podiums })
    }
    // Fast start that deflated: strong first third, markedly worse the rest of the way.
    const early = statsUpTo(ctx, d.id, 1, third)
    const late = statsUpTo(ctx, d.id, N - third + 1, N)
    if (early.finishes.length >= 2 && late.finishes.length >= 2 && early.avgFinish <= 8 && late.avgFinish - early.avgFinish >= 5) {
      push({ driverId: d.id, key: 'fastStart', strength: late.avgFinish - early.avgFinish, wins: st.wins, podiums: st.podiums })
    }
    // Rookie outscoring a veteran teammate over the season.
    if (rookie && tm && tmSt && !isRookieSeason(ctx, tm.id, tm.debutYear, tmSt.started) && st.points > tmSt.points && st.points >= tmSt.points * 1.1) {
      push({ driverId: d.id, key: 'rookieBeatsVet', strength: (st.points - tmSt.points), wins: st.wins, podiums: st.podiums, teammateId: tm.id })
    }
    // Rookie on the podium against expectation.
    if (rookie && st.podiums >= 1 && (exp?.tier !== 'front')) {
      push({ driverId: d.id, key: 'rookieEarly', strength: st.podiums * 3 + st.wins * 5, wins: st.wins, podiums: st.podiums })
    }
    // Late-career resurgence: 35+, running at the sharp end and getting stronger as the year closed.
    // Both windows need real finishes — else early.avgFinish=99 (no classified finish) fakes a giant "surge".
    if (d.age >= 35 && early.finishes.length >= 2 && late.finishes.length >= 2 && late.avgFinish <= 7 && early.avgFinish - late.avgFinish >= 2) {
      push({ driverId: d.id, key: 'lateSurge', strength: (early.avgFinish - late.avgFinish) + st.podiums, wins: st.wins, podiums: st.podiums })
    }
  }

  // One match per driver (their strongest), then the most newsworthy across the grid first.
  const best = new Map<string, DriverArcMatch>()
  for (const m of out) {
    const cur = best.get(m.driverId)
    if (!cur || m.strength > cur.strength) best.set(m.driverId, m)
  }
  return [...best.values()].sort((a, b) => b.strength - a.strength)
}

export type TeammateKey = 'dominant' | 'underdeliver'

export interface TeammateMatch {
  teamId: string
  winnerId: string // the driver who came out ahead (the story's subject)
  loserId: string // the team-mate who came out behind
  key: TeammateKey
  strength: number
}

// Teammate-battle archetypes (#88): one driver routing the other on equal machinery, or the more-fancied
// driver being out-performed by a team-mate. (Incident-driven clashes + team-orders favouritism are deferred
// — neither incidents nor an orders flag are modelled; see DEFERRED_ARCHETYPES.)
export function teammateBattles(ctx: NewsContext, analysis: SeasonAnalysis): TeammateMatch[] {
  const N = analysis.completedRounds
  if (N < 6) return []
  const seated = ctx.drivers.filter((d) => d.teamId !== '')
  const minStarts = Math.max(3, Math.round(N / 2))
  const out: TeammateMatch[] = []
  const seenTeams = new Set<string>()
  for (const t of ctx.teams) {
    if (seenTeams.has(t.id)) continue
    seenTeams.add(t.id)
    const pair = seated.filter((d) => d.teamId === t.id)
    if (pair.length !== 2) continue
    const [a, b] = pair
    const sa = statsUpTo(ctx, a.id, 1, N)
    const sb = statsUpTo(ctx, b.id, 1, N)
    if (sa.started < minStarts || sb.started < minStarts) continue
    const hi = sa.points >= sb.points ? a : b
    const lo = hi === a ? b : a
    const hiPts = Math.max(sa.points, sb.points)
    const loPts = Math.min(sa.points, sb.points)
    // Dominant: ~2:1 or better on equal equipment (guard the loPts==0 case via a points floor).
    if (hiPts >= 30 && hiPts >= loPts * 1.8 + 1) {
      out.push({ teamId: t.id, winnerId: hi.id, loserId: lo.id, key: 'dominant', strength: hiPts - loPts })
    }
    // Underdeliver: the more-fancied driver (better preseason expectation) finished behind the team-mate.
    const expA = analysis.driverExpectations.get(a.id)?.expectedRank ?? 99
    const expB = analysis.driverExpectations.get(b.id)?.expectedRank ?? 99
    const fancied = expA <= expB ? a : b
    const other = fancied === a ? b : a
    const fancPts = fancied === a ? sa.points : sb.points
    const otherPts = other === a ? sa.points : sb.points
    if (Math.abs(expA - expB) >= 2 && otherPts > fancPts * 1.15 && otherPts >= 20) {
      out.push({ teamId: t.id, winnerId: other.id, loserId: fancied.id, key: 'underdeliver', strength: otherPts - fancPts })
    }
  }
  // Strongest battle per team, then most newsworthy first.
  const best = new Map<string, TeammateMatch>()
  for (const m of out) {
    const cur = best.get(m.teamId)
    if (!cur || m.strength > cur.strength) best.set(m.teamId, m)
  }
  return [...best.values()].sort((a, b) => b.strength - a.strength)
}

export type CrossTeamKey = 'parallelFight' | 'midfieldDuel'

export interface CrossTeamMatch {
  aId: string // the driver who finished ahead
  bId: string // the driver just behind
  key: CrossTeamKey
  h2hA: number // race head-to-head (both classified) in A's favour
  h2hB: number
  gap: number // season points gap (small = a real duel)
  strength: number
}

// Cross-team rivalry archetypes (#88): two drivers on DIFFERENT teams, NOT in the title fight, who finished
// the season locked together — a parallel fight among the fast cars behind the leaders, or a midfield duel.
// Adjacent in the final order, close on points, with an even race head-to-head.
export function crossTeamDuels(ctx: NewsContext, analysis: SeasonAnalysis): CrossTeamMatch[] {
  const N = analysis.completedRounds
  if (N < 6) return []
  const seated = ctx.drivers.filter((d) => d.teamId !== '')
  const minStarts = Math.max(3, Math.round(N / 2))
  const rows = seated
    .map((d) => ({ id: d.id, teamId: d.teamId, ...statsUpTo(ctx, d.id, 1, N) }))
    .filter((r) => r.started >= minStarts)
    .sort((a, b) => b.points - a.points)
  const out: CrossTeamMatch[] = []
  // Skip the top two (the title fight is the championship arc's job); walk adjacent pairs below.
  for (let i = 2; i < rows.length - 1; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    if (a.teamId === b.teamId) continue // must be a CROSS-team duel
    const gap = a.points - b.points
    if (gap > 15) continue // close on points
    const [h2hA, h2hB] = raceH2H(ctx, a.id, b.id, N)
    const total = h2hA + h2hB
    if (total < 4) continue // enough wheel-to-wheel meetings
    const dominance = Math.max(h2hA, h2hB) / total
    if (dominance > 0.75) continue // a duel, not a rout
    const key: CrossTeamKey = i <= 4 ? 'parallelFight' : 'midfieldDuel' // fast cars behind the leaders vs the midfield
    out.push({ aId: a.id, bId: b.id, key, h2hA, h2hB, gap, strength: (16 - gap) + (1 - Math.abs(0.5 - dominance) * 2) * 10 })
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, 1) // the season's single defining cross-team duel
}

// How the drivers' title was actually won (#88 championship-battle taxonomy) — the most salient single shape,
// used to frame the season review beyond the basic wire-to-wire/comeback/decider split. Suffix-keyed so the
// producer can index `champion${shape}` copy directly.
export type ChampionShape =
  | 'TitleNoWins' | 'WinStreak' | 'ComebackMerit' | 'ComebackHanded' | 'ThreeWay' | 'Domination' | 'WireToWire' | 'Decider' | 'Clear'

// The comeback shapes also report WHO led early (the driver whose lead the champion overhauled / who
// retired it away) — distinct from the final runner-up, so the copy can name the right driver.
export interface ChampionShapeResult {
  shape: ChampionShape
  earlyLeaderId?: string
  teammatePair?: boolean // the top two in the drivers' table share a garage (an internal title fight)
  lateWobble?: boolean // a big lead that shrank sharply over the run-in but still held on
  wetAided?: boolean // at least half the champion's wins came in races that ran wet
}

// Modifier flags layered on the primary shape — a season can be e.g. a domination that wobbled late, or an
// internal teammate fight. Copy reads these to add a clause; they never change the primary shape (#88: a
// combination of archetypes is itself an archetype).
function championModifiers(ctx: NewsContext, analysis: SeasonAnalysis): { teammatePair: boolean; lateWobble: boolean; wetAided: boolean } {
  const t = analysis.driverTitle
  const champ = t.currentLeaderId
  const N = analysis.completedRounds
  if (!champ || N < 3) return { teammatePair: false, lateWobble: false, wetAided: false }
  const ru = t.series[t.series.length - 1]?.secondId ?? null
  const champTeam = ctx.drivers.find((d) => d.id === champ)?.teamId
  const ruTeam = ru ? ctx.drivers.find((d) => d.id === ru)?.teamId : null
  const teammatePair = !!champTeam && champTeam !== '' && champTeam === ruTeam
  // Held a 60+ point lead that shrank to single digits but still held on (a near-collapse, not a collapse).
  // (Absolute points for now; era-scaling by driverMaxPerRace is a deferred follow-up.)
  let champPeak = 0
  for (const g of t.series) if (g.leaderId === champ && g.gap > champPeak) champPeak = g.gap
  const lateWobble = champPeak >= 60 && t.currentGap > 0 && t.currentGap < 10
  // Wet-aided title: the champion outscored the runner-up by 1.5x+ in WET races while being outscored in the
  // DRY — wet-weather skill made the title difference, not just "some wins came in the rain".
  let champWet = 0, champDry = 0, ruWet = 0, ruDry = 0
  for (let r = 1; r <= N; r++) {
    const rr = ctx.raceResults[r - 1] ?? []
    const wet = (rr.find((x) => x.weather)?.weather?.rained) ?? false
    const c = rr.find((x) => x.driverId === champ)
    const u = ru ? rr.find((x) => x.driverId === ru) : undefined
    if (c) { if (wet) champWet += c.points; else champDry += c.points }
    if (u) { if (wet) ruWet += u.points; else ruDry += u.points }
  }
  const wetAided = !!ru && champWet > 0 && champWet >= 1.5 * ruWet && champDry < ruDry
  return { teammatePair, lateWobble, wetAided }
}

export function championshipShape(ctx: NewsContext, analysis: SeasonAnalysis): ChampionShapeResult {
  return { ...baseChampionShape(ctx, analysis), ...championModifiers(ctx, analysis) }
}

function baseChampionShape(ctx: NewsContext, analysis: SeasonAnalysis): ChampionShapeResult {
  const t = analysis.driverTitle
  const champ = t.currentLeaderId
  const N = analysis.completedRounds
  if (!champ || N < 3) return { shape: 'Clear' }
  const st = statsUpTo(ctx, champ, 1, N)

  // Title built on consistency, no win all year — the most striking shape.
  if (st.wins === 0) return { shape: 'TitleNoWins' }

  // A long unbeaten run (5+ consecutive wins) that defined the season.
  let streak = 0, maxStreak = 0
  for (let r = 1; r <= N; r++) {
    if ((ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === champ)?.finishPosition === 1) { streak++; maxStreak = Math.max(maxStreak, streak) } else streak = 0
  }
  if (maxStreak >= 5) return { shape: 'WinStreak' }

  // Came from behind: the champion wasn't leading early. Merit (own wins) vs handed (the early leader's DNFs).
  const earlyLeader = t.series[0]?.leaderId
  if (earlyLeader && earlyLeader !== champ) {
    const half = Math.floor(N / 2)
    let champWins = 0, earlyLeaderDnfs = 0
    for (let r = half + 1; r <= N; r++) {
      const rr = ctx.raceResults[r - 1] ?? []
      if (rr.find((x) => x.driverId === champ)?.finishPosition === 1) champWins++
      if (rr.find((x) => x.driverId === earlyLeader)?.dnf) earlyLeaderDnfs++
    }
    return { shape: earlyLeaderDnfs > champWins ? 'ComebackHanded' : 'ComebackMerit', earlyLeaderId: earlyLeader }
  }

  if (st.wins >= Math.ceil(N / 2)) return { shape: 'Domination' } // won at least half the races
  if (t.wireToWire) return { shape: 'WireToWire' } // led the table every round

  // Three (or more) drivers still mathematically alive with three rounds to go. Checked AFTER domination/
  // wire-to-wire so a one-sided season with stragglers merely "mathematically alive" isn't called a three-way.
  if (N >= 4) {
    const checkRound = Math.max(1, N - 3)
    const rows = ctx.drivers.filter((d) => d.teamId !== '').map((d) => ({ pts: statsUpTo(ctx, d.id, 1, checkRound).points })).sort((a, b) => b.pts - a.pts)
    const reach = (N - checkRound) * driverMaxPerRace(ctx.year)
    if (rows.length >= 3 && rows.filter((r) => rows[0].pts - r.pts <= reach).length >= 3) return { shape: 'ThreeWay' }
  }

  if (t.currentGap <= driverMaxPerRace(ctx.year)) return { shape: 'Decider' } // settled late, within a race win
  return { shape: 'Clear' }
}

// ---- tier coverage (#90): the best-of-the-rest fight and the backmarker tier ----

interface TeamRow { id: string; points: number; wins: number }

function teamSeasonStats(ctx: NewsContext, N: number): TeamRow[] {
  return ctx.teams
    .map((t) => {
      let points = 0, wins = 0
      for (let r = 1; r <= N; r++) {
        for (const c of (ctx.raceResults[r - 1] ?? []).filter((x) => x.teamId === t.id)) {
          points += c.points
          if (c.finishPosition === 1) wins++
        }
      }
      return { id: t.id, points, wins }
    })
    .sort((a, b) => b.points - a.points)
}

export type BestOfRestKind = 'compressed' | 'surge' | 'clear'
export interface BestOfRestResult {
  winnerId: string // best finisher among teams outside the preseason front tier
  runnerUpId: string // the next non-front team (always present; the producer needs two)
  gap: number // points to the next team in the midfield
  kind: BestOfRestKind
}

// The best-of-the-rest battle (#90): the fight to lead the midfield, defined EXACTLY as the season review's
// best-of-the-rest line — the best ACTUAL finisher among teams NOT in the preseason front tier — so the two
// end-of-season pieces never name different teams. `surge` = projected well down preseason; `compressed` = a
// tight band among the leading non-front teams.
export function bestOfRestBattle(ctx: NewsContext, analysis: SeasonAnalysis): BestOfRestResult | null {
  const N = analysis.completedRounds
  if (N < 6) return null
  const front = new Set(analysis.tiers.front)
  const rows = teamSeasonStats(ctx, N).filter((r) => !front.has(r.id))
  if (rows.length < 2) return null // need a midfield with at least two teams
  const bor = rows[0]
  const runnerUp = rows[1]
  const gap = bor.points - runnerUp.points
  const band = rows.slice(0, 4)
  const bandSpread = band.length >= 3 ? band[0].points - band[band.length - 1].points : 999
  const actualRank = front.size + 1 // the best-of-the-rest sits just behind the front tier
  const expRank = analysis.teamExpectations.get(bor.id)?.expectedRank ?? actualRank
  const surge = expRank - actualRank >= 3 // projected well down preseason, finished best-of-the-rest
  const kind: BestOfRestKind = surge ? 'surge' : bandSpread <= 25 ? 'compressed' : 'clear'
  return { winnerId: bor.id, runnerUpId: runnerUp.id, gap, kind }
}

export type BackmarkerKey = 'newTeamDebut' | 'pointsAgainstOdds' | 'lastPlaceBattle'
export interface BackmarkerResult {
  key: BackmarkerKey
  teamId: string // the story's subject team
  otherId?: string // the rival, for the last-place battle
  gap: number
  points: number
}

// The backmarker tier (#90): one notable story from the back — a new team's tough debut, a tail-ender
// scoring against the odds, or a tight last-place battle. Returns the single most newsworthy.
export function backmarkerStory(ctx: NewsContext, analysis: SeasonAnalysis): BackmarkerResult | null {
  const N = analysis.completedRounds
  if (N < 6) return null
  const rows = teamSeasonStats(ctx, N)
  if (rows.length < 4) return null
  const last = rows[rows.length - 1]
  const secondLast = rows[rows.length - 2]
  const everRaced = new Set((ctx.constructorHistory ?? []).map((h) => h.teamId))

  // A brand-new team enduring a debut DEAD LAST — only then is the "slowest on the grid" copy accurate.
  if (everRaced.size > 0 && !everRaced.has(last.id)) {
    return { key: 'newTeamDebut', teamId: last.id, gap: 0, points: last.points }
  }
  // A tail-ender (bottom three) scoring against the odds — a win, or a real points haul.
  const overPerformer = rows.slice(-3).find((r) => r.wins > 0 || r.points >= 15)
  if (overPerformer) {
    return { key: 'pointsAgainstOdds', teamId: overPerformer.id, gap: 0, points: overPerformer.points }
  }
  // A tight fight to avoid last.
  if (secondLast.points - last.points <= 10) {
    return { key: 'lastPlaceBattle', teamId: secondLast.id, otherId: last.id, gap: secondLast.points - last.points, points: secondLast.points }
  }
  return null
}

// ---- constructors' & team-season taxonomy (#88) ----

// Points a team scored within a round window, and a per-window ranking of the whole grid by those points —
// the basis for the development-arc shapes (a team's first-third pace vs its last-third pace).
function teamPointsRange(ctx: NewsContext, teamId: string, fromR: number, toR: number): number {
  let p = 0
  for (let r = fromR; r <= toR; r++) for (const c of ctx.raceResults[r - 1] ?? []) if (c.teamId === teamId) p += c.points
  return p
}
function teamRanksInRange(ctx: NewsContext, fromR: number, toR: number): Map<string, number> {
  const rows = ctx.teams.map((t) => ({ id: t.id, pts: teamPointsRange(ctx, t.id, fromR, toR) })).sort((a, b) => b.pts - a.pts)
  return new Map(rows.map((r, i) => [r.id, i + 1]))
}
// Each driver's season points within one team, strongest seat first (one-car-carried / dead-seat signals).
function teamDriverSplit(ctx: NewsContext, teamId: string, N: number): { id: string; points: number }[] {
  const m = new Map<string, number>()
  for (let r = 1; r <= N; r++) for (const c of ctx.raceResults[r - 1] ?? []) if (c.teamId === teamId) m.set(c.driverId, (m.get(c.driverId) ?? 0) + c.points)
  return [...m.entries()].map(([id, points]) => ({ id, points })).sort((a, b) => b.points - a.points)
}
// The earliest round at which the leader's gap became mathematically insurmountable (the title clinch).
export function clinchRound(series: { round: number; gap: number }[], maxPer: number, totalRounds: number): number | null {
  for (const g of series) if (g.gap > (totalRounds - g.round) * maxPer) return g.round
  return null
}

// How the CONSTRUCTORS' title was won. Mirrors championshipShape: one most-salient shape, ids + signals only,
// suffix-keyed for `cons${shape}` copy. `driversSealedEarly` is a modifier (the drivers' title was settled
// well before the constructors' went to the wire).
export type ConstructorShape =
  | 'BothCarsDominate' | 'OneCarCarried' | 'WinsVsPoints' | 'LeadTradedLate' | 'RepeatChampion' | 'Clear'

export interface ConstructorShapeResult {
  shape: ConstructorShape
  championId: string | null
  otherId?: string // WinsVsPoints: the team that led on wins; LeadTradedLate: the title rival
  carriedDriverId?: string // OneCarCarried: the seat that scored the bulk of the champion's points
  driversSealedEarly?: boolean
}

export function constructorShape(ctx: NewsContext, analysis: SeasonAnalysis): ConstructorShapeResult {
  const ct = analysis.constructorTitle
  const champ = ct.currentLeaderId
  const N = analysis.completedRounds
  if (!champ || N < 3) return { shape: 'Clear', championId: champ }
  const rows = teamSeasonStats(ctx, N)
  const champRow = rows.find((r) => r.id === champ)
  if (!champRow) return { shape: 'Clear', championId: champ }
  const winsLeader = [...rows].sort((a, b) => b.wins - a.wins || b.points - a.points)[0]

  const dClinch = clinchRound(analysis.driverTitle.series, driverMaxPerRace(ctx.year), analysis.totalRounds)
  const cClinch = clinchRound(ct.series, constructorMaxPerRace(ctx.year), analysis.totalRounds)
  const consDecided = cClinch ?? analysis.completedRounds // teams' clinch round, or the final round if it ran the distance
  const driversSealedEarly = dClinch != null && consDecided - dClinch >= 3

  // Repeat: the same constructor won last season too.
  const lastYear = (ctx.constructorHistory ?? []).reduce((m, h) => Math.max(m, h.seasonYear), -Infinity)
  const lastChamp = (ctx.constructorHistory ?? []).find((h) => h.seasonYear === lastYear && h.finalPosition === 1)?.teamId
  if (lastChamp && lastChamp === champ) return { shape: 'RepeatChampion', championId: champ, driversSealedEarly }

  const split = teamDriverSplit(ctx, champ, N)
  const total = split.reduce((s, d) => s + d.points, 0)
  const topShare = total > 0 ? (split[0]?.points ?? 0) / total : 1
  // Both cars dominate: won at least half the rounds with the points spread across both seats.
  if (champRow.wins >= Math.ceil(N / 2) && split.length >= 2 && topShare <= 0.65) {
    return { shape: 'BothCarsDominate', championId: champ, driversSealedEarly }
  }
  // One car carried it: the title leaned heavily on a single seat.
  if (split.length >= 2 && topShare >= 0.65) {
    return { shape: 'OneCarCarried', championId: champ, carriedDriverId: split[0]?.id, driversSealedEarly }
  }
  // Wins on one team, the title on another (banked consistency beat raw speed). Only when the wins gap is a
  // genuine 3+ — a one-win edge isn't a "fastest car lost the title" story.
  if (winsLeader && winsLeader.id !== champ && winsLeader.wins - champRow.wins >= 3) {
    return { shape: 'WinsVsPoints', championId: champ, otherId: winsLeader.id, driversSealedEarly }
  }
  // Lead genuinely traded hands across the season: a single, clear signal of 3+ round-to-round lead changes
  // (a high count already implies a competitive year, so no separate closeness gate).
  if (ct.leadChanges >= 3) {
    return { shape: 'LeadTradedLate', championId: champ, otherId: ct.series[ct.series.length - 1]?.secondId ?? undefined, driversSealedEarly }
  }
  return { shape: 'Clear', championId: champ, driversSealedEarly }
}

// Team-season arcs (#88): the standout team story away from the title — a fancied team that flopped, a
// development surge from the back, a fade from the front, or a team carried by one seat while the other
// scored nothing. Strongest first; the producer surfaces the top one or two.
export type TeamArcKey = 'flop' | 'devSurge' | 'devDecline' | 'deadSeat'
export interface TeamArcMatch {
  teamId: string
  key: TeamArcKey
  strength: number
  driverId?: string // deadSeat: the seat carrying the team
  otherId?: string // deadSeat: the seat that scored ~nothing
}

export function teamArcs(ctx: NewsContext, analysis: SeasonAnalysis): TeamArcMatch[] {
  const N = analysis.completedRounds
  if (N < 6) return []
  const rows = teamSeasonStats(ctx, N)
  const finalRank = new Map(rows.map((r, i) => [r.id, i + 1]))
  const total = ctx.teams.length || 1
  const e = Math.max(1, Math.round(N / 3))
  const earlyRank = teamRanksInRange(ctx, 1, e)
  const lateRank = teamRanksInRange(ctx, N - e + 1, N)
  const frontCut = Math.max(2, total / 3)
  const out: TeamArcMatch[] = []

  for (const t of ctx.teams) {
    const exp = analysis.teamExpectations.get(t.id)
    const delta = analysis.teamDeltas.find((d) => d.id === t.id)?.delta ?? 0
    const fRank = finalRank.get(t.id) ?? total
    const er = earlyRank.get(t.id) ?? total
    const lr = lateRank.get(t.id) ?? total
    // Flop: a preseason front team finishing well down the order.
    if (exp && exp.expectedRank <= frontCut && fRank >= Math.max(4, frontCut + 1) && delta <= -2) {
      out.push({ teamId: t.id, key: 'flop', strength: -delta + (fRank - exp.expectedRank) })
    }
    // Development surge: ran down the order early, climbed toward the front late.
    if (er - lr >= 3 && lr <= Math.max(4, frontCut + 1)) {
      out.push({ teamId: t.id, key: 'devSurge', strength: er - lr })
    }
    // Development fade: front early, faded down the order.
    if (lr - er >= 3 && er <= Math.max(4, frontCut + 1)) {
      out.push({ teamId: t.id, key: 'devDecline', strength: lr - er })
    }
    // Dead seat: one car carries the team, the other scores next to nothing.
    const split = teamDriverSplit(ctx, t.id, N)
    if (split.length >= 2) {
      const tot = split.reduce((s, d) => s + d.points, 0)
      if (tot >= 20 && split[1].points <= Math.max(2, tot * 0.08)) {
        out.push({ teamId: t.id, key: 'deadSeat', strength: split[0].points - split[1].points, driverId: split[0].id, otherId: split[1].id })
      }
    }
  }
  // Rank by newsworthiness, not raw magnitude: a dead seat's strength (a points gap) would otherwise always
  // dwarf a development swing's (a few rank places). One arc per team, its highest-priority match.
  const PRI: Record<TeamArcKey, number> = { flop: 0, devSurge: 1, devDecline: 2, deadSeat: 3 }
  const best = new Map<string, TeamArcMatch>()
  for (const m of out) {
    const cur = best.get(m.teamId)
    if (!cur || PRI[m.key] < PRI[cur.key] || (PRI[m.key] === PRI[cur.key] && m.strength > cur.strength)) best.set(m.teamId, m)
  }
  return [...best.values()].sort((a, b) => PRI[a.key] - PRI[b.key] || b.strength - a.strength)
}

// The runner-up's story (#88): the title's losing side, which the champion-centric shape can't tell — a
// valiant late comeback that fell short, a charge ended by the chaser's own retirement, or a fight kept
// alive to the final round that needed a leader DNF that never came. Returns the single defining one.
export type RunnerUpKey = 'valiant' | 'lateChargeOwnDnf' | 'ledIntoFinale' | 'aliveToFlag'
export interface RunnerUpResult {
  driverId: string
  key: RunnerUpKey
  peakDeficit: number // the largest the runner-up's deficit to the champion ever was
  finalGap: number
  lateWins: number // runner-up wins in the trailing window
  dnfRound?: number // lateChargeOwnDnf: the round of the charge-ending retirement
  gapBeforeFinal?: number // champion minus runner-up points going into the final round (signed; <0 = runner-up led)
}

export function runnerUpArc(ctx: NewsContext, analysis: SeasonAnalysis): RunnerUpResult | null {
  const t = analysis.driverTitle
  const N = analysis.completedRounds
  const champ = t.currentLeaderId
  const ru = t.series[t.series.length - 1]?.secondId ?? null
  if (!champ || !ru || N < 6) return null
  const maxPer = driverMaxPerRace(ctx.year)
  const champPts = (r: number) => statsUpTo(ctx, champ, 1, r).points
  const ruPts = (r: number) => statsUpTo(ctx, ru, 1, r).points
  let peakDeficit = 0
  for (let r = 1; r <= N; r++) peakDeficit = Math.max(peakDeficit, champPts(r) - ruPts(r))
  const finalGap = champPts(N) - ruPts(N)
  const w = Math.min(4, N - 1)
  let lateWins = 0
  for (let r = N - w + 1; r <= N; r++) if ((ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === ru)?.finishPosition === 1) lateWins++
  let dnfRound = 0
  for (let r = Math.max(1, N - 2); r <= N; r++) if ((ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === ru)?.dnf) dnfRound = r
  const closingLate = finalGap < champPts(Math.max(1, N - w)) - ruPts(Math.max(1, N - w))
  const gapBeforeFinal = N >= 2 ? champPts(N - 1) - ruPts(N - 1) : finalGap // champ - ru going into the final round

  if (closingLate && dnfRound) return { driverId: ru, key: 'lateChargeOwnDnf', peakDeficit, finalGap, lateWins, dnfRound }
  if (peakDeficit >= 30 && finalGap <= 12 && lateWins >= 2) return { driverId: ru, key: 'valiant', peakDeficit, finalGap, lateWins }
  // The runner-up actually LED going into the final round but lost it at the last (the title flipped at the flag).
  if (gapBeforeFinal < 0) return { driverId: ru, key: 'ledIntoFinale', peakDeficit, finalGap, lateWins, gapBeforeFinal }
  // Still mathematically alive but BEHIND going into the final round; the champion held on.
  if (gapBeforeFinal >= 0 && gapBeforeFinal <= maxPer) return { driverId: ru, key: 'aliveToFlag', peakDeficit, finalGap, lateWins, gapBeforeFinal }
  return null
}
