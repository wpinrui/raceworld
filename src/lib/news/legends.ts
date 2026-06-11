import type { NewsContext, NewsArticle, LegendProfile } from './engine'
import { lastName, plural, fill, pick, listJoin, ordinal, pronouns } from './util'
import { paras } from './copy'
import legendsCopy from './legends-copy.json'

// "Remember this driver?" — the legends series (#93). One adaptive retrospective per retired driver,
// whose beats flex with stature: a champion gets a moment of brilliance, the rivals who defined the era,
// and a GOAT-debate close; a journeyman gets the ousting story (teammate head-to-head, who took the seat
// and what they made of it). The near-miss beat is optional, skipped for genuine greats. Every fact is
// pre-built server-side on ctx.legends (archive-backed); this only resolves them into prose, dropped on
// the feature's absolute 4-month-grid date. Gendered pronouns come from p.gender (resolved server-side).
const LEGEND_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
type LegendPools = Record<string, string[]>
const LEGEND_COPY = legendsCopy as unknown as {
  headline: string[]
  rivalPhrase: LegendPools
  stature: LegendPools
  texture: LegendPools
  retro: LegendPools
  rivalQuote: { intro: LegendPools; assessment: LegendPools }
  lastSeason: LegendPools
  immortal: LegendPools; champion: LegendPools; nearly: LegendPools; winner: LegendPools; bestOfRest: LegendPools; midfield: LegendPools; footnote: LegendPools
  podiumTally: LegendPools; podiumCoda: LegendPools
}

// A driver's standing as a phrase, gated on career wins then podiums — the "tier" the conclusion states
// before tying back to the angle (e.g. "among the sport's genuine winners", then "but no title").
function legendStature(wins: number, podiums: number): string {
  return wins >= 20 ? 'elite' : wins >= 8 ? 'major' : wins >= 3 ? 'winner' : wins >= 1 ? 'occasionalWinner'
    : podiums >= 10 ? 'podiumRegular' : podiums >= 3 ? 'podium' : podiums >= 1 ? 'podiumRare' : 'minor'
}

export function legends(ctx: NewsContext): NewsArticle[] {
  const L = LEGEND_COPY
  const out: NewsArticle[] = []
  for (const f of ctx.legends?.features ?? []) {
    const p = f.profile
    const seed = `legend-${p.driverId}-${f.date.slice(0, 4)}`
    const era = p.firstYear === p.lastYear ? `${p.firstYear}` : `${p.firstYear}–${p.lastYear}`

    // STATURE TIER — the primary bracket (multiple qualify/disqualify routes, not a binary win count).
    const winsRank = p.allTimeRanks.wins, polesRank = p.allTimeRanks.poles
    const immortal = p.titles >= 2 || (p.titles >= 1 && ((winsRank?.rank ?? 99) <= 3 || (polesRank?.rank ?? 99) <= 3)) || p.wins >= 30
    const contender = p.wins >= 6 || p.runnerUpYears.length >= 2 || (p.wins >= 3 && p.runnerUpYears.length >= 1)
    const bestOfRest = p.podiums >= 3 || p.poles >= 1 || (p.peak != null && p.peak.wdc <= 6)
    const tier: 'immortal' | 'champion' | 'nearly' | 'winner' | 'bestOfRest' | 'midfield' | 'footnote' =
      immortal ? 'immortal'
        : p.titles >= 1 ? 'champion'
          : p.wins >= 1 ? (contender ? 'nearly' : 'winner')
            : bestOfRest ? 'bestOfRest'
              : (p.points >= 20 || (p.seasons >= 4 && p.points > 0) || p.podiums >= 1) ? 'midfield'
                : 'footnote'
    const A = L[tier]

    // MODIFIERS (orthogonal continuums) → one "texture" sentence so two same-tier drivers still read apart:
    // dominance, machinery (over/under-performed the car), trajectory (peaked early/late), longevity.
    const carGap = p.peak && p.peak.teamWcc != null ? p.peak.teamWcc - p.peak.wdc : 0
    const machinery = p.peak && p.peak.teamWcc != null
      ? (p.peak.teamWcc >= 5 && carGap >= 4 ? 'draggedUp' : p.wins >= 3 && p.peak.teamWcc <= 2 ? 'goodCar' : '')
      : ''
    const span = Math.max(1, p.lastYear - p.firstYear)
    const bestPos = p.bestSeason ? (p.bestSeason.year - p.firstYear) / span : 0.5
    const trajectory = !p.bestSeason || p.seasons < 5 ? ''
      : (bestPos <= 0.34 && p.lastYear - p.bestSeason.year >= 3) ? 'faded' : (bestPos >= 0.66 ? 'lateBloom' : '')
    const textureKind = (p.titles >= 2 || (p.bestSeason != null && p.bestSeason.wins >= 8)) ? 'dominant'
      : machinery || trajectory || (p.seasons >= 15 ? 'marathon' : p.seasons <= 2 ? 'fleeting' : '')
    const ending = !p.lastSeason ? '' : p.lastSeason.tm?.beaten ? 'pushedOut'
      : p.lastSeason.wins > 0 ? 'wonLast' : p.lastSeason.tm ? 'heldUp' : 'faded'

    // Era peers = the CHAMPIONS/contenders they raced (never team-mates), each from their own record.
    const rivalPhrase = (r: LegendProfile['rivals'][number]): string => {
      const rs = { rname: r.name, rtitles: r.titles, rtitles_word: plural(r.titles, 'title'), rwins: r.wins, rwins_word: plural(r.wins, 'win') }
      if (r.relation === 'title') return fill(pick(r.titles >= 1 ? L.rivalPhrase.titleChamp : L.rivalPhrase.title, `${seed}|rv|${r.name}`), rs)
      return r.name
    }
    const eraRivals = p.rivals.filter((r) => r.relation === 'title').length ? p.rivals.filter((r) => r.relation === 'title') : p.rivals.filter((r) => r.relation === 'peer')

    const slots: Record<string, string | number> = {
      ...pronouns(p.gender),
      name: p.name, last: lastName(p.name), era, first_year: p.firstYear, last_year: p.lastYear,
      teams_list: listJoin(p.teams), main_team: p.teams[0] ?? '', team_count: p.teams.length,
      seasons: p.seasons, seasons_word: plural(p.seasons, 'season'), starts: p.starts, starts_word: plural(p.starts, 'start'),
      wins: p.wins, wins_word: plural(p.wins, 'win'), podiums: p.podiums, podiums_word: plural(p.podiums, 'podium'),
      poles: p.poles, poles_word: plural(p.poles, 'pole'), points: p.points,
      titles: p.titles, titles_word: plural(p.titles, 'title'), title_years: listJoin(p.titleYears.map(String)),
      rivals_list: eraRivals.length ? listJoin(eraRivals.map(rivalPhrase)) : '',
      best_year: p.bestSeason?.year ?? '', best_team: p.bestSeason?.team ?? '', best_wins: p.bestSeason?.wins ?? 0, best_wins_word: plural(p.bestSeason?.wins ?? 0, 'win'),
      sig_circuit: p.signatureWin?.circuit ?? '', sig_year: p.signatureWin?.year ?? '', sig_grid: p.signatureWin ? ordinal(p.signatureWin.fromGrid) : '',
      ru_years: listJoin(p.runnerUpYears.map(String)),
      peak_ord: p.peak ? ordinal(p.peak.wdc) : '', peak_year: p.peak?.year ?? '', peak_team: p.peak?.team ?? '', peak_wcc_ord: p.peak?.teamWcc ? ordinal(p.peak.teamWcc) : '',
      last_team: p.lastSeason?.team ?? '', last_wdc_ord: p.lastSeason?.wdc ? ordinal(p.lastSeason.wdc) : '',
      last_tm: p.lastSeason?.tm?.name ?? '', last_tm_qual: p.lastSeason?.tm ? `${p.lastSeason.tm.qual.split('–')[1]}–${p.lastSeason.tm.qual.split('–')[0]}` : '',
      last_replacement: p.lastSeason?.replacedBy ?? '',
      riv_name: p.marqueeRival?.name ?? '', riv_detail: p.marqueeRival?.detail ?? '',
    }
    // Podium count as a count-correct phrase, so the midfield tier (now able to hold 0–2 podium drivers)
    // never states the wrong tally. zero -> "no podium", one -> "a lone podium", many -> "{n} podiums".
    const podiumBracket = p.podiums === 0 ? 'zero' : p.podiums === 1 ? 'one' : 'many'
    slots.podium_tally = fill(pick(L.podiumTally[podiumBracket], `${seed}|ptally`), slots)

    const seg = (pool: string[] | undefined, key: string, when = true): string => pool && when ? fill(pick(pool, `${seed}|${key}`), slots) : ''
    const join = (...xs: string[]) => xs.filter(Boolean).join(' ')
    const hasSig = !!(p.signatureWin && p.signatureWin.circuit)

    // 1) LEAD — the tier's thesis, plus one modifier "texture" sentence so each driver reads distinctly.
    const lead = join(fill(pick(A.lead, `${seed}|lead`), slots), seg(L.texture[textureKind], 'tex', !!textureKind))

    // 2) RETROSPECTIVE, by ORDER OF SIGNIFICANCE: best season, then the biggest battle available
    //    (a title fight → a fight for a midfield position → a single great race), each used once.
    const battle = p.titleYears.length && slots.rivals_list ? seg(L.retro.titleWon, 'bt')
      : p.runnerUpYears.length && slots.rivals_list ? seg(L.retro.titleLost, 'bt')
        : (p.peak && p.peak.wdc <= 12 && slots.rivals_list) ? seg(L.retro.position, 'bt')
          : ''
    const retro = join(seg(L.retro.bestSeason, 'best', p.wins >= 1 && !!p.bestSeason), battle, seg(L.retro.race, 'race', hasSig))

    // 3) RIVAL QUOTE — the rival who matters most (intro = the relationship) + an assessment GRADED BY TIER,
    //    so a back-marker's rival doesn't call them the fastest they faced. intro × assessment combine.
    const quote = p.marqueeRival
      ? join(seg(L.rivalQuote.intro[p.marqueeRival.kind], 'qi'), seg(L.rivalQuote.assessment[tier], 'qa'))
      : ''

    // 4) LAST SEASON — how it ended. When they were pushed out / faded, name who took the seat; fall back to
    //    the anonymous wording when the team folded or kept the same line-up (no known replacement).
    const endKey = (ending === 'pushedOut' || ending === 'faded') && !slots.last_replacement ? `${ending}Anon` : ending
    const last = ending ? seg(L.lastSeason[endKey], 'last') : ''

    // 5) CONCLUSION — all-time standing, framed + a wins/podiums stature, or a plain verdict for footnotes.
    const rankList = (['wins', 'poles', 'podiums', 'points'] as const)
      .map((m) => ({ m, r: p.allTimeRanks[m] })).filter((x): x is { m: typeof x.m; r: { rank: number; value: number } } => !!x.r)
    const rankGroups: { rank: number; parts: string[] }[] = []
    for (const { m, r } of rankList) {
      const g = rankGroups.find((g) => g.rank === r.rank)
      if (g) g.parts.push(`${m} (${r.value})`); else rankGroups.push({ rank: r.rank, parts: [`${m} (${r.value})`] })
    }
    const asOf = `${LEGEND_MONTHS[Number(f.date.slice(5, 7)) - 1]} ${f.date.slice(0, 4)}`
    const statsRanks = listJoin(rankGroups.map((g) => `${ordinal(g.rank)} all-time in ${listJoin(g.parts)}`))
    const stature = fill(pick(L.stature[legendStature(p.wins, p.podiums)], `${seed}|stat`), slots)
    // The "no podium" flourish only for genuine zero-podium drivers; the stature line carries it otherwise.
    const podiumCoda = p.podiums === 0 ? fill(pick(L.podiumCoda.zero, `${seed}|coda`), slots) : ''
    const conclusion = rankList.length > 0 && tier !== 'footnote'
      ? fill(pick(A.conclusion, `${seed}|concl`), { ...slots, as_of: asOf, stats_line: statsRanks, stature, podium_coda: podiumCoda })
      : fill(pick(A.verdict, `${seed}|verdict`), slots)

    out.push({
      id: seed, category: 'legends', round: 0, priority: 40, absoluteDate: f.date,
      headline: fill(pick(L.headline, `${seed}|h`), slots),
      dek: fill(pick(A.dek, `${seed}|d`), slots),
      body: paras(lead, retro, quote, last, conclusion),
    })
  }
  return out
}
