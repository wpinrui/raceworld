import type { NewsContext, NewsArticle } from './engine'
import type { ContractWatch } from '@/lib/sim/driver-market'
import { marketWatchRound, marketRenewalRound } from '@/lib/sim/driver-market'
import { constructorStandingsAfter } from './news-standings'
import { teamName } from './lookups'
import { paras } from './copy'
import { lastName, listJoin, ordinal, fill, pick } from './util'
import marketFeatureCopy from './market-feature-copy.json'

// Silly-season market feature producers (contract watch, renewals round-up, off-season recap) carved out of
// engine.ts, with their dedicated copy helpers. The watch / renewal rounds are placed proportionally per
// season (marketWatchRound / marketRenewalRound), matching the store so each article dates to its round.

// A count of 1 against a hardcoded plural noun ("1 drivers", "1 Expiring Contracts") reads as a template
// tell. Singularise the known market count nouns (with an optional single adjective in between) when they
// follow a bare "1", so the copy agrees whatever the real numbers turn out to be.
const MARKET_COUNT_NOUNS = /\b1 ((?:out-of-contract |unsigned |expiring |confirmed |driver )?)(drivers|contracts|deals|seats|names|renewals|extensions|re-signings|confirmations|signings|moves)\b/gi
const agree1 = (text: string): string => text
  .replace(MARKET_COUNT_NOUNS, (_m, adj: string, noun: string) => `1 ${adj}${noun.replace(/s$/i, '')}`)
  .replace(/ {2,}/g, ' ') // collapse stray double spaces (e.g. an empty standing slot for a brand-new team)
function agreeArticle(a: NewsArticle): NewsArticle {
  return { ...a, headline: agree1(a.headline), dek: agree1(a.dek), body: agree1(a.body) }
}

// A short attributed quote from one of the drivers in a story, e.g. "Give me a car that can fight," said Hill.
// Strip a trailing full stop from the line so it doesn't collide with the closing comma.
const quoteLine = (pool: string[], seed: string, name: string): string => `"${pick(pool, seed).replace(/\.$/, '')}," said ${lastName(name)}.`

// A survey of the expiring contracts at the (season-scaled) contract-watch round, graded from the driver's side. Chunked: ONE sentence per
// verdict names the whole group (with their teams), instead of a paragraph per driver.
export function contractWatchFeature(ctx: NewsContext): NewsArticle[] {
  const watch = ctx.contractWatch
  if (!ctx.live || !watch || watch.length === 0) return []
  const c = marketFeatureCopy.watch
  const year = ctx.year
  const seed = `contract-watch-${year}`
  const hslots = { n: watch.length, year, next: year + 1, round: marketWatchRound(ctx.calendar.length) }
  type Verdict = 'could_do_better' | 'right_place' | 'lucky'
  // Most newsworthy first: the biggest over- and under-placements lead; well-matched cases sit nearest 0.
  const newsworthiness = (key: Verdict) => (a: ContractWatch, b: ContractWatch) =>
    key === 'could_do_better' ? b.diff - a.diff : key === 'lucky' ? a.diff - b.diff : Math.abs(b.diff) - Math.abs(a.diff)
  const chunk = (key: Verdict) => {
    const list = watch.filter((w) => w.verdict === key).sort(newsworthiness(key))
    if (list.length === 0) return ''
    const names = listJoin(list.map((w) => `${w.driverName} (${w.teamName})`))
    const line = fill(pick(c[key], `${seed}|${key}`), { ...hslots, names })
    // Only the could-do-better group carries a quote (the most newsworthy case); the rest read straight.
    return key === 'could_do_better' ? paras(line, quoteLine(c.quote_could_do_better, `${seed}|q-cdb`, list[0].driverName)) : line
  }
  // "As for ..." only works as a transition, never to open the run of verdicts; force the first to "For ...".
  const verdicts = [chunk('could_do_better'), chunk('right_place'), chunk('lucky')].filter(Boolean)
  if (verdicts.length) verdicts[0] = verdicts[0].replace(/^As for /, 'For ')
  const body = paras(fill(pick(c.intro, `${seed}|intro`), hslots), ...verdicts)
  return [agreeArticle({
    id: seed, category: 'silly_season', round: marketWatchRound(ctx.calendar.length), priority: 34,
    headline: fill(pick(c.title, `${seed}|h`), hslots),
    dek: fill(pick(c.dek, `${seed}|d`), hslots),
    body,
  })]
}

// A round-up once the renewal window closes (at the season-scaled renewal round). Chunked: one sentence lists the re-signings (team +
// length), one lists who is heading to the market.
export function renewalsFeature(ctx: NewsContext): NewsArticle[] {
  // Fires from the renewal round on (incl. the off-season archive snapshot, so it persists to archived seasons).
  const renewalRound = marketRenewalRound(ctx.calendar.length)
  if (!ctx.live || ctx.completedRounds < renewalRound) return []
  const renewals = ctx.renewals ?? []
  const stillExpiring = ctx.drivers.filter((d) => d.teamId !== '' && d.contractExpiresAfterSeason === ctx.year)
  if (renewals.length === 0 && stillExpiring.length === 0) return []
  const c = marketFeatureCopy.renewals
  const year = ctx.year
  const next = year + 1
  const seed = `renewals-roundup-${year}`
  const hslots = { n: renewals.length, m: stillExpiring.length, year, next, round: renewalRound }
  const renewedNames = listJoin(renewals.map((r) => `${r.driverName} (${r.teamName}, ${r.years}yr)`))
  const expiringNames = listJoin(stillExpiring.map((d) => `${d.name} (${teamName(ctx, d.teamId)})`))
  const body = paras(
    fill(pick(c.intro, `${seed}|intro`), hslots),
    renewals.length ? paras(fill(pick(c.renewed, `${seed}|renewed`), { ...hslots, names: renewedNames }), quoteLine(c.quote_renewed, `${seed}|q-ren`, renewals[0].driverName)) : '',
    stillExpiring.length ? paras(fill(pick(c.expiring, `${seed}|expiring`), { ...hslots, names: expiringNames }), quoteLine(c.quote_expiring, `${seed}|q-exp`, stillExpiring[0].name)) : '',
  )
  return [agreeArticle({
    id: seed, category: 'silly_season', round: renewalRound, priority: 36,
    headline: fill(pick(c.title, `${seed}|h`), hslots),
    dek: fill(pick(c.dek, `${seed}|d`), hslots),
    body,
  })]
}

// End-of-season retrospective. The marquee move gets a fact-dense sentence (who left whom, where each
// team finished, the term); everything else is chunked into one sentence per category.
export function offSeasonFeature(ctx: NewsContext): NewsArticle[] {
  const eos = ctx.endOfSeason
  if (!eos) return []
  const draft = ctx.draft ?? []

  // The market recap waits until Signing Day is settled: either the player has revealed every signing
  // on the Signing Day board, or the off-season has advanced past that stage (contract-negotiations).
  const revealed = ctx.signingDayRevealed ?? 0
  const signingDayDone = ctx.phase === 'driver-retirements' || ctx.phase === 'pre-season-testing'
    || (ctx.phase === 'contract-negotiations' && draft.length > 0 && revealed >= draft.length)
  if (!signingDayDone) return []

  const moves = eos.marketMoves ?? []
  // Every genuine transfer is listed; media only decides which is the marquee.
  const realMoves = moves.filter((m) => m.fromTeamId && m.fromTeamId !== m.toTeamId)
  // Teamless drivers who signed, split into established free agents (a media profile) and debut rookies.
  const freeAgents = moves.filter((m) => m.fromTeamId == null && !m.isResignation && m.mediaScore > 0)
  const rookies = moves.filter((m) => m.fromTeamId == null && !m.isResignation && m.mediaScore === 0)
  const upsets = draft.filter((p) => p.flavour === 'upset')
  const dropped = eos.droppedDrivers ?? []
  if (!realMoves.length && !freeAgents.length && !rookies.length && !upsets.length && !dropped.length) return []
  const c = marketFeatureCopy.offseason
  const year = eos.seasonYear
  const next = year + 1
  const seed = `offseason-moves-${year}`
  const hslots = { year, next }

  // Final constructors order, so each move can be framed by where the teams actually finished.
  const cstand = constructorStandingsAfter(ctx, ctx.calendar.length)
  const posOf = new Map(cstand.map((cs, i) => [cs.teamId, i + 1]))
  const champTeam = cstand[0]?.teamId
  const teamPos = (id: string | null | undefined): string => {
    if (!id) return ''
    if (id === champTeam) return 'the champions'
    const p = posOf.get(id)
    return p ? `${ordinal(p)}-placed` : ''
  }
  const faRankOf = new Map(draft.map((p) => [p.driverId, p.faRank]))
  const faPhrase = (id: string): string => {
    const r = faRankOf.get(id)
    return r === 1 ? 'the most sought-after free agent of the window'
      : r && r <= 3 ? 'one of the most coveted free agents'
      : r ? `the ${ordinal(r)}-rated free agent` : 'a free agent'
  }
  const fromName = (m: { fromTeamId: string | null }) => (m.fromTeamId ? teamName(ctx, m.fromTeamId) : 'free agency')

  const marquee = [...realMoves].sort((a, b) => b.mediaScore - a.mediaScore)[0]
  const marqueePara = marquee
    ? fill(pick(c.marquee, `${seed}|hm`), {
        driver: marquee.driverName, driver_last: lastName(marquee.driverName),
        from: fromName(marquee), from_pos: teamPos(marquee.fromTeamId),
        to: marquee.toTeamName, to_pos: teamPos(marquee.toTeamId),
        years: marquee.contractLength, fa: faPhrase(marquee.driverId), year, next,
      })
    : ''
  const otherMoves = realMoves.filter((m) => m.driverId !== marquee?.driverId)

  const body = paras(
    marquee ? paras(marqueePara, quoteLine(c.quote_signed, `${seed}|q-sign`, marquee.driverName)) : '',
    otherMoves.length ? fill(pick(c.moves, `${seed}|moves`), { ...hslots, names: listJoin(otherMoves.map((m) => `${m.driverName} (${fromName(m)} to ${m.toTeamName})`)) }) : '',
    freeAgents.length ? fill(pick(c.free_agents, `${seed}|fa`), { ...hslots, names: listJoin(freeAgents.map((m) => `${m.driverName} (${m.toTeamName})`)) }) : '',
    upsets.length ? fill(pick(c.upsets, `${seed}|upsets`), { ...hslots, names: listJoin(upsets.map((p) => `${p.driverName} (${p.teamName})`)) }) : '',
    rookies.length ? fill(pick(c.rookies, `${seed}|rookies`), { ...hslots, names: listJoin(rookies.map((m) => `${m.driverName} (${m.toTeamName})`)) }) : '',
    dropped.length ? paras(fill(pick(c.dropped, `${seed}|dropped`), { ...hslots, names: listJoin(dropped.map((d) => `${d.driverName} (${d.fromTeamName})`)) }), quoteLine(c.quote_dropped, `${seed}|q-drop`, dropped[0].driverName)) : '',
  )
  return [agreeArticle({
    id: seed, category: 'silly_season', round: ctx.calendar.length + 1, priority: 85,
    headline: fill(pick(c.title, `${seed}|h`), hslots),
    dek: fill(pick(c.dek, `${seed}|d`), hslots),
    body,
  })]
}
