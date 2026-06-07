import type { NewsContext } from './engine'
import { raceH2H, type SeasonAnalysis } from './season-analysis'
import { driverMaxPerRace } from '@/lib/sim/points'

// Season-archetype classifier (#88). Pure detectors over the season-analysis layer + raw results. Each
// returns a KEYED match (ids + numeric signals only — never a dramatic label, so nothing leaks into copy)
// for the targeted producers (driver arcs, teammate battles, cross-team duels) to frame coverage around.
// Detectors gate themselves to data the sim actually models; wet/safety-car-dependent archetypes are
// deferred (those flags aren't persisted) — see DEFERRED_ARCHETYPES.

export const DEFERRED_ARCHETYPES = [
  'win streak heavily wet/SC-aided', 'team orders favouring one car', 'incident-driven teammate clash',
  'points concentrated in chaotic/wet rounds', 'shock-qualifying not matched in the race (no quali-vs-race split in archive)',
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
export interface ChampionShapeResult { shape: ChampionShape; earlyLeaderId?: string }

export function championshipShape(ctx: NewsContext, analysis: SeasonAnalysis): ChampionShapeResult {
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
  winnerId: string // top team behind the front three
  runnerUpId?: string
  gap: number // points to the next team in the midfield
  kind: BestOfRestKind
}

// The best-of-the-rest battle (#90): the fight to lead the midfield, taken as the order behind the front
// three. `surge` = the winner was projected well down preseason; `compressed` = a tight P4-P7 band.
export function bestOfRestBattle(ctx: NewsContext, analysis: SeasonAnalysis): BestOfRestResult | null {
  const N = analysis.completedRounds
  if (N < 6) return null
  const rows = teamSeasonStats(ctx, N)
  const FRONT = 3
  if (rows.length < FRONT + 2) return null // need a midfield to have a best-of-the-rest
  const bor = rows[FRONT]
  const runnerUp = rows[FRONT + 1]
  const gap = bor.points - (runnerUp?.points ?? 0)
  const band = rows.slice(FRONT, FRONT + 4)
  const bandSpread = band.length >= 3 ? band[0].points - band[band.length - 1].points : 999
  const expRank = analysis.teamExpectations.get(bor.id)?.expectedRank ?? FRONT + 1
  const surge = expRank - (FRONT + 1) >= 3 // expected ~7th or worse, finished best-of-the-rest
  const kind: BestOfRestKind = surge ? 'surge' : bandSpread <= 25 ? 'compressed' : 'clear'
  return { winnerId: bor.id, runnerUpId: runnerUp?.id, gap, kind }
}

export type BackmarkerKey = 'newTeamDebut' | 'pointsAgainstOdds' | 'lastPlaceBattle'
export interface BackmarkerResult {
  key: BackmarkerKey
  teamId: string // the story's subject team
  otherId?: string // the rival, for the last-place battle
  gap: number
  points: number
  wins: number
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

  // A brand-new team enduring a debut at the back.
  const debutant = [last, secondLast].find((r) => !everRaced.has(r.id))
  if (debutant && everRaced.size > 0) {
    return { key: 'newTeamDebut', teamId: debutant.id, gap: 0, points: debutant.points, wins: debutant.wins }
  }
  // A tail-ender (bottom three) scoring against the odds — a win, or a real points haul.
  const bottom = rows.slice(-3)
  const overPerformer = bottom.find((r) => r.wins > 0 || r.points >= 15)
  if (overPerformer) {
    return { key: 'pointsAgainstOdds', teamId: overPerformer.id, gap: 0, points: overPerformer.points, wins: overPerformer.wins }
  }
  // A tight fight to avoid last.
  if (secondLast.points - last.points <= 10) {
    return { key: 'lastPlaceBattle', teamId: secondLast.id, otherId: last.id, gap: secondLast.points - last.points, points: secondLast.points, wins: 0 }
  }
  return null
}
