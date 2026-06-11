import type { NewsContext, NewsArticle } from './engine'
import type { RaceResult } from '@/lib/sim/types'
import { milestoneCrossed } from '@/lib/stats/milestone-defs'
import { careerTotalsThroughRound, teamTotalsThroughRound, teamMilestoneCrossed, milestoneSig, type MileCat } from './milestone-math'
import { sortedResults } from './result-format'
import { teamOneTwoBefore, podiumBefore, isHomeRace } from './season-history'
import { circuit, teamName, paceRank } from './lookups'
import { lastName, ordinal, plural, listJoin, fill, pick, pronouns } from './util'
import { paras, poss, texture } from './copy'
import milestoneCopy from './milestone-copy.json'

// The per-race milestone roundup, carved out of engine.ts. The driver milestone-step / crossing logic
// lives in src/lib/stats/milestone-defs.ts (MILESTONE_STEP / milestoneCrossed), shared with the World
// driver page so the two never drift. Team milestone steps live in milestone-math.

// If a team crossed the SAME-category milestone in this race as one of its drivers, return a line
// noting it (to append to the driver's milestone article); otherwise ''. Same-category only, so a
// pole pairs with a team pole, never a team points milestone (issue: team milestones).
function teamAccompanyLine(ctx: NewsContext, teamId: string, cat: 'wins' | 'podiums' | 'poles' | 'points' | 'starts', r: number): string {
  const before = teamTotalsThroughRound(ctx, teamId, r - 1)
  const after = teamTotalsThroughRound(ctx, teamId, r)
  if (!before || !after) return ''
  const v = teamMilestoneCrossed(cat, before[cat], after[cat])
  if (v == null) return ''
  const key = `${cat}${v === 1 ? 'Maiden' : 'Nth'}` as keyof typeof milestoneCopy.teamAccompany
  const pool = milestoneCopy.teamAccompany[key]
  if (!pool) return ''
  return fill(pick(pool, `team-mile-${ctx.year}-${teamId}-${cat}-${v}`), { team: teamName(ctx, teamId), n: v, nth: ordinal(v) })
}

// A compact one-sentence summary of a single career milestone, for the secondary entries listed
// beneath the headline milestone in the per-race roundup. Prose lives in milestone-copy.json.
function milestoneLine(ctx: NewsContext, res: RaceResult, cat: MileCat, value: number): string {
  const seed = `mileline-${ctx.year}-${res.driverId}-${cat}`
  const slots = {
    driver_last: lastName(res.driverName), driver_poss: poss(lastName(res.driverName)), team: res.teamName,
    n: value, nth: ordinal(value), pos: ordinal(res.finishPosition ?? 0),
    ...pronouns(ctx.drivers.find((d) => d.id === res.driverId)?.gender),
  }
  return fill(pick(milestoneCopy.milestoneLine[cat][value === 1 ? 'maiden' : 'nth'], seed), slots)
}

// When several drivers cross the SAME milestone (category + value) in one race, combine them into a
// single line naming all of them rather than repeating near-identical sentences. Only podiums / points
// / starts can have multiple holders in a race; wins and poles never do (one winner, one pole-sitter).
function combinedLine(ctx: NewsContext, members: { res: RaceResult }[], cat: MileCat, value: number): string {
  const key = `${cat}${value === 1 ? 'Maiden' : 'Nth'}` as keyof typeof milestoneCopy.combined
  const pool = milestoneCopy.combined[key]
  if (!pool) return members.map((m) => milestoneLine(ctx, m.res, cat, value)).join(' ')
  const names = listJoin(members.map((m) => lastName(m.res.driverName)))
  return fill(pick(pool, `mile-combined-${ctx.year}-${cat}-${value}`), { names, n: value, nth: ordinal(value) })
}

// TRIGGER: per race, ONE milestone article. Every career milestone crossed that race (issue #19) —
// first or every-step win / podium / pole / points / start — plus a team's first 1-2 and a surprise
// podium are gathered, ordered by significance, and reported together: the most significant leads
// (full prose + quote, sets the headline) and the rest follow as one-line entries.
export function milestones(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const sorted = sortedResults(ctx.raceResults[r - 1] ?? [])
    const podium = sorted.filter((x) => !x.dnf && x.finishPosition != null).slice(0, 3)
    if (podium.length === 0) continue
    const [p1, p2] = podium
    const circuitName = circuit(ctx, r)

    const raceRes = ctx.raceResults[r - 1] ?? []

    // --- Gather every milestone crossed this race, then report them together in ONE article. ---
    // Mass-debut guard: in a brand-new world (season one, no career history) the whole grid debuts
    // in the very first race, which is not individually newsworthy. Suppress ONLY those first-race
    // milestones; every other first (first win, first points...) still stands.
    // A driver whose real-world debut predates this season (historical mode) is racing in-game for the
    // first time but is NOT a rookie — never report or count them as a debut.
    const preExistingDriver = (driverId: string) => {
      const dy = ctx.drivers.find((d) => d.id === driverId)?.debutYear
      return dy != null && dy < ctx.year
    }
    let debutants = 0
    for (const res of raceRes) {
      if (preExistingDriver(res.driverId)) continue
      const b = careerTotalsThroughRound(ctx, res.driverId, r - 1)
      const a = careerTotalsThroughRound(ctx, res.driverId, r)
      if (b && a && milestoneCrossed('starts', b.starts, a.starts) === 1) debutants++
    }
    const massDebut = debutants > Math.ceil(raceRes.length / 2)

    type Career = { kind: 'career'; res: RaceResult; cat: MileCat; value: number; sig: number }
    type OneTwo = { kind: 'onetwo'; sig: number }
    type Surprise = { kind: 'surprise'; res: RaceResult; sig: number }
    const events: (Career | OneTwo | Surprise)[] = []
    const winDrivers = new Set<string>()
    const podiumMile = new Set<string>()
    for (const res of raceRes) {
      const before = careerTotalsThroughRound(ctx, res.driverId, r - 1)
      const after = careerTotalsThroughRound(ctx, res.driverId, r)
      if (!before || !after) continue
      for (const cat of ['wins', 'podiums', 'poles', 'points', 'starts'] as const) {
        const v = milestoneCrossed(cat, before[cat], after[cat])
        if (v == null) continue
        if (cat === 'starts' && v === 1 && massDebut) continue // inaugural mass debut: not news
        if (cat === 'starts' && v === 1 && preExistingDriver(res.driverId)) continue // raced before the game's reach
        events.push({ kind: 'career', res, cat, value: v, sig: milestoneSig(cat, v) })
        if (cat === 'wins') winDrivers.add(res.driverId)
        if (cat === 'podiums') podiumMile.add(res.driverId)
      }
    }
    // A win is a podium is a points finish: drop the lesser FIRSTS a win/podium already implies, so a
    // maiden win does not also read "scored for the first time". Recurring steps (a 250th point) are
    // distinct achievements and kept even alongside a podium.
    const collected: (Career | OneTwo | Surprise)[] = events.filter((e) => {
      if (e.kind !== 'career') return true
      if (e.cat === 'podiums' && winDrivers.has(e.res.driverId)) return false
      if (e.cat === 'points' && e.value === 1 && (winDrivers.has(e.res.driverId) || podiumMile.has(e.res.driverId))) return false
      return true
    })

    // A team's first one-two of the season (a team result, folded into the same piece).
    if (p1 && p2 && p1.teamId === p2.teamId && !teamOneTwoBefore(ctx, p1.teamId, r)) {
      collected.push({ kind: 'onetwo', sig: 4_300_000 })
    }
    // A surprise podium for a slow car (live only), skipped where the driver already has a
    // first-career-podium milestone (the same event, better told by the career line).
    if (ctx.live) {
      for (const d of podium) {
        if (d.driverId === p1.driverId) continue
        if (podiumMile.has(d.driverId)) continue
        if (paceRank(ctx, d.teamId) <= 3) continue
        if (podiumBefore(ctx, d.driverId, r)) continue
        collected.push({ kind: 'surprise', res: d, sig: 3_800_000 })
        break // at most one surprise podium per race
      }
    }

    if (collected.length === 0) continue
    collected.sort((a, b) => b.sig - a.sig)
    const top = collected[0]
    const rest = collected.slice(1)
    const seed = `mile-${ctx.year}-${r}`

    // The headline milestone gets a full lead; the remaining milestones follow as one-line entries.
    let headline = '', dek = ''
    let lead: string[] = []
    if (top.kind === 'career' && top.cat === 'wins') {
      const w = top.res
      const maiden = top.value === 1
      const homeWin = isHomeRace(ctx, w.driverId, r)
      const poleSitter = raceRes.find((x) => x.gridPosition === 1)
      const fromPole = !!poleSitter && poleSitter.driverId === w.driverId
      let priorSeconds = 0, priorBestPos = 99
      for (let k = 1; k < r; k++) {
        const res = (ctx.raceResults[k - 1] ?? []).find((x) => x.driverId === w.driverId)
        if (!res || res.dnf || res.finishPosition == null) continue
        if (res.finishPosition === 2) priorSeconds++
        if (res.finishPosition < priorBestPos) priorBestPos = res.finishPosition
      }
      const s = {
        driver: w.driverName, driver_last: lastName(w.driverName), driver_poss: poss(lastName(w.driverName)),
        team: w.teamName, team_poss: poss(w.teamName), circuit: circuitName, year: ctx.year,
        n: top.value, nth: ordinal(top.value),
        prior_seconds: priorSeconds, seconds_times: plural(priorSeconds, 'time'), seconds_noun: plural(priorSeconds, 'second place'),
        prior_best: priorBestPos < 99 ? ordinal(priorBestPos) : '',
        ...pronouns(ctx.drivers.find((d) => d.id === w.driverId)?.gender),
      }
      if (maiden) {
        const M = milestoneCopy.winMaiden
        headline = fill(pick(M.headline, `${seed}|h`), s)
        dek = fill(pick(M.dek, `${seed}|d`), s)
        lead = [
          fill(pick(M.b1, `${seed}|b1`), s),
          fromPole ? fill(pick(M.pole, `${seed}|pole`), s) : '',
          priorSeconds >= 1 ? fill(pick(M.nm, `${seed}|nm`), s) : '',
          fill(pick(M.mr, `${seed}|mr`), s),
          homeWin ? fill(pick(M.home, `${seed}|home`), s) : '',
          texture(seed, M.scene, s),
          texture(`${seed}|q`, M.quote, s, 80),
        ]
      } else {
        const M = milestoneCopy.winNth
        headline = fill(pick(M.headline, `${seed}|h`), s)
        dek = fill(pick(M.dek, `${seed}|d`), s)
        lead = [
          fill(pick(M.b1, `${seed}|b1`), s),
          fromPole ? fill(pick(M.pole, `${seed}|pole`), s) : '',
          priorSeconds >= 1 ? fill(pick(M.nm, `${seed}|nm`), s) : '',
          fill(pick(M.b2, `${seed}|b2`), s),
          homeWin ? fill(pick(M.home, `${seed}|home`), s) : '',
          texture(`${seed}|q`, M.quote, s, 80),
        ]
      }
    } else if (top.kind === 'career') {
      const d = top.res
      const cat = top.cat as 'podiums' | 'poles' | 'points' | 'starts'
      const maiden = top.value === 1
      const s = {
        driver: d.driverName, driver_last: lastName(d.driverName), driver_poss: poss(lastName(d.driverName)),
        team: d.teamName, team_poss: poss(d.teamName), circuit: circuitName, year: ctx.year,
        n: top.value, nth: ordinal(top.value), pos: ordinal(d.finishPosition ?? 0),
        ...pronouns(ctx.drivers.find((dd) => dd.id === d.driverId)?.gender),
      }
      const C = milestoneCopy.MILESTONE_COPY[cat][maiden ? 'maiden' : 'nth']
      headline = fill(pick(C.h, `${seed}|h`), s)
      dek = fill(pick(C.d, `${seed}|d`), s)
      lead = [fill(pick(C.b1, `${seed}|b1`), s), fill(pick(C.b2, `${seed}|b2`), s), texture(`${seed}|q`, C.q, s, 80)]
    } else if (top.kind === 'onetwo') {
      const s = { team: p1.teamName, team_poss: poss(p1.teamName), d1: p1.driverName, d1_last: lastName(p1.driverName), d2: p2.driverName, d2_last: lastName(p2.driverName), circuit: circuitName, year: ctx.year }
      const O = milestoneCopy.oneTwo
      headline = fill(pick(O.headline, `${seed}|h`), s)
      dek = fill(pick(O.dek, `${seed}|d`), s)
      lead = [fill(pick(O.b1, `${seed}|b1`), s), fill(pick(O.b2, `${seed}|b2`), s)]
    } else {
      const d = top.res
      const s = { driver: d.driverName, driver_last: lastName(d.driverName), driver_poss: poss(lastName(d.driverName)), team: d.teamName, team_poss: poss(d.teamName), circuit: circuitName, pos: ordinal(d.finishPosition ?? 0), year: ctx.year, ...pronouns(ctx.drivers.find((dd) => dd.id === d.driverId)?.gender) }
      const S = milestoneCopy.surprise
      headline = fill(pick(S.headline, `${seed}|h`), s)
      dek = fill(pick(S.dek, `${seed}|d`), s)
      lead = [fill(pick(S.b1, `${seed}|b1`), s), fill(pick(S.b2, `${seed}|b2`), s), texture(seed, S.scene, s)]
    }

    // If the headline driver milestone also lands a team milestone of the same category this race
    // (e.g. the driver's first point coincides with the team's 100th), note it in the lead paragraph.
    if (top.kind === 'career' && lead.length) {
      const tline = teamAccompanyLine(ctx, top.res.teamId, top.cat, r)
      if (tline) lead[0] = `${lead[0]} ${tline}`
    }

    // Secondary-milestone lines, combining identical career milestones (same category + value) across
    // drivers into ONE line so a cohort hitting e.g. 50 starts together reads as a single sentence
    // rather than nineteen near-identical ones.
    const emitted = new Set<string>()
    const lines: string[] = []
    for (const e of rest) {
      if (e.kind === 'career') {
        const key = `${e.cat}:${e.value}`
        if (emitted.has(key)) continue
        emitted.add(key)
        const members = rest.filter((m): m is Career => m.kind === 'career' && m.cat === e.cat && m.value === e.value)
        lines.push(members.length > 1 ? combinedLine(ctx, members, e.cat, e.value) : milestoneLine(ctx, e.res, e.cat, e.value))
      } else if (e.kind === 'onetwo') {
        lines.push(fill(pick(milestoneCopy.oneTwo.line, `${seed}|otl`), { team: p1.teamName, d1_last: lastName(p1.driverName), d2_last: lastName(p2.driverName) }))
      } else {
        lines.push(fill(pick(milestoneCopy.surprise.line, `${seed}|spl-${e.res.driverId}`), { driver_last: lastName(e.res.driverName), team: e.res.teamName, pos: ordinal(e.res.finishPosition ?? 0) }))
      }
    }
    const priority = top.kind === 'onetwo' ? 60 : top.kind === 'surprise' ? 55
      : top.cat === 'wins' ? (top.value === 1 ? 72 : 66)
      : top.cat === 'podiums' ? 58 : top.cat === 'poles' ? 50 : top.cat === 'points' ? 46 : 44
    const restPara = lines.length
      ? fill(pick(milestoneCopy.connector, `${seed}|conn`), { circuit: circuitName }) + ' ' + lines.join(' ')
      : ''
    out.push({ id: seed, category: 'milestone', round: r, priority, headline, dek, body: paras(...lead, restPara) })
  }
  return out
}
