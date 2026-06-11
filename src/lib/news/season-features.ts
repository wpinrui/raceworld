import type { NewsContext, NewsArticle } from './engine'
import { driverArcs, teammateBattles, crossTeamDuels, bestOfRestBattle, backmarkerStory } from './archetypes'
import { buildSeasonAnalysis } from './season-analysis'
import { teamName } from './lookups'
import { lastName, fill, pick, pronouns } from './util'
import driverArcCopy from './driver-arc-copy.json'
import teammateBattleCopy from './teammate-battle-copy.json'
import crossTeamDuelCopy from './cross-team-duel-copy.json'
import bestOfRestCopy from './best-of-rest-copy.json'
import backmarkerCopy from './backmarker-copy.json'

// End-of-season feature producers (#88/#90) carved out of engine.ts: the individual driver arcs, the
// teammate verdicts, the cross-team duel, and the best-of-rest / backmarker stories from the midfield and
// the back. All fire only at season end and read from the season analysis + archetype detectors.

// Driver-arc retrospectives (#88): the season's individual stories — an overachiever dragging a lesser car
// to podiums, a preseason pick who flopped, a fast start that deflated, a rookie beating a veteran teammate,
// a rookie podium, a late-career resurgence. End-of-season, sparse (top 3 most newsworthy across the grid).
export function driverArc(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || !ctx.endOfSeason) return []
  const analysis = buildSeasonAnalysis(ctx)
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const c = driverArcCopy as Record<string, { h: string[]; d: string[]; b: string[] }>
  return driverArcs(ctx, analysis).slice(0, 3).map((m) => {
    const driver = dn(m.driverId)
    const teammate = m.teammateId ? dn(m.teammateId) : ''
    const slots = {
      year: ctx.year, driver, driver_last: lastName(driver), podiums: m.podiums, wins: m.wins,
      teammate, teammate_last: teammate ? lastName(teammate) : '',
      ...pronouns(ctx.drivers.find((x) => x.id === m.driverId)?.gender),
    }
    const a = c[m.key]
    const seed = `driver-arc-${ctx.year}-${m.driverId}`
    return {
      id: seed, category: 'feature', round: ctx.completedRounds, priority: 70,
      headline: fill(pick(a.h, `${seed}|h`), slots),
      dek: fill(pick(a.d, `${seed}|d`), slots),
      body: fill(pick(a.b, `${seed}|b`), slots),
    }
  })
}

// Teammate-battle retrospectives (#88): the season's intra-team verdicts — one driver routing the other on
// equal machinery, or the more-fancied driver being beaten by the other side of the garage. End-of-season,
// top 2. Supersedes the analysis producer's teammate-imbalance angle.
export function teammateBattle(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || !ctx.endOfSeason) return []
  const analysis = buildSeasonAnalysis(ctx)
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const c = teammateBattleCopy as Record<string, { h: string[]; d: string[]; b: string[] }>
  return teammateBattles(ctx, analysis).slice(0, 2).map((m) => {
    const winner = dn(m.winnerId)
    const loser = dn(m.loserId)
    const slots = { year: ctx.year, winner, winner_last: lastName(winner), loser, loser_last: lastName(loser), team: teamName(ctx, m.teamId) }
    const a = c[m.key]
    const seed = `teammate-${ctx.year}-${m.teamId}`
    return {
      id: seed, category: 'analysis_opinion', round: ctx.completedRounds, priority: 35,
      headline: fill(pick(a.h, `${seed}|h`), slots),
      dek: fill(pick(a.d, `${seed}|d`), slots),
      body: fill(pick(a.b, `${seed}|b`), slots),
    }
  })
}

// Cross-team duel retrospective (#88): the season's single defining battle between two drivers on different
// teams outside the title fight — a parallel fight among the fast cars, or a midfield duel. End-of-season.
export function crossTeamDuel(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || !ctx.endOfSeason) return []
  const analysis = buildSeasonAnalysis(ctx)
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const c = crossTeamDuelCopy as Record<string, { h: string[]; d: string[]; b: string[] }>
  return crossTeamDuels(ctx, analysis).map((m) => {
    const a = dn(m.aId)
    const b = dn(m.bId)
    const slots = { year: ctx.year, a_last: lastName(a), b_last: lastName(b), h2h_a: m.h2hA, h2h_b: m.h2hB, gap: m.gap }
    const cc = c[m.key]
    const seed = `crossteam-${ctx.year}-${m.aId}-${m.bId}`
    return {
      id: seed, category: 'analysis_opinion', round: ctx.completedRounds, priority: 34,
      headline: fill(pick(cc.h, `${seed}|h`), slots),
      dek: fill(pick(cc.d, `${seed}|d`), slots),
      body: fill(pick(cc.b, `${seed}|b`), slots),
    }
  })
}

// Best-of-the-rest retrospective (#90): the fight to lead the midfield (the best finisher among the teams
// outside the preseason front tier) — a compressed band, a surge from a projected backmarker, or a clear
// win. Shares its definition with the season review's best-of-the-rest line. End-of-season.
export function bestOfRest(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || !ctx.endOfSeason) return []
  const r = bestOfRestBattle(ctx, buildSeasonAnalysis(ctx))
  if (!r) return []
  const tn = (id: string) => teamName(ctx, id)
  const c = bestOfRestCopy as Record<string, { h: string[]; d: string[]; b: string[] }>
  const slots = { year: ctx.year, winner: tn(r.winnerId), runner_up: r.runnerUpId ? tn(r.runnerUpId) : '', gap: r.gap }
  const cc = c[r.kind]
  const seed = `best-of-rest-${ctx.year}`
  return [{
    id: seed, category: 'analysis_opinion', round: ctx.completedRounds, priority: 33,
    headline: fill(pick(cc.h, `${seed}|h`), slots),
    dek: fill(pick(cc.d, `${seed}|d`), slots),
    body: fill(pick(cc.b, `${seed}|b`), slots),
  }]
}

// Backmarker retrospective (#90): one notable story from the back — a new team's tough debut, a tail-ender
// scoring against the odds, or a tight last-place battle. End-of-season.
export function backmarker(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || !ctx.endOfSeason) return []
  const r = backmarkerStory(ctx, buildSeasonAnalysis(ctx))
  if (!r) return []
  const tn = (id: string) => teamName(ctx, id)
  const c = backmarkerCopy as Record<string, { h: string[]; d: string[]; b: string[] }>
  const slots = { year: ctx.year, team: tn(r.teamId), other: r.otherId ? tn(r.otherId) : '', gap: r.gap, points: r.points }
  const cc = c[r.key]
  const seed = `backmarker-${ctx.year}`
  return [{
    id: seed, category: 'analysis_opinion', round: ctx.completedRounds, priority: 32,
    headline: fill(pick(cc.h, `${seed}|h`), slots),
    dek: fill(pick(cc.d, `${seed}|d`), slots),
    body: fill(pick(cc.b, `${seed}|b`), slots),
  }]
}
