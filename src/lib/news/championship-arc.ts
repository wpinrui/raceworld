import type { NewsContext, NewsArticle } from './engine'
import { titleArcEvents, constructorArcEvents } from './season-analysis'
import { teamName } from './lookups'
import { poss, paras } from './copy'
import { lastName, plural, fill, pick } from './util'
import arcCopy from './title-arc-copy.json'
import constructorArcCopy from './constructor-arc-copy.json'

// The championship arc (#88): a sparse, trajectory-driven narrative on the title fight — the comeback/
// erosion story, the leader pulling clear, or the run-in maths. Complements titleScenario (the precise
// clinch permutations) and the factual clinch/lead-change in `championship`, covering the story rather
// than the maths. Fires only at inflections (see titleArcEvents).
export function championshipArc(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.endOfSeason) return []
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  return titleArcEvents(ctx).map((e) => {
    const leader = dn(e.leaderId)
    const chaser = dn(e.chaserId)
    const h2hHi = Math.max(e.h2hLeader, e.h2hChaser)
    const h2hLo = Math.min(e.h2hLeader, e.h2hChaser)
    const h2hLeads = e.h2hLeader >= e.h2hChaser ? leader : chaser
    const h2h = e.h2hLeader === e.h2hChaser ? `level at ${e.h2hLeader}-${e.h2hChaser}` : `${h2hHi}-${h2hLo} in ${poss(lastName(h2hLeads))} favour`
    const slots = {
      year: ctx.year, round: e.round, leader, chaser,
      leader_last: lastName(leader), chaser_last: lastName(chaser),
      leader_poss: poss(lastName(leader)), chaser_poss: poss(lastName(chaser)),
      gap: e.gap, gap_pts: plural(e.gap, 'point'), gap_ago: e.gapAgo, rounds_ago: e.roundsAgo, change: Math.abs(e.change),
      prev_state: e.gapAgo > 0 ? `led by ${e.gapAgo} ${plural(e.gapAgo, 'point')}` : e.gapAgo < 0 ? `trailed by ${-e.gapAgo} ${plural(-e.gapAgo, 'point')}` : 'been level',
      remaining: e.remaining, races_left: `${e.remaining} ${plural(e.remaining, 'race')}`, max_pts: e.maxPts,
      h2h, mom_leader: e.momLeader, mom_chaser: e.momChaser, chaser_wins: e.chaserWins, leader_dnfs: e.leaderDnfs,
    }
    const angle = e.kind === 'erosion'
      ? (e.merit === 'handed' ? 'erosionHanded' : e.merit === 'merit' ? 'erosionMerit' : 'erosionMixed')
      : e.kind
    const c = arcCopy[angle as keyof typeof arcCopy]
    const seed = `title-arc-${ctx.year}-${e.round}`
    return {
      id: seed, category: 'championship_state', round: e.round, priority: 76,
      headline: fill(pick(c.h, `${seed}|h`), slots),
      dek: fill(pick(c.d, `${seed}|d`), slots),
      body: fill(pick(c.b, `${seed}|b`), slots),
    }
  })
}

// The constructors' championship arc (#88): the teams' title fight, same sparse inflection detection as the
// drivers' arc (constructorArcEvents). Priority just below the drivers' arc so the marquee title leads the round.
export function constructorArc(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.endOfSeason) return []
  const tn = (id: string) => teamName(ctx, id)
  const c = constructorArcCopy as Record<string, { h: string[]; d: string[]; b: string[] }>
  return constructorArcEvents(ctx).map((e) => {
    const leader = tn(e.leaderId)
    const chaser = tn(e.chaserId)
    const h2hHi = Math.max(e.h2hLeader, e.h2hChaser)
    const h2hLo = Math.min(e.h2hLeader, e.h2hChaser)
    const h2h = e.h2hLeader === e.h2hChaser ? `level at ${e.h2hLeader}-${e.h2hChaser}` : `${h2hHi}-${h2hLo} in ${poss(e.h2hLeader >= e.h2hChaser ? leader : chaser)} favour`
    const slots = {
      year: ctx.year, round: e.round, leader, chaser,
      gap: e.gap, gap_pts: plural(e.gap, 'point'), gap_ago: e.gapAgo, rounds_ago: e.roundsAgo, change: Math.abs(e.change),
      prev_state: e.gapAgo > 0 ? `led by ${e.gapAgo} ${plural(e.gapAgo, 'point')}` : e.gapAgo < 0 ? `trailed by ${-e.gapAgo} ${plural(-e.gapAgo, 'point')}` : 'been level',
      remaining: e.remaining, races_left: `${e.remaining} ${plural(e.remaining, 'race')}`, max_pts: e.maxPts,
      h2h, mom_leader: e.momLeader, mom_chaser: e.momChaser, chaser_wins: e.chaserWins, leader_dnfs: e.leaderDnfs,
    }
    const angle = e.kind === 'erosion'
      ? (e.merit === 'handed' ? 'erosionHanded' : e.merit === 'merit' ? 'erosionMerit' : 'erosionMixed')
      : e.kind
    const cc = c[angle]
    const seed = `cons-arc-${ctx.year}-${e.round}`
    // Enrich the body (#88 follow-up): the gap alone is thin. Add who actually scored the window's points for
    // each team, and the development race between them (upgrades brought + which car is quicker now).
    const fromR = e.round - e.roundsAgo + 1
    const contribs = (teamId: string): string[] => {
      const m = new Map<string, number>()
      for (let k = fromR; k <= e.round; k++) for (const res of ctx.raceResults[k - 1] ?? []) if (res.teamId === teamId) m.set(res.driverId, (m.get(res.driverId) ?? 0) + res.points)
      return [...m.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).map(([id, p]) => `${lastName(ctx.drivers.find((d) => d.id === id)?.name ?? id)} (${p})`)
    }
    const contribPhrase = (cs: string[]) => (cs.length === 0 ? 'neither car scoring' : cs.length === 1 ? cs[0] : `${cs[0]} and ${cs[1]}`)
    const upgrades = (teamId: string) => (ctx.upgradeEvents ?? []).filter((u) => u.teamId === teamId && !u.failed && u.round >= fromR && u.round <= e.round)
    const lUp = upgrades(e.leaderId), cUp = upgrades(e.chaserId)
    const lDev = lUp.reduce((s, u) => s + u.paceDelta, 0), cDev = cUp.reduce((s, u) => s + u.paceDelta, 0)
    const dev =
      lUp.length === 0 && cUp.length === 0 ? 'Neither has brought an upgrade across the window'
      : lUp.length > cUp.length ? `${leader} have out-developed ${chaser}, ${lUp.length} ${plural(lUp.length, 'upgrade')} to ${cUp.length}`
      : cUp.length > lUp.length ? `${chaser} have out-developed ${leader}, ${cUp.length} ${plural(cUp.length, 'upgrade')} to ${lUp.length}`
      : lDev > cDev + 0.3 ? `${poss(leader)} upgrades have brought the bigger step`
      : cDev > lDev + 0.3 ? `${poss(chaser)} upgrades have brought the bigger step`
      : 'Both have developed at a similar rate'
    const lPace = ctx.teams.find((t) => t.id === e.leaderId)?.carPace ?? 0, cPace = ctx.teams.find((t) => t.id === e.chaserId)?.carPace ?? 0
    const paceClause = Math.abs(lPace - cPace) < 1 ? 'the two cars are now closely matched on pace' : `${poss(lPace > cPace ? leader : chaser)} car is the quicker of the two`
    const details = `Across the window, ${poss(chaser)} points came through ${contribPhrase(contribs(e.chaserId))}, ${poss(leader)} through ${contribPhrase(contribs(e.leaderId))}. ${dev}, and ${paceClause}.`
    return {
      id: seed, category: 'championship_state', round: e.round, priority: 74,
      headline: fill(pick(cc.h, `${seed}|h`), slots),
      dek: fill(pick(cc.d, `${seed}|d`), slots),
      body: paras(fill(pick(cc.b, `${seed}|b`), slots), details),
    }
  })
}
