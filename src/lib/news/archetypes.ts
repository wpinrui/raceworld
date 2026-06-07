import type { NewsContext } from './engine'
import type { SeasonAnalysis } from './season-analysis'

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
