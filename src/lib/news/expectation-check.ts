import type { NewsContext, NewsArticle } from './engine'
import { buildSeasonAnalysis } from './season-analysis'
import { driverStandingsAfter } from './news-standings'
import { circuit } from './lookups'
import { lastName, ordinal, plural, pronouns, pick } from './util'
import { paras } from './copy'
import { raceDate, daysBetween } from '@/lib/sim/calendar-dates'

// Expectation-vs-actual checkpoint (#88): ~twice a season (one-third, two-thirds), who is running above or
// below their PRESEASON projection — drivers and teams. Compares the season-analysis preseason expectation
// (round-independent) against the actual standings AT that checkpoint round. Supersedes the analysis
// producer's form-slump/surge and team-vs-car-pace angles. Live only (needs the expectation basis).
export function expectationCheck(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.completedRounds < 3) return []
  const analysis = buildSeasonAnalysis(ctx)
  const N = ctx.calendar.length
  const checkpoints = [...new Set([Math.round(N / 3), Math.round((2 * N) / 3), N])].filter((k) => k >= 3) // + the full season at year end (#88)
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const CARD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  const numWord = (n: number) => CARD[n] ?? String(n)
  const numTimes = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${numWord(n)} times`)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const out: NewsArticle[] = []
  for (const K of checkpoints) {
    if (K > ctx.completedRounds) continue
    const isEnd = K >= N // the full-season checkpoint reads in the past tense (final positions), not "N rounds in"
    const dStand = driverStandingsAfter(ctx, K)
    const dRank = new Map(dStand.map((s, i) => [s.driverId, i + 1]))
    // Only judge drivers who have actually raced by K — a seated mid-season joiner absent from the
    // standings isn't "under-performing", they simply weren't on the grid yet.
    const half = Math.ceil(dStand.length / 2)
    const dDelta = [...analysis.driverExpectations.values()].filter((e) => dRank.has(e.driverId)).map((e) => ({ id: e.driverId, proj: e.expectedRank, pos: dRank.get(e.driverId)!, delta: e.expectedRank - dRank.get(e.driverId)! }))
    // Over-performers must end up somewhere that matters (top half), not a backmarker creeping up the order;
    // under-performers must have been fancied (projected top half) — otherwise there was nothing to fall from.
    const dOver = dDelta.filter((x) => x.delta >= 3 && x.pos <= half).sort((a, b) => b.delta - a.delta).slice(0, 3).map((x) => x.id)
    const dUnder = dDelta.filter((x) => x.delta <= -3 && x.proj <= half).sort((a, b) => a.delta - b.delta).slice(0, 3).map((x) => x.id)
    if (!dOver.length && !dUnder.length) continue // nothing notable this checkpoint

    // Per-driver facts at this checkpoint: where the winter ranked them (the projection, now SHOWN, not
    // implied) vs where they actually sit, plus the concrete reason — retirements, a scoring drought.
    const statsFor = (id: string) => {
      let dnfs = 0, lastScored = 0, best = 99, starts = 0
      for (let rr = 0; rr < K; rr++) {
        const res = (ctx.raceResults[rr] ?? []).find((x) => x.driverId === id)
        if (!res) continue
        starts++
        if (res.dnf) dnfs++
        if (res.finishPosition != null && res.finishPosition < best) best = res.finishPosition
        if (res.points > 0) lastScored = rr + 1
      }
      return { dnfs, lastScored, best: best === 99 ? null : best, starts }
    }
    const info = (id: string) => {
      const proj = analysis.driverExpectations.get(id)!.expectedRank
      const pos = dRank.get(id)!
      return { name: dn(id), last: lastName(dn(id)), pos, proj, delta: proj - pos, gender: ctx.drivers.find((d) => d.id === id)?.gender, ...statsFor(id) }
    }
    type Info = ReturnType<typeof info>
    const overs = dOver.map(info)
    const unders = dUnder.map(info)

    const overSentence = (f: Info, i: number): string => {
      const pr = pronouns(f.gender)
      return (isEnd ? [
        `${f.name} finished ${ordinal(f.pos)}, ${numWord(f.delta)} ${plural(f.delta, 'place')} above where ${pr.they} was projected.`,
        `${f.name}, projected ${ordinal(f.proj)} over the winter, climbed to ${ordinal(f.pos)}.`,
        `${f.name} turned a preseason ${ordinal(f.proj)} into ${ordinal(f.pos)} by the flag.`,
      ] : [
        `${f.name} sits ${ordinal(f.pos)}, ${numWord(f.delta)} ${plural(f.delta, 'place')} above where ${pr.they} was projected.`,
        `${f.name}, projected ${ordinal(f.proj)} over the winter, has climbed to ${ordinal(f.pos)}.`,
        `${f.name} has turned a preseason ${ordinal(f.proj)} into ${ordinal(f.pos)} on the road.`,
      ])[i % 3]
    }
    const reason = (f: Info, i: number): string => {
      if (f.dnfs >= 2) return isEnd ? (i % 2 ? `suffered ${numWord(f.dnfs)} retirements` : `retired ${numTimes(f.dnfs)} in ${numWord(f.starts)} starts`) : (i % 2 ? `has ${numTimes(f.dnfs)} retirements already` : `has retired ${numTimes(f.dnfs)} in ${numWord(f.starts)} starts`)
      if (f.lastScored === 0) return isEnd ? 'never troubled the scorers' : 'has yet to trouble the scorers'
      if (K - f.lastScored >= 2) return isEnd ? `scored for the last time in round ${f.lastScored}` : (i % 2 ? `last scored back in round ${f.lastScored}` : `has not scored since round ${f.lastScored}`)
      if (f.dnfs === 1) return isEnd ? 'lost a finish to retirement' : (i % 2 ? 'has lost a finish to retirement' : 'has already retired once')
      return ''
    }
    const underSentence = (f: Info, i: number): string => {
      const projP = [`ranked ${ordinal(f.proj)} in the preseason`, `${ordinal(f.proj)} in the winter ratings`, `a projected ${ordinal(f.proj)}`][i % 3]
      const posP = (isEnd ? ['finished', 'slid to', 'ended up'] : ['sits', 'has slid to', 'now runs'])[i % 3]
      const r = reason(f, i)
      return r ? `${f.name}, ${projP}, ${r} and ${posP} ${ordinal(f.pos)}.` : `${f.name}, ${projP}, ${isEnd ? 'slipped' : 'has slipped'} to ${ordinal(f.pos)}.`
    }

    // Next-round signpost from the real calendar gap.
    const nextC = ctx.calendar[K]
    const closer = nextC
      ? `The season resumes in ${numWord(Math.max(1, Math.round(daysBetween(raceDate(ctx.year, ctx.calendar[K - 1]), raceDate(ctx.year, nextC)) / 7)))} ${plural(Math.max(1, Math.round(daysBetween(raceDate(ctx.year, ctx.calendar[K - 1]), raceDate(ctx.year, nextC)) / 7)), 'week')} at the ${circuit(ctx, K + 1)}.`
      : ''

    const eseed = `expect-${ctx.year}-${K}`
    const paragraphs: string[] = []
    if (overs.length) {
      const intro = isEnd
        ? pick([
            `By the end of ${ctx.year}, the order had pulled clear of the winter form guide.`,
            `The ${ctx.year} season finished a long way from the winter projections.`,
            `Several names ended ${ctx.year} clear of their winter ranking.`,
          ], `${eseed}|oi`)
        : pick([
            `${cap(numWord(K))} rounds in, the season has already pulled away from the winter form guide.`,
            `${cap(numWord(K))} rounds into the season, the winter projections are already being torn up.`,
            `The opening ${numWord(K)} rounds have already diverged from the winter projections.`,
            `${cap(numWord(K))} rounds in, several names are running clear of their winter ranking.`,
          ], `${eseed}|oi`)
      paragraphs.push(`${intro} ${overs.map(overSentence).join(' ')}`)
    }
    if (unders.length) {
      const lead = overs.length
        ? pick(isEnd
            ? ['The bigger story was how far the fancied names fell.', 'More striking was how far the fancied names dropped.']
            : ['The bigger story is how far the fancied names have fallen.', 'More striking is how far the fancied names have slid.'], `${eseed}|ul`)
        : pick(isEnd
            ? [`Across ${ctx.year}, the fancied names went backwards.`, `The names rated highly over the winter went the other way in ${ctx.year}.`]
            : [`${cap(numWord(K))} rounds in, the fancied names have gone backwards.`, `${cap(numWord(K))} rounds in, the names rated highly over the winter have slid down the order.`], `${eseed}|ul`)
      paragraphs.push(`${lead} ${unders.map(underSentence).join(' ')}`)
    }
    if (closer) paragraphs.push(closer)

    // Headline + dek lead with the actual movers, not a restatement of the premise.
    const headline = overs.length && unders.length
      ? (isEnd ? `${overs[0].last} beat the winter call, ${unders[0].last} fell short of it in ${ctx.year}` : `${overs[0].last} climbs and ${unders[0].last} slides ${numWord(K)} rounds into ${ctx.year}`)
      : overs.length
      ? (isEnd ? `${overs[0].last} finished ${ordinal(overs[0].pos)}, well above the winter call, in ${ctx.year}` : `${overs[0].last} runs ${ordinal(overs[0].pos)}, well above the winter call, after ${numWord(K)} rounds`)
      : (isEnd ? `${unders[0].last} ended ${ordinal(unders[0].pos)}, well below the winter call, in ${ctx.year}` : `${unders[0].last} slides to ${ordinal(unders[0].pos)} ${numWord(K)} rounds into ${ctx.year}`)
    const dek = overs.length && unders.length
      ? (isEnd ? `${overs[0].name} ended ${ordinal(overs[0].pos)} from a projected ${ordinal(overs[0].proj)}; ${unders[0].name} went the other way, ${ordinal(unders[0].proj)} down to ${ordinal(unders[0].pos)}.` : `${overs[0].name} has climbed to ${ordinal(overs[0].pos)} from a projected ${ordinal(overs[0].proj)}; ${unders[0].name} has gone the other way, ${ordinal(unders[0].proj)} down to ${ordinal(unders[0].pos)}.`)
      : overs.length
      ? (isEnd ? `${overs[0].name} led the names that beat the winter projection across ${ctx.year}.` : `${overs[0].name} leads the names running clear of the winter projection ${numWord(K)} rounds into ${ctx.year}.`)
      : (isEnd ? `${unders[0].name} headed the names that trailed the winter projection across ${ctx.year}.` : `${unders[0].name} heads the names trailing the winter projection ${numWord(K)} rounds into ${ctx.year}.`)

    // At year end this is a marquee season piece (drops on finale day); mid-season it's a checkpoint opinion.
    out.push({ id: `expectation-${ctx.year}-${K}`, category: isEnd ? 'feature' : 'analysis_opinion', round: K, priority: isEnd ? 84 : 33, ...(isEnd ? { dayOffset: 0 } : {}), headline, dek, body: paras(...paragraphs) })
  }
  return out
}
