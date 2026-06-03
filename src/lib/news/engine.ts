// Templated FM-style news engine. Pure + deterministic: given a snapshot of a season
// (the live store + calendar, or a context rebuilt from the archive DB), it returns a feed
// of articles. No LLM, no API cost.
//
// Variety without an LLM: bodies are assembled by `compose()` from independent fragment
// pools (opener x detail x closer), so a handful of authored strings yield hundreds of
// stable-but-distinct paragraphs. Each article seeds its picks off its own id, so wording
// never flickers between renders but reads differently article-to-article. Every article is
// built to run to at least five sentences.
//
// Cadence: most categories are paced, not fired every race.
//  - race_report      : one per race, consolidating result + start + attrition + title picture.
//  - milestone        : per race, only on a genuine first (first win of the season, surprise
//                       podium, team 1-2).
//  - technical_upgrade : one ROUNDUP per race, and only when a team actually upgraded.
//  - championship_state: only the clinch moments + a late-season title-fight watch.
//  - feature          : a long state-of-the-season read at half-distance + a season review.
//  - silly_season     : only at three points (mid / three-quarter / penultimate round), and the
//                       rumours are produced by actually running the market sim with a seeded
//                       -10..+10 error on each driver's media rating.
//  - analysis_opinion : at most one per round, the most newsworthy angle, with a recency bias.

import type {
  Driver, Team, RaceResult, DevUpgradeEvent,
  EndOfSeasonSummary, Circuit, SeasonPhase, ConstructorSeasonRecord,
} from '@/lib/sim/types'
import { computeDriverMediaScores, computeTeamMediaScores } from '@/lib/sim/media-scores'
import { computeRetentionDeltas, runDriverMarket } from '@/lib/sim/free-agency'
import { pick, chance, fill, ordinal, lastName, listJoin, plural, compose, mulberry32, clamp } from './util'

export interface NewsContext {
  year: number
  phase: SeasonPhase
  completedRounds: number          // raceResults.length
  drivers: Driver[]                // full roster incl. free agents (teamId === '')
  teams: Team[]
  raceResults: RaceResult[][]      // [round-1]
  upgradeEvents: DevUpgradeEvent[]
  constructorHistory: ConstructorSeasonRecord[]   // prior-season records (for silly-season team media)
  endOfSeason: EndOfSeasonSummary | null
  calendar: Circuit[]
  live: boolean                    // true = the active season from the store (full attributes available);
                                   // false = an archived season rebuilt from the DB (results only — the
                                   // attribute-dependent producers, e.g. trajectory/silly-season, stand down)
  careers?: Record<string, DriverCareer>  // F1 career totals per driver, as of this season. Optional —
                                          // producers that lean on it (retirement, driver-to-watch) degrade
                                          // gracefully when it is absent. starts === 0 (or no entry) means
                                          // the driver has never raced in F1; never infer that from age.
}

// Cross-season F1 career totals for one driver, accumulated up to (and including) the context's
// season. The only reliable way to tell a never-raced prospect (starts === 0) from an experienced
// free agent (starts > 0).
export interface DriverCareer {
  driverId: string
  starts: number
  wins: number
  podiums: number
  poles: number
  points: number
  seasons: number
  titles: number
  titleYears: number[]
  debutYear: number | null
  bestFinish: number | null   // best single-race finish position ever (1 = a win)
}

export interface NewsArticle {
  id: string
  category: string
  round: number      // chronological sort key: 0 = pre-season, 1..N = races, N+1 = off-season
  priority: number   // tiebreak within a round (higher = nearer the top)
  headline: string
  dek: string
  body: string
}

const DRIVER_MAX_PER_RACE = 25
const CONSTRUCTOR_MAX_PER_RACE = 43

// Join composed paragraphs, dropping any that collapsed to empty.
function paras(...parts: string[]): string {
  return parts.filter(Boolean).join('\n\n')
}

function teamName(ctx: NewsContext, id: string): string {
  return ctx.teams.find((t) => t.id === id)?.name ?? id
}

// Possessive form. Names ending in s (Mercedes, Williams, Haas, Racing Bulls) take a bare
// apostrophe; everything else takes 's.
function poss(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

function circuit(ctx: NewsContext, round: number): string {
  const name = ctx.calendar[round - 1]?.name
  return name ? name.replace(/\bGP\b/, 'Grand Prix') : `Round ${round}`
}

// Real-world track characteristics, keyed by circuit id. Unfalsifiable against the game (we
// model no track type), so safe to use as preview colour. One entry per 2026 circuit.
const CIRCUIT_TRAITS: Record<string, string> = {
  australia: 'the flowing rhythm of Albert Park',
  china: 'the long, energy-sapping corners of Shanghai',
  japan: 'the fast esses of Suzuka',
  bahrain: 'the abrasive Bahrain surface',
  'saudi-arabia': 'the high-speed walls of Jeddah',
  miami: 'the Miami heat',
  imola: 'the narrow, old-school Imola',
  monaco: 'the tight streets of Monaco',
  spain: 'the aero-hungry corners of Barcelona',
  canada: 'the stop-start rhythm of Montreal',
  austria: 'the short, punchy Red Bull Ring',
  britain: 'the high-speed sweeps of Silverstone',
  belgium: 'the long lap and fickle weather of Spa',
  hungary: 'the twisty, sweltering Hungaroring',
  netherlands: 'the banking of Zandvoort',
  italy: 'the low-downforce blast of Monza',
  azerbaijan: 'the long straight and unforgiving walls of Baku',
  singapore: 'the heat and humidity of Singapore',
  usa: 'the bumps and elevation of Austin',
  mexico: 'the thin air of Mexico City',
  brazil: 'the altitude and changeable skies of Interlagos',
  'las-vegas': 'the cold desert night of Las Vegas',
  qatar: 'the relentless high-speed corners of Lusail',
  'abu-dhabi': 'the smooth Yas Marina tarmac',
}

// Finishers first (by position), DNFs last.
function sortedResults(results: RaceResult[]): RaceResult[] {
  return [...results].sort((a, b) => {
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1
    return (a.finishPosition ?? 99) - (b.finishPosition ?? 99)
  })
}

// car-pace rank: 1 = fastest car on the grid. Meaningless for archived contexts (carPace 0).
function paceRank(ctx: NewsContext, teamId: string): number {
  const sorted = [...ctx.teams].sort((a, b) => b.carPace - a.carPace)
  return sorted.findIndex((t) => t.id === teamId) + 1
}

function tierWord(rank: number, total: number): string {
  if (rank <= Math.max(2, total / 3)) return 'front-running'
  if (rank <= (2 * total) / 3) return 'midfield'
  return 'backmarker'
}

interface SimpleStanding {
  driverId: string; driverName: string; teamId: string; teamName: string; points: number; wins: number
}

// Driver standings as they stood AFTER `round` completed rounds (0 = before any race).
// Computed from the result slices so it works identically for live and archived contexts.
function driverStandingsAfter(ctx: NewsContext, round: number): SimpleStanding[] {
  const map = new Map<string, SimpleStanding>()
  for (let r = 0; r < round && r < ctx.raceResults.length; r++) {
    for (const res of ctx.raceResults[r] ?? []) {
      let s = map.get(res.driverId)
      if (!s) {
        s = { driverId: res.driverId, driverName: res.driverName, teamId: res.teamId, teamName: res.teamName, points: 0, wins: 0 }
        map.set(res.driverId, s)
      }
      s.points += res.points
      if (res.finishPosition === 1) s.wins++
      s.teamId = res.teamId
      s.teamName = res.teamName
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins)
}

function constructorStandingsAfter(ctx: NewsContext, round: number): { teamId: string; teamName: string; points: number }[] {
  const map = new Map<string, { teamId: string; teamName: string; points: number }>()
  for (let r = 0; r < round && r < ctx.raceResults.length; r++) {
    for (const res of ctx.raceResults[r] ?? []) {
      let s = map.get(res.teamId)
      if (!s) { s = { teamId: res.teamId, teamName: res.teamName, points: 0 }; map.set(res.teamId, s) }
      s.points += res.points
      s.teamName = res.teamName
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points)
}

// Most-recent-first finishing positions for a driver up to and including `round`. A DNF
// counts as a notional 30th so a run of retirements reads as a slump.
function recentFinishesUpTo(ctx: NewsContext, driverId: string, round: number, n: number): number[] {
  const out: number[] = []
  for (let r = Math.min(round, ctx.raceResults.length); r >= 1 && out.length < n; r--) {
    const row = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === driverId)
    if (!row) continue
    out.push(row.dnf || row.finishPosition == null ? 30 : row.finishPosition)
  }
  return out
}

// Has this driver won / reached the podium earlier in the season (rounds 1..before)?
function wonBefore(ctx: NewsContext, driverId: string, before: number): boolean {
  for (let r = 1; r < before; r++) {
    if ((ctx.raceResults[r - 1] ?? []).some((x) => x.driverId === driverId && x.finishPosition === 1)) return true
  }
  return false
}
function podiumBefore(ctx: NewsContext, driverId: string, before: number): boolean {
  for (let r = 1; r < before; r++) {
    if ((ctx.raceResults[r - 1] ?? []).some((x) => x.driverId === driverId && !x.dnf && x.finishPosition != null && x.finishPosition <= 3)) return true
  }
  return false
}

// Plain, slot-safe gap figure ("0.849s" / "13.4s") that reads correctly in every sentence
// position ("by {margin}", "{margin} clear", "fell {margin} short"). Empty when unknown.
function marginWord(gap: number | null): string {
  if (gap == null) return ''
  if (gap < 1) return `just ${gap.toFixed(3)}s`
  return `${gap.toFixed(1)}s`
}

// Invented, unfalsifiable colour. The rule: a texture line may NEVER reference a tracked
// quantity (position, points, gap, lap, another driver's result). It is either sentiment that
// matches the known outcome or fully orthogonal to anything we model, so it cannot contradict
// the standings / driver / classification views. Gated so it stays texture, not boilerplate.
const TEXTURE_PCT = 66
function texture(seed: string, pool: string[], slots: Record<string, string | number>, pct: number = TEXTURE_PCT): string {
  if (pool.length === 0 || !chance(`${seed}|tex`, pct)) return ''
  return fill(pick(pool, `${seed}|tex`), slots)
}

// Upgrades are fully abstracted in the data (we only know a team upgraded and whether it
// worked), so naming the actual component and what it targets is pure unfalsifiable colour.
const UPGRADE_PARTS = [
  'front wing', 'floor', 'rear wing', 'diffuser', 'sidepod package', 'engine cover',
  'suspension package', 'brake-duct package', 'beam wing', 'front-wing endplate',
]
const UPGRADE_AREAS = [
  'low-speed balance', 'high-speed stability', 'tyre wear', 'straight-line speed',
  'overall downforce', 'cooling', 'rear-end grip', 'front-end bite', 'kerb-riding',
]

// --- Safe-detail helpers: every value below is an observable fact (results, fixed circuit
// metadata, nationality) or a count derived from results, so it can never contradict the game.

// A driver racing in their own country (driver nationality === circuit country, both ISO-2).
function isHomeRace(ctx: NewsContext, driverId: string, round: number): boolean {
  const c = ctx.calendar[round - 1]
  const nat = ctx.drivers.find((d) => d.id === driverId)?.nationality ?? ''
  return !!c && !!nat && c.country === nat
}

// Wins a driver has up to and including `round`, this season.
function winsUpTo(ctx: NewsContext, driverId: string, round: number): number {
  let n = 0
  for (let r = 1; r <= round && r <= ctx.raceResults.length; r++) {
    if ((ctx.raceResults[r - 1] ?? []).some((x) => x.driverId === driverId && x.finishPosition === 1)) n++
  }
  return n
}

// Whether this team has already had a 1-2 earlier this season (before `round`).
function teamOneTwoBefore(ctx: NewsContext, teamId: string, round: number): boolean {
  for (let r = 1; r < round; r++) {
    const top2 = sortedResults(ctx.raceResults[r - 1] ?? []).filter((x) => !x.dnf && x.finishPosition != null).slice(0, 2)
    if (top2.length === 2 && top2[0].teamId === teamId && top2[1].teamId === teamId) return true
  }
  return false
}

function bestQuali(r: RaceResult): number | null {
  return r.q3Time ?? r.q2Time ?? r.q1Time
}

// Pole margin (P1 vs P2 on the grid) as a string, or null when unknown / implausible.
function poleMargin(results: RaceResult[]): string | null {
  const p1 = results.find((x) => x.gridPosition === 1)
  const p2 = results.find((x) => x.gridPosition === 2)
  if (!p1 || !p2) return null
  const a = bestQuali(p1), b = bestQuali(p2)
  if (a == null || b == null) return null
  const d = b - a
  if (d <= 0 || d > 5) return null
  return `${d.toFixed(3)}s`
}

const TYRE_PLURAL: Record<string, string> = {
  soft: 'softs', medium: 'mediums', hard: 'hards', intermediate: 'intermediates', wet: 'wets',
}
function strategyPhrase(stints: RaceResult['stints']): string | null {
  if (!stints || stints.length === 0) return null
  const stops = stints.length - 1
  if (stops <= 0) return 'a no-stop run'
  if (stops === 1) return 'a one-stop strategy'
  if (stops === 2) return 'a two-stop strategy'
  if (stops === 3) return 'a three-stop strategy'
  return `a ${stops}-stop strategy`
}
function startingTyre(stints: RaceResult['stints']): string | null {
  const c = stints?.[0]?.compound
  return c ? (TYRE_PLURAL[c] ?? c) : null
}

// Format a recent finish for prose. recentFinishesUpTo uses 30 as the DNF sentinel, and a
// real grid never reaches 30th, so >= 30 reliably means a retirement.
function fmtFinish(pos: number): string {
  return pos >= 30 ? 'a retirement' : ordinal(pos)
}

// Points a driver scored across the last `x` completed rounds (ending at `round`).
function pointsInWindow(ctx: NewsContext, driverId: string, round: number, x: number): number {
  let p = 0
  for (let rr = Math.max(1, round - x + 1); rr <= round; rr++) {
    const row = (ctx.raceResults[rr - 1] ?? []).find((z) => z.driverId === driverId)
    if (row) p += row.points
  }
  return p
}

// For a teammate gap, pick the recent window (3..6 races) that tells the starkest story, and
// say whether the trailing driver is clawing back or falling further behind. Returns null if
// there aren't enough rounds. `trend` is 'fightback' | 'widening' | 'steady'.
function teammateTrend(ctx: NewsContext, aheadId: string, behindId: string, round: number):
  { x: number; ra: number; rb: number; trend: 'fightback' | 'widening' | 'steady' } | null {
  if (round < 3) return null
  let best: { x: number; ra: number; rb: number } | null = null
  let bestScore = -1
  for (const x of [3, 4, 5, 6]) {
    if (x > round) break
    const ra = pointsInWindow(ctx, aheadId, round, x)
    const rb = pointsInWindow(ctx, behindId, round, x)
    // Prefer a window where the trailing driver is ahead recently (fightback, the more telling
    // angle); otherwise the one with the starkest PER-RACE margin, so a concentrated recent
    // stretch beats a longer window that merely accumulates a bigger raw number.
    const score = (rb - ra >= 4 ? 1000 : 0) + Math.abs(ra - rb) / x
    if (score > bestScore) { bestScore = score; best = { x, ra, rb } }
  }
  if (!best) return null
  const diff = best.rb - best.ra
  const trend = diff >= 4 ? 'fightback' : (best.ra - best.rb >= 4 ? 'widening' : 'steady')
  return { x: best.x, ra: best.ra, rb: best.rb, trend }
}

// A team's finishing position last season, from the constructor history (null in year one).
function lastSeasonPos(ctx: NewsContext, teamId: string): number | null {
  const recs = ctx.constructorHistory.filter((h) => h.teamId === teamId).sort((a, b) => b.seasonYear - a.seasonYear)
  return recs[0]?.finalPosition ?? null
}

// F1 career totals for a driver, if the caller supplied them. starts > 0 ⇔ has raced in F1.
function careerOf(ctx: NewsContext, id: string): DriverCareer | null {
  return ctx.careers?.[id] ?? null
}

// Gendered pronoun slots for a single driver, so copy reads with natural pronouns (he/she, his/her,
// him/her, ...) instead of contorting to stay neutral. A driver's gender is always known.
function pronouns(gender: string | undefined): Record<string, string> {
  const f = gender === 'female'
  return {
    they: f ? 'she' : 'he', they_cap: f ? 'She' : 'He',
    them: f ? 'her' : 'him', their: f ? 'her' : 'his', their_cap: f ? 'Her' : 'His',
    theirs: f ? 'hers' : 'his', themself: f ? 'herself' : 'himself', theyre: f ? 'she\'s' : 'he\'s',
  }
}

// Extend a careers map (DB totals for prior seasons) with one in-progress/just-finished season's
// results from the live store, so the live newsroom sees a complete, up-to-date career. The base
// must NOT already include `year` (we always count the current season from the store, never the
// DB, to stay correct regardless of when the season is archived). Pass `championId` once the
// season has ended to credit the title the archive does not record until it is archived.
export function foldLiveSeason(
  base: Record<string, DriverCareer>,
  year: number,
  raceResults: { driverId: string; finishPosition: number | null; gridPosition: number; points: number }[][],
  championId?: string | null,
): Record<string, DriverCareer> {
  const out: Record<string, DriverCareer> = {}
  for (const [k, v] of Object.entries(base)) out[k] = { ...v, titleYears: [...v.titleYears] }
  const seenThisSeason = new Set<string>()
  for (const round of raceResults) for (const res of round) {
    const id = res.driverId
    let c = out[id]
    if (!c) c = out[id] = { driverId: id, starts: 0, wins: 0, podiums: 0, poles: 0, points: 0, seasons: 0, titles: 0, titleYears: [], debutYear: null, bestFinish: null }
    const fp = res.finishPosition
    c.starts++
    c.points += res.points
    if (res.gridPosition === 1) c.poles++
    if (fp != null && fp === 1) c.wins++
    if (fp != null && fp <= 3) c.podiums++
    if (fp != null && (c.bestFinish == null || fp < c.bestFinish)) c.bestFinish = fp
    if (c.debutYear == null || year < c.debutYear) c.debutYear = year
    if (!seenThisSeason.has(id)) { seenThisSeason.add(id); c.seasons++ }
  }
  if (championId && out[championId] && !out[championId].titleYears.includes(year)) {
    out[championId].titles++
    out[championId].titleYears = [...out[championId].titleYears, year].sort((a, b) => a - b)
  }
  return out
}

// --- Producers ---------------------------------------------------------------

// TRIGGER: every completed round. ONE consolidated report per race — winner + podium +
// margin, the start (pole / drive of the day), attrition (DNFs), and the title picture.
// This is the category that fires every race; incident/retirement/championship live inside it.
function raceReports(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  const N = ctx.calendar.length
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const results = ctx.raceResults[r - 1] ?? []
    const sorted = sortedResults(results)
    const podium = sorted.filter((x) => !x.dnf && x.finishPosition != null).slice(0, 3)
    if (podium.length === 0) continue
    const [p1, p2, p3] = podium
    const gap = p2 && p2.totalTime != null && p1.totalTime != null ? p2.totalTime - p1.totalTime : null
    const margin = marginWord(gap)
    const pole = results.find((x) => x.gridPosition === 1)
    const fromPole = !!pole && pole.driverId === p1.driverId

    let mover: RaceResult | null = null
    let moverGain = 0
    for (const x of sorted) {
      if (x.dnf || x.finishPosition == null) continue
      const gainPlaces = x.gridPosition - x.finishPosition
      if (gainPlaces > moverGain) { moverGain = gainPlaces; mover = x }
    }

    const dnfs = sorted.filter((x) => x.dnf)
    const dnfNames = dnfs.map((x) => x.driverName)

    const afterR = driverStandingsAfter(ctx, r)
    const afterPrev = driverStandingsAfter(ctx, r - 1)
    const leader = afterR[0]
    const leadGap = leader ? leader.points - (afterR[1]?.points ?? 0) : 0
    const prevLeaderId = afterPrev[0]?.driverId
    const leadChanged = !!leader && !!prevLeaderId && leader.driverId !== prevLeaderId
    const remaining = N - r
    const racesLeft = `${remaining} ${plural(remaining, 'race')}`
    const clinched = !!leader && afterR.length >= 2 && remaining > 0 && leadGap > remaining * DRIVER_MAX_PER_RACE

    // Safe, specific colour.
    const winnerHome = isHomeRace(ctx, p1.driverId, r)
    const winnerWins = winsUpTo(ctx, p1.driverId, r)
    const pMargin = poleMargin(results)
    const strat = strategyPhrase(p1.stints)
    const startTyre = startingTyre(p1.stints)
    const nextName = r < N ? circuit(ctx, r + 1) : null
    const dnfSolo = dnfs.length === 1 ? dnfs[0] : null
    const hasMargin = margin !== ''
    const faller = dnfs[0] ?? null

    const circuitName = circuit(ctx, r)
    const seed = `report-${ctx.year}-${r}`
    const slots: Record<string, string | number> = {
      winner: p1.driverName, winner_last: lastName(p1.driverName), team: p1.teamName,
      p2: p2?.driverName ?? '', p2_last: p2 ? lastName(p2.driverName) : '', p3: p3?.driverName ?? '',
      circuit: circuitName, margin, points: p1.points, pole: pole?.driverName ?? '', pole_last: pole ? lastName(pole.driverName) : '',
      mover: mover?.driverName ?? '', mover_from: ordinal(mover?.gridPosition ?? 0), mover_to: ordinal(mover?.finishPosition ?? 0),
      mover_gain: moverGain, leader: leader?.driverName ?? '', second: afterR[1]?.driverName ?? '',
      lead_gap: leadGap, leader_points: leader?.points ?? 0, round: r, races_left: racesLeft,
      dnf_list: listJoin(dnfNames), dnf_count: dnfs.length, cars: plural(dnfs.length, 'car'),
      win_ord: ordinal(winnerWins), pole_margin: pMargin ?? '', strategy: strat ?? '', start_tyre: startTyre ?? '',
      next_circuit: nextName ?? '', dnf_solo: dnfSolo?.driverName ?? '', dnf_solo_laps: dnfSolo?.lapsCompleted ?? 0,
      faller: faller ? lastName(faller.driverName) : '', faller_team: faller?.teamName ?? '',
    }

    const leadPara = compose(`${seed}:lead`, slots,
      [
        '{winner} won the {circuit}.', '{winner} took victory at the {circuit}.',
        'Victory at the {circuit} went to {winner}.', '{winner} took the win at the {circuit}.',
        'It was {winner} who came out on top at the {circuit}.', 'The {circuit} belonged to {winner}.',
        '{winner} delivered when it counted at the {circuit}.', 'There was no stopping {winner} at the {circuit}.',
        '{winner} held on to win the {circuit}.', 'A polished afternoon gave {winner} the {circuit}.',
      ],
      hasMargin
        ? [
            'The {team} driver came home {margin} clear of {p2}, with {p3} completing the podium.',
            'A win by {margin} over {p2} sealed it, {p3} third on the rostrum.',
            '{p2} finished {margin} adrift in second, {p3} rounding out the top three.',
            'Behind, {p2} took second and {p3} third, beaten by {margin}.',
            '{margin} covered the win as {p2} and {p3} filled out the podium.',
            '{p2} chased hard but fell {margin} short, {p3} next up.',
            'It was {margin} back to {p2}, with {p3} claiming the final podium spot.',
          ]
        : [
            '{p2} took second and {p3} completed the podium.',
            '{p2} followed home in second, with {p3} third.',
            'Behind, {p2} and {p3} rounded out the top three.',
            '{p2} was next, with {p3} claiming the final podium spot.',
          ],
      winnerHome
        ? [
            'The win came on home soil.', 'It was a home victory to savour for {winner_last}.',
            'Few wins mean more than one in front of your own crowd.',
          ]
        : [''],
      [
        'It is worth the full {points} points.', '{winner_last} banks the maximum {points} points.',
        'The win is worth {points} points.', 'That is {points} points for {winner_last}.',
        'It is another {points}-point score for {winner_last}.',
      ],
    )

    const startPool = fromPole
      ? [
          'Starting from pole, {winner_last} controlled the race from the front.',
          '{winner_last} converted pole into a lights-to-flag win.',
          'From the front of the grid {winner_last} was never seriously headed.',
          'Pole turned into a win as {winner_last} dictated the pace throughout.',
          '{winner_last} led every lap that mattered after starting on pole.',
          'It was a textbook drive from pole for {winner_last}.',
        ]
      : pole
      ? [
          '{pole_last} had started from pole, but it was {winner_last} who took the flag.',
          'Pole-sitter {pole_last} could not convert as {winner_last} came through.',
          '{winner_last} got the better of pole-man {pole_last} when it mattered most.',
          'The pole, taken by {pole_last}, did not translate into the win.',
          '{pole_last} led early from pole before {winner_last} found a way by.',
          '{winner_last} overhauled pole-sitter {pole_last} to take the win.',
        ]
      : ['{winner_last} judged the race perfectly to take the win.', '{winner_last} timed the run to perfection.']
    const moverPool = moverGain >= 4 && mover
      ? [
          'The drive of the day belonged to {mover}, up from {mover_from} to {mover_to}.',
          '{mover} made the biggest gains, climbing from {mover_from} to {mover_to}.',
          'A charge from {mover} lit up the order, {mover_gain} places gained.',
          '{mover} carved through the field from {mover_from} to {mover_to}.',
          'Few moved like {mover}, who went from {mover_from} to {mover_to}.',
          'A standout recovery saw {mover} climb from {mover_from} to {mover_to}.',
        ]
      : ['']
    const qualiPool = pMargin && pole
      ? ['{pole_last} had taken pole by {pole_margin} on Saturday.', 'Qualifying had gone the way of {pole_last} by {pole_margin}.', '{pole_last} had edged pole by {pole_margin}.']
      : ['']
    const stratPool = strat
      ? [
          'The win was built on {strategy}.', '{winner_last} made {strategy} work.',
          'It was {strategy} that proved the right call for {winner_last}.',
          startTyre ? '{winner_last} started on {start_tyre} and built {strategy} from there.' : 'The {team} pit wall judged {strategy} to perfection.',
        ]
      : ['']
    const startPara = compose(`${seed}:story`, slots, startPool, qualiPool, moverPool, stratPool)

    const attritionPara = dnfs.length === 0
      ? compose(`${seed}:dnf`, slots, [
          'A clean race saw the full field reach the flag.',
          'There were no retirements; every car was classified.',
          'Reliability held across the grid with nobody dropping out.',
          'For once the race ran without a single retirement.',
          'Every car that started also finished, a rarity in itself.',
        ])
      : dnfSolo
      ? compose(`${seed}:dnf`, slots, [
          '{dnf_solo} was the only retirement, out after {dnf_solo_laps} laps.',
          'Only {dnf_solo} failed to finish, retiring after {dnf_solo_laps} laps.',
          'The lone retirement was {dnf_solo}, gone by lap {dnf_solo_laps}.',
        ])
      : compose(`${seed}:dnf`, slots,
          [
            '{dnf_count} {cars} failed to finish.', 'The race claimed {dnf_count} {cars}.',
            'Attrition accounted for {dnf_count} {cars}.', 'There were {dnf_count} retirements.',
            'Not everyone made the flag, with {dnf_count} {cars} sidelined.',
          ],
          [
            '{dnf_list} dropped out.', '{dnf_list} were the cars to retire.',
            '{dnf_list} did not see the flag.', '{dnf_list} failed to reach the flag.',
            '{dnf_list} were left to rue what might have been.',
          ])

    const texturePool = [
      '{winner_last} looked spent climbing from the cockpit.',
      'Over the team radio, it sounded like one of the harder afternoons of the year for {winner_last}.',
      '{winner_last} was treated for dehydration once the cameras had moved on.',
      'The {team} mechanics were waiting at parc ferme to mob {winner_last}.',
      'A scruffy pit stop briefly set nerves jangling on the {team} wall.',
      '{winner_last} kept the visor down through most of the slow-down lap.',
      'The {team} garage exhaled as one when the flag fell.',
      '{winner_last} admitted afterwards to barely feeling the closing laps.',
      'There were tired smiles all round in the {team} engineering room.',
    ]
    if (faller) texturePool.push(
      '{faller} cut a frustrated figure on the long walk back.',
      'There was little to say in the {faller_team} garage afterwards.',
      '{faller} sat quietly for a while before facing anyone.',
    )
    const texturePara = texture(seed, texturePool, slots)
    // Occasional invented winner quote (first-person, so no gender issue; generic, so it cannot
    // contradict the result).
    const quotePara = texture(`${seed}|q`, [
      '"The car felt mega all day," said {winner_last} afterwards.',
      '"Huge effort from the whole team," {winner_last} said.',
      '"That is right up there with my best weekends," reflected {winner_last}.',
      '"We executed it just about perfectly," said {winner_last}.',
      '"I could not have asked for more out there," {winner_last} said.',
      '"Days like this are why you do it," {winner_last} said.',
    ], slots, 30)

    const champPool = !leader
      ? ['']
      : clinched
      ? [
          'With the win, {leader} cannot now be caught in the championship.',
          'The result puts the title beyond doubt, and {leader} is now uncatchable.',
          '{leader} has effectively wrapped up the championship, {lead_gap} clear with {races_left} to run.',
        ]
      : leadChanged
      ? [
          'The result swings the championship, and {leader} now leads.',
          'There is a new name on top of the standings in {leader}.',
          '{leader} takes over at the head of the table, {lead_gap} ahead of {second}.',
          'The points lead changes hands, with {leader} now in front of {second}.',
        ]
      : [
          'In the championship, {leader} stays in front, {lead_gap} clear of {second}.',
          '{leader} retains the points lead on {leader_points}, {lead_gap} up on {second}.',
          'Atop the standings, {leader} holds firm with a {lead_gap}-point cushion over {second}.',
          '{leader} extends control of the championship over {second}.',
        ]
    const champPara = compose(`${seed}:champ`, slots, champPool)

    const closerPara = compose(`${seed}:closer`, slots,
      [
        'It is {winner_last}\'s {win_ord} win of the season.',
        'That makes it the {win_ord} win of the campaign for {winner_last}.',
        'The {win_ord} win of the year goes to {winner_last}.',
      ],
      nextName
        ? [
            'Next up is the {next_circuit}.',
            'Attention turns to the {next_circuit}.',
            'The {next_circuit} is next on the calendar.',
          ]
        : [
            'That brings the season to its close.',
            'And with that, the campaign is done.',
            'The season ends here.',
          ])

    out.push({
      id: seed, category: 'race_report', round: r, priority: 90,
      headline: fill(pick([
        '{winner} wins the {circuit}', '{winner} takes the {circuit}', '{winner} triumphs at the {circuit}',
        '{winner} masters the {circuit}', '{winner} conquers the {circuit}', '{winner} seals {circuit} victory',
        '{winner} on top at the {circuit}', '{winner} delivers at the {circuit}', 'The {circuit} goes to {winner}',
        'Victory for {winner} at the {circuit}', '{winner} reigns at the {circuit}', '{winner_last} wins the {circuit}',
        '{winner} untouchable at the {circuit}', '{winner} the class of the field at the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{winner} leads home {p2} and {p3}.',
        ...(hasMargin ? ['{winner} wins the {circuit} by {margin} from {p2}.'] : []),
        '{winner} beats {p2} and {p3} to the flag.', '{winner} wins the {circuit} ahead of {p2}.',
        '{winner} controls the {circuit} for {team}.', 'The {team} driver takes the spoils at the {circuit}.',
        '{winner} sees off {p2} to win the {circuit}.', 'Another {circuit} to remember for {winner}.',
      ], `${seed}|d`), slots),
      body: paras(leadPara, startPara, attritionPara, texturePara, champPara, quotePara, closerPara),
    })
  }
  return out
}

// TRIGGER: per race, on a genuine first — a driver winning for the first time this season, a
// surprise podium (a podium for a non-top-pace team, first of the year for that driver), or a
// team 1-2. At most a couple per race; naturally rare.
function milestones(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const sorted = sortedResults(ctx.raceResults[r - 1] ?? [])
    const podium = sorted.filter((x) => !x.dnf && x.finishPosition != null).slice(0, 3)
    if (podium.length === 0) continue
    const [p1, p2] = podium
    const circuitName = circuit(ctx, r)

    // First win of the season for this driver.
    if (!wonBefore(ctx, p1.driverId, r)) {
      const seed = `mile-win-${ctx.year}-${p1.driverId}-${r}`
      const homeWin = isHomeRace(ctx, p1.driverId, r)
      const slots = { driver: p1.driverName, driver_last: lastName(p1.driverName), team: p1.teamName, circuit: circuitName, year: ctx.year }
      out.push({
        id: seed, category: 'milestone', round: r, priority: 70,
        headline: fill(pick([
          'First win of the season for {driver}', '{driver} breaks through at the {circuit}',
          '{driver} opens the {year} account', '{driver} wins for the first time this year',
          'A maiden {year} victory for {driver}', '{driver} gets off the mark at the {circuit}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{driver} claims a first win of the {year} campaign.',
          'The {circuit} delivers {driver} a first victory of the year.',
          '{driver} finally tops the podium in {year}.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{driver} has won for the first time this season.', 'The wait for a {year} win is over for {driver}.', '{driver} stood on the top step for the first time this year.'],
            ['It came at the {circuit}, and it was thoroughly deserved.', 'The {circuit} provided the breakthrough.', 'A strong weekend at the {circuit} delivered the goods.'],
            homeWin
              ? ['Sweeter still, it came on home soil.', 'And the breakthrough came in front of a home crowd.']
              : ['']),
          compose(`${seed}:p2`, slots,
            ['For {team}, it is a significant moment in the campaign.', 'The result lifts {team} and their driver alike.', 'It is a result {team} have been building towards.'],
            ['Momentum can be a powerful thing once the first win arrives.', 'A first victory often unlocks more.', 'Confidence will flow from a day like this.']),
          compose(`${seed}:p3`, slots,
            ['{driver_last} will hope this is the first of many.', 'The challenge now is to back it up.', 'Whether it sparks a run remains to be seen.'],
            ['Either way, it is a weekend that will be remembered.', 'It changes the complexion of the season.', 'The grid has been put on notice.']),
          texture(seed, [
            '{driver_last} was mobbed in parc ferme.',
            'The radio message said it all, even if the words did not.',
            '{driver_last} needed a quiet moment before facing the cameras.',
            'The {team} garage erupted the instant the flag fell.',
          ], slots),
          texture(`${seed}|q`, [
            '"I have waited a long time for this," said {driver_last}.',
            '"This one means everything," {driver_last} said.',
            '"To finally get it done feels unreal," said {driver_last}.',
            '"That is for the whole team," {driver_last} said.',
          ], slots, 35),
        ),
      })
    }

    // Team 1-2 — only the FIRST of the season for that team (a dominant team locks out the top
    // two most weekends; firing every time is repetitive).
    if (p1 && p2 && p1.teamId === p2.teamId && !teamOneTwoBefore(ctx, p1.teamId, r)) {
      const seed = `mile-12-${ctx.year}-${p1.teamId}-${r}`
      const slots = { team: p1.teamName, d1: p1.driverName, d2: p2.driverName, circuit: circuitName, year: ctx.year }
      out.push({
        id: seed, category: 'milestone', round: r, priority: 60,
        headline: fill(pick([
          '{team} lock out the top two at the {circuit}', 'A {team} one-two at the {circuit}',
          '{team} dominate the {circuit}', '{d1} and {d2} give {team} a one-two',
          'Perfect day for {team} at the {circuit}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{team} take both top steps at the {circuit}.',
          '{d1} leads home {d2} for a {team} one-two.',
          'A maximum-haul afternoon for {team}.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{team} could hardly have scripted it better at the {circuit}.', 'It was a near-perfect afternoon for {team}.', '{team} dominated proceedings at the {circuit}.'],
            ['{d1} led home teammate {d2} for a one-two.', '{d1} and {d2} filled the top two places.', 'Both cars came home at the front, {d1} ahead of {d2}.']),
          compose(`${seed}:p2`, slots,
            ['It is their first one-two of the season.', 'It marks a first one-two of the campaign for {team}.', 'A maiden one-two of the year for the team.'],
            ['A one-two is the maximum a team can take from a race.', 'It is the kind of result that defines a season.', 'Days like this do not come along often.'],
            ['The points swing is enormous in the constructors race.', 'The constructors standings take a serious jolt.', 'Rivals will have watched on with concern.']),
          compose(`${seed}:p3`, slots,
            ['Both sides of the garage delivered when it mattered.', 'The whole operation can take a bow.', 'It is a statement of intent from {team}.'],
            ['The challenge now is to make it a habit.', 'Sustaining this will be the next test.', 'For now, {team} can simply enjoy it.']),
        ),
      })
    }

    // Surprise podium (live only — needs car pace): a podium for a slower car, first of the year.
    if (ctx.live) {
      for (const d of podium) {
        if (d.driverId === p1.driverId) continue
        if (paceRank(ctx, d.teamId) <= 3) continue
        if (podiumBefore(ctx, d.driverId, r)) continue
        const seed = `mile-pod-${ctx.year}-${d.driverId}-${r}`
        const slots = { driver: d.driverName, driver_last: lastName(d.driverName), team: d.teamName, circuit: circuitName, pos: ordinal(d.finishPosition ?? 0), year: ctx.year }
        out.push({
          id: seed, category: 'milestone', round: r, priority: 55,
          headline: fill(pick([
            'Surprise podium for {driver} at the {circuit}', '{driver} crashes the podium party',
            '{team} steal a podium at the {circuit}', '{driver} defies the odds at the {circuit}',
            'An unlikely rostrum for {driver}',
          ], `${seed}|h`), slots),
          dek: fill(pick([
            '{driver} grabs a first podium of the season for {team}.',
            'A {pos}-place finish puts {driver} on the rostrum.',
            'Few saw {driver} on the podium coming.',
          ], `${seed}|d`), slots),
          body: paras(
            compose(`${seed}:p1`, slots,
              ['{driver} produced a podium few expected at the {circuit}.', 'Against the odds, {driver} reached the rostrum.', 'It was a standout result for {driver} at the {circuit}.'],
              ['It is a first podium of the season for the {team} driver.', 'The {team} car is not usually a podium contender.', 'On paper, {team} had no business being up there.']),
            compose(`${seed}:p2`, slots,
              ['Opportunity met execution on a day that broke their way.', 'When the chance came, {driver_last} took it.', 'A clean, opportunistic drive made the difference.'],
              ['Results like this can lift a whole team.', 'The garage will be walking on air.', 'Moments like this are why they go racing.']),
            compose(`${seed}:p3`, slots,
              ['Replicating it will be the hard part.', 'Whether it is a one-off or a sign of things to come is the question.', 'For now, it is simply a day to savour.'],
              ['{driver_last} has given everyone something to think about.', 'The midfield just got a little more interesting.', 'It is a timely reward for honest graft.']),
            texture(seed, [
              'The {team} mechanics could not quite believe it either.',
              '{driver_last} wore a grin that said it all on the slow-down lap.',
              'It was the kind of afternoon a driver remembers for years.',
            ], slots),
          ),
        })
        break // at most one surprise-podium piece per race
      }
    }
  }
  return out
}

// TRIGGER: any team delivered an upgrade this round (M3 dev cycles). ONE roundup per race,
// grouping every team's package together — skipped entirely if nobody upgraded.
function technicalRoundup(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const evs = ctx.upgradeEvents.filter((e) => e.round === r)
    if (evs.length === 0) continue
    const delivered = evs.filter((e) => !e.failed).map((e) => teamName(ctx, e.teamId))
    const missed = evs.filter((e) => e.failed).map((e) => teamName(ctx, e.teamId))
    const circuitName = circuit(ctx, r)
    const seed = `tech-${ctx.year}-${r}`
    // A representative upgrading team: its real constructor position grounds the closing line,
    // and one of its drivers carries the (invented, unfalsifiable) mood line.
    // The representative team is the BIGGEST delivered upgrade this round (largest pace gain),
    // so "the eye-catcher" genuinely is the most significant package; fall back to the biggest
    // of the misfires if none delivered.
    const repPool = evs.filter((e) => !e.failed).length ? evs.filter((e) => !e.failed) : evs
    const repTeamId = [...repPool].sort((a, b) => b.paceDelta - a.paceDelta)[0].teamId
    const repTeamDrivers = ctx.drivers.filter((d) => d.teamId === repTeamId)
    const repDriver = repTeamDrivers.length ? pick(repTeamDrivers, `${seed}|updrv`) : undefined
    const cstandTech = constructorStandingsAfter(ctx, r)
    const repPosIdx = cstandTech.findIndex((c) => c.teamId === repTeamId)
    const repPos = repPosIdx >= 0 ? ordinal(repPosIdx + 1) : ''
    const repDelivered = delivered.length > 0 // rep is a delivered team if any delivered, else a misfire
    const slots: Record<string, string | number> = {
      circuit: circuitName, delivered: listJoin(delivered), missed: listJoin(missed),
      n: evs.length, teams: plural(evs.length, 'team'),
      up_driver: repDriver ? lastName(repDriver.name) : '',
      rep_team: teamName(ctx, repTeamId), rep_team_poss: poss(teamName(ctx, repTeamId)), rep_pos: repPos,
      part: pick(UPGRADE_PARTS, `${seed}|part`), area: pick(UPGRADE_AREAS, `${seed}|area`),
    }
    const intro = compose(`${seed}:intro`, slots,
      [
        'The {circuit} brought a fresh wave of development to the grid.',
        'Several teams arrived at the {circuit} carrying new parts.',
        'The technical battle stepped up a gear at the {circuit}.',
        'Upgrade season rolled on at the {circuit}.',
        'The development war was front and centre at the {circuit}.',
        'New bodywork was the talk of the {circuit} paddock.',
      ],
      evs.length >= 2
        ? ['{n} teams brought changes in all.', 'In total, {n} teams introduced updates.', 'It was a busy day for the development departments.']
        : ['Just one team rolled out new parts.', 'A solitary update this time, but a notable one.', 'Only one team brought changes this weekend.'])
    const goodPara = delivered.length
      ? compose(`${seed}:good`, slots, [
          '{delivered} appear to have found genuine lap time.',
          'The early read is positive for {delivered}.',
          '{delivered} look to have taken a real step forward.',
          'There were encouraging signs from {delivered}.',
        ])
      : ''
    const badPara = missed.length
      ? compose(`${seed}:bad`, slots, [
          '{missed} were left disappointed, with little to show for the effort.',
          'For {missed}, the new parts failed to deliver the expected gain.',
          '{missed} head back to the drawing board after a flat update.',
          'Not every gamble paid off, with {missed} finding no real step.',
        ])
      : ''
    // The specific (invented, unfalsifiable) component — different part/area/team each round.
    const partPara = compose(`${seed}:part`, slots, repDelivered
      ? [
          'The headline change is a new {part}, aimed at {area}.',
          'At the heart of the {rep_team} update sits a reworked {part}, targeting {area}.',
          '{rep_team} brought a new {part}, chasing gains in {area}.',
          'The {rep_team} {part} is the eye-catcher, said to address {area}.',
        ]
      : [
          '{rep_team_poss} reworked {part} did not bring the {area} they were chasing.',
          'The new {part} {rep_team} fitted added little in {area}.',
          'For {rep_team}, the revised {part} left {area} no better than before.',
        ])
    // Grounded close: the representative team's actual constructor position, not platitude.
    const outlook = repPos
      ? compose(`${seed}:outlook`, slots,
          delivered.length
            ? [
                '{rep_team} sit {rep_pos} in the constructors, and will want the gains to stick.',
                'For {rep_team}, {rep_pos} in the standings, the timing could hardly be better.',
                '{rep_team} go again from {rep_pos}, hoping the step holds across the rounds ahead.',
              ]
            : [
                '{rep_team}, {rep_pos} in the constructors, are still searching for the breakthrough.',
                'For {rep_team}, stuck {rep_pos}, the wait for a genuine step goes on.',
                '{rep_team} remain {rep_pos}, with the gap to close unchanged.',
              ])
      : compose(`${seed}:outlook`, slots,
          ['The development race rolls straight on.', 'Back at the factory, the next parts are already on the bench.'])
    // Driver mood is just one flavour of many, so keep it rare (a couple of times a season).
    const techTexturePool = !repDriver
      ? []
      : delivered.length
        ? [
            '{up_driver} sounded genuinely buoyed by the new parts.',
            'The mood in the {rep_team} debrief was quietly upbeat.',
            '{up_driver} admitted to being unconvinced at first, but the team stood by the numbers.',
            'Privately, {up_driver} wanted a little more, even as the wall celebrated the step.',
          ]
        : [
            '{up_driver} had warned the parts felt no different, and so it proved.',
            '{up_driver} was politely unimpressed in the debrief.',
            'The {rep_team} engineers cut frustrated figures on the pit wall.',
          ]
    const techTexture = texture(seed, techTexturePool, slots, 18)
    out.push({
      id: seed, category: 'technical_upgrade', round: r, priority: 45,
      headline: fill(pick([
        'Upgrade roundup from the {circuit}', 'Development watch at the {circuit}', 'New parts at the {circuit}',
        'Who brought what to the {circuit}', 'Technical roundup from the {circuit}', 'The development race at the {circuit}',
        'Inside the {circuit} upgrade war', 'Fresh bodywork at the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{n} {teams} brought updates to the {circuit}.', 'A look at the new parts at the {circuit}.',
        'The upgrade battle at the {circuit}.', 'Tracking the development war at the {circuit}.',
      ], `${seed}|d`), slots),
      body: paras(intro, goodPara, badPara, partPara, techTexture, outlook),
    })
  }
  return out
}

// TRIGGER: the mathematical clinch of either title — the splashy "champion crowned" moment,
// emitted at the exact round it was secured (or the final round if it went to the end).
function championship(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds === 0) return []
  const out: NewsArticle[] = []
  const N = ctx.calendar.length

  // Drivers
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const s = driverStandingsAfter(ctx, r)
    if (s.length < 1) continue
    const gap = s[0].points - (s[1]?.points ?? 0)
    const remaining = N - r
    const clinched = remaining <= 0 || (s.length >= 2 && gap > remaining * DRIVER_MAX_PER_RACE)
    if (!clinched) continue
    const champ = s[0]
    const earlyClinch = remaining > 0 // secured with rounds to spare, vs decided at the finale
    const racesLeft = `${remaining} ${plural(remaining, 'race')}`
    const seed = `title-${ctx.year}`
    const slots = { driver: champ.driverName, driver_last: lastName(champ.driverName), team: champ.teamName, year: ctx.year, gap, round: r, wins: champ.wins, wins_word: plural(champ.wins, 'win'), races_left: racesLeft }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 100,
      headline: fill(pick(earlyClinch
        ? ['{driver} crowned {year} World Champion', '{driver} seals the {year} title', '{driver} is the {year} World Champion', '{driver_last} is champion of the world', '{driver} conquers {year}']
        : ['{driver} takes the {year} title in the finale', '{driver} crowned champion in a season-long fight', '{driver} is the {year} World Champion', '{driver_last} wins the title at the last', '{driver} holds on to be crowned {year} champion'],
        `${seed}|h`), slots),
      dek: fill(pick(earlyClinch
        ? ['{driver} cannot be caught and is the {year} World Drivers Champion.', '{driver} wraps up the {year} crown for {team} with {races_left} to spare.', 'The {year} championship is settled early in {driver}\'s favour.']
        : ['{driver} takes the {year} World Drivers Championship in the season finale.', '{driver} is crowned {year} champion after going the distance.', 'The {year} title is decided at the last, and it is {driver}\'s.'],
        `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['{driver} is the {year} World Drivers Champion.', '{driver} has won the {year} World Championship.', 'The {year} title belongs to {driver}.'],
          ['The crown is sealed for {team}.', 'It is a landmark season for {team}.', 'A long campaign ends in glory for {team}.']),
        compose(`${seed}:p2`, slots, earlyClinch
          ? ['With {wins} {wins_word} on the board, the title was secured with {races_left} still to run.', 'The championship was mathematically locked up at round {round}, with {races_left} to spare.', '{driver} put the title beyond reach with {races_left} remaining.']
          : ['It went all the way to the final round, and {driver} got the job done.', 'The title went to the wire, settled only at the last race.', '{driver} held the advantage when it mattered, sealing it in the finale.'],
          ['The consistency told over a gruelling season.', 'Reliability and results combined to decisive effect.', 'It was a campaign of few weaknesses.']),
        compose(`${seed}:p3`, slots,
          ['For {driver_last}, it is the reward for a season of relentless application.', 'The hard yards of a long year have paid off.', 'It caps a season few could live with.'],
          ['Attention will soon turn to whether the feat can be repeated.', 'The target only grows from here.', 'Rivals must now find a way to respond.']),
        texture(`${seed}|q`, [
          '"This is everything I have worked for," said {driver_last}.',
          '"I am lost for words, honestly," {driver_last} said.',
          '"To do this with {team} is the dream," said {driver_last}.',
          '"Every single person back at the factory earned this," {driver_last} said.',
        ], slots, 55),
      ),
    })
    break
  }

  // Constructors
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const s = constructorStandingsAfter(ctx, r)
    if (s.length < 1) continue
    const gap = s[0].points - (s[1]?.points ?? 0)
    const remaining = N - r
    const clinched = remaining <= 0 || (s.length >= 2 && gap > remaining * CONSTRUCTOR_MAX_PER_RACE)
    if (!clinched) continue
    const earlyClinch = remaining > 0
    const racesLeft = `${remaining} ${plural(remaining, 'race')}`
    const seed = `wcc-${ctx.year}`
    const slots = { team: s[0].teamName, team_poss: poss(s[0].teamName), year: ctx.year, gap, round: r, races_left: racesLeft }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 95,
      headline: fill(pick(earlyClinch
        ? ['{team} clinch the Constructors title', '{team} are {year} Constructors Champions', '{team} seal the Constructors Championship', '{team} rule the {year} Constructors', '{team} take the team title']
        : ['{team} take the Constructors title in the finale', '{team} are {year} Constructors Champions', '{team} win the Constructors at the last', '{team} hold on for the team title'],
        `${seed}|h`), slots),
      dek: fill(pick(earlyClinch
        ? ['{team} have sealed the {year} Constructors Championship with {races_left} to spare.', '{team} cannot be caught in the Constructors standings.', 'The Constructors title is {team_poss} for {year}.']
        : ['{team} take the {year} Constructors Championship in the season finale.', 'The Constructors title is decided at the last, and it is {team_poss}.', '{team} are crowned {year} Constructors Champions after going the distance.'],
        `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['{team} are the {year} Constructors Champions.', '{team} have won the {year} Constructors Championship.', 'The Constructors crown goes to {team} in {year}.'],
          ['It caps a dominant team effort.', 'Both garages can celebrate.', 'The whole factory shares in this one.']),
        compose(`${seed}:p2`, slots, earlyClinch
          ? ['The title was secured at round {round} with a {gap}-point cushion, {races_left} still to run.', 'A lead of {gap} points put the title beyond doubt with {races_left} to spare.']
          : ['It came down to the final round, settled by a {gap}-point margin.', 'The team title went the distance before {team} closed it out.'],
          ['Two cars scoring heavily, race after race, made the difference.', 'Strength in depth was the foundation.', 'Consistency from both drivers told.']),
        compose(`${seed}:p3`, slots,
          ['It is the reward for sustained excellence across the season.', 'Months of work at the factory have paid off.', 'The result reflects a team firing on all cylinders.'],
          ['The challenge now is to stay on top.', 'Rivals will be plotting how to close the gap.', 'Defending it next year is the next mission.']),
      ),
    })
    break
  }

  return out
}

// TRIGGER: going into a round, a title (drivers and/or constructors) can be mathematically
// clinched there. Lays out exactly what must happen, RaceFans-style. The two championships are
// checked INDEPENDENTLY — they can fall at completely different races, and each gets its own
// piece. This sim awards no fastest-lap point and runs no sprints, so a win is a flat 25 and
// the constructors maximum is 43 (25+18), making the maths exact.
function titleScenario(ctx: NewsContext): NewsArticle[] {
  const N = ctx.calendar.length
  const out: NewsArticle[] = []
  const upTo = ctx.endOfSeason ? ctx.completedRounds : Math.min(ctx.completedRounds + 1, N)
  const F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
  // Best (lowest-number) finish a rival may take while the leader still clinches (points < A).
  const clinchPos = (A: number) => { for (let p = 1; p <= 10; p++) if (F1[p - 1] < A) return p; return 11 }
  // Can each title be clinched at round rr (and is it not already won)?
  const drvCanClinch = (rr: number) => { const d = driverStandingsAfter(ctx, rr - 1); if (d.length < 2) return false; const a = (d[0].points - d[1].points) + 25 - (N - rr) * 25; return a > 0 && a <= 50 }
  const wccCanClinch = (rr: number) => { const c = constructorStandingsAfter(ctx, rr - 1); if (c.length < 2) return false; const a = (c[0].points - c[1].points) + CONSTRUCTOR_MAX_PER_RACE - (N - rr) * CONSTRUCTOR_MAX_PER_RACE; return a > 0 && a <= 2 * CONSTRUCTOR_MAX_PER_RACE }

  for (let r = 2; r <= upTo; r++) {
    const rem = N - r // races AFTER round r
    if (rem < 1) continue // round r is the finale; that is its own kind of decider
    const racesLeft = `${rem} ${plural(rem, 'race')}`

    // --- Drivers ---
    const ds = driverStandingsAfter(ctx, r - 1)
    if (ds.length >= 2 && drvCanClinch(r)) {
      const L = ds[0]
      const S = ds[1]
      const G = L.points - S.points
      // Points swing the leader needs over the nearest rival to clinch (negative = can even
      // lose ground and still clinch). This covers EVERY result combination, not just a win.
      const clinchMargin = rem * 25 - G + 1
      // Worst finish that still clinches if the rival scores nothing (lowest points >= margin).
      let worstPos = 1
      for (let p = 10; p >= 1; p--) { if (F1[p - 1] >= clinchMargin) { worstPos = p; break } }
      // Win-scenario conditions for any rival who could otherwise survive the leader winning. We
      // only list a rival once the requirement is real (3rd or lower); "no higher than 2nd" is
      // vacuous, since a rival cannot beat a winning leader anyway.
      const conds: string[] = []
      for (const j of ds.slice(1)) {
        if (j.points + (rem + 1) * 25 < L.points) continue // out of mathematical contention
        const A = (L.points + 25) - j.points - rem * 25
        if (A > 18) continue // even at 2nd this rival cannot deny a winning leader
        const pos = clinchPos(A)
        conds.push(pos >= 11 ? `${lastName(j.driverName)} finishes outside the points` : `${lastName(j.driverName)} finishes no higher than ${ordinal(pos)}`)
      }
      let streak = 0
      for (let k = r - 1; k >= 1; k--) { const w = (ctx.raceResults[k - 1] ?? []).find((x) => x.finishPosition === 1); if (w && w.driverId === L.driverId) streak++; else break }
      const seed = `scenario-${ctx.year}-${r}`
      const slots: Record<string, string | number> = {
        leader: L.driverName, leader_last: lastName(L.driverName), s_last: lastName(S.driverName),
        circuit: circuit(ctx, r), next_circuit: circuit(ctx, r + 1), year: ctx.year,
        rem, races_left: racesLeft, wins: L.wins, wins_word: plural(L.wins, 'win'), streak,
        conds: conds.length ? listJoin(conds) : '',
        clinch_margin: clinchMargin, margin_pts: plural(Math.abs(clinchMargin), 'point'),
        worst_pos: ordinal(worstPos), surv: 1 - clinchMargin, surv_pts: plural(1 - clinchMargin, 'point'),
      }
      // The win scenario.
      const winText = conds.length
        ? fill(pick(['Win the {circuit}, and {leader_last} is champion provided {conds}.', 'Victory at the {circuit} crowns {leader_last}, as long as {conds}.'], `${seed}|win`), slots)
        : fill(pick(['Win the {circuit}, and the title is {leader_last}\'s whatever the others do.', 'A win at the {circuit} settles it outright.'], `${seed}|win`), slots)
      // The full swing (covers finishing other than first) and the flip side into the next race.
      const swingText = clinchMargin <= 0
        ? fill(pick(['Such is the lead that {leader_last} is champion at the {circuit} unless {s_last} outscores them by {surv} {surv_pts}.', '{leader_last} clinches barring {s_last} outscoring them by {surv} {surv_pts}.'], `${seed}|sw`), slots) + ' ' + fill(pick(['Only that keeps the fight alive into the {next_circuit}.', 'Anything short of that and it is done.'], `${seed}|sw2`), slots)
        : clinchMargin <= 18
        ? fill(pick(['{leader_last} need not even win: outscoring {s_last} by {clinch_margin} {margin_pts} is enough, so even {worst_pos} would do should {s_last} draw a blank.', 'A win is not essential, with {leader_last} clinching by outscoring {s_last} by {clinch_margin} {margin_pts}; even {worst_pos} settles it if {s_last} fails to score.'], `${seed}|sw`), slots) + ' ' + fill(pick(['Anything less, and the title race goes on to the {next_circuit}.', 'Short of that swing, the championship heads to the {next_circuit}.'], `${seed}|sw2`), slots)
        : fill(pick(['Only a win will do, and even then {leader_last} must outscore {s_last} by {clinch_margin} {margin_pts} to settle it.', 'Nothing short of victory can clinch it here, with {leader_last} needing to outscore {s_last} by {clinch_margin} {margin_pts}.'], `${seed}|sw`), slots) + ' ' + fill(pick(['Fail to manage it, and the title goes to the {next_circuit}.', 'If not, the championship rolls on to the {next_circuit}.'], `${seed}|sw2`), slots)
      out.push({
        id: seed, category: 'championship_state', round: r, priority: 86,
        headline: fill(pick([
          'How {leader_last} can be crowned champion at the {circuit}',
          'What {leader_last} needs to seal the title at the {circuit}',
          '{leader} can wrap up the drivers title at the {circuit}',
          'Drivers crown within reach for {leader} at the {circuit}',
          '{leader_last} eyes the title at the {circuit}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{leader} can seal the {year} drivers title at the {circuit}, with {races_left} to spare.',
          'The permutations for {leader_last} to be champion at the {circuit}.',
          '{leader} has a shot at the {year} crown at the {circuit}.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{leader} can be crowned {year} World Champion at the {circuit}.', 'The {year} drivers title could be {leader_last}\'s by the end of the {circuit}.', '{leader_last} has the chance to wrap it up at the {circuit}.'],
            ['It would come with {races_left} to spare.', 'A title sealed with {races_left} still to run would be some statement.']),
          compose(`${seed}:form`, slots,
            ['{leader_last} has {wins} {wins_word} this season.', 'With {wins} {wins_word} banked, {leader_last} has earned the chance.'],
            streak >= 2 ? ['{streak} straight wins have brought the crown within touching distance.', 'A {streak}-race winning run has made it close to a formality.'] : ['']),
          winText,
          swingText,
        ),
      })
    }

    // --- Constructors (entirely separate timing) ---
    const cs = constructorStandingsAfter(ctx, r - 1)
    if (cs.length >= 2 && wccCanClinch(r)) {
      const CG = cs[0].points - cs[1].points
      const diffNeeded = rem * CONSTRUCTOR_MAX_PER_RACE - CG // net points lead-team must gain on rival
      const reqPool = diffNeeded >= 0
        ? [`{lead_team} must outscore {rival_team} by at least ${diffNeeded + 1} points at the {circuit}.`, `A net gain of ${diffNeeded + 1} points over {rival_team} would seal it for {lead_team}.`]
        : [`{lead_team} hold such a lead that only {rival_team} outscoring them by more than ${-diffNeeded} points would keep the title open.`, `Short of {rival_team} outscoring {lead_team} by more than ${-diffNeeded} points, the title is theirs.`]
      const seed = `wcc-scenario-${ctx.year}-${r}`
      const slots: Record<string, string | number> = {
        lead_team: cs[0].teamName, rival_team: cs[1].teamName, cg: CG, circuit: circuit(ctx, r), year: ctx.year,
        rem, races_left: racesLeft,
      }
      out.push({
        id: seed, category: 'championship_state', round: r, priority: 84,
        headline: fill(pick([
          'How {lead_team} can clinch the constructors title at the {circuit}',
          'What {lead_team} need to seal the constructors crown at the {circuit}',
          '{lead_team} can wrap up the constructors title at the {circuit}',
          'Constructors crown within reach for {lead_team} at the {circuit}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{lead_team} can seal the {year} constructors title at the {circuit}, with {races_left} to spare.',
          'The constructors permutations for {lead_team} at the {circuit}.',
          '{lead_team} have a shot at the {year} teams crown at the {circuit}.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{lead_team} can be crowned {year} Constructors Champions at the {circuit}.', 'The {year} teams title could be {lead_team}\'s by the end of the {circuit}.'],
            ['It would come with {races_left} to spare.', '{lead_team} carry a {cg}-point lead over {rival_team} into the weekend.']),
          fill(pick(reqPool, `${seed}|req`), slots),
        ),
      })
    }
  }
  return out
}

// TRIGGER (gated): a tight title fight in the final third of the calendar. Emitted for the
// late rounds where the gap is small and nobody has clinched, so the run-in gets coverage.
function titleFight(ctx: NewsContext): NewsArticle[] {
  if (ctx.endOfSeason) return []
  const N = ctx.calendar.length
  const out: NewsArticle[] = []
  const start = Math.ceil((2 * N) / 3)
  for (let r = Math.max(start, 1); r <= ctx.completedRounds; r++) {
    const s = driverStandingsAfter(ctx, r)
    if (s.length < 2) continue
    const gap = s[0].points - s[1].points
    const remaining = N - r
    if (remaining <= 0) continue
    if (gap > remaining * DRIVER_MAX_PER_RACE || gap > 40) continue
    const seed = `fight-${ctx.year}-${r}`
    if (!chance(seed, 60)) continue
    const racesLeft = `${remaining} ${plural(remaining, 'race')}`
    // Grounded battle context: season head-to-head (races both finished) and recent momentum.
    let h2hL = 0, h2hS = 0
    for (let k = 1; k <= r; k++) {
      const rr = ctx.raceResults[k - 1] ?? []
      const a = rr.find((x) => x.driverId === s[0].driverId)
      const b = rr.find((x) => x.driverId === s[1].driverId)
      if (a && b && !a.dnf && !b.dnf && a.finishPosition != null && b.finishPosition != null) { if (a.finishPosition < b.finishPosition) h2hL++; else h2hS++ }
    }
    const pl = pointsInWindow(ctx, s[0].driverId, r, 4)
    const ps = pointsInWindow(ctx, s[1].driverId, r, 4)
    const momTied = pl === ps
    const momLast = pl >= ps ? lastName(s[0].driverName) : lastName(s[1].driverName)
    const momOther = pl >= ps ? lastName(s[1].driverName) : lastName(s[0].driverName)
    const hhPhrase = h2hL === h2hS ? `level at ${h2hL}-${h2hS}` : `${Math.max(h2hL, h2hS)}-${Math.min(h2hL, h2hS)} in ${h2hL > h2hS ? lastName(s[0].driverName) : lastName(s[1].driverName)}'s favour`
    const slots = {
      leader: s[0].driverName, second: s[1].driverName, leader_last: lastName(s[0].driverName), second_last: lastName(s[1].driverName),
      gap, gap_pts: plural(gap, 'point'), remaining, races_left: racesLeft, round: r, max_pts: remaining * DRIVER_MAX_PER_RACE,
      lw: s[0].wins, sw: s[1].wins, lw_word: plural(s[0].wins, 'win'),
      hh_phrase: hhPhrase, mom_last: momLast, mom_other: momOther, mom_hi: Math.max(pl, ps), mom_lo: Math.min(pl, ps),
    }
    const battleTexture = [
      texture(`${seed}|ql`, ['"We just take it race by race," said {leader_last}.', '"Nothing is won yet," {leader_last} said.'], slots, 22),
      texture(`${seed}|qs`, ['"I have nothing to lose from here," said {second_last}.', '"All the pressure is on them," {second_last} said.'], slots, 22),
      texture(`${seed}|pundit`, ['Pundits are split on who holds the edge.', 'Most of the paddock make {leader_last} a narrow favourite.'], slots, 18),
      texture(`${seed}|fans`, ['Fans are bracing for a grandstand finish.', 'Neutrals have rarely had it so good.'], slots, 16),
      texture(`${seed}|orders`, ['Talk of team orders is already swirling in both garages.'], slots, 12),
      texture(`${seed}|pressure`, ['The pressure now sits squarely on {leader_last}\'s shoulders.', 'It is {second_last} who races with the freedom of the chaser.'], slots, 16),
    ].filter(Boolean).join(' ')
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 75,
      headline: fill(pick([
        'Title fight goes down to the wire', '{leader} and {second} locked in a duel',
        'Just {gap} {gap_pts} in it at the top', 'The championship is alive',
        '{leader} holds off {second} in the title race', 'Advantage {leader}, but only just',
        '{gap} {gap_pts} to settle a championship',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        'Only {gap} {gap_pts} split the top two with {races_left} to go.',
        '{leader} leads {second} by {gap} as the season nears its climax.',
        'The run-in is set up for a fight, {gap} {gap_pts} the margin.',
      ], `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['The championship is going to the wire.', 'This title race is far from settled.', 'It is advantage {leader}, but only just.'],
          ['Only {gap} {gap_pts} separate {leader} and {second} with {races_left} remaining.', 'The gap stands at {gap} {gap_pts} with {races_left} left to run.', '{gap} {gap_pts} is all that divides the top two.']),
        compose(`${seed}:form`, slots,
          ['{leader_last} has {lw} {lw_word} this year to {second_last}\'s {sw}.', 'On wins, {leader_last} leads {lw} to {sw}.', 'The win column reads {lw} to {sw} in {leader_last}\'s favour.'],
          ['Their season head-to-head is {hh_phrase}.', 'In races where both finished, the head-to-head sits {hh_phrase}.'],
          momTied
            ? ['Recent form is dead level, {mom_hi} points apiece over the last four races.']
            : ['Momentum may sit with {mom_last}, who has outscored {mom_other} {mom_hi} to {mom_lo} over the last four races.', 'Recent form favours {mom_last}, {mom_hi} points to {mom_lo} across the last four rounds.']),
        compose(`${seed}:stake`, slots,
          ['Up to {max_pts} points remain to be won over {races_left}.', 'With {max_pts} points still on the table, nothing is decided.', 'A single retirement could wipe out the {gap}-point margin.']),
        battleTexture,
      ),
    })
  }
  return out
}

// TRIGGER: a long state-of-the-season feature at half-distance, and a season review once the
// final round is in. Grounded entirely in the standings to date.
function features(ctx: NewsContext): NewsArticle[] {
  const N = ctx.calendar.length
  const out: NewsArticle[] = []
  const half = Math.round(N / 2)

  // Mid-season state of play
  if (!ctx.endOfSeason && ctx.completedRounds >= half && half >= 3) {
    const r = half
    const ds = driverStandingsAfter(ctx, r)
    const cs = constructorStandingsAfter(ctx, r)
    if (ds.length >= 2 && cs.length >= 1) {
      const seed = `feature-mid-${ctx.year}`
      const gap = ds[0].points - ds[1].points
      const slots = {
        year: ctx.year, leader: ds[0].driverName, leader_last: lastName(ds[0].driverName), second: ds[1].driverName,
        gap, gap_pts: plural(gap, 'point'), top_team: cs[0].teamName, third: ds[2]?.driverName ?? ds[1].driverName, round: r,
      }
      out.push({
        id: seed, category: 'feature', round: r, priority: 82,
        headline: fill(pick([
          'The {year} story so far', 'Half-distance and the {year} season takes shape',
          'Taking stock at the {year} midpoint', 'The {year} season at half-time',
          'Where the {year} championship stands',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{leader} leads, but the {year} season has plenty left to give.',
          'A look at the form, the surprises and the questions at half-distance.',
          'The {year} title race and the battles behind it, assessed.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['We have reached the midpoint of the {year} season.', 'Half the {year} calendar is done.', 'With the season at half-distance, the picture is forming.'],
            ['{leader} sits on top of the drivers standings.', 'It is {leader} who leads the way.', 'At the front, {leader} has set the pace.']),
          compose(`${seed}:p2`, slots,
            ['The lead over {second} stands at {gap} {gap_pts}.', '{leader} holds a {gap}-point advantage over {second}.', 'A margin of {gap} {gap_pts} separates {leader} and {second}.'],
            ['It is close enough that nothing is settled.', 'There is daylight, but no comfort just yet.', 'The chasers remain firmly in touch.']),
          compose(`${seed}:p3`, slots,
            ['In the constructors race, {top_team} have set the standard.', '{top_team} lead the way among the teams.', 'It is {top_team} who top the constructors table.'],
            ['{third} has been among the names to watch behind the leaders.', 'The battle for the minor places has been fierce.', 'Several drivers are still in the mix behind the top two.']),
          compose(`${seed}:p4`, slots,
            ['The second half will test depth, development and nerve.', 'How the contenders manage the run-in will define the year.', 'Upgrades and reliability could yet reshape everything.'],
            ['On this evidence, the run-in promises plenty.', 'There is a season still to be won and lost.', '{leader_last} knows the job is only half done.']),
        ),
      })
    }
  }

  // Season review (final round complete). Not gated on endOfSeason, so the capstone read
  // survives once the off-season market runs and stays in the feed.
  if (ctx.completedRounds >= N && N >= 1) {
    const ds = driverStandingsAfter(ctx, N)
    const cs = constructorStandingsAfter(ctx, N)
    if (ds.length >= 1 && cs.length >= 1) {
      const seed = `feature-review-${ctx.year}`
      const slots = {
        year: ctx.year, champ: ds[0].driverName, champ_last: lastName(ds[0].driverName),
        runner: ds[1]?.driverName ?? ds[0].driverName, top_team: cs[0].teamName, wins: ds[0].wins, wins_word: plural(ds[0].wins, 'win'),
      }
      out.push({
        id: seed, category: 'feature', round: N, priority: 88,
        headline: fill(pick([
          'The {year} season in review', 'How the {year} championship was won',
          'Looking back on {year}', 'The story of the {year} season',
          '{champ} and the making of {year}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{champ} took the {year} crown after a long campaign.',
          'A full accounting of the {year} season, start to finish.',
          'The defining moments of {year}, revisited.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['The {year} season is complete.', 'Another championship year is in the books.', 'The {year} campaign has run its course.'],
            ['{champ} ends it as champion.', 'It is {champ} who stands tallest.', '{champ} claimed the crown.']),
          compose(`${seed}:p2`, slots,
            ['{champ} finished the year with {wins} {wins_word}.', 'A season of {wins} {wins_word} carried {champ} home.', 'It took {wins} {wins_word} for {champ} to get the job done.'],
            ['{runner} pushed hardest in pursuit.', '{runner} was the closest challenger.', 'The chief threat came from {runner}.']),
          compose(`${seed}:p3`, slots,
            ['{top_team} were the standout constructor.', 'Among the teams, {top_team} set the benchmark.', 'It was {top_team} who led the constructors.'],
            ['Their two-car strength proved decisive.', 'Consistency across the field told.', 'They simply scored more than anyone.']),
          compose(`${seed}:p4`, slots,
            ['Attention now turns to the off-season and the market.', 'The focus shifts to next year already.', 'Now the rebuilding and the rumours begin.'],
            ['{champ_last} will start as the man to beat.', 'The challengers must regroup and come again.', 'The story resets, and the chase begins anew.']),
        ),
      })
    }
  }
  return out
}

// A grounded "last time out" talking point for a preview of round r, pulled from round r-1.
// Surfaces the single most newsworthy angle from across the grid (one, never a pile-up):
// win streaks, maiden wins, a title contender's horror show, a standout drive, a first-points
// breakthrough, a notable retirement, or a fresh upgrade.
function previewTalkingPoint(ctx: NewsContext, r: number, seed: string): string {
  const prev = r - 1
  if (prev < 1 || prev > ctx.raceResults.length) return ''
  const results = ctx.raceResults[prev - 1] ?? []
  if (results.length === 0) return ''
  const sorted = sortedResults(results)
  const standings = driverStandingsAfter(ctx, prev)   // going into round r
  const before = driverStandingsAfter(ctx, prev - 1)  // before the last race
  const ptsBefore = (id: string) => before.find((s) => s.driverId === id)?.points ?? 0
  const prevCircuit = circuit(ctx, prev)
  const winner = results.find((x) => x.finishPosition === 1)

  let streak = 0
  if (winner) for (let k = prev; k >= 1; k--) { const w = (ctx.raceResults[k - 1] ?? []).find((x) => x.finishPosition === 1); if (w && w.driverId === winner.driverId) streak++; else break }
  const maiden = !!winner && prev >= 2 && !wonBefore(ctx, winner.driverId, prev)

  let horror: { who: string; what: string } | null = null
  for (const s of standings.slice(0, 2)) { const res = results.find((x) => x.driverId === s.driverId); if (res && (res.dnf || (res.finishPosition ?? 0) >= 8)) { horror = { who: lastName(s.driverName), what: res.dnf ? 'a retirement' : ordinal(res.finishPosition ?? 0) }; break } }

  let mover: RaceResult | null = null; let gain = 0
  for (const x of sorted) { if (x.dnf || x.finishPosition == null) continue; const g = x.gridPosition - x.finishPosition; if (g > gain) { gain = g; mover = x } }

  // A genuine first-points drought-breaker, not everyone's opener (hence prev >= 4).
  let firstPts: RaceResult | null = null
  if (prev >= 4) for (const x of results) { if (x.points > 0 && ptsBefore(x.driverId) === 0) { firstPts = x; break } }

  let faller: RaceResult | null = null
  for (const x of results) { if (!x.dnf) continue; const rank = standings.findIndex((s) => s.driverId === x.driverId); if (rank >= 0 && rank < 8) { faller = x; break } }

  const upg = ctx.upgradeEvents.find((e) => !e.failed && (e.round === prev || e.round === r))

  const slots: Record<string, string | number> = {
    prev_circuit: prevCircuit, streak,
    w: winner ? lastName(winner.driverName) : '',
    horror_who: horror?.who ?? '', horror_what: horror?.what ?? '',
    mover: mover ? lastName(mover.driverName) : '', mover_from: ordinal(mover?.gridPosition ?? 0), mover_to: ordinal(mover?.finishPosition ?? 0),
    first_pts: firstPts ? lastName(firstPts.driverName) : '',
    faller: faller ? lastName(faller.driverName) : '',
    upg_team: upg ? teamName(ctx, upg.teamId) : '', upg_team_poss: upg ? poss(teamName(ctx, upg.teamId)) : '',
  }

  let pool: string[]
  if (streak >= 2) pool = ['{w} arrives on a {streak}-race winning streak, and nobody has found an answer.', 'The question is whether anyone can halt {w}, winner of the last {streak}.']
  else if (maiden) pool = ['{w} arrives fresh off a maiden win of the season at the {prev_circuit}.', 'Confidence will be sky-high in the {w} camp after a breakthrough win last time out.']
  else if (horror) pool = ['{horror_who} endured a rare off-day last time out, {horror_what} at the {prev_circuit}, and badly needs a response.', 'All eyes are on {horror_who} after {horror_what} last time, a dent in the title bid.']
  else if (gain >= 6 && mover) pool = ['{mover} was the standout last time, charging from {mover_from} to {mover_to}, and will want more of the same.', 'Few impressed like {mover} at the {prev_circuit}, up from {mover_from} to {mover_to}.']
  else if (firstPts) pool = ['{first_pts} finally opened the account at the {prev_circuit} last time, and will look to build on it.', 'A first points finish for {first_pts} last time out was a long time coming.']
  else if (faller) pool = ['{faller} retired at the {prev_circuit} last time and will be desperate for a bounce-back.', 'A bounce-back is the order of the day for {faller} after retiring last time.']
  else if (upg) pool = ['Whether {upg_team_poss} recent upgrade bites here is one of the weekend\'s questions.', 'The paddock is watching to see if {upg_team_poss} new parts make a difference.']
  else return ''
  return fill(pick(pool, `${seed}|tp`), slots)
}

// TRIGGER: a preview for every round of the calendar (run-up coverage across the whole
// season), plus the upcoming one while the season is live. Frames each round off the
// standings as they stood beforehand.
function previews(ctx: NewsContext): NewsArticle[] {
  const N = ctx.calendar.length
  const out: NewsArticle[] = []
  const upTo = ctx.endOfSeason ? ctx.completedRounds : Math.min(ctx.completedRounds + 1, N)
  for (let r = 1; r <= upTo; r++) {
    const before = driverStandingsAfter(ctx, r - 1)
    const cbefore = constructorStandingsAfter(ctx, r - 1)
    const leader = before[0]
    const second = before[1]
    const isOpener = r === 1
    const isNext = !ctx.endOfSeason && r === ctx.completedRounds + 1
    const remaining = N - r + 1
    const seed = `preview-${ctx.year}-${r}`
    const circuitName = circuit(ctx, r)

    // Track-specific colour: a real circuit trait, tied to a top team and that team's chosen
    // driver's actual recent form.
    const trait = CIRCUIT_TRAITS[ctx.calendar[r - 1]?.id ?? '']
    const favC = cbefore.length ? pick(cbefore.slice(0, 3), `${seed}|favc`) : null
    const favDrivers = favC ? ctx.drivers.filter((d) => d.teamId === favC.teamId) : []
    const favDrv = favDrivers.length ? pick(favDrivers, `${seed}|favd`) : null
    const favRecent = favDrv ? recentFinishesUpTo(ctx, favDrv.id, r - 1, 3) : []
    const favAvg = favRecent.length ? favRecent.reduce((s, x) => s + x, 0) / favRecent.length : 99
    const favForm = favAvg <= 6 ? 'on' : favAvg >= 12 ? 'off' : 'mid'

    // Grid talking point from last time out, and (opener only) the rookie debut note.
    const talkingPoint = previewTalkingPoint(ctx, r, seed)
    const rookieNames = ctx.drivers.filter((d) => d.teamId !== '' && d.age <= 21).map((d) => d.name)
    const rookieNote = !isOpener ? ''
      : rookieNames.length === 0 ? ''
      : rookieNames.length === 1 ? `${rookieNames[0]} makes a Grand Prix debut.`
      : rookieNames.length <= 3 ? `${listJoin(rookieNames)} all start their first Grand Prix.`
      : `${rookieNames.length} rookies line up for their maiden Grand Prix.`

    const wccGap = cbefore[0] && cbefore[1] ? cbefore[0].points - cbefore[1].points : 0
    const leadGap = leader ? leader.points - (second?.points ?? 0) : 0
    // Occasional qualitative descriptor for the gap, by how it compares to the points still on
    // offer. Gated so it is not slapped on every preview; a bare number is often plenty.
    const availLeft = remaining * DRIVER_MAX_PER_RACE
    const ratio = leadGap > 0 && availLeft > 0 ? leadGap / availLeft : 0
    const band = ratio >= 0.6 ? ['a commanding ', 'an almost insurmountable ', 'an imposing ']
      : ratio >= 0.28 ? ['a healthy ', 'a comfortable ', 'a substantial ']
      : leadGap > 0 && ratio <= 0.12 ? ['a slender ', 'a narrow ', 'a wafer-thin ']
      : ['']
    const gapDesc = band[0] && chance(`${seed}|gd`, 45) ? pick(band, `${seed}|gd`) : ''
    const slots: Record<string, string | number> = {
      circuit: circuitName, round: r, year: ctx.year,
      leader: leader?.driverName ?? '', leader_last: leader ? lastName(leader.driverName) : '',
      second: second?.driverName ?? '', second_last: second ? lastName(second.driverName) : '',
      lead_gap: leadGap, gap_desc: gapDesc, gap_pts: plural(leadGap, 'point'),
      leader_points: leader?.points ?? 0, leader_wins: leader?.wins ?? 0, wins_word: plural(leader?.wins ?? 0, 'win'),
      top_team: cbefore[0]?.teamName ?? '', wcc_second: cbefore[1]?.teamName ?? '', wcc_gap: wccGap, wcc_pts: plural(wccGap, 'point'),
      remaining, rounds_word: plural(remaining, 'round'), n_teams: ctx.teams.length,
      trait: trait ?? '', trait_cap: trait ? trait.charAt(0).toUpperCase() + trait.slice(1) : '',
      fav_team: favC?.teamName ?? '', fav_team_poss: favC ? poss(favC.teamName) : '', fav_driver: favDrv?.name ?? '',
    }
    const trackTexture = trait && favC && favDrv && r >= 3
      ? texture(`${seed}|track`,
          favForm === 'on'
            ? ['{trait_cap} should suit {fav_team}, whose driver {fav_driver} is in fine form to exploit it.', 'Expect {trait} to play into {fav_team_poss} hands, with {fav_driver} on song.', '{trait_cap} could favour {fav_team}, and {fav_team_poss} {fav_driver} arrives in the form to make it count.', '{fav_team} should relish {trait}, with {fav_driver} flying at just the right time.']
            : favForm === 'off'
            ? ['{trait_cap} might favour {fav_team}, but {fav_team_poss} {fav_driver} has been off the boil, a real talking point this weekend.', '{trait_cap} should suit {fav_team}, yet questions hang over {fav_team_poss} {fav_driver} after a rough run.', 'On paper {trait} should play to {fav_team_poss} strengths, though {fav_driver} must rediscover some form first.', '{fav_team} ought to like {trait}, but {fav_team_poss} {fav_driver} arrives under a cloud after a flat spell.']
            : ['{trait_cap} could favour {fav_team}, with {fav_driver} one to watch.', 'Conditions around {trait} may suit {fav_team} and {fav_driver}.', '{trait_cap} should put {fav_team} and {fav_driver} in the conversation.'],
          slots, 45)
      : ''

    const body = isOpener
      ? paras(
          compose(`${seed}:intro`, slots,
            ['The {year} season gets under way at the {circuit}.', 'It all begins at the {circuit}.', 'Round one takes the grid to the {circuit}.'],
            ['All {n_teams} teams start level on zero.', 'Every driver opens the {year} campaign on nothing.', 'The form book is blank over the {remaining} {rounds_word} ahead.']),
          rookieNote,
          compose(`${seed}:stake`, slots,
            ['Reliability over a full race distance is the first real question.', 'A clean getaway will be worth its weight in points.', 'The opening laps will give the first honest read on the order.']),
          texture(seed, ['The paddock buzzed with first-race nerves.', 'Months of speculation finally meet the stopwatch.', 'There was a charged, expectant mood up and down the grid.'], slots),
        )
      : paras(
          compose(`${seed}:intro`, slots,
            ['Round {round} takes the championship to the {circuit}.', 'The grid heads to the {circuit} for round {round}.', 'Attention turns to the {circuit}.'],
            ['{leader} leads on {leader_points}, {gap_desc}{lead_gap} {gap_pts} clear of {second}.', '{leader} arrives {gap_desc}{lead_gap} {gap_pts} ahead of {second}.', 'It is {leader} who tops the table, {gap_desc}{lead_gap} {gap_pts} up on {second}.']),
          talkingPoint,
          compose(`${seed}:stake`, slots,
            leadGap === 0
              ? ['{second_last} is level on points with {leader_last} at the top.']
              : remaining <= 5
              ? ['With just {remaining} {rounds_word} left, time is short for {second_last}.', '{second_last} is running out of road, {remaining} {rounds_word} remaining.']
              : ['{second_last} sits {lead_gap} {gap_pts} back and will fancy a response.', 'The job for {second_last} is to chip into a {lead_gap}-point deficit.', '{second_last} has ground to make up on {leader_last}.'],
            (leader?.wins ?? 0) > 0 ? ['{leader_last} carries {leader_wins} {wins_word} into the weekend.', '{leader_last} has {leader_wins} {wins_word} to their name so far.'] : ['']),
          compose(`${seed}:wcc`, slots,
            cbefore[1]
              ? ['In the constructors, {top_team} lead {wcc_second} by {wcc_gap} {wcc_pts}.', '{top_team} head the teams standings, {wcc_gap} {wcc_pts} clear of {wcc_second}.']
              : ['{top_team} head the constructors standings.']),
          trackTexture,
        )
    out.push({
      id: seed, category: 'preview_schedule', round: r, priority: isNext ? 80 : 50,
      headline: fill(pick([
        'A preview of the {circuit}', '{circuit} up next', 'What to watch at the {circuit}',
        'Looking ahead to the {circuit}', 'Round {round} at the {circuit}', 'The {circuit} in focus',
        'Setting the stage for the {circuit}', 'Eyes on the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        'Everything to watch ahead of the {circuit}.',
        'Setting the scene for the {circuit}.',
        'The talking points ahead of the {circuit}.',
        'The build-up to the {circuit}.',
      ], `${seed}|d`), slots),
      body,
    })
  }
  return out
}

// TRIGGER: a season preview, one launch per team, and a rookie spotlight for the youngest
// debutants. These are round-0 stories that PERSIST all season (the newsroom is a feed, not a
// snapshot of the current round) — they sort to the bottom once racing starts, but never vanish.
// Live-only (needs car pace + roster).
function preSeason(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
  const byPace = [...ctx.teams].sort((a, b) => b.carPace - a.carPace)
  const seed = `season-preview-${ctx.year}`
  const sp = { year: ctx.year, fav: byPace[0]?.name ?? '', fav2: byPace[1]?.name ?? '' }
  out.push({
    id: seed, category: 'preview_schedule', round: 0, priority: 85,
    headline: fill(pick([
      'The {year} title picture, before a wheel turns',
      '{fav} lead the charge into {year}',
      'Pre-season pace sets up a {year} showdown',
      '{fav} and {fav2} draw first blood in {year}',
      'Winter speed tells a story for {year}',
      'What the pre-season numbers say about {year}',
    ], `${seed}|h`), sp),
    dek: fill(pick([
      '{fav} arrive at the first race as the team to beat, with {fav2} their closest shadow on the timing screens.',
      'Pre-season testing has handed {fav} a clear pace advantage, putting the rest of the grid on the back foot before a race has been run.',
      'The {year} grid has sorted itself early, with {fav} at the top and {fav2} the only side close enough to make it a genuine fight.',
      'Before a points-paying lap is turned, {fav} have already made their intentions plain with the quickest car in the paddock.',
    ], `${seed}|d`), sp),
    body: paras(
      fill(pick([
        '{fav} carry the fastest raw car pace into {year}, a benchmark the rest of the grid measured themselves against across every session of winter running.',
        'The gap between {fav} and the chasing pack is not enormous, but it is real, and in a sport where tenths decide championships, it matters enormously.',
        '{fav2} are the team closest to matching that pre-season pace, making a two-way fight at the front the likeliest opening chapter of {year}.',
        'What {fav} have shown in testing is not merely a single-lap flier but a consistent race-trim performance that signals a car built to win across a long calendar.',
        'For {fav2}, the pace deficit to {fav} is narrow enough to suggest that track-specific setups and strategic calls could flip the order on any given weekend.',
        'Every other team on the grid is now playing catch-up, with {fav} having set the pre-season bar higher than the competition was hoping to see.',
      ], `${seed}|b1`), sp),
      fill(pick([
        'The development war will run in parallel with the championship itself, and whichever side keeps its upgrade curve steepest through the flyaway rounds could shift the balance of power before the summer break.',
        'Reliability is the silent variable that reshapes title fights, and a car carrying the lap time {fav} have shown inevitably carries the complexity that brings risk alongside speed.',
        'The midfield is packed tightly enough that a single successful upgrade package could vault a team from sixth in the constructors\' standings to third, making the chasing positions as contested as the front.',
        'A full-season calendar leaves almost no margin for mechanical failure or operational errors, and the teams that convert pace into points consistently, rather than brilliantly, tend to be the ones lifting trophies.',
        'The same regulations everyone has had a year to study mean the intellectual gap across the grid is smaller now than at any point since the rules were written.',
        'The attrition that a long calendar inflicts means the team that manages its car, its tyres and its people across the full distance has historically outscored the team that merely has the quickest machine.',
      ], `${seed}|b2`), sp),
      fill(pick([
        'Pace advantage is a starting position in a championship, not a finishing one, and the history of the sport is built on teams who led pre-season tests and then watched rivals close the gap round by round.',
        'For {fav2}, the task is narrowing the gap to {fav} fast enough that a title fight is still mathematically alive when the calendar turns to its final third.',
        'The pressure on every team outside the top two is structural, not motivational, because the resource gap between front-runners and the midfield makes genuine championship bids difficult to sustain across an entire year.',
        'What will ultimately decide {year} is the rate of in-season development, because a car that leads winter testing rarely crosses the final finish line with exactly the same relative advantage it carried into the opener.',
        'The team that wins the {year} title will almost certainly be the one that brought both the fastest package and the fewest self-inflicted wounds, and right now {fav} have shown they own at least the first half of that equation.',
        'A pre-season pace advantage is leverage, not destiny, and the depth of both the {fav} and {fav2} operations means any complacency from the front will be punished by a midfield hungry for an opening.',
      ], `${seed}|b3`), sp),
    ),
  })
  for (const t of ctx.teams) {
    const squad = ctx.drivers.filter((d) => d.teamId === t.id).map((d) => d.name)
    const tseed = `launch-${ctx.year}-${t.id}`
    const lastPos = lastSeasonPos(ctx, t.id)
    const tslots = { team: t.name, team_poss: poss(t.name), year: ctx.year, squad: listJoin(squad) || 'Their driver pairing', tier: tierWord(paceRank(ctx, t.id), ctx.teams.length), last_pos: lastPos ? ordinal(lastPos) : '' }
    out.push({
      id: tseed, category: 'car_launch_livery', round: 0, priority: 30,
      headline: fill(pick([
        '{team} pull the covers off their {year} challenger',
        '{team_poss} {year} car breaks cover at launch',
        '{team} reveal the machine built for {year}',
        '{team_poss} {year} contender steps into the light',
        '{team} lift the lid on their {year} title bid',
        '{team_poss} new car makes its {year} debut',
      ], `${tseed}|h`), tslots),
      dek: fill(pick([
        '{team} have launched their {year} challenger, with {squad} tasked with extracting every tenth from a package that arrives rated as a {tier} proposition.',
        'The covers are off at {team}, where {squad} will campaign a car the paddock rates firmly in the {tier} bracket when the {year} season gets under way.',
        '{team} have taken the wraps off their {year} contender, handing {squad} a {tier} platform as the team set their sights on a strong championship campaign.',
        'With {squad} confirmed behind the wheel, {team} have presented the car that will define their {year} season, a machine assessed across the paddock as a {tier} entry.',
      ], `${tseed}|d`), tslots),
      body: paras(
        fill(pick([
          '{team} brought the {year} car into the open today, and the reaction inside the garage was telling, with the aerodynamic philosophy shifted visibly from last year, tighter bodywork around the sidepods and a revised floor edge the team believe will prove decisive in high-speed corners.',
          'Rated as a {tier} car by those who have seen the wind-tunnel correlation data, the {year} challenger sets a clear ceiling and floor for what {squad} can realistically target on race weekends.',
          'The launch marked the first public look at how {team} have interpreted this season\'s regulatory tweaks, and the solutions on show suggest the design office made bold calls rather than conservative ones.',
          'For a {tier} outfit, the opening rounds will reveal whether the correlation between simulation and track is tight enough to let {squad} develop in real time rather than firefight fundamental issues.',
          'The {year} car carries forward the development gains {team} banked in the closing rounds of last season, meaning the baseline on the grid in the opening round is stronger than anything the team ran before the summer break.',
          'In a {tier} fight where the margin between neighbouring cars can be smaller than a tenth, the quality of the launch specification matters enormously, because a solid aero concept arriving early lets {squad} push the development cycle forward rather than chase a fundamental fix through the flyaways.',
        ], `${tseed}|b1`), tslots),
        fill(pick(lastPos
          ? [
            'Finishing {last_pos} in the constructors\' table last season left {team} with a precise and uncomfortable reference point, and every design decision on the {year} car has been judged against whether it closes the gap to the teams that finished above them.',
            '{team_poss} {last_pos} place in last year\'s constructors\' standings is the number the engineers have pinned to the wall, and the {year} car either moves the team up the order or it does not.',
            'Coming off {last_pos} in the constructors\', {team} needed more than iteration on last year\'s concept, and the launch car suggests the design team heard the brief, with substantive changes to the floor and rear-end packaging.',
            'The {last_pos} place result last season was the target the engineers were handed when the {year} project began, and {squad} will be determined not to let the resources poured into this car go to waste.',
          ]
          : [
            'Without a prior-season finish to measure against, the {tier} billing is the only public benchmark on the {year} car, and {squad} will be the first to report whether it translates into consistent points-scoring pace.',
            'For a team writing its {year} chapter without the anchor of a previous constructors\' result, the {tier} classification is both a starting marker and a challenge that {squad} must push the car beyond.',
            'The absence of a finishing position to measure against sharpens the story around the launch, because {team} must define their own benchmark, and a {tier} car gives {squad} the tools to set one that means something by mid-season.',
            'A fresh entry with no championship result to anchor the target throws attention onto the car itself, and clearing the {tier} ceiling consistently would be a real statement from a team still building its identity.',
          ], `${tseed}|b2`), tslots),
        fill(pick([
          'Reliability out of the box will be the quiet priority in the opening rounds, because a {tier} car that completes every lap banks more usable data than a quicker machine that keeps retiring, and {squad} need the mileage to compress the development timeline.',
          'How quickly {team} read and react to the feedback from {squad} will separate a good season from a forgettable one, since upgrade parts arriving by round four on real correlation are worth more than any number of wind-tunnel hours now.',
          'For {squad}, the handling balance over a full stint will matter as much as one-lap pace, because tyre degradation is where {tier} teams either overperform their grid slot or slide out of the points in the final twenty laps.',
          'Power-unit reliability across a long run of back-to-back race weekends will test {team_poss} engineering depth as much as anything the aerodynamics offer, and {squad} need clean Sundays to build the points tally that justifies the {year} investment.',
          '{team_poss} in-season development rate is the one variable the pre-season assessment cannot price in, and a {tier} car that arrives at round eight with a real upgrade can finish the year punching above its launch billing.',
          'Both drivers arrive with something to prove, and the benchmark between {squad} will sharpen the feedback loop, pushing the team to resolve the ambiguities in the data faster than a single-driver effort ever could.',
        ], `${tseed}|b3`), tslots),
      ),
    })
  }
  const youngest = ctx.drivers.filter((d) => d.teamId !== '').sort((a, b) => a.age - b.age).slice(0, 2)
  for (const d of youngest) {
    if (d.age > 22) continue
    const rseed = `rookie-${ctx.year}-${d.id}`
    const rslots = { driver: d.name, driver_last: lastName(d.name), age: d.age, year: ctx.year, team: teamName(ctx, d.teamId), team_poss: poss(teamName(ctx, d.teamId)), driver_poss: poss(lastName(d.name)), ...pronouns(d.gender) }
    out.push({
      id: rseed, category: 'rookie_debut', round: 0, priority: 25,
      headline: fill(pick([
        'Young gun {driver_last} steps up for {team} in {year}',
        '{driver_last} at {age}, the rookie {team} are betting on',
        'Can {driver_last} deliver for {team} in {their} debut season',
        '{age}-year-old {driver_last} targets a fast {team} baptism',
        '{driver_poss} moment is here, and {year} will be the proof',
        '{driver_last} arrives in F1 at just {age}',
      ], `${rseed}|h`), rslots),
      dek: fill(pick([
        'At just {age}, {driver} joins {team} as one of the youngest drivers on the grid, carrying the weight of a junior career\'s worth of expectations into the harshest spotlight in motorsport.',
        '{driver} is {age} and already on Formula 1\'s starting grid, tasked with matching {team_poss} investment in {them} before the first chequered flag of {year}.',
        'The step from junior formulae to a full {team} race seat is the largest of {driver_poss} career, and {year} is where the world finds out whether {theyre} ready for it.',
        'Formula 1 in {year} hands {driver} a seat at {team}, a scrutinising global audience, and no margin for a gentle learning curve.',
      ], `${rseed}|d`), rslots),
      body: paras(
        fill(pick([
          'The jump from junior categories to a full Formula 1 season compresses years of technical learning into a winter\'s worth of preparation, and {driver_last} has had to process that acceleration faster than almost any rival on the {year} grid.',
          'Where the feeder series let {them} find rhythm over a weekend, the freight-train schedule of practice, qualifying and race demands that {driver_last} reads a circuit and extracts the maximum before a single radio call ends.',
          'Media commitments alone scale up sharply at {team}, with press obligations, sponsor appearances and simulator debriefs eating into the hours factory engineers want spent reviewing data.',
          'The moment {driver_last} steps under the garage lights in parc fermé, {they} trades the relative shelter of a junior programme for a broadcast audience that dissects every tenth of a second.',
          '{driver_poss} first Formula 1 winter has meant learning {team_poss} tyre philosophy, aero concept and steering-wheel architecture all at once, a cognitive load that rookies routinely call unlike anything below.',
          'Now racing for {team}, {driver_last} must acclimatise to being scrutinised not just by engineers but by a paddock that will form its verdict on {them} within the opening three weekends.',
        ], `${rseed}|b1`), rslots),
        fill(pick([
          'Qualifying is the earliest and starkest test, one flying lap with no second invitation, the format that strips away context and prints a raw number beside {driver_poss} name.',
          '{team_poss} car demands a driver who can manage front-left degradation across a thirty-lap stint, a discipline learned in corners {driver_last} has never driven on compounds {they} has never raced.',
          '{their_cap} teammate stands as the most immediate and inescapable benchmark, sharing the same machinery and the same strategist\'s call-sheet, leaving the data nowhere to hide.',
          'Street circuits arrive without the buffer of long free-practice familiarity, replacing it with a wall on the exit of every barrier-lined chicane and a single shot at the lap.',
          'Racecraft in traffic is where Formula 1 separates the graduate from the arrival, the braking-reference shift, the understeer in dirty air, the half-second window to commit to a move or abort it, all coming faster than in any category below.',
          'Tyre warm-up on a cool out-lap, safety-car restarts and the call to pit or stay out are decisions {driver_last} rehearsed in the simulator but now executes under the full points cost of getting them wrong.',
        ], `${rseed}|b2`), rslots),
        fill(pick([
          'The measure {team} will apply to {driver_last} by midsummer is not a championship position but the gap to {their} teammate in qualifying trim, the number that reveals whether {they} has genuinely understood the car.',
          'A strong result before the European summer break would shift the internal conversation from potential to proof, and {driver_last} will feel that deadline in every debrief from the opening race.',
          '{year} will be judged a success for {them} if {they} out-qualifies {their} teammate on merit and manages tyre life in a points-scoring position deep into a long second stint.',
          'Pressure from the junior pipeline is structural and permanent, because {team_poss} academy produced {driver_last} and will produce the next candidate, making {their} seat conditional on performance rather than promise.',
          'Sponsor visibility, simulator feedback and raw lap counts will all be weighed as {year} unfolds to justify or question {team_poss} decision to hand {them} a front-line seat so early.',
          'The final verdict on {driver_poss} rookie season comes down to whether {they} closes the gap to {their} teammate across the year or lets that gap define the conversation heading into contract talks.',
        ], `${rseed}|b3`), rslots),
      ),
    })
  }
  return out
}

// TRIGGER: end-of-season market resolved. Signings / re-signings / exits / retirements.
function market(ctx: NewsContext): NewsArticle[] {
  const eos = ctx.endOfSeason
  if (!eos) return []
  const r = ctx.calendar.length + 1   // off-season: newest
  const out: NewsArticle[] = []
  for (const m of eos.marketMoves ?? []) {
    if (m.fromTeamId == null && !m.isResignation && m.mediaScore === 0) {
      const seed = `rookie-sign-${m.driverId}-${eos.seasonYear}`
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), team: m.toTeamName, next: eos.seasonYear + 1 }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 40,
        headline: fill(pick(['{team} hand {driver} a debut', '{driver} promoted to {team}', '{team} bet on rookie {driver}', '{driver} gets the call from {team}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} steps up to {team} for {next}.', 'A maiden seat for {driver}.', '{team} go with youth for {next}.'], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{team} have handed a debut to {driver} for {next}.', '{driver} earns a first seat with {team} from {next}.', '{team} have promoted {driver} to a race seat.'],
            ['It is a vote of confidence in youth.', 'The team backs raw potential over experience.', 'A bold call that says plenty about their plans.']),
          compose(`${seed}:p2`, slots,
            ['The step up to a full season is a steep one.', 'Expectations will be tempered, at least early on.', 'There will be lessons to absorb quickly.'],
            ['But the opportunity is the kind every young driver craves.', 'Get it right and a career takes off.', 'The upside, if it clicks, is considerable.']),
          compose(`${seed}:p3`, slots,
            ['{driver_last} now has the winter to prepare.', 'All eyes will be on how the leap is handled.', 'The paddock will watch the adaptation with interest.'],
            ['It is one of the stories to follow into {next}.', 'A promising chapter begins.', 'The pressure is on from day one.']),
        ),
      })
      continue
    }
    if (m.isResignation) {
      const seed = `resign-${m.driverId}-${eos.seasonYear}`
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), team: m.toTeamName, until: m.contractExpiresAfterSeason }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 60,
        headline: fill(pick(['{driver} stays at {team}', '{team} keep {driver}', '{driver} re-signs with {team}', '{team} tie down {driver}', '{driver} commits to {team}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} has re-signed with {team}.', 'Continuity at {team}.', '{driver} commits to {team} through {until}.'], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{driver} will remain at {team}.', '{team} have kept hold of {driver}.', '{driver} has put pen to paper with {team} again.'],
            ['The new deal runs until {until}.', 'The contract extends through {until}.', 'Both sides commit through {until}.']),
          compose(`${seed}:p2`, slots,
            ['It is continuity both parties wanted.', 'Stability looks the priority for the team.', 'A settled line-up is no small advantage.'],
            ['Familiarity with the team is worth real performance.', 'The working relationship has clearly borne fruit.', 'There is value in not starting over.']),
          compose(`${seed}:p3`, slots,
            ['{driver_last} can now plan for the long term.', 'The focus shifts squarely to performance.', 'With the future settled, all that matters is results.'],
            ['It removes one question mark from the off-season.', 'One seat, at least, is no longer in play.', 'The market has one fewer domino to fall.']),
          texture(`${seed}|q`, [
            '"I am exactly where I want to be," said {driver_last}.',
            '"There was never any real doubt," {driver_last} said.',
            '"We have unfinished business together," said {driver_last}.',
          ], slots, 30),
        ),
      })
    } else {
      const seed = `move-${m.driverId}-${eos.seasonYear}`
      const next = eos.seasonYear + 1
      const term = m.contractLength === 1
        ? `a one-year deal for ${next}`
        : `a ${m.contractLength}-year deal through ${m.contractExpiresAfterSeason}`
      const from = m.fromTeamId ? teamName(ctx, m.fromTeamId) : ''
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), team: m.toTeamName, next, until: m.contractExpiresAfterSeason, term, from }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 75,
        headline: fill(pick(['{driver} signs for {team}', '{team} land {driver}', '{driver} joins {team}', '{team} swoop for {driver}', '{driver} on the move to {team}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} switches to {team} for {next}.', 'A new chapter for {driver} at {team}.', '{team} make their move for {driver}.'], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{driver} has agreed a move to {team}.', '{team} have signed {driver}.', '{driver} is on the way to {team}.'],
            ['It is {term}.', '{driver_last} has signed {term}.', 'The agreement is {term}.']),
          compose(`${seed}:p2`, slots,
            ['It is a notable shake-up in the driver market.', 'The move reshapes the grid for {next}.', 'Expect knock-on effects up and down the paddock.'],
            from
              ? ['It ends {driver_last}\'s time at {from}.', 'A seat at {from} now opens up.', 'It leaves a vacancy at {from} for the market to fill.']
              : ['It marks a return to a full-time race seat for {driver_last}.', 'It is a route back onto the grid for {driver_last}.']),
          compose(`${seed}:p3`, slots,
            ['{driver_last} now faces the task of adapting quickly.', 'Pre-season will be about building chemistry with {team}.', 'The pressure to deliver follows any big move.'],
            ['It is one of the headline transfers of the off-season.', 'The grid for {next} suddenly looks different.', 'The deal is {term}.']),
          texture(`${seed}|q`, [
            '"I could not be more excited to join {team}," said {driver_last}.',
            '"It is a new challenge and I am ready for it," {driver_last} said.',
            '"When {team} came calling, it was an easy decision," said {driver_last}.',
            'The {team} principal called it "a signing that speaks to our ambition."',
          ], slots, 35),
        ),
      })
    }
  }
  for (const d of eos.droppedDrivers ?? []) {
    const seed = `drop-${d.driverId}-${eos.seasonYear}`
    const slots = { driver: d.driverName, driver_last: lastName(d.driverName), team: d.fromTeamName, next: eos.seasonYear + 1 }
    out.push({
      id: seed, category: 'driver_exit', round: r, priority: 55,
      headline: fill(pick(['{driver} dropped by {team}', '{driver} loses {team} seat', '{team} part ways with {driver}', 'No {next} seat for {driver}', '{driver} left without a drive'], `${seed}|h`), slots),
      dek: fill(pick(['{driver} is out at {team} for {next}.', '{driver} faces an uncertain future.', 'The end of the road at {team} for {driver}.'], `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['{driver} has been let go by {team}.', '{team} will not retain {driver}.', '{driver} is without a seat after {team} moved on.'],
          ['The {next} grid will have to find room, if it can.', 'A return for {next} is far from guaranteed.', 'The market is short on vacancies.']),
        compose(`${seed}:p2`, slots,
          ['It is a harsh end to the chapter.', 'The market is unforgiving at this level.', 'Few second chances come along once a seat is lost.'],
          ['Form and timing both went the wrong way.', 'The numbers, ultimately, did the talking.', 'Decisions like this are rarely sentimental.']),
        compose(`${seed}:p3`, slots,
          ['{driver_last} will hope a door opens elsewhere.', 'A reserve role may be the route back.', 'Reinvention is the only option now.'],
          ['Careers have recovered from worse.', 'The phone will need to ring soon.', 'Time, as ever, is short.']),
      ),
    })
  }
  for (const id of eos.retiredDriverIds ?? []) {
    const d = ctx.drivers.find((x) => x.id === id)
    const name = d?.name ?? id
    const seed = `retire-${id}-${eos.seasonYear}`
    const c = careerOf(ctx, id)
    // Final-season sign-off, straight from the standings — no career data needed.
    const standings = driverStandingsAfter(ctx, ctx.completedRounds)
    const idx = standings.findIndex((s) => s.driverId === id)
    const finalPos = idx >= 0 ? idx + 1 : null
    const finalPts = idx >= 0 ? standings[idx].points : 0
    const titlePhrase = c && c.titles > 0
      ? (c.titles === 1
          ? `a World Champion${c.titleYears[0] ? ` in ${c.titleYears[0]}` : ''}`
          : `a ${c.titles}-time World Champion${c.titleYears.length ? ` (${listJoin(c.titleYears.map(String))})` : ''}`)
      : ''
    const statBits: string[] = []
    if (c) {
      if (c.wins > 0) statBits.push(`${c.wins} ${plural(c.wins, 'win')}`)
      if (c.podiums > 0) statBits.push(`${c.podiums} ${plural(c.podiums, 'podium')}`)
      if (c.poles > 0) statBits.push(`${c.poles} ${plural(c.poles, 'pole position')}`)
    }
    const slots: Record<string, string | number> = {
      driver: name, driver_last: lastName(name), year: eos.seasonYear,
      debut: c?.debutYear ?? '', seasons: c?.seasons ?? 0, seasons_word: plural(c?.seasons ?? 0, 'season'),
      starts: c?.starts ?? 0, starts_word: plural(c?.starts ?? 0, 'start'),
      title_phrase: titlePhrase, stat_line: statBits.length ? listJoin(statBits) : '',
      best: c?.bestFinish ? ordinal(c.bestFinish) : '',
      final_pos: finalPos ? ordinal(finalPos) : '', final_pts: finalPts, final_pts_word: plural(finalPts, 'point'),
    }
    // Tenure (only when the debut season is known).
    const tenure = c?.debutYear
      ? fill(pick([' A career that began in {debut} closes after {seasons} {seasons_word}.', ' First racing in F1 in {debut}, {driver_last} bows out after {seasons} {seasons_word}.'], `${seed}|ten`), slots)
      : ''
    // The numbers — the heart of the piece. Honest when the career was winless.
    let numbersPara = ''
    if (c && c.starts > 0) {
      const lead = titlePhrase ? fill(pick(['{driver_last} leaves the sport {title_phrase}.', 'The record books will remember {driver_last} as {title_phrase}.'], `${seed}|tl`), slots) : ''
      const body = statBits.length
        ? fill(pick(['Across {starts} {starts_word}, {driver_last} took {stat_line}.', 'The tally from {starts} {starts_word}: {stat_line}.'], `${seed}|st`), slots)
        : fill(pick(['Across {starts} {starts_word}, a best finish of {best} stood as the high point.', '{starts} {starts_word} brought no podium, a best result of {best}.'], `${seed}|st`), slots)
      numbersPara = [lead, body].filter(Boolean).join(' ')
    }
    const seasonPara = finalPos
      ? fill(pick(['{driver_last} signs off {final_pos} in the {year} standings, with {final_pts} {final_pts_word}.', 'A final campaign ends {final_pos}, {final_pts} {final_pts_word} the return.'], `${seed}|fin`), slots)
      : ''
    // Tributes are earned, not handed out. A title winner or prolific winner gets the "great of
    // the sport" line; a solid racer gets a modest nod; a journeyman gets neither (the honest
    // numbers above already speak for themselves — no need to inflate a winless career).
    const illustrious = !!(c && (c.titles > 0 || c.wins >= 10))
    const solid = !!(c && (c.wins >= 1 || c.podiums >= 3))
    const tributePool = illustrious
      ? ['Formula 1 paid tribute to "a true great of the sport."', 'One paddock figure called {driver_last} "simply one of a kind."']
      : solid
      ? ['Rivals were quick to call {driver_last} "a tough, fair racer."', 'One former teammate called {driver_last} "seriously underrated."']
      : null
    const quotePara = [
      fill(pick(['"This is it," {driver_last} said. "After {year}, it is time for something new."', '"The time is right," said {driver_last}. "I leave with no regrets."'], `${seed}|q1`), slots),
      tributePool && chance(`${seed}|q2`, 60) ? fill(pick(tributePool, `${seed}|q2t`), slots) : '',
    ].filter(Boolean).join(' ')
    const dekOpts = c?.seasons
      ? ['{driver_last} will retire from Formula 1 at the end of {year}.', 'After {seasons} {seasons_word}, {driver_last} bows out.', '{driver} brings the curtain down after {year}.']
      : ['{driver_last} will retire from Formula 1 at the end of {year}.', '{driver} brings the curtain down after {year}.']
    out.push({
      id: seed, category: 'career_retirement', round: r, priority: 65,
      headline: fill(pick(titlePhrase
        ? ['{driver} to retire a champion', '{driver} calls time on a title-winning career', 'Curtain falls for champion {driver}', '{driver} steps away after {year}']
        : ['{driver} announces retirement', '{driver} calls time on a Formula 1 career', 'Curtain falls for {driver}', '{driver} to step away after {year}'], `${seed}|h`), slots),
      dek: fill(pick(dekOpts, `${seed}|d`), slots),
      body: paras(
        fill(pick(['{driver} will retire from Formula 1 at the end of {year}.', '{driver} has announced that {year} is to be a final season in Formula 1.'], `${seed}|p1`), slots) + tenure,
        numbersPara,
        seasonPara,
        quotePara,
      ),
    })
  }
  // God-mode grid changes taking effect next season: a new team's arrival, and a departing team's
  // farewell — both announced at the close of the current season. Names only; the rest is plausible,
  // unfalsifiable colour (we model none of the backers/bases/staff).
  const nextCount = ctx.teams.length - (eos.gridRemovals?.length ?? 0) + (eos.gridAdditions?.length ?? 0)
  for (const add of eos.gridAdditions ?? []) {
    const seed = `entry-${add.teamId}-${eos.seasonYear}`
    const slots = { team: add.teamName, next: eos.seasonYear + 1, count: nextCount }
    out.push({
      id: seed, category: 'team_entry', round: r, priority: 70,
      headline: fill(pick(['{team} confirmed as F1\'s newest team', '{team} get the green light for {next}', '{team} to join the Formula 1 grid', 'Welcome to Formula 1, {team}'], `${seed}|h`), slots),
      dek: fill(pick(['{team} have been approved to join the grid for {next}.', 'A new name joins Formula 1 in {next}.', 'The grid grows to {count} teams in {next}.'], `${seed}|d`), slots),
      body: paras(
        fill(pick(['{team} have been granted entry to Formula 1 from {next}, the sport has confirmed.', 'It is official: {team} will line up on the Formula 1 grid in {next}.'], `${seed}|p1`), slots)
          + ' ' + fill(pick(['The {next} grid will number {count} teams.', 'Their arrival takes the grid to {count} teams.'], `${seed}|p1b`), slots),
        fill(pick(['Formula 1 welcomed the entry, calling it "an exciting step for the sport and its fans."', 'Formula 1 called the news "a strong signal of the championship\'s momentum."'], `${seed}|q1`), slots)
          + ' ' + fill(pick(['The FIA hailed "a milestone for the championship."', 'The governing body spoke of "fresh energy" entering the paddock.'], `${seed}|q2`), slots),
        fill(pick(['The team principal said the squad "cannot wait to go racing."', 'The team principal spoke of "belief in the mission" through a long application process.'], `${seed}|q3`), slots)
          + ' ' + fill(pick(['Bases, a growing headcount and a power-unit programme are all taking shape ahead of the opener.', 'Facilities, staff and technical partnerships have been falling into place for months.'], `${seed}|p3`), slots),
      ),
    })
  }
  for (const rem of eos.gridRemovals ?? []) {
    const seed = `exit-${rem.teamId}-${eos.seasonYear}`
    const slots = { team: rem.teamName, year: eos.seasonYear, next: eos.seasonYear + 1, final_pos: rem.finalPosition ? ordinal(rem.finalPosition) : '' }
    const posLine = rem.finalPosition
      ? fill(pick([' They bow out {final_pos} in the constructors\' championship.', ' A final campaign ends {final_pos} among the constructors.'], `${seed}|pos`), slots)
      : ''
    out.push({
      id: seed, category: 'team_exit', round: r, priority: 68,
      headline: fill(pick(['{team} to leave Formula 1 after {year}', '{team} confirm grid exit', 'End of the road for {team}', '{team} bow out of Formula 1'], `${seed}|h`), slots),
      dek: fill(pick(['{team} will depart the grid at the end of {year}.', 'The {year} season is {team}\'s last in Formula 1.', '{team} call time on their Formula 1 entry.'], `${seed}|d`), slots),
      body: paras(
        fill(pick(['{team} will leave the Formula 1 grid after the {year} season.', 'It is the end of {team}\'s time in Formula 1, the team set to depart after {year}.'], `${seed}|p1`), slots) + posLine,
        fill(pick(['The decision draws a line under the team\'s spell in the sport, and their drivers return to the market as free agents.', 'With the seats now vacated, the team\'s drivers re-enter the driver market.'], `${seed}|p2`), slots),
        fill(pick(['A team spokesperson thanked "everyone who made the journey possible."', 'Formula 1 wished the team "the very best for the future."'], `${seed}|q`), slots),
      ),
    })
  }
  return out
}

// TRIGGER (live only): three windows — mid-season, three-quarter distance, and the
// penultimate round. The rumours are real: we run the actual driver-market sim on the
// season-to-date with a seeded -10..+10 error applied to each driver's media rating, then
// report the non-trivial moves it spits out as paddock speculation.
function sillySeason(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.endOfSeason || ctx.completedRounds < 2 || ctx.teams.length === 0) return []
  const N = ctx.calendar.length
  const windows = [...new Set([Math.round(N / 2), Math.round((3 * N) / 4), N - 1])].filter((r) => r >= 2 && r <= ctx.completedRounds)
  const out: NewsArticle[] = []
  for (const r of windows) {
    const resultsSoFar = ctx.raceResults.slice(0, r)
    const cstand = constructorStandingsAfter(ctx, r)
    const rankInfo = cstand.map((c, i) => ({ teamId: c.teamId, points: c.points, finalPosition: i + 1 }))
    for (const t of ctx.teams) if (!rankInfo.find((x) => x.teamId === t.id)) rankInfo.push({ teamId: t.id, points: 0, finalPosition: rankInfo.length + 1 })

    const baseScores = computeDriverMediaScores(ctx.drivers, ctx.teams, resultsSoFar, rankInfo, ctx.teams.length)
    const rng = mulberry32(`silly-${ctx.year}-${r}`)
    const noised = baseScores.map((s) => ({ driverId: s.driverId, score: clamp(s.score + (rng() * 20 - 10), 0, 100) }))
    const teamScores = computeTeamMediaScores(ctx.teams, ctx.constructorHistory, rankInfo)
    const retention = computeRetentionDeltas(ctx.drivers, ctx.teams, resultsSoFar)

    let projection
    try {
      projection = runDriverMarket(ctx.drivers, ctx.teams, noised, teamScores, retention, ctx.year + 1, rng)
    } catch {
      continue
    }
    // Only established drivers switching teams. Rookie fill-ins are excluded (mediaScore 0);
    // they are generated after the moves are settled and use Math.random() for their names, so
    // dropping them keeps the reported rumours fully deterministic. We also drop implausible
    // links (a driver tied to a team several places worse than their current one) — the media
    // noise can otherwise pair a frontrunner with a backmarker, which reads as nonsense.
    const cpos = new Map(cstand.map((c, i) => [c.teamId, i + 1]))
    const moves = projection.marketMoves.filter((m) => {
      if (m.isResignation || m.fromTeamId == null || m.mediaScore <= 0) return false
      const fromP = cpos.get(m.fromTeamId) ?? ctx.teams.length
      const toP = cpos.get(m.toTeamId) ?? ctx.teams.length
      return toP - fromP <= 4
    })
    const window = r === N - 1 ? 'with the season nearly over' : r >= (3 * N) / 4 ? 'as the campaign enters its closing stretch' : 'at the midway point of the season'

    if (moves.length === 0) {
      const seed = `silly-quiet-${ctx.year}-${r}`
      if (!chance(seed, 50)) continue
      const slots = { window, round: r }
      out.push({
        id: seed, category: 'silly_season', round: r, priority: 28,
        headline: fill(pick(['A quiet driver market, for now', 'Silly season slow to ignite', 'No movement yet on the grid', 'The market holds its breath'], `${seed}|h`), slots),
        dek: fill(pick(['The paddock rumour mill is unusually still {window}.', 'Few seats look likely to change hands.', 'Calm before the storm, perhaps.'], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['For all the talk, the driver market is quiet {window}.', 'The grid looks settled {window}.', 'There is little concrete movement {window}.'],
            ['Most teams appear content with their current line-ups.', 'No obvious dominoes are poised to fall just yet.', 'The big names seem to be staying put.']),
          compose(`${seed}:p2`, slots,
            ['That can change in an instant, of course.', 'One signing tends to trigger several more.', 'The calm rarely lasts long in this paddock.'],
            ['A single result can reopen a seat thought closed.', 'Performance, as ever, will drive the market.', 'Patience is the watchword for now.']),
          compose(`${seed}:p3`, slots,
            ['For now, there is little to report.', 'The rumour mill will have to wait.', 'Watch this space as the season unwinds.'],
            ['Things tend to heat up later in the year.', 'The real moves often come late.', 'Expect activity before long.']),
        ),
      })
      continue
    }

    const dstand = driverStandingsAfter(ctx, r)
    for (const m of moves) {
      const fromName = teamName(ctx, m.fromTeamId as string)
      const dpts = dstand.find((s) => s.driverId === m.driverId)?.points ?? 0
      const dRank = dstand.findIndex((s) => s.driverId === m.driverId)
      // Only brag about a points haul when it is actually notable (upper half of the grid);
      // otherwise "a return of 2 points has not gone unnoticed" reads as a joke.
      const notablePoints = dpts > 0 && dRank >= 0 && dRank < dstand.length / 2
      const toIdx = cstand.findIndex((c) => c.teamId === m.toTeamId)
      const toPos = toIdx >= 0 ? ordinal(toIdx + 1) : ''
      const fromIdx = cstand.findIndex((c) => c.teamId === m.fromTeamId)
      const fromPos = fromIdx >= 0 ? ordinal(fromIdx + 1) : ''
      // Frame the move by its real direction in the constructors order (lower index = better).
      const direction = fromIdx >= 0 && toIdx >= 0 ? (toIdx < fromIdx ? 'up' : toIdx > fromIdx ? 'down' : 'level') : 'unknown'
      const seed = `silly-${ctx.year}-${r}-${m.driverId}`
      const drv = ctx.drivers.find((d) => d.id === m.driverId)
      const veteran = (drv?.age ?? 25) >= 30
      const outOfContract = !!drv && drv.contractExpiresAfterSeason <= ctx.year
      // Ambiguous, unfalsifiable "qualities" that fit "value {driver}'s {appeal}" — age-aware so
      // we never claim something the data could contradict.
      // Each fits "value {driver}'s {appeal}", so no leading article.
      const qualities = veteran
        ? ['experience and know-how', 'racecraft and composure', 'steadying influence in the garage', 'big-race temperament', 'sheer mileage', 'marketability', 'professionalism', 'all-round package', 'standing in the paddock', 'reliability between the walls']
        : ['youth and upside', 'raw potential', 'sky-high ceiling', 'fearlessness', 'long-term promise', 'marketability', 'professionalism', 'all-round package', 'standing in the paddock', 'fresh edge']
      const appeal = pick(qualities, `${seed}|appeal`)
      // Status descriptor for "would be adding {status}" — grounded so it can't contradict.
      const wins = winsUpTo(ctx, m.driverId, r)
      const status = wins > 0 ? 'a proven race winner' : (dRank >= 0 && dRank < 4 ? 'an upper-echelon talent' : 'a known quantity')
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), to: m.toTeamName, to_poss: poss(m.toTeamName), from: fromName, window, round: r, driver_points: dpts, to_pos: toPos, from_pos: fromPos, appeal, status }
      // Texture from many independent low-odds sources (each ~10%, several can fire) rather than
      // one heavy line — sightings, rival suitors, the driver in the pen, a team line, fans, pundits.
      const sillyTexture = [
        texture(`${seed}|sight`, ['A sighting of {driver_last} near the {to} hospitality unit did little to quell the talk.', 'The {driver_last} camp is said to have held exploratory talks.', 'Word of a quiet meeting at {to} headquarters has only fanned the flames.', 'An agent was spotted doing the rounds of the paddock motorhomes.'], slots, 10),
        texture(`${seed}|rival`, ['{to} are not thought to be the only admirers.', 'At least one rival outfit is said to be monitoring the situation.', 'Whispers suggest {to} face competition for the signature.'], slots, 10),
        texture(`${seed}|pen`, ['Asked directly, {driver_last} batted the question away in the media pen.', '"My focus is on the racing here," {driver_last} said when asked.', '"I am happy where I am," said {driver_last}, with a smile that gave little away.', '{driver_last} offered nothing but a wry smile when pressed.'], slots, 10),
        texture(`${seed}|spox`, ['A {to} spokesperson declined to comment.', '{to} dismissed the talk as paddock noise.', '{from} insisted their driver is going nowhere.'], slots, 10),
        texture(`${seed}|fan`, ['Fans have already started the countdown on social media.', 'The grandstands buzzed with the rumour all weekend.', 'Supporters of both camps are split on the idea.'], slots, 10),
        texture(`${seed}|pundit`, ['Pundits are divided on whether the move makes sense.', 'Analysts reckon it would suit one party more than the other.', 'The paddock consensus is that it would be a gamble worth taking.'], slots, 10),
      ].filter(Boolean).join(' ')
      out.push({
        id: seed, category: 'silly_season', round: r, priority: 30,
        headline: fill(pick([
          'Rumour has {driver} linked with {to}', '{driver} on {to_poss} radar', 'Could {driver} swap {from} for {to}?',
          '{to} eyeing a move for {driver}', 'Is {driver} bound for {to}?', 'Speculation grows around {driver}',
          'Is a {driver} switch to {to} on?', '{driver} the name on everyone\'s lips',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{driver} is being linked with a switch to {to}.', 'Talk of a {driver} move is gathering pace.',
          '{to} are said to admire {driver}.', 'The rumour mill turns to {driver}.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['The paddock is buzzing with talk of {driver}.', '{driver} has become a name to watch in the market.', 'Speculation is building around the future of {driver}.'],
            ['Sources suggest {to} are weighing up a move {window}.', '{to} are understood to have registered interest {window}.', 'A switch from {from} to {to} is the talk of the rumour mill {window}.']),
          sillyTexture,
          compose(`${seed}:p2`, slots,
            ['{to} are said to value {driver_last}\'s {appeal}.', 'What draws {to} is {driver_last}\'s {appeal}.', 'On paper, the fit makes a certain sense.', 'The logic behind the link is not hard to see.'],
            notablePoints
              ? ['{driver_last} has {driver_points} points to show for the season so far.', 'A return of {driver_points} points this year has not gone unnoticed.']
              : [''],
            // Grounded direction of the move, using both teams' real standings.
            direction === 'up'
              ? ['It would be a step up, from {from} in {from_pos} to {to} in {to_pos}.', 'On the table is a move up the order, {from_pos} to {to_pos}.']
              : direction === 'down'
              ? ['Curiously, it would mean a step down, from {from} in {from_pos} to {to} in {to_pos}.', 'It would be a slide from {from_pos} to {to_pos}, which raises eyebrows.']
              : direction === 'level'
              ? ['It would be a sideways move, {from} ({from_pos}) and {to} ({to_pos}) near-level in the order.', 'There is little between {from} ({from_pos}) and {to} ({to_pos}) in the standings.']
              : [''],
            ['{to} would be adding {status}.', 'For {to}, it would be a statement of intent.', 'Each party has something the other wants.']),
          compose(`${seed}:p3`, slots,
            ['Nothing is signed, and {from} would still have to release {driver_last}.', 'For now it is talk, and {from} hold the cards.', 'Any deal hinges on {from} being willing to let {driver_last} go.'],
            outOfContract
              ? ['Crucially, {driver_last}\'s deal is up at the end of the year, which only adds fuel.', 'Out of contract at season\'s end, {driver_last} is free to listen to offers.']
              : ['But {driver_last} is tied to {from} beyond this season, complicating any switch.', 'With time still left on the contract, {from} are under no pressure to sell.']),
        ),
      })
    }
  }
  return out
}

interface AnalysisCandidate {
  subject: string          // recency key (driverId or teamId)
  score: number            // base newsworthiness (0-100ish, comparable across angles)
  make: () => NewsArticle
}

// Each angle's newsworthiness on a shared scale, so the most striking story wins regardless
// of type: a runaway teammate gap, a deep slump, a hot streak, or a team off its car-pace tier.
const teammateScore = (gap: number) => clamp(gap * 2, 0, 100)
const slumpScore = (avg: number) => clamp((avg - 10) * 6, 0, 100)
const surgeScore = (avg: number) => clamp((6 - avg) * 16, 0, 100)        // avg 5th -> 16, 2nd -> 64, 1st -> 80
const trajectoryScore = (absDelta: number) => clamp(absDelta * 18, 0, 100)

// TRIGGER (opinion): AT MOST ONE analysis piece per round. Every angle (teammate imbalance,
// form slump, form surge, team over/under-performance) is scored for newsworthiness; subjects
// featured in the last few rounds take a small penalty so the column doesn't fixate on one
// story; the single best candidate runs, but only if it clears a minimum bar. Rounds are
// walked in order so the recency bias reflects what has already been published.
function analysis(ctx: NewsContext): NewsArticle[] {
  if (ctx.endOfSeason) return []
  const total = ctx.teams.length
  const THRESHOLD = 30
  const CAP = 2          // at most this many analysis pieces about any one subject per season
  const MATERIAL = 15    // a repeat only fires if the subject's score grew at least this much
  const featuredAt = new Map<string, number>()
  const featuredScore = new Map<string, number>()
  const featuredCount = new Map<string, number>()
  // Wider, steeper penalty than before, so a runaway story does not resurface every few rounds.
  const recencyPenalty = (subject: string, r: number): number => {
    const last = featuredAt.get(subject)
    if (last == null) return 0
    const gap = r - last
    return gap <= 0 || gap >= 6 ? 0 : (6 - gap) * 6
  }

  const out: NewsArticle[] = []
  for (let r = 3; r <= ctx.completedRounds; r++) {
    const candidates: AnalysisCandidate[] = []
    const stand = driverStandingsAfter(ctx, r)

    // Teammate imbalance
    const byTeam = new Map<string, SimpleStanding[]>()
    for (const s of stand) {
      if (s.teamId === '') continue
      const arr = byTeam.get(s.teamId) ?? []
      arr.push(s)
      byTeam.set(s.teamId, arr)
    }
    for (const [teamId, pair] of byTeam) {
      if (pair.length < 2) continue
      const [a, b] = [...pair].sort((x, y) => y.points - x.points)
      const gap = a.points - b.points
      if (gap < 25) continue
      const id = `tm-${ctx.year}-${r}-${teamId}`
      const tr = teammateTrend(ctx, a.driverId, b.driverId, r)
      const slots = { team: a.teamName, ahead: a.driverName, ahead_last: lastName(a.driverName), behind: b.driverName, behind_last: lastName(b.driverName), ap: a.points, bp: b.points, gap, round: r, win_x: tr?.x ?? 0, ra: tr?.ra ?? 0, rb: tr?.rb ?? 0 }
      // Grounded recent-form line: the most telling window, and which way the gap is moving.
      const trendPara = tr ? fill(pick(
        tr.trend === 'fightback'
          ? ['There are signs of a fightback, with {behind_last} outscoring {ahead_last} {rb} to {ra} over the last {win_x} races.', 'Recent form offers {behind_last} hope, the trailing driver beating {ahead_last} {rb} to {ra} across the last {win_x} races.']
          : tr.trend === 'widening'
          ? ['And it is only widening, with {ahead_last} outscoring {behind_last} {ra} to {rb} over the last {win_x} races.', 'The recent trend is grim for {behind_last}, beaten {rb} to {ra} on points over the last {win_x} races.']
          : ['Of late the pair have been more evenly matched, {ra} against {rb} over the last {win_x} races.', 'Recent form has been closer, {ahead_last} on {ra} to {behind_last}\'s {rb} across the last {win_x} races.'],
        `${id}|trend`), slots) : ''
      candidates.push({
        subject: teamId, score: teammateScore(gap),
        make: () => ({
          id, category: 'analysis_opinion', round: r, priority: 35,
          headline: fill(pick([
            '{ahead} has the upper hand at {team}', '{behind} struggling in the {team} fight',
            'The {team} garage is becoming one-sided', '{ahead} pulling clear of {behind}',
            'Who is number one at {team}?', '{behind} on the back foot at {team}',
          ], `${id}|h`), slots),
          dek: fill(pick([
            '{ahead} leads {behind} {ap} to {bp} at {team}.', 'A {gap}-point gap inside the {team} garage.',
            '{behind} has work to do against {ahead}.', 'The intra-team balance has tilted at {team}.',
          ], `${id}|d`), slots),
          body: paras(
            compose(`${id}:p1`, slots,
              ['The intra-team battle at {team} is increasingly one-sided.', 'There is a clear number one emerging at {team}.', 'The {team} pairing is no longer evenly matched.'],
              ['{ahead} ({ap} pts) has pulled clear of {behind} ({bp} pts).', '{ahead} holds a {gap}-point edge over {behind}.', '{ahead} leads {behind} by {gap} points.']),
            trendPara,
            compose(`${id}:p2`, slots,
              ['The pressure is mounting on the other side of the garage.', '{behind} badly needs a result to steady things.', 'Questions are starting to follow {behind} around the paddock.'],
              ['Team dynamics can sour quickly when the gap grows.', 'A turnaround is still possible, but time is a factor.', 'Confidence, once dented, is hard to rebuild.']),
            compose(`${id}:p3`, slots,
              ['For {ahead_last}, it is validation of a strong run.', 'The momentum is firmly with {ahead_last}.', 'Internally, the pecking order looks increasingly settled.'],
              ['{behind_last} will be desperate to respond.', 'A reset over the coming rounds is the only answer.', 'The second half offers a chance to put it right.']),
            texture(`${id}|q`, [
              '"I am not panicking, we keep working," said {behind_last}.',
              '"The results do not reflect the effort," {behind_last} said.',
              '"My side of the garage will come good," said {behind_last}.',
            ], slots, 30),
          ),
        }),
      })
    }

    // Form slump (poor recent run) and form surge (hot streak)
    for (const d of ctx.drivers.filter((x) => x.teamId !== '')) {
      const recent = recentFinishesUpTo(ctx, d.id, r, 3)
      if (recent.length < 3) continue
      const avg = recent.reduce((s, x) => s + x, 0) / recent.length
      if (avg >= 12) {
        const id = `slump-${ctx.year}-${r}-${d.id}`
        const veteran = (d.age ?? 25) >= 32
        const slots = { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId), round: r, recent_runs: listJoin(recent.map(fmtFinish)) }
        // Many independent low-odds texture sources (several may fire) instead of generic filler.
        const slumpTexture = [
          texture(`${id}|upg`, ['{team} are understood to be fast-tracking upgrades to arrest the slide.', 'The hope at {team} is that new parts can turn it around.'], slots, 16),
          texture(`${id}|chassis`, ['There is talk of a chassis change to rule out hidden damage.', 'A back-to-basics inspection of the car is reportedly under way.'], slots, 16),
          texture(`${id}|psych`, ['Word is {driver_last} has been leaning on a sports psychologist.'], slots, 12),
          texture(`${id}|luck`, ['Analysts put much of the run down to plain bad luck.', 'Some pundits insist the pace is still there and the results flatter to deceive.'], slots, 18),
          texture(`${id}|tweet`, ['A cryptic post from {driver_last} only added to the intrigue.'], slots, 12),
          texture(`${id}|spox`, ['A {team} spokesperson insisted there is no cause for concern.', 'The team line is that it is a blip and nothing more.'], slots, 14),
          texture(`${id}|rivals`, ['Even rivals have offered private sympathy for the run.'], slots, 10),
          texture(`${id}|age`, veteran ? ['Some in the paddock wonder aloud whether the years are catching up.'] : [], slots, 14),
          texture(`${id}|mood`, ['{driver_last} cut a frustrated figure in the paddock.', '{driver_last} kept the post-race media duties brief.'], slots, 14),
        ].filter(Boolean).join(' ')
        candidates.push({
          subject: d.id, score: slumpScore(avg),
          make: () => ({
            id, category: 'analysis_opinion', round: r, priority: 30,
            headline: fill(pick([
              'Pressure builds on {driver}', '{driver} searching for answers', 'A worrying run for {driver}',
              'What has gone wrong for {driver}?', '{driver} stuck in a rut', 'The slump deepens for {driver}',
            ], `${id}|h`), slots),
            dek: fill(pick([
              '{driver} has slipped down the order in recent rounds.', 'Points have dried up for {driver}.',
              'A difficult spell for the {team} driver.', 'The form guide makes grim reading for {driver}.',
            ], `${id}|d`), slots),
            body: paras(
              compose(`${id}:p1`, slots,
                ['{driver} is enduring a difficult run.', 'The last few rounds have been bleak for {driver}.', 'Form has deserted {driver} at the worst time.'],
                ['Recent finishes have read {recent_runs}.', 'The last three weekends brought {recent_runs}.', 'A run of {recent_runs} tells the story.']),
              compose(`${id}:p2`, slots,
                ['Questions are being asked about the {driver_last} slump.', 'The paddock is starting to wonder where the turnaround comes from.', 'For {team}, it is a problem that needs solving quickly.']),
              slumpTexture,
              texture(`${id}|q`, [
                '"We stay calm and keep digging," said {driver_last}.',
                '"It will turn, I have no doubt," {driver_last} said.',
                '"You do not forget how to drive overnight," said {driver_last}.',
              ], slots, 30),
            ),
          }),
        })
      } else if (avg <= 5) {
        const id = `surge-${ctx.year}-${r}-${d.id}`
        const slots = { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId), round: r, recent_runs: listJoin(recent.map(fmtFinish)) }
        candidates.push({
          subject: d.id, score: surgeScore(avg),
          make: () => ({
            id, category: 'analysis_opinion', round: r, priority: 32,
            headline: fill(pick([
              '{driver} is on a roll', 'Red-hot {driver} hits form', 'The {driver} surge continues',
              '{driver} can do no wrong', 'Everything clicking for {driver}', '{driver} in unstoppable form',
            ], `${id}|h`), slots),
            dek: fill(pick([
              '{driver} has strung together a run of strong results.', 'Points are flowing for {driver}.',
              'A purple patch for the {team} driver.', '{driver} is the form pick of the grid.',
            ], `${id}|d`), slots),
            body: paras(
              compose(`${id}:p1`, slots,
                ['{driver} is in a rich vein of form.', 'The last few rounds have belonged to {driver}.', 'Few are in better shape right now than {driver}.'],
                ['Recent finishes have read {recent_runs}.', 'The last three rounds brought {recent_runs}.', 'A sequence of {recent_runs} tells the story.']),
              compose(`${id}:p2`, slots,
                ['Confidence is a powerful thing, and {driver_last} has it in spades.', 'When a driver is hot, the whole team lifts with them.', 'Momentum like this is hard to manufacture and easy to lose.'],
                ['Rivals will be eager to halt the run.', 'The challenge now is to sustain it.', 'Form this good rarely lasts forever, but while it does it is formidable.']),
              compose(`${id}:p3`, slots,
                ['It has dragged {team} up the order with it.', 'The standings reflect a driver at the top of their game.', 'The numbers tell the story of a genuine hot streak.'],
                ['Keeping it going is the only goal now.', 'The bandwagon is rolling.', 'On this evidence, anything looks possible.']),
              texture(`${id}|q`, [
                '"Everything is just clicking right now," said {driver_last}.',
                '"I feel completely at one with the car," {driver_last} said.',
                '"Long may it continue," said {driver_last} with a grin.',
              ], slots, 30),
            ),
          }),
        })
      }
    }

    // Team trajectory vs car pace (live only — needs real car pace)
    if (ctx.live) {
      const cstand = constructorStandingsAfter(ctx, r)
      cstand.forEach((cs, idx) => {
        const standingPos = idx + 1
        const pace = paceRank(ctx, cs.teamId)
        const delta = pace - standingPos // positive = punching above car pace
        if (Math.abs(delta) < 2) return
        const id = `traj-${ctx.year}-${r}-${cs.teamId}`
        const slots = { team: cs.teamName, pos: ordinal(standingPos), tier: tierWord(pace, total), round: r }
        const over = delta > 0
        candidates.push({
          subject: cs.teamId, score: trajectoryScore(Math.abs(delta)),
          make: () => ({
            id, category: 'analysis_opinion', round: r, priority: 28,
            headline: fill(pick(over
              ? ['{team} are punching above their weight', 'Overachieving {team} defy the form book', 'How are {team} doing it?', '{team} the overperformers of the season', '{team} keep outdoing themselves']
              : ['{team} underdelivering on their potential', 'Has {team} hit a ceiling?', '{team} leaving points on the table', 'Underwhelming {team} fall short', 'Where are the points, {team}?'],
              `${id}|h`), slots),
            dek: fill(pick(over
              ? ['{team} sit {pos} despite a {tier} car.', '{team} are outscoring their machinery.', 'A {tier} car, a flattering position for {team}.']
              : ['{team} sit only {pos} with a {tier} car.', '{team} are not making their pace count.', 'A {tier} car, a disappointing return for {team}.'],
              `${id}|d`), slots),
            body: over
              ? paras(
                  compose(`${id}:p1`, slots,
                    ['{team} have been one of the stories of the season.', '{team} keep defying their car.', 'Few expected {team} to be where they are.'],
                    ['They sit {pos} with what is, on paper, a {tier} package.', 'A {tier} car has them running {pos} in the standings.', 'The results outstrip the {tier} machinery beneath them.']),
                  compose(`${id}:p2`, slots,
                    ['Maximum points from a modest package is a credit to the operation.', 'Execution has been the difference, weekend after weekend.', 'Nothing has been left on the table.'],
                    ['Whether they can sustain it is the question.', 'Rivals with faster cars have been made to look ordinary.', 'It is a lesson in extracting everything available.']),
                  compose(`${id}:p3`, slots,
                    ['The whole team can take real pride in the run.', 'Operationally, they have been close to faultless.', 'Belief grows with every weekend like this.'],
                    ['The target now is to hold position as others develop.', 'Staying ahead of faster cars will get harder.', 'For now, they are punching well above their weight.']),
                )
              : paras(
                  compose(`${id}:p1`, slots,
                    ['{team} are leaving points on the table.', '{team} are not getting the most from their car.', 'Something is not clicking at {team}.'],
                    ['A {tier} car has only delivered {pos} in the standings.', 'They sit {pos} despite genuinely {tier} pace.', 'The position flatters nobody given the {tier} machinery.']),
                  compose(`${id}:p2`, slots,
                    ['The paddock is questioning where it is going wrong.', 'Operational mistakes have been costly.', 'Too many weekends have unravelled.'],
                    ['Pressure is building to turn pace into results.', 'The car deserves better than the points say.', 'Execution, not speed, looks the problem.']),
                  compose(`${id}:p3`, slots,
                    ['Heads will need to stay cool to arrest the slide.', 'The talent in the car is not in doubt.', 'A run of clean weekends would change the narrative fast.'],
                    ['The second half is a chance to put it right.', 'They cannot afford to keep squandering the speed.', 'Time remains, but patience is wearing thin.']),
                ),
          }),
        })
      })
    }

    // A subject already covered may only resurface if it is below the season cap AND its score
    // has grown materially since last time — otherwise it is "the same story again".
    const eligible = candidates.filter((c) => {
      const count = featuredCount.get(c.subject) ?? 0
      if (count === 0) return true
      if (count >= CAP) return false
      return c.score - (featuredScore.get(c.subject) ?? 0) >= MATERIAL
    })
    if (eligible.length === 0) continue
    const best = eligible
      .map((c) => ({ c, adj: c.score - recencyPenalty(c.subject, r) }))
      .sort((x, y) => y.adj - x.adj || x.c.subject.localeCompare(y.c.subject))[0]
    if (best.adj < THRESHOLD) continue
    out.push(best.c.make())
    featuredAt.set(best.c.subject, r)
    featuredScore.set(best.c.subject, best.c.score)
    featuredCount.set(best.c.subject, (featuredCount.get(best.c.subject) ?? 0) + 1)
  }
  return out
}

// TRIGGER (live only): roughly one every four races — a spotlight on a driver off the grid.
// career.starts is the truth of it: 0 means a never-raced prospect (pure narrative on name/age/
// potential — nothing to contradict); > 0 means an experienced free agent, where we cite the real
// career record. Either way it closes on the actual market projection (seeded ±10 media error) for
// whether a return looks likely.
function driverToWatch(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.endOfSeason) return []
  const freeAgents = ctx.drivers.filter((d) => d.teamId === '')
  if (freeAgents.length === 0 || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
  for (let r = 4; r <= ctx.completedRounds; r += 4) {
    const fa = pick(freeAgents, `watch-${ctx.year}-${r}`)
    const seed = `watch-${ctx.year}-${r}-${fa.id}`
    const c = careerOf(ctx, fa.id)
    const experienced = (c?.starts ?? 0) > 0

    // Market projection: would this free agent pick up a seat for next season?
    const resultsSoFar = ctx.raceResults.slice(0, r)
    const cstand = constructorStandingsAfter(ctx, r)
    const rankInfo = cstand.map((cs, i) => ({ teamId: cs.teamId, points: cs.points, finalPosition: i + 1 }))
    for (const t of ctx.teams) if (!rankInfo.find((x) => x.teamId === t.id)) rankInfo.push({ teamId: t.id, points: 0, finalPosition: rankInfo.length + 1 })
    const rng = mulberry32(seed)
    const base = computeDriverMediaScores(ctx.drivers, ctx.teams, resultsSoFar, rankInfo, ctx.teams.length)
    const noised = base.map((s) => ({ driverId: s.driverId, score: clamp(s.score + (rng() * 20 - 10), 0, 100) }))
    const teamScores = computeTeamMediaScores(ctx.teams, ctx.constructorHistory, rankInfo)
    const retention = computeRetentionDeltas(ctx.drivers, ctx.teams, resultsSoFar)
    let toTeam = ''
    try {
      const proj = runDriverMarket(ctx.drivers, ctx.teams, noised, teamScores, retention, ctx.year + 1, rng)
      const mv = proj.marketMoves.find((m) => m.driverId === fa.id && m.toTeamId && !m.isResignation)
      if (mv) toTeam = mv.toTeamName
    } catch { /* projection failed → treat as no opening */ }

    // Experienced-career honours, only what is real.
    const honourBits: string[] = []
    if (c) {
      if (c.titles > 0) honourBits.push(c.titles === 1 ? `a former World Champion` : `a ${c.titles}-time World Champion`)
      if (c.wins > 0) honourBits.push(`${c.wins} ${plural(c.wins, 'win')}`)
      else if (c.podiums > 0) honourBits.push(`${c.podiums} ${plural(c.podiums, 'podium')}`)
    }
    const slots: Record<string, string | number> = {
      driver: fa.name, driver_last: lastName(fa.name), age: fa.age, next: ctx.year + 1, to: toTeam,
      starts: c?.starts ?? 0, starts_word: plural(c?.starts ?? 0, 'start'),
      honours: honourBits.length ? listJoin(honourBits) : '',
      pot: fa.peakPotential >= 88 ? 'one of the hottest properties in the junior ranks' : fa.peakPotential >= 80 ? 'a genuine prospect' : 'an intriguing talent',
    }
    const marketLine = toTeam
      ? fill(pick(['Run the silly-season maths and a {to} seat for {next} looks a genuine possibility.', 'The market projects {driver_last} could even land at {to} for {next}.'], `${seed}|mkt`), slots)
      : experienced
      ? fill(pick(['For now, the projection shows no opening, and a seat may have to wait.', 'As things stand, a route back onto the grid looks hard to find.'], `${seed}|mkt`), slots)
      : fill(pick(['For now, the projection shows no opening, and a debut may have to wait.', 'As things stand, a first F1 seat looks some way off.'], `${seed}|mkt`), slots)

    if (experienced) {
      const recordLine = honourBits.length
        ? fill(pick(['Across {starts} {starts_word}, {driver_last} brings {honours} to the table.', 'A record of {starts} {starts_word} and {honours} is not one to overlook.'], `${seed}|rec`), slots)
        : fill(pick(['{starts} {starts_word} of experience count for something, even without the silverware.', 'No podiums in {starts} {starts_word}, but a known quantity all the same.'], `${seed}|rec`), slots)
      out.push({
        id: seed, category: 'driver_to_watch', round: r, priority: 33,
        headline: fill(pick(['Where next for {driver}?', '{driver} eyes a way back', 'A familiar name on the market in {driver}', 'Could {driver} return to the grid?'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} is between seats and weighing the options.', 'Out of a drive for now, {driver_last} is not done yet.', 'A familiar face is on the market.'], `${seed}|d`), slots),
        body: paras(
          fill(pick(['{driver}, {age}, finds themselves without a seat, a familiar face still chasing a way back.', 'At {age}, {driver} is on the market, and not short of suitors.'], `${seed}|p1`), slots),
          recordLine,
          fill(pick(['"I am not done in this sport," {driver_last} said.', '"Do not write me off," said {driver_last}. "I will be back."'], `${seed}|q`), slots),
          marketLine,
        ),
      })
    } else {
      out.push({
        id: seed, category: 'driver_to_watch', round: r, priority: 33,
        headline: fill(pick(['Keep an eye on {driver}', '{driver}, one for the future', 'A prospect worth watching in {driver}', 'Why {driver} is turning heads'], `${seed}|h`), slots),
        dek: fill(pick(['{driver}, {age}, has yet to race in F1 but is generating buzz.', 'Meet {driver}, tipped for big things.', 'A name to file away in {driver}.'], `${seed}|d`), slots),
        body: paras(
          fill(pick(['{driver}, just {age}, has yet to make a Grand Prix start, but is rated {pot}.', 'At {age}, {driver} has never raced in F1, and is regarded as {pot}.'], `${seed}|p1`), slots),
          fill(pick(['Those who have watched the junior ranks talk up the raw speed and racecraft.', 'A reputation built in the junior single-seater categories, where the results have caught the eye.'], `${seed}|p2`), slots),
          fill(pick(['"There is something special there," one paddock figure said.', '"Keep that name in mind," said a junior-series insider.'], `${seed}|q`), slots),
          marketLine,
        ),
      })
    }
  }
  return out
}

// TRIGGER: a mid-season driver change at a team (god-mode), detected straight from the race
// results — a seat's occupant changes partway through the year. Reports the axed driver's form to
// that point (grounded, so the "why" never overclaims) and introduces the replacement, using the
// career record to tell a returning hand from a debutant.
function midSeasonSwaps(ctx: NewsContext): NewsArticle[] {
  const N = ctx.completedRounds
  if (N < 2) return []
  // Per team, each driver's first/last round and stats to date.
  type Stint = { first: number; last: number; starts: number; points: number; best: number | null; name: string }
  const byTeam = new Map<string, Map<string, Stint>>()
  for (let round = 1; round <= N; round++) {
    for (const res of ctx.raceResults[round - 1] ?? []) {
      if (!res.teamId) continue
      let team = byTeam.get(res.teamId)
      if (!team) { team = new Map(); byTeam.set(res.teamId, team) }
      let d = team.get(res.driverId)
      if (!d) { d = { first: round, last: round, starts: 0, points: 0, best: null, name: res.driverName }; team.set(res.driverId, d) }
      d.last = round; d.starts++; d.points += res.points
      const fp = res.finishPosition
      if (fp != null && (d.best == null || fp < d.best)) d.best = fp
    }
  }
  const out: NewsArticle[] = []
  for (const [teamId, drivers] of byTeam) {
    for (const [repId, rep] of drivers) {
      if (rep.first <= 1) continue // a regular, not a mid-season arrival
      const k = rep.first
      // Whose seat did they take? A driver whose last round was exactly the one before.
      let axed: Stint | null = null
      for (const [aid, a] of drivers) {
        if (aid !== repId && a.last === k - 1 && a.first <= k - 1) { axed = a; break }
      }
      if (!axed) continue
      const seed = `swap-${teamId}-${repId}-${k}`
      const cr = careerOf(ctx, repId)
      const repExperienced = !!(cr && (cr.wins > 0 || cr.podiums > 0 || cr.starts > rep.starts))
      const slots: Record<string, string | number> = {
        team: teamName(ctx, teamId), axed: axed.name, axed_last: lastName(axed.name),
        rep: rep.name, rep_last: lastName(rep.name), round: k,
        a_starts: axed.starts, a_starts_word: plural(axed.starts, 'round'),
        a_pts: axed.points, a_pts_word: plural(axed.points, 'point'),
        a_best: axed.best ? ordinal(axed.best) : '', cr_starts: cr?.starts ?? 0, cr_starts_word: plural(cr?.starts ?? 0, 'start'),
      }
      // The "why" is grounded in the axed driver's actual form to that point — never inflated.
      const whyLine = axed.points === 0
        ? fill(pick(['{a_starts} {a_starts_word} brought no points, and {team} have opted for a change.', 'A pointless run over {a_starts} {a_starts_word} has cost {axed_last} the seat.'], `${seed}|why`), slots)
        : fill(pick(['{axed_last} leaves the seat with {a_pts} {a_pts_word} and a best finish of {a_best} from {a_starts} {a_starts_word}.', 'Over {a_starts} {a_starts_word}, {axed_last} managed {a_pts} {a_pts_word}, best finish {a_best}.'], `${seed}|why`), slots)
      const repLine = repExperienced
        ? fill(pick(['In comes {rep}, who brings {cr_starts} {cr_starts_word} of experience.', '{rep} steps in, no stranger to the grid with {cr_starts} {cr_starts_word} to their name.'], `${seed}|rep`), slots)
        : fill(pick(['In comes {rep}, handed a Grand Prix debut.', '{rep} steps up for a first taste of Formula 1.'], `${seed}|rep`), slots)
      out.push({
        id: seed, category: 'mid_season_swap', round: k, priority: 52,
        headline: fill(pick(['{team} replace {axed_last} with {rep_last}', '{axed_last} axed by {team} mid-season', '{rep_last} called up as {team} drop {axed_last}', 'Mid-season change at {team}'], `${seed}|h`), slots),
        dek: fill(pick(['{team} swap {axed_last} for {rep_last} from round {round}.', 'A mid-season driver change at {team}.', '{rep_last} replaces {axed_last} at {team}.'], `${seed}|d`), slots),
        body: paras(
          fill(pick(['{team} have made a mid-season change, replacing {axed} with {rep} from round {round}.', '{team} have pulled the trigger mid-season, drafting in {rep} in place of {axed}.'], `${seed}|p1`), slots),
          whyLine,
          repLine,
          fill(pick(['"It is a difficult call, but the right one for the team," a {team} spokesperson said.', '"I am grateful for the chance and ready to deliver," said {rep_last}.'], `${seed}|q`), slots),
        ),
      })
    }
  }
  return out
}

export function generateNews(ctx: NewsContext): NewsArticle[] {
  const all = [
    ...preSeason(ctx),
    ...raceReports(ctx),
    ...milestones(ctx),
    ...technicalRoundup(ctx),
    ...championship(ctx),
    ...titleScenario(ctx),
    ...titleFight(ctx),
    ...features(ctx),
    ...analysis(ctx),
    ...sillySeason(ctx),
    ...previews(ctx),
    ...market(ctx),
    ...driverToWatch(ctx),
    ...midSeasonSwaps(ctx),
  ]
  // de-dupe by id, then newest round first, higher priority first
  const seen = new Set<string>()
  const deduped = all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
  deduped.sort((a, b) => (b.round - a.round) || (b.priority - a.priority) || a.id.localeCompare(b.id))
  return deduped.slice(0, 400)
}

// Small helper so the page can label each card by category without importing the list.
export const CATEGORY_LABELS: Record<string, string> = {
  race_report: 'Race report', milestone: 'Milestone', technical_upgrade: 'Technical',
  championship_state: 'Championship', feature: 'Feature', preview_schedule: 'Preview',
  car_launch_livery: 'Launch', rookie_debut: 'Rookie', driver_signing: 'Transfer',
  driver_exit: 'Transfer', career_retirement: 'Retirement', silly_season: 'Silly season',
  analysis_opinion: 'Analysis', driver_to_watch: 'Driver watch',
  team_entry: 'New team', team_exit: 'Team exit', mid_season_swap: 'Driver change',
}

// The complete, ordered filter taxonomy. The page renders one chip per entry (always, so
// the legend is stable), disabling those with no article in the selected season. A chip can
// cover several categories (e.g. both transfer sides share one "Transfer" chip).
export const NEWS_FILTERS: { label: string; categories: string[] }[] = [
  { label: 'Race report', categories: ['race_report'] },
  { label: 'Milestone', categories: ['milestone'] },
  { label: 'Technical', categories: ['technical_upgrade'] },
  { label: 'Championship', categories: ['championship_state'] },
  { label: 'Feature', categories: ['feature'] },
  { label: 'Preview', categories: ['preview_schedule'] },
  { label: 'Launch', categories: ['car_launch_livery'] },
  { label: 'Rookie', categories: ['rookie_debut'] },
  { label: 'Transfer', categories: ['driver_signing', 'driver_exit'] },
  { label: 'Retirement', categories: ['career_retirement'] },
  { label: 'Silly season', categories: ['silly_season'] },
  { label: 'Analysis', categories: ['analysis_opinion'] },
  { label: 'Driver watch', categories: ['driver_to_watch'] },
  { label: 'Grid change', categories: ['team_entry', 'team_exit'] },
  { label: 'Driver change', categories: ['mid_season_swap'] },
]
