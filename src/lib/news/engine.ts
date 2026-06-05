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
import type { RenewalResult, DraftPick, ContractWatch } from '@/lib/sim/driver-market'
import { pick, chance, fill, ordinal, lastName, listJoin, plural, compose, mulberry32, clamp } from './util'
import { raceDate, toISODate, addDays } from '@/lib/sim/calendar-dates'
import milestoneCopy from './milestone-copy.json'
import titleCopy from './titlescenario-copy.json'
import recordsCopy from './records-copy.json'
import sillyCopy from './sillyseason-copy.json'
import marketFeatureCopy from './market-feature-copy.json'
import teamnewsCopy from './teamnews-copy.json'
import { historicalGrids } from '@/data/history/grids'
import { milestoneCrossed } from '@/lib/stats/milestone-defs'

// Records-journalism context: prior all-time single-season records (one mark per metric, from archived
// per-season tallies so they exclude the in-progress season; empty in season one) plus id->name maps so
// the producer can name retired/dropped entities that career rankings include but ctx.drivers can't.
export type RecordMetric = 'wins' | 'poles' | 'podiums' | 'points' | 'dnfs'
export interface SeasonRecordMark { value: number; holderName: string; year: number }
export interface RecordsContext {
  archivedSeasons: number  // completed prior seasons; the all-time lists only mean something once deep
  seasonDriver: Partial<Record<RecordMetric, SeasonRecordMark>>
  seasonTeam: Partial<Record<RecordMetric, SeasonRecordMark>>
  driverNames: Record<string, string>
  teamNames: Record<string, string>
}

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
  records?: RecordsContext  // prior single-season records + entity name maps, for the records producer
  careers?: Record<string, DriverCareer>  // F1 career totals per driver, as of this season. Optional —
                                          // producers that lean on it (retirement, driver-to-watch) degrade
                                          // gracefully when it is absent. starts === 0 (or no entry) means
                                          // the driver has never raced in F1; never infer that from age.
  teamCareers?: Record<string, TeamCareer>  // constructor career totals per team, for team milestones (optional)
  teamDriverTallies?: Record<string, TeamDriverTally[]>  // per-lineage driver tallies (folded live), for {top_driver} (optional)
  // Driver-market beats for the market journalism (all optional — present only on the live context):
  contractWatch?: ContractWatch[]  // round-15 verdicts on expiring contracts (could-do-better/right-place/lucky)
  renewals?: RenewalResult[]       // round-18 in-season contract renewals
  draft?: DraftPick[]              // end-of-season Signing Day picks (ordered, best seat first)
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

// Cross-season constructor career totals for one team, accumulated up to (and including) the
// context's season. The basis for team milestones (first/Nth point, podium, win, pole, Grand Prix).
export interface TeamCareer {
  teamId: string
  races: number    // distinct Grands Prix entered
  seasons: number  // distinct seasons entered (archived base; the live season is added in the slot builder)
  wins: number     // race wins (per car finishing 1st)
  podiums: number  // top-three finishes (per car)
  poles: number    // poles (per car on grid P1)
  points: number   // cumulative constructors points
  bestConstructorsFinish: number | null // best (lowest) constructors' championship position; null = never classified
  constructorTitles: number              // constructors' championships won
}

// One driver's tally FOR a given lineage (not their whole career), so the team-transition newsroom can
// name the lineage's most prolific driver and the span they raced for it. Folded with the live season.
export interface TeamDriverTally {
  driverId: string
  driverName: string
  wins: number
  podiums: number
  points: number
  firstYear: number
  lastYear: number
}

export interface NewsArticle {
  id: string
  category: string
  round: number      // chronological sort key: 0 = pre-season, 1..N = races, N+1 = off-season
  priority: number   // tiebreak within a round (higher = nearer the top)
  headline: string
  dek: string
  body: string
  // Always populated by generateNews (optional only so the per-producer literals stay terse):
  date?: string      // ISO 'YYYY-MM-DD' the story drops on, derived from round + category + calendar
  entities?: { driverIds: string[]; teamIds: string[]; circuitId?: string } // who/what it mentions (for name-follow + linking)
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
  madrid: 'the fast street sweeps of the Madring',
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

// Format a run of recent finishes, grouping repeats: [30,11,30] -> "two retirements and an 11th
// place", [6,7,7] -> "a 6th place and two 7th places". The caller adds the "in the last N races".
// recentFinishesUpTo uses 30 as the DNF sentinel, and a real grid never reaches 30th, so >= 30
// reliably means a retirement.
function formatRecent(recent: number[]): string {
  const order: number[] = []
  const counts = new Map<number, number>()
  for (const p of recent) { if (!counts.has(p)) order.push(p); counts.set(p, (counts.get(p) ?? 0) + 1) }
  const numWord = ['', 'a', 'two', 'three', 'four', 'five']
  const phrases = order.map((p) => {
    const c = counts.get(p) ?? 1
    const noun = p >= 30 ? 'retirement' : `${ordinal(p)} place`
    if (c === 1) return p >= 30 ? 'a retirement' : `${/^(8|11|18)/.test(String(p)) ? 'an' : 'a'} ${noun}`
    return `${numWord[c] ?? c} ${noun}s`
  })
  return listJoin(phrases)
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

// Extend a team-careers map (archived DB totals) with the live/just-finished season from the store,
// so the live newsroom sees complete constructor totals for team milestones. Like foldLiveSeason but
// per team: races counts distinct Grands Prix entered; wins/podiums/poles count per car.
export function foldLiveSeasonTeams(
  base: Record<string, TeamCareer>,
  raceResults: { finishPosition: number | null; gridPosition: number; points: number; teamId: string }[][],
): Record<string, TeamCareer> {
  const out: Record<string, TeamCareer> = {}
  for (const [k, v] of Object.entries(base)) out[k] = { ...v }
  for (const round of raceResults) {
    const entered = new Set<string>()
    for (const res of round) {
      const id = res.teamId
      let c = out[id]
      if (!c) c = out[id] = { teamId: id, races: 0, seasons: 0, wins: 0, podiums: 0, poles: 0, points: 0, bestConstructorsFinish: null, constructorTitles: 0 }
      const fp = res.finishPosition
      c.points += res.points
      if (res.gridPosition === 1) c.poles++
      if (fp != null && fp === 1) c.wins++
      if (fp != null && fp <= 3) c.podiums++
      entered.add(id)
    }
    for (const id of entered) out[id].races++
  }
  return out
}

// Extend per-lineage driver tallies (archived DB totals, grouped by team id) with the live/just-finished
// season, so the live newsroom ranks a lineage's most prolific driver including the current year.
export function foldLiveSeasonTeamDrivers(
  base: Record<string, TeamDriverTally[]>,
  year: number,
  raceResults: { finishPosition: number | null; points: number; teamId: string; driverId: string; driverName: string }[][],
): Record<string, TeamDriverTally[]> {
  const out: Record<string, TeamDriverTally[]> = {}
  for (const [k, v] of Object.entries(base)) out[k] = v.map((t) => ({ ...t }))
  for (const round of raceResults) {
    for (const res of round) {
      const list = out[res.teamId] ?? (out[res.teamId] = [])
      let t = list.find((x) => x.driverId === res.driverId)
      if (!t) { t = { driverId: res.driverId, driverName: res.driverName, wins: 0, podiums: 0, points: 0, firstYear: year, lastYear: year }; list.push(t) }
      t.points += res.points
      if (res.finishPosition === 1) t.wins++
      if (res.finishPosition != null && res.finishPosition <= 3) t.podiums++
      t.firstYear = Math.min(t.firstYear, year)
      t.lastYear = Math.max(t.lastYear, year)
    }
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
    // Invented, unfalsifiable retirement causes (the sim tracks only the DNF flag, not the reason).
    // All genuinely race-ending; assigned deterministically per driver and de-duplicated within a
    // race so the same failure does not appear two or three times in one report.
    const RETIRE_REASONS = ['a power-unit failure', 'a hydraulics leak', 'a gearbox problem', 'brake failure', 'a suspension failure', 'an engine that let go', 'an oil leak', 'terminal floor damage', 'damage from a first-lap clash', 'a high-speed spin into the barriers', 'an electrical failure', 'a wheel-nut problem at a stop']
    const usedReasons = new Set<string>()
    const reasonFor = (driverId: string): string => {
      const seeded = pick(RETIRE_REASONS, `${seed}|why-${driverId}`)
      const chosen = usedReasons.has(seeded)
        ? (RETIRE_REASONS.filter((rr) => !usedReasons.has(rr))[0] ?? seeded)
        : seeded
      usedReasons.add(chosen)
      return chosen
    }
    const dnfReasoned = listJoin(dnfs.map((x) => `${lastName(x.driverName)} with ${reasonFor(x.driverId)}`))
    const dnfSoloLaps = dnfSolo?.lapsCompleted ?? 0
    const poleRunnerUp = results.find((x) => x.gridPosition === 2)
    const slots: Record<string, string | number> = {
      winner: p1.driverName, winner_last: lastName(p1.driverName), team: p1.teamName,
      p2: p2?.driverName ?? '', p2_last: p2 ? lastName(p2.driverName) : '', p3: p3?.driverName ?? '',
      circuit: circuitName, margin, points: p1.points, pole: pole?.driverName ?? '', pole_last: pole ? lastName(pole.driverName) : '',
      pole_runner_up: poleRunnerUp ? lastName(poleRunnerUp.driverName) : '',
      mover: mover?.driverName ?? '', mover_from: ordinal(mover?.gridPosition ?? 0), mover_to: ordinal(mover?.finishPosition ?? 0),
      mover_gain: moverGain, leader: leader?.driverName ?? '', second: afterR[1]?.driverName ?? '',
      lead_gap: leadGap, lead_gap_pts: plural(leadGap, 'point'), leader_points: leader?.points ?? 0, round: r, races_left: racesLeft,
      dnf_list: listJoin(dnfNames), dnf_count: dnfs.length, cars: plural(dnfs.length, 'car'),
      dnf_reasoned: dnfReasoned, dnf_word: dnfs.length === 2 ? 'both' : 'all',
      dnf_solo_reason: dnfSolo ? pick(RETIRE_REASONS, `${seed}|why-${dnfSolo.driverId}`) : '',
      win_ord: ordinal(winnerWins), pole_margin: pMargin ?? '', strategy: strat ?? '', start_tyre: startTyre ?? '',
      next_circuit: nextName ?? '', dnf_solo: dnfSolo?.driverName ?? '', dnf_solo_laps: dnfSoloLaps,
      dnf_solo_phrase: dnfSoloLaps === 0 ? 'before completing a lap' : dnfSoloLaps === 1 ? 'after a single lap' : `after ${dnfSoloLaps} laps`,
      faller: faller ? lastName(faller.driverName) : '', faller_team: faller?.teamName ?? '',
      faller_poss: faller ? poss(lastName(faller.driverName)) : '', winner_poss: poss(lastName(p1.driverName)),
      ...pronouns(ctx.drivers.find((d) => d.id === p1.driverId)?.gender),
    }

    const leadPara = compose(`${seed}:lead`, slots,
      [
        '{winner} won the {circuit}, converting pace into points on a day that belonged to {team}.',
        '{winner} took victory at the {circuit} in a drive that answered every question put to {them}.',
        '{winner} claimed the {circuit} with a controlled performance that the chasing pack could not match.',
        '{winner} added the {circuit} to {their} record, seeing off the pressure from the pack behind.',
        '{winner} delivered at the {circuit}, holding the lead through the phases that decide races.',
        '{winner} was the class of the field at the {circuit}, turning qualifying pace into race-day victory.',
        '{winner} controlled the {circuit} from the front, untroubled once {they} had the lead.',
        'It was {winner_last} who mastered the {circuit}, in command whenever it mattered.',
        '{winner} made the {circuit} look straightforward, the win built on clean and relentless pace.',
        'A commanding drive carried {winner} to victory at the {circuit} for {team}.',
        'There was a composed inevitability to {winner_poss} win at the {circuit}.',
        '{winner} saw off the field at the {circuit}, never letting the race slip from {their} grasp.',
      ],
      hasMargin
        ? [
            '{winner_last} finished {margin} clear of {p2}, with {p3} a further step back in third.',
            'The gap to {p2} at the flag was {margin}, {p3} rounding out the podium behind.',
            '{p2} crossed the line {margin} adrift, {p3} completing the top three.',
            '{winner_last} had {margin} in hand over {p2_last} at the chequered flag, {p3} in third.',
            'By the finish the cushion over {p2} stood at {margin}, with {p3} third.',
          ]
        : [
            '{p2} gave chase throughout but could not find a way through, {p3} taking the final podium spot.',
            '{p2_last} finished second and {p3} third, neither able to match the pace of the {team} car.',
            '{p2} and {p3} completed the podium without ever mounting a serious challenge for the lead.',
          ],
      winnerHome
        ? [
            'For {winner_last} it was a win on home soil, a result that will carry extra weight.',
            'The victory carried the added satisfaction of a home race for {winner_last}.',
            'Winning in front of a home crowd added real significance to a commanding afternoon.',
          ]
        : [''],
      [
        'The {points} points were the maximum on offer, and {winner_last} took every one of them.',
        'It was {points} points banked for {winner_last} and {team}.',
        'The full {points} points capped a near-flawless weekend for {team}.',
        'A maximum {points}-point haul was the reward for the drive.',
        'There was nothing left on the table, {points} points and the win for {winner_last}.',
      ],
    )

    const startPool = fromPole
      ? [
          '{winner_last} made the most of pole, getting away cleanly and building a gap before the first stops.',
          '{winner_last} led from the front after taking pole, controlling the tempo and never inviting a challenge.',
          'Pole was the foundation, and {winner_last} built the race on it lap by lap.',
          'Starting on pole, {winner_last} covered the early laps precisely and put clear air between {them} and the pack.',
          '{winner_last} converted pole the efficient way, never relinquishing the lead and managing the gap as required.',
          'From the front row {winner_last} dictated every phase, using the clean air to extend the lead at will.',
        ]
      : pole
      ? [
          '{pole_last} took pole but found no answer to {winner_last} once the race was underway.',
          '{pole_last} led the early laps only for {winner_last} to find a way ahead as the strategy unfolded.',
          'The front row had {pole_last} on top, yet it was {winner_last} who held the advantage when it mattered.',
          '{pole_last} set the pace in qualifying, but {winner_last} reversed the order when it counted on Sunday.',
          '{pole_last} used the grid advantage early, yet {winner_last} had the measure of the race overall.',
          'Despite {pole_last} starting from pole, {winner_last} found the pace to overturn the deficit during the race.',
        ]
      : [
          '{winner_last} read the race correctly from the off and was in the right place when it opened up.',
          '{winner_last} threaded through the early laps without incident and into the position the race could be won from.',
          'The opening lap sorted the order, and {winner_last} emerged ideally placed to control what followed.',
          '{winner_last} stayed out of trouble at the start and built the drive from there, letting the stops do the rest.',
        ]
    const moverPool = moverGain >= 4 && mover && (mover.finishPosition ?? 99) <= 10
      ? [
          '{mover} produced the drive of the afternoon, charging from {mover_from} into the points in {mover_to}.',
          'The standout recovery came from {mover}, who advanced {mover_gain} places to finish {mover_to}.',
          '{mover} made up {mover_gain} places, climbing from {mover_from} to a points finish in {mover_to}.',
          'Best-mover honours went to {mover}, who climbed from {mover_from} to {mover_to} over the course of the race.',
          'Nobody gained more ground than {mover}, {mover_gain} places from {mover_from} to {mover_to} in a drive that caught the eye.',
        ]
      : ['']
    const qualiPool = pMargin && pole
      ? [
          '{pole_last} had split the field in qualifying, taking pole by {pole_margin}.',
          'Qualifying had gone to {pole_last} by {pole_margin}, a margin that spoke of real single-lap pace.',
          '{pole_last} had grabbed pole by {pole_margin} from {pole_runner_up}.',
        ]
      : ['']
    const stratPool = strat
      ? [
          '{winner_last} executed {strategy}, starting on {start_tyre}, and the timing of the stops proved to be the margin.',
          'The win was built on {strategy}, with {winner_last} making the pit calls the rivals could not replicate.',
          '{team} committed to {strategy} from the outset and {winner_last} drove it to perfection.',
          'Running {strategy} on {start_tyre}, {winner_last} found the rhythm the tyres allowed and never looked back.',
        ]
      : ['']
    const startPara = compose(`${seed}:story`, slots, startPool, qualiPool, moverPool, stratPool)

    const attritionPara = dnfs.length === 0
      ? compose(`${seed}:dnf`, slots, [
          'It was a clean race, every car reaching the flag and no safety car to bunch the order, the result settled on pace and strategy alone.',
          'The field ran to the finish intact, with no retirements and no safety-car period to redistribute the gaps.',
          'Every car that started the {circuit} crossed the line, the positions decided on merit rather than misfortune.',
          'There were no retirements to report, and without a safety-car restart to reshuffle things the order was shaped purely by pace.',
          'A full-field finish meant the points were earned the hard way, without the lottery of a safety car shifting the order late on.',
        ])
      : dnfSolo
      ? compose(`${seed}:dnf`, slots, [
          '{dnf_solo} was the only retirement, out {dnf_solo_phrase} with {dnf_solo_reason}.',
          'The lone retirement was {dnf_solo}, {dnf_solo_reason} ending the day {dnf_solo_phrase}.',
          'Only {dnf_solo} failed to make the flag, {dnf_solo_reason} the cause.',
          '{dnf_solo} did not finish, {dnf_solo_reason} forcing retirement {dnf_solo_phrase}.',
        ])
      : compose(`${seed}:dnf`, slots,
          [
            '{dnf_count} {cars} did not make the finish, thinning the points-paying places as the race wore on.',
            'Attrition accounted for {dnf_count} {cars} before the flag, reshaping the order behind the leaders.',
            'The retirement count reached {dnf_count} {cars}, changing the complexion of the midfield.',
            '{dnf_count} {cars} fell out of contention, the running order shifting with every one of them.',
          ],
          [
            'It was {dnf_reasoned}.',
            'The retirements read {dnf_reasoned}.',
            '{dnf_list} {dnf_word} failed to see the flag.',
            'Out of the running were {dnf_reasoned}.',
          ])

    const texturePool = [
      'The {team} garage erupted as {winner_last} crossed the line, months of work landing in a single moment.',
      '{winner_last} pulled off {their} helmet on the slow-down lap to take in the reception from the grandstands.',
      'The {team} pit wall let the tension of the final laps drain away the instant the flag fell.',
      '{winner_last} drove the in-lap at a measured pace, in no rush to let the afternoon end.',
      '{winner_last} stood on the podium with the look of someone who knew the result had been earned, not gifted.',
      'The {team} mechanics were at the pit-lane wall before the car had stopped, ready for the celebrations.',
      '{winner_last} held the trophy in both hands and looked out into the crowd before the formalities resumed.',
      '{winner_last} was treated for dehydration once the cameras had moved on, the cockpit a brutal place in the closing laps.',
      'Over the team radio it had sounded like one of the harder afternoons of the year for {winner_last}.',
      'A scruffy pit stop briefly set nerves jangling on the {team} wall before the lead was safe again.',
      'A brief safety car midway bunched the pack, but {winner_last} judged the restart to perfection.',
      '{winner_last} kept the visor down through most of the slow-down lap, spent after a hard afternoon.',
      'There were tired but satisfied faces all through the {team} engineering room.',
    ]
    if (faller) texturePool.push(
      'The body language in the {faller_team} garage told the story of a race that slipped away from {faller}.',
      '{faller_poss} walk back to the garage said everything about a day that promised points and delivered none.',
      '{faller} sat quietly for a while before facing anyone.',
    )
    const texturePara = texture(seed, texturePool, slots)
    // Occasional invented winner quote (first-person; generic, so it cannot contradict the result).
    const quotePara = texture(`${seed}|q`, [
      '"The car was there from the start. We just had to execute the plan and not give anything away," said {winner_last}.',
      '"I knew the gap was there if I could hold the pace, and the team gave me the right call at the right time," said {winner_last}.',
      '"There were moments where I had to manage it carefully, but I always felt we had something in reserve," said {winner_last}.',
      '"It is never easy until it is over, so I kept pushing every single lap," said {winner_last}.',
      '"Getting through the first few corners cleanly let me build the gap rather than defend," said {winner_last}.',
      '"These points matter. Every race this season has felt like it counts, and today was no different," said {winner_last}.',
    ], slots, 72)

    const champPool = !leader
      ? ['']
      : clinched
      ? [
          'With the win, {leader} can no longer be caught in the championship.',
          'The result puts the title beyond doubt, {leader} now uncatchable with {lead_gap} {lead_gap_pts} in hand and {races_left} left.',
          '{leader} has effectively wrapped up the championship, {lead_gap} {lead_gap_pts} clear with {races_left} to run.',
          'The arithmetic is settled, {leader} now champion with {lead_gap} {lead_gap_pts} in hand and {races_left} remaining.',
        ]
      : leadChanged
      ? [
          'The result swings the championship, and {leader} now leads.',
          'There is a new name on top of the standings in {leader}, {lead_gap} {lead_gap_pts} clear of {second}.',
          '{leader} takes over at the head of the table, {lead_gap} {lead_gap_pts} ahead of {second}.',
          'The points lead changes hands, {leader} now in front of {second} by {lead_gap} {lead_gap_pts}.',
        ]
      : [
          'In the championship, {leader} stays in front, {lead_gap} {lead_gap_pts} clear of {second}.',
          '{leader} holds the points lead on {leader_points}, {lead_gap} {lead_gap_pts} up on {second}.',
          'Atop the standings, {leader} keeps a {lead_gap}-point cushion over {second}.',
          'No change at the top, {leader} on {leader_points} points with {second} {lead_gap} {lead_gap_pts} adrift.',
        ]
    const champPara = compose(`${seed}:champ`, slots, champPool)

    out.push({
      id: seed, category: 'race_report', round: r, priority: 90,
      headline: fill(pick([
        '{winner} wins the {circuit}', '{winner_last} triumphs at the {circuit}', '{winner_last} holds on for {circuit} victory',
        '{winner_last} dominates from start to finish at the {circuit}', '{team} celebrate as {winner_last} takes {circuit} honours',
        '{winner_last} converts pace into victory at the {circuit}', '{winner_last} sees off {p2_last} to win the {circuit}',
        'Victory for {winner_last} at the {circuit}', '{winner_last} moves clear after the {circuit}', '{winner_last} delivers at the {circuit}',
        '{team} claim the {circuit} through {winner_last}', '{winner} masters the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{winner} took victory at the {circuit}, with {p2} and {p3} completing the podium.',
        ...(hasMargin ? ['{winner} won the {circuit}, finishing {margin} clear of {p2}.'] : []),
        '{winner_last} delivered a controlled drive to win the {circuit} ahead of {p2} and {p3}.',
        '{winner} claimed {their} {win_ord} win of the season at the {circuit}.',
        '{team} top the podium at the {circuit} as {winner_last} holds off {p2_last}.',
        '{winner_last} wins the {circuit} and tightens {their} grip on the season.',
        'A composed afternoon from {winner_last} puts {team} on the top step at the {circuit}.',
      ], `${seed}|d`), slots),
      body: paras(leadPara, startPara, attritionPara, texturePara, champPara, quotePara),
    })
  }
  return out
}

// --- Career milestones (issue #19): counted per CAREER, never per season. The thresholds and the
// crossing logic live in src/lib/stats/milestone-defs.ts (MILESTONE_STEP / milestoneCrossed), shared
// with the World driver page so the two never drift. Team milestones keep their own steps below.

// A driver's career totals as of AFTER round `r` of this season (r = 0 → before the season began).
// ctx.careers holds the total INCLUDING the whole completed season, so we subtract this season back
// out and re-add only rounds 1..r. Counting matches foldLiveSeason exactly (a start per entry incl.
// DNFs, a pole on grid P1, a podium on a top-three finish, a win on P1). Null with no career record.
function careerTotalsThroughRound(ctx: NewsContext, id: string, r: number): { starts: number; points: number; podiums: number; wins: number; poles: number } | null {
  const c = careerOf(ctx, id)
  if (!c) return null
  let sSt = 0, sPt = 0, sPo = 0, sWi = 0, sPl = 0 // whole completed season
  let aSt = 0, aPt = 0, aPo = 0, aWi = 0, aPl = 0 // rounds 1..r only
  for (let k = 1; k <= ctx.completedRounds; k++) {
    const res = (ctx.raceResults[k - 1] ?? []).find((x) => x.driverId === id)
    if (!res) continue
    const fp = res.finishPosition
    const st = 1, pt = res.points
    const po = fp != null && fp <= 3 ? 1 : 0
    const wi = fp === 1 ? 1 : 0
    const pl = res.gridPosition === 1 ? 1 : 0
    sSt += st; sPt += pt; sPo += po; sWi += wi; sPl += pl
    if (k <= r) { aSt += st; aPt += pt; aPo += po; aWi += wi; aPl += pl }
  }
  return {
    starts: c.starts - sSt + aSt, points: c.points - sPt + aPt,
    podiums: c.podiums - sPo + aPo, wins: c.wins - sWi + aWi, poles: c.poles - sPl + aPl,
  }
}

// Team (constructor) milestone steps. A team scores far faster than a driver (two cars), so the
// steps are coarser than the per-driver ones. First ever, then every: 50 Grands Prix, 100 points,
// 25 podiums, 10 wins, 10 poles. (Tweak these numbers to taste — they are the only knob.)
const TEAM_MILESTONE_STEP: Record<'starts' | 'points' | 'podiums' | 'wins' | 'poles', number> = {
  starts: 50, points: 100, podiums: 25, wins: 10, poles: 10,
}
function teamMilestoneCrossed(cat: keyof typeof TEAM_MILESTONE_STEP, before: number, after: number): number | null {
  if (before < 1 && after >= 1) return 1
  const s = TEAM_MILESTONE_STEP[cat]
  if (after >= s && Math.floor(after / s) > Math.floor(before / s)) return Math.floor(after / s) * s
  return null
}

// A team's constructor career totals as of AFTER round `r` of this season (ctx.teamCareers holds the
// total INCLUDING the whole completed season, so strip the season and re-add rounds 1..r). `starts`
// is distinct Grands Prix entered. Null with no team-career record.
function teamTotalsThroughRound(ctx: NewsContext, teamId: string, r: number): { starts: number; points: number; podiums: number; wins: number; poles: number } | null {
  const c = ctx.teamCareers?.[teamId]
  if (!c) return null
  let sSt = 0, sPt = 0, sPo = 0, sWi = 0, sPl = 0
  let aSt = 0, aPt = 0, aPo = 0, aWi = 0, aPl = 0
  for (let k = 1; k <= ctx.completedRounds; k++) {
    const cars = (ctx.raceResults[k - 1] ?? []).filter((x) => x.teamId === teamId)
    if (cars.length === 0) continue
    let pt = 0, po = 0, wi = 0, pl = 0
    for (const res of cars) { const fp = res.finishPosition; pt += res.points; if (fp != null && fp <= 3) po++; if (fp === 1) wi++; if (res.gridPosition === 1) pl++ }
    sSt += 1; sPt += pt; sPo += po; sWi += wi; sPl += pl
    if (k <= r) { aSt += 1; aPt += pt; aPo += po; aWi += wi; aPl += pl }
  }
  return { starts: c.races - sSt + aSt, points: c.points - sPt + aPt, podiums: c.podiums - sPo + aPo, wins: c.wins - sWi + aWi, poles: c.poles - sPl + aPl }
}

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

type MileCat = 'wins' | 'podiums' | 'poles' | 'points' | 'starts'

// Significance ordering across every milestone kind, so the most newsworthy one leads the per-race
// roundup: wins > podiums > poles > points > starts, and within a category a first-ever (value 1)
// outranks any recurring step.
function milestoneSig(cat: MileCat, value: number): number {
  const rank: Record<MileCat, number> = { wins: 5, podiums: 4, poles: 3, points: 2, starts: 1 }
  return rank[cat] * 1_000_000 + (value === 1 ? 500_000 : value)
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
function milestones(ctx: NewsContext): NewsArticle[] {
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
    const intro = fill(pick(evs.length >= 2
      ? [
          'The {circuit} served as the latest proving ground for the development race, with {n} {teams} arriving with significant new components.',
          'Car upgrades were a major subplot at the {circuit}, as {n} {teams} introduced fresh parts in search of a step forward.',
          'Development was high on the agenda at the {circuit}, where {n} {teams} brought new parts hoping to find time over their rivals.',
          'Factory work arrived at the track this weekend, with {n} {teams} running new components for the first time at the {circuit}.',
        ]
      : [
          'Only one team came to the {circuit} carrying new parts, making their update the story of the garage.',
          'The {circuit} was not a heavy upgrade weekend, with just one team rolling out meaningful new components.',
          'Development was quiet at the {circuit}, with a single team breaking from the crowd to introduce fresh parts.',
        ], `${seed}:intro`), slots)
    const goodPara = delivered.length
      ? fill(pick([
          '{delivered} extracted real performance from the new parts, and it showed in the pace through the weekend.',
          'For {delivered}, the new parts delivered, with a clear step up in competitiveness.',
          '{delivered} left the {circuit} with data that confirmed what the simulations had promised.',
          'The new components on the {delivered} car performed as intended and brought a tangible gain in race trim.',
          '{delivered} came away confident the development direction is sound after a positive showing with the new parts.',
        ], `${seed}:good`), slots)
      : ''
    const badPara = missed.length
      ? fill(pick([
          '{missed} found nothing from the new parts across the weekend, a frustrating return on the factory investment.',
          'The upgrades on the {missed} car failed to translate, leaving the engineers with more questions than answers.',
          '{missed} will be disappointed, with the new components producing no step and the weekend exposing the gap.',
          'A difficult verdict for {missed}, whose new parts delivered no meaningful improvement on the timing screens.',
          '{missed} head back to the factory to work out what went wrong after the package failed to fire at the {circuit}.',
        ], `${seed}:bad`), slots)
      : ''
    // The specific (invented, unfalsifiable) component — different part/area/team each round.
    const partPara = fill(pick(repDelivered
      ? [
          '{rep_team} brought the eye-catching change, a revised {part} aimed at {area}, and it delivered.',
          '{rep_team} introduced a new {part} with {area} as the primary objective, and the data backed up the concept.',
          'A redesigned {part} was the centrepiece of {rep_team_poss} package, with the team targeting {area} and finding the gains.',
          'The new {part} on the {rep_team} car was built around gains in {area}, and it delivered on that brief.',
        ]
      : [
          '{rep_team_poss} new {part} did not bring the {area} gains they were targeting, and the weekend numbers made that clear.',
          'The revised {part} on the {rep_team} car was meant to unlock {area}, but that improvement did not materialise.',
          '{rep_team_poss} {part} update promised gains in {area}, yet the track told a different story.',
          'Despite the focus on {area} in the new {part}, {rep_team} found no reward at the {circuit}.',
        ], `${seed}:part`), slots)
    // Grounded close: the representative team's actual constructor position, not platitude.
    const outlook = repPos
      ? fill(pick(delivered.length
          ? [
              '{rep_team} sit {rep_pos} in the constructors\' championship and will want these gains to hold as the calendar moves on.',
              'Sitting {rep_pos} in the standings, {rep_team} have given themselves fresh ammunition for the next phase of the season.',
              '{rep_team} occupy {rep_pos} in the constructors\' championship and now have a confirmed step to build from.',
              '{rep_team} are {rep_pos} in the constructors\' standings, and a working upgrade puts them in a stronger position to push higher.',
            ]
          : [
              '{rep_team} remain {rep_pos} in the constructors\' championship and are still searching for the breakthrough the results need.',
              'Stuck {rep_pos} in the standings, {rep_team} head back to the factory to regroup after a fruitless upgrade weekend.',
              '{rep_team} are {rep_pos} in the constructors\' championship and cannot afford many more weekends where new parts fail to deliver.',
              'The pressure on {rep_team} only grows, {rep_pos} in the constructors\' standings with parts that did not work.',
            ], `${seed}:outlook`), slots)
      : ''
    // Driver mood is just one flavour of many, so keep it rare (a couple of times a season).
    const techTexturePool = !repDriver
      ? []
      : delivered.length
        ? [
            '{up_driver} was upbeat afterwards, noting the car felt more responsive with the new parts.',
            'The {rep_team} garage had a lighter mood, {up_driver} reporting a more planted feel through the high-speed sections.',
            '{up_driver} said the update opened up options that had not been there in recent races.',
            'There was a real lift around {rep_team}, {up_driver} offering positive words on how the car took the changes.',
          ]
        : [
            'The mood inside {rep_team} was subdued, {up_driver} giving measured answers that told their own story.',
            '{up_driver} chose words carefully afterwards, but the {rep_team} body language said enough about a wasted step.',
            'There was little to celebrate for {rep_team}, {up_driver} admitting the parts had not done what was hoped.',
          ]
    const techTexture = texture(seed, techTexturePool, slots, 18)
    out.push({
      id: seed, category: 'technical_upgrade', round: r, priority: 45,
      headline: fill(pick([
        'Upgrade roundup from the {circuit}', '{n} {teams} brought new parts to the {circuit}', 'Development verdicts from the {circuit}',
        'Who won and lost the upgrade battle at the {circuit}', '{rep_team} headline a {circuit} development push',
        'The winners and losers of parts day at the {circuit}', 'Upgrades assessed at the {circuit}', 'Fresh bodywork at the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{n} {teams} arrived at the {circuit} with new parts, and not all of them left happy.',
        'The {circuit} doubled as a development checkpoint, with {n} {teams} running fresh components.',
        'Upgrade season hit the {circuit} hard, and the lap-time data has started to separate the gains from the gambles.',
        'A busy weekend in the garages as {n} {teams} chased performance with new parts at the {circuit}.',
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
    const slots = { driver: champ.driverName, driver_last: lastName(champ.driverName), driver_poss: poss(lastName(champ.driverName)), team: champ.teamName, team_poss: poss(champ.teamName), year: ctx.year, gap, round: r, wins: champ.wins, wins_word: plural(champ.wins, 'win'), races_left: racesLeft, runner_up: s[1] ? lastName(s[1].driverName) : 'the field', ...pronouns(ctx.drivers.find((d) => d.id === champ.driverId)?.gender) }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 100,
      headline: fill(pick(earlyClinch
        ? ['{driver} crowned {year} World Champion with {races_left} still to run', '{driver_last} seals the {year} drivers\' title {races_left} before the end', '{driver} is World Champion as {team} clinch the {year} crown early', '{driver_last} unstoppable as the {year} title is secured early', '{team} and {driver_last} wrap up the {year} drivers\' championship']
        : ['{driver} World Champion after a battle that runs to the final lap', '{driver_last} holds on at the finale to claim the {year} drivers\' title', '{driver} takes the {year} crown at the final race', 'On the final day of {year}, {driver_last} is confirmed World Champion', '{driver} survives a tense finale to be crowned {year} champion'],
        `${seed}|h`), slots),
      dek: fill(pick(earlyClinch
        ? ['{driver} wraps up the {year} drivers\' championship {races_left} from the end, with {wins} {wins_word} and a {gap}-point margin over the field.', 'A {gap}-point lead and {wins} {wins_word} tell the story of a campaign {driver_last} owned start to finish, the title sealed {races_left} early.', '{driver} becomes {year} World Champion with {races_left} left, a {gap}-point lead putting the outcome beyond doubt.']
        : ['{driver} arrives at the final round with it all to play for, and {they} gets the job done, champion by {gap} points over {runner_up}.', 'After a season of relentless pressure, {driver_last} is {year} World Champion, {gap} points clear of {runner_up}.', 'The {year} title is settled on the final day, {driver} champion by {gap} points over {runner_up}, with {wins} {wins_word} to {their} name.'],
        `${seed}|d`), slots),
      body: paras(
        fill(pick([
          '{driver} is the {year} Formula 1 World Drivers Champion, the crowning moment of {driver_poss} career at {team} and confirmation of a season built on speed and consistency.',
          'The {year} world championship belongs to {driver}, whose {wins} {wins_word} and {gap}-point margin leave no argument about who owned the season.',
          'For {team}, this is a defining moment, {driver} delivering the drivers\' title to a squad that built a car worthy of it and trusted {them} to finish the job.',
          '{driver_poss} {year} crown is sealed, the {gap}-point gap to second reflecting a season {they} turned pole positions and race wins into an unanswerable points lead.',
        ], `${seed}|b1`), slots),
        fill(pick(earlyClinch
          ? [
              '{driver_last} produced {wins} {wins_word} across the season to put the title beyond reach, leaving {races_left} as little more than procession.',
              'The arithmetic ran out for {driver_poss} rivals with {races_left} still to run, a {gap}-point cushion too vast to close.',
              'With {races_left} remaining and {gap} points in hand, {driver_last} arrived already champion in all but name.',
              '{wins} {wins_word} gives the full picture of {driver_poss} {year}, not a tight survival but sustained front-running that wore the opposition down.',
            ]
          : [
              'There was no buffer and no margin for error when the final weekend opened, {driver_last} forced to settle it on track against a rival.',
              'The garage barely breathed through the closing laps, every engineer watching the gap until the flag confirmed what {team} had chased all year.',
              '{driver_last} drove those last laps knowing exactly where the rival was, managing tyres, traffic and nerves as the {year} title hung on every sector.',
              'When the maths finally fell {driver_poss} way, {team_poss} pit wall erupted, headsets off, the tension of a whole season released at once.',
            ], `${seed}|b2`), slots),
        texture(`${seed}|tex`, [
          'The team radio was a wall of noise when the title was confirmed, the engineers shouting over each other before {driver_last} managed a single word.',
          'In parc ferme {driver_last} sat still in the cockpit for a long moment, helmet and gloves still on, before climbing the barrier to face the crowd.',
          'Back at the {team} factory a feed ran in every workshop, and when the title was confirmed the building shook with months of late nights let go at once.',
          'The race engineer\'s voice broke mid-message delivering the news, and {driver_last} answered with nothing but a long exhale and a short laugh.',
          '{team_poss} mechanics formed a corridor in the pit lane, each waiting a turn to throw {driver_last} into the air.',
        ], slots, 66),
        texture(`${seed}|q`, [
          '"This team gave me a car I could win with every weekend, and the title is theirs as much as mine," said {driver_last}.',
          '"I have dreamed of this for a long time, and standing here with {wins} {wins_word} it is hard to believe it is real," said {driver_last}.',
          '"Every race we gave everything, and I never looked at the standings until today," said {driver_last}.',
          '"The team built something extraordinary, and I just had to be brave enough to use it," said {driver_last}.',
        ], slots, 78),
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
    const slots = { team: s[0].teamName, team_poss: poss(s[0].teamName), year: ctx.year, gap, round: r, races_left: racesLeft, runner_up: s[1] ? s[1].teamName : 'the field' }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 95,
      headline: fill(pick(earlyClinch
        ? ['{team} clinch the {year} constructors\' title with {races_left} to spare', '{team} seal the {year} constructors\' title {races_left} before the end', '{team} are {year} constructors\' champions with {races_left} still to run', '{team} wrap up the {year} constructors\' championship early', 'The {year} constructors\' crown belongs to {team} after two-car dominance']
        : ['{team} are {year} constructors\' champions after a title that runs to the last', 'Final-round drama hands {team} the {year} constructors\' title over {runner_up}', '{team} hold on to win the {year} constructors\' championship at the last', 'At the last, {team} take the {year} constructors\' crown', '{team} win the {year} constructors\' title on the final afternoon'],
        `${seed}|h`), slots),
      dek: fill(pick(earlyClinch
        ? ['{team} seal the {year} constructors\' championship with {races_left} still remaining, a {gap}-point margin reflecting a season of consistent two-car scoring.', 'With {gap} points between {team} and their nearest pursuer and {races_left} left, the constructors\' crown is confirmed early.', '{team} add the {year} constructors\' title with {races_left} to spare, a {gap}-point cushion no rival could realistically overhaul.']
        : ['{team} survive the final round to claim the {year} constructors\' championship by {gap} points from {runner_up}, a margin that captures a year-long fight.', 'The {year} constructors\' title is settled on the last day, {team} winning it by {gap} points from {runner_up}.', 'It could not have been tighter, {team} edging {runner_up} to the {year} constructors\' crown by {gap} points.'],
        `${seed}|d`), slots),
      body: paras(
        fill(pick([
          '{team} are the {year} Formula 1 Constructors Champions, a title earned through both cars working in concert across the calendar and a {gap}-point gap that defines the season.',
          'The {year} constructors\' crown confirms {team} as the team of the season, the points total built on strategic depth, engineering precision and the whole squad pulling together.',
          '{team_poss} {year} constructors\' championship is the product of a factory effort far beyond the pit lane, from the aero department to the strategists, all feeding a total rivals could not touch.',
          'From the first test to the decisive lap, {team} operated as a unit, two cars covering each other in the standings and maximising every opportunity the calendar offered.',
        ], `${seed}|b1`), slots),
        fill(pick(earlyClinch
          ? [
              '{team} reach the line {races_left} before the season ends, the {gap}-point buffer assembled through a run of results that left the chasers no credible path.',
              'Both {team} cars scored throughout, in combinations that compounded into a {gap}-point lead too large to dismantle with {races_left} still to play.',
              'The {races_left} that remain are now irrelevant to the championship picture, the {gap}-point advantage simply too wide.',
              'When the {gap}-point lead moved beyond the reach of arithmetic, the {team} pit wall allowed itself a moment it had held back for months.',
            ]
          : [
              'There was no margin and no room for failure, {team} racing the final weekend knowing a {gap}-point gap could vanish with one bad afternoon.',
              'The last laps of the season were unlike any other, the {team} strategists running scenarios on screen as the constructors\' title balanced on a knife edge.',
              'When the points were totalled and the {gap}-point gap was confirmed, the relief in the {team} garage was visceral after months of work came down to one race.',
              '{gap} points is the margin that defines {team_poss} {year}, a season that could have gone anywhere finishing their way at the very last.',
            ], `${seed}|b2`), slots),
        texture(`${seed}|tex`, [
          'Inside the {team} factory staff gathered around monitors in the canteen and the engineering bays, the building erupting floor by floor as the news spread.',
          'The pit crew heard the confirmation on the radio and the pit lane became a crush of mechanics, the wall moving as one before the cars had even completed their in-laps.',
          'The team principal walked the length of the {team} garage shaking every hand in reach, stopping longest at the data engineers who had chased the margins all year.',
          'In parc ferme both {team} cars sat side by side without strategy telling them where to be, the engineers clustered between them with the trophy somewhere in the middle.',
        ], slots, 66),
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
      // The win scenario. When the lead is so big the leader clinches even by losing ground
      // (clinchMargin <= 0), a "win the race" line undersells it — finishing ahead of the rival is
      // already enough — so it is dropped and the swing line below carries the real scenario.
      const winText = clinchMargin > 0
        ? (conds.length
            ? fill(pick(['Win the {circuit}, and {leader_last} is champion provided {conds}.', 'Victory at the {circuit} crowns {leader_last}, as long as {conds}.'], `${seed}|win`), slots)
            : fill(pick(['Win the {circuit}, and the title is {leader_last}\'s whatever the others do.', 'A win at the {circuit} settles it outright.'], `${seed}|win`), slots))
        : ''
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
      const diffNeeded = rem * CONSTRUCTOR_MAX_PER_RACE - CG // net swing the lead team needs this race
      // A team's maximum from one race is a 1-2 (43); behind a rival's 1-2 the chaser can do no
      // better than 3rd and 4th (27), so a 1-2 nets at least 16 on the rival. That is the test for
      // whether locking out the top two guarantees the title regardless of the rival's result.
      const oneTwo = F1[0] + F1[1]
      const oneTwoGuarantees = (oneTwo - (F1[2] + F1[3])) > diffNeeded
      const rivalCapIfOneTwo = Math.max(0, oneTwo - (diffNeeded + 1)) // rival's combined cap for a 1-2 to clinch
      const seed = `wcc-scenario-${ctx.year}-${r}`
      const slots: Record<string, string | number> = {
        lead_team: cs[0].teamName, rival_team: cs[1].teamName, cg: CG, circuit: circuit(ctx, r), next_circuit: circuit(ctx, r + 1), year: ctx.year,
        rem, races_left: racesLeft, net_needed: diffNeeded + 1, surv_margin: -diffNeeded, rival_cap: rivalCapIfOneTwo,
      }
      // The points swing the lead team needs (or, when the lead is huge, what would keep it open).
      const W = titleCopy.wccDecider
      const marginText = fill(pick(diffNeeded >= 0 ? W.marginPos : W.marginNeg, `${seed}|m`), slots)
      const scenarioText = fill(pick(oneTwoGuarantees ? W.scenarioGuaranteed : W.scenarioCap, `${seed}|sc`), slots)
      const closeText = fill(pick(W.close, `${seed}|cl`), slots)
      out.push({
        id: seed, category: 'championship_state', round: r, priority: 84,
        headline: fill(pick(W.headline, `${seed}|h`), slots),
        dek: fill(pick(W.dek, `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots, W.p1a, W.p1b),
          marginText,
          scenarioText,
          closeText,
        ),
      })
    }
  }

  // --- Finale deciders: the last round, with a title still alive going in. Only as a live preview
  // of the upcoming finale (not retrospectively), so it never contradicts the post-race clinch piece.
  const fr = N
  if (fr >= 2 && !ctx.endOfSeason && fr === ctx.completedRounds + 1) {
    // Drivers: leader can clinch unless the nearest rival outscores them by more than the gap.
    const ds = driverStandingsAfter(ctx, fr - 1)
    if (ds.length >= 2) {
      const G = ds[0].points - ds[1].points
      if (G >= 0 && G <= 25) { // alive: one race can still change hands at the top
        const seed = `finale-drv-${ctx.year}`
        const slots: Record<string, string | number> = {
          leader: ds[0].driverName, leader_last: lastName(ds[0].driverName), s: ds[1].driverName, s_last: lastName(ds[1].driverName),
          circuit: circuit(ctx, fr), year: ctx.year, gap: G, gap_pts: plural(G, 'point'), need: G + 1, need_pts: plural(G + 1, 'point'),
          ...pronouns(ctx.drivers.find((d) => d.id === ds[0].driverId)?.gender),
        }
        const D = titleCopy.finaleDrv
        const body = G === 0
          ? paras(fill(pick(D.p1Zero, `${seed}|p1`), slots), fill(pick(D.mZero, `${seed}|m`), slots))
          : paras(
              fill(pick(D.p1Lead, `${seed}|p1`), slots),
              fill(pick(D.mLead, `${seed}|m`), slots),
              fill(pick(D.win, `${seed}|w`), slots),
              fill(pick(D.riv, `${seed}|riv`), slots),
            )
        out.push({
          id: seed, category: 'championship_state', round: fr, priority: 92,
          headline: fill(pick(D.headline, `${seed}|h`), slots),
          dek: fill(pick(D.dek, `${seed}|d`), slots),
          body,
        })
      }
    }
    // Constructors: a 1-2 always extends the lead, so it settles it whatever the rival does.
    const csF = constructorStandingsAfter(ctx, fr - 1)
    if (csF.length >= 2) {
      const CG = csF[0].points - csF[1].points
      if (CG >= 0 && CG <= CONSTRUCTOR_MAX_PER_RACE) {
        const seed = `finale-wcc-${ctx.year}`
        const slots: Record<string, string | number> = {
          lead_team: csF[0].teamName, rival_team: csF[1].teamName, circuit: circuit(ctx, fr), year: ctx.year,
          cg: CG, cg_pts: plural(CG, 'point'), need: CG + 1, need_pts: plural(CG + 1, 'point'),
        }
        const W = titleCopy.finaleWcc
        const body = CG === 0
          ? paras(fill(pick(W.p1Zero, `${seed}|p1`), slots), fill(pick(W.mZero, `${seed}|m`), slots))
          : paras(
              fill(pick(W.p1Lead, `${seed}|p1`), slots),
              fill(pick(W.mLead, `${seed}|m`), slots),
              fill(pick(W.win, `${seed}|w`), slots),
            )
        out.push({
          id: seed, category: 'championship_state', round: fr, priority: 89,
          headline: fill(pick(W.headline, `${seed}|h`), slots),
          dek: fill(pick(W.dek, `${seed}|d`), slots),
          body,
        })
      }
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
    const hhPhrase = h2hL === h2hS ? `level at ${h2hL}-${h2hS}` : `${Math.max(h2hL, h2hS)}-${Math.min(h2hL, h2hS)} in ${poss(h2hL > h2hS ? lastName(s[0].driverName) : lastName(s[1].driverName))} favour`
    // Wins are framed by whoever actually has MORE of them — the points leader need not lead on wins.
    const winsTied = s[0].wins === s[1].wins
    const noWins = s[0].wins === 0 && s[1].wins === 0 // both winless: drop the wins line entirely
    const winsLeaderName = s[0].wins >= s[1].wins ? s[0].driverName : s[1].driverName
    const slots = {
      leader: s[0].driverName, second: s[1].driverName, leader_last: lastName(s[0].driverName), second_last: lastName(s[1].driverName),
      leader_poss: poss(lastName(s[0].driverName)), second_poss: poss(lastName(s[1].driverName)),
      gap, gap_pts: plural(gap, 'point'), remaining, races_left: racesLeft, round: r, max_pts: remaining * DRIVER_MAX_PER_RACE,
      w_leader_last: lastName(winsLeaderName), w_leader_poss: poss(lastName(winsLeaderName)), w_hi: Math.max(s[0].wins, s[1].wins), w_lo: Math.min(s[0].wins, s[1].wins),
      hh_phrase: hhPhrase, mom_last: momLast, mom_other: momOther, mom_hi: Math.max(pl, ps), mom_lo: Math.min(pl, ps),
    }
    const battleTexture = [
      texture(`${seed}|ql`, ['"We just take it race by race," said {leader_last}.', '"Nothing is won yet," {leader_last} said.'], slots, 62),
      texture(`${seed}|qs`, ['"I have nothing to lose from here," said {second_last}.', '"All the pressure is on them," {second_last} said.'], slots, 62),
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
          ['Only {gap} {gap_pts} separate {leader} and {second} with {races_left} remaining.', 'The gap from {leader_last} to {second_last} stands at {gap} {gap_pts} with {races_left} left to run.', '{gap} {gap_pts} is all that divides {leader_last} and {second_last}.']),
        compose(`${seed}:form`, slots,
          noWins
            ? ['']
            : winsTied
              ? ['Both drivers share {w_hi} wins apiece on the season.', 'The pair are level in the win column, {w_hi} each.', 'Wins are split evenly at {w_hi} apiece.']
              : ['On wins, {w_leader_last} leads {w_hi} to {w_lo} this season.', 'The wins tally favours {w_leader_last}, {w_hi} to {w_lo}.', 'Race wins sit {w_hi} to {w_lo} in {w_leader_poss} favour.'],
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
        year: ctx.year, leader: ds[0].driverName, leader_last: lastName(ds[0].driverName), leader_poss: poss(lastName(ds[0].driverName)), second: ds[1].driverName,
        gap, gap_pts: plural(gap, 'point'), top_team: cs[0].teamName, third: ds[2]?.driverName ?? ds[1].driverName, round: r,
        ...pronouns(ctx.drivers.find((d) => d.id === ds[0].driverId)?.gender),
      }
      out.push({
        id: seed, category: 'feature', round: r, priority: 82,
        headline: fill(pick([
          '{leader_last} holds the upper hand at half-distance',
          '{leader_last} leads {second} by {gap} {gap_pts} with the hard miles still to come',
          'Halfway through {year}, {leader_last} is on top but far from clear',
          'Why {leader_poss} lead over {second} is comfortable but not conclusive',
          '{leader_last} leads and {top_team} rule as {year} reaches its midpoint',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{leader} carries a {gap}-point advantage into the second half of {year}, but the development race and the circuits ahead mean nothing is decided.',
          'At round {round}, {leader_last} has converted pace into points more consistently than anyone, yet {second} and {third} stay close enough to make the next stretch defining.',
          '{top_team} sit atop the constructors table and {leader} heads the drivers standings, but the midseason upgrade cycle could scramble both pictures.',
        ], `${seed}|d`), slots),
        body: paras(
          fill(pick([
            '{leader} arrives at the midpoint having turned {their} car\'s strengths into points with a ruthlessness that has opened a {gap}-point gap over {second}.',
            'The {gap}-point margin between {leader} and {second} at round {round} is meaningful but not decisive, one retirement for the leader and one win for the challenger enough to reshuffle the maths overnight.',
            '{leader_poss} consistency has been {their} sharpest weapon, and where {second} has seen points dented by small errors and mechanical trouble, {leader_last} has banked them whenever the car was capable.',
            '{second} has not been slow, the {gap}-point gap reflecting the fine margins at the front of the field more than any collapse in form.',
            'At the midpoint of {year}, the championship reads as a {leader_last} advantage rather than a {leader_last} runaway, and the distinction matters for everything that follows.',
          ], `${seed}|b1`), slots),
          fill(pick([
            '{top_team} lead the constructors on the strength of both cars scoring heavily, a depth single-car operations cannot match when reliability is even.',
            'Behind {leader} and {second}, {third} has emerged as the most credible threat to the established order, pairing raw pace with the point-gathering focus that makes an outside challenger dangerous.',
            'The constructors battle is not just about the quickest car on a Saturday, but about which team can field two consistent, trouble-free entries across very different circuits.',
            '{third} has shown the gap to the leading pair is not fixed, and any weekend {leader} or {second} drops points opens a window.',
            '{top_team} hold the constructors advantage for now, but the teams behind are narrowing the gap on upgrades.',
          ], `${seed}|b2`), slots),
          fill(pick([
            'Development pace from here decides the title as much as driver craft, the team that extracts the most from upgrades carrying momentum into the run-in.',
            'Reliability will matter as much as raw speed, a {gap}-point buffer capable of vanishing in two rounds of mechanical bad luck.',
            'The circuits to come will test aerodynamic versatility, tyre management over long stints, and the ability to change set-up direction quickly.',
            'Consistency under pressure is the real test of the second half, the driver who loses least when conditions are difficult usually the one lifting the trophy.',
            '{leader_poss} rivals will study {their} weaker circuits, knowing a gap of {gap} {gap_pts} is surmountable while the maths still allow it.',
          ], `${seed}|b3`), slots),
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
        year: ctx.year, champ: ds[0].driverName, champ_last: lastName(ds[0].driverName), champ_poss: poss(lastName(ds[0].driverName)),
        champ_team: ds[0].teamName,
        runner: ds[1]?.driverName ?? ds[0].driverName, top_team: cs[0].teamName, wins: ds[0].wins, wins_word: plural(ds[0].wins, 'win'),
        ...pronouns(ctx.drivers.find((d) => d.id === ds[0].driverId)?.gender),
      }
      out.push({
        id: seed, category: 'feature', round: N, priority: 88,
        headline: fill(pick([
          '{champ_last} delivers in {year} with {wins} {wins_word} and the title',
          'How {champ_last} turned car pace into a {year} title',
          '{champ_last} takes the drivers crown as {top_team} win the constructors in {year}',
          '{wins} {wins_word} and a world title, {champ_poss} {year} reviewed',
          'The {year} championship belongs to {champ_last}, with {top_team} taking the constructors',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{champ} finishes {year} as world champion with {wins} {wins_word} for {champ_team}, while {top_team} took the constructors title.',
          '{runner} pushed hardest and came closest, but {champ_poss} knack for harvesting points even when victory was off the table proved the decisive gap.',
          '{top_team} dominate the constructors in {year} on the back of two cars scoring all season long.',
        ], `${seed}|d`), slots),
        body: paras(
          fill(pick([
            '{champ} finishes {year} as world champion for {champ_team} on the back of {wins} {wins_word}, a tally that understates how completely {they} controlled the title.',
            '{runner} was the closest challenger and gave the championship its best stretches, yet when the pressure asked {champ_last} to respond, {they} did, at exactly the moments that mattered.',
            'The {wins} {wins_word} {champ} took were not one purple patch, coming at different circuits and in different conditions, the mark of a complete championship effort.',
            'What separated {champ} from {runner} was the accumulation of points in the finishes that fell short of victory, second and third banked when the win was not on, building the cushion that decided it.',
            '{runner} can look back on a season where the pace was rarely in question, the final margin flattering neither the closeness of the fight nor the effort behind it.',
          ], `${seed}|b1`), slots),
          fill(pick([
            '{top_team} leave {year} as constructors champions, earned through the dual consistency of two cars scoring in every condition the season served up.',
            'The constructors crown reflects an organisational quality easy to understate, {top_team} arriving each weekend having understood the last and adjusted accordingly.',
            'Both championships were effectively settled early, the leads at the front proving too large for the chasers to overturn.',
            'Where the teams chasing {top_team} found speed on their best circuits, they could not match the breadth of scoring that made the champions so hard to catch.',
            '{year} had its twists, but its defining arc was one of control, {top_team} in the constructors and {champ_last} in the drivers.',
          ], `${seed}|b2`), slots),
          fill(pick([
            '{champ_last} enters the off-season as the benchmark every rival builds their winter around, a position that brings expectation as much as prestige.',
            'For {runner} and that team, the winter begins knowing the gap to {champ_last} is not structural, the pace there on the right circuits and the job now to widen that list.',
            '{top_team} carry the specific burden of the defending champion, every strength catalogued and every weakness filed by rivals over the months ahead.',
            'The reset begins now, new tyres and revised development paths, and a grid that has spent a year learning exactly how far it must close on {champ_last}.',
          ], `${seed}|b3`), slots),
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
  else if (gain >= 6 && mover && (mover.finishPosition ?? 99) <= 10) pool = ['{mover} was the standout last time, charging from {mover_from} to {mover_to} and into the points, and will want more of the same.', 'Few impressed like {mover} at the {prev_circuit}, up from {mover_from} to a points finish in {mover_to}.']
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
    // A debutant is a driver with NO prior F1 starts (in historical mode, only in their real debut
    // season). No age guessing: Button at 21 with 24 starts is not a rookie.
    const isDebutant = (d: Driver) =>
      d.debutYear != null ? d.debutYear === ctx.year : (careerTotalsThroughRound(ctx, d.id, r - 1)?.starts ?? 0) === 0
    const seatedCount = ctx.drivers.filter((d) => d.teamId !== '').length
    const rookieNames = ctx.drivers.filter((d) => d.teamId !== '' && isDebutant(d)).map((d) => d.name)
    // A fresh-world mass debut (e.g. a generated season one, where the whole grid has no prior starts)
    // is not individually newsworthy — suppress the note rather than list the entire field.
    const massDebutOpener = rookieNames.length > seatedCount / 2
    const rookieNote = !isOpener || massDebutOpener ? ''
      : rookieNames.length === 0 ? ''
      : rookieNames.length === 1 ? `${rookieNames[0]} makes a Grand Prix debut.`
      : `${listJoin(rookieNames)} all start their first Grand Prix.`

    const wccGap = cbefore[0] && cbefore[1] ? cbefore[0].points - cbefore[1].points : 0
    const leadGap = leader ? leader.points - (second?.points ?? 0) : 0
    // Occasional qualitative descriptor for the gap, by how it compares to the points still on
    // offer. Gated so it is not slapped on every preview; a bare number is often plenty.
    const availLeft = remaining * DRIVER_MAX_PER_RACE
    const ratio = leadGap > 0 && availLeft > 0 ? leadGap / availLeft : 0
    // "slender/narrow/wafer-thin" is reserved for a genuinely small absolute gap (a couple of
    // results), not just a small ratio early in a long season where 10+ points is still real.
    const band = ratio >= 0.6 ? ['a commanding ', 'an almost insurmountable ', 'an imposing ']
      : ratio >= 0.28 ? ['a healthy ', 'a comfortable ', 'a substantial ']
      : leadGap > 0 && leadGap <= 6 ? ['a slender ', 'a narrow ', 'a wafer-thin ']
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
      ...pronouns(ctx.drivers.find((d) => d.id === leader?.driverId)?.gender),
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
            ['Reliability over a full race distance is the first real question.', 'The opening laps will give the first honest read on the order.', 'Whether winter pace translates to race day is the question everyone wants answered.']),
          texture(seed, ['The paddock buzzed with first-race nerves.', 'There was a charged, expectant mood up and down the grid.', 'The garages had the taut quiet of a grid that had run out of time to prepare.'], slots),
        )
      : paras(
          compose(`${seed}:intro`, slots,
            ['Round {round} takes the championship to the {circuit}.', 'The grid heads to the {circuit} for round {round}.', 'The {circuit} is next, round {round} of the season.'],
            ['{leader} leads on {leader_points} points, {gap_desc}{lead_gap} {gap_pts} clear of {second}.', '{leader} arrives {gap_desc}{lead_gap} {gap_pts} ahead of {second}.', 'It is {leader} who tops the table, {gap_desc}{lead_gap} {gap_pts} up on {second}.']),
          talkingPoint,
          compose(`${seed}:stake`, slots,
            leadGap === 0
              ? ['{second_last} is level on points with {leader_last} at the top.']
              : remaining <= 5
              ? ['With just {remaining} {rounds_word} left, time is short for {second_last}.', '{second_last} is running out of road, {remaining} {rounds_word} remaining.']
              : ['{second_last} sits {lead_gap} {gap_pts} behind {leader_last} and will fancy a response.', 'The job for {second_last} is to chip into a {lead_gap}-point deficit to {leader_last}.', '{second_last} has ground to make up on {leader_last}.'],
            (leader?.wins ?? 0) > 0 ? ['{leader_last} carries {leader_wins} {wins_word} into the weekend.', '{leader_last} has {leader_wins} {wins_word} to {their} name so far.'] : ['']),
          compose(`${seed}:wcc`, slots,
            cbefore[1]
              ? ['In the constructors, {top_team} lead {wcc_second} by {wcc_gap} {wcc_pts}.', '{top_team} head the teams standings, {wcc_gap} {wcc_pts} clear of {wcc_second}.']
              : ['{top_team} head the constructors\' championship.']),
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
// Like pick(), but avoids repeating a variant already used in the same set (e.g. across the teams in
// one launch article), falling back to the full pool only once every option has been spent.
function pickUnique(pool: string[], seed: string, used: Set<string>): string {
  const avail = pool.filter((s) => !used.has(s))
  const chosen = pick(avail.length ? avail : pool, seed)
  used.add(chosen)
  return chosen
}

// Car-launch prose pools (Sonnet-authored). `line` introduces a team + its drivers; `refPos` adds a
// last-season reference using {art} {last_pos}; `refNew` covers a team with no prior finish on record
// (the first season, or a genuine new entrant — never call them "new"). Pools are deliberately large
// so the no-repeat picker can give every car in a tier a distinct line and reference.
const LAUNCH_COPY: {
  line: string[]; refPos: string[]; refNew: string[]
  tiers: Record<'front-running' | 'midfield' | 'backmarker', { prio: number; headline: string[]; dek: string[]; intro: string[]; close: string[] }>
} = {
  line: [
    'Over at {team}, {squad} will carry the hopes of a factory that spent the winter rethinking its aerodynamic philosophy from the floor up.',
    '{squad} are tasked with extracting the maximum from a {team} package that engineers describe as the most cohesive they have produced in years.',
    'For {team}, the wraps come off a machine that the drawing office has been quietly confident about since the first CFD runs landed in late autumn.',
    'At {team}, {squad} debut a car that bears almost no visual resemblance to the chassis they ended last season with.',
    'The {team} launch reveals a sharply reworked sidepod concept, and it is {squad} who will find out whether the theory translates on track.',
    '{squad} stepped into the simulator for the first time last month and the feedback, by all accounts, was encouraging for everyone at {team}.',
    'Shaped by a winter of wind-tunnel hours and a factory culture that reportedly refused to carry a single compromise into {year}, {team_poss} new car makes its case on aesthetics alone.',
    'Built around a revised suspension geometry that the {team} technical staff have been pushing for two seasons, the {year} car hands {squad} a notably different tool.',
    '{team} pull the covers back on a car that the design team insists solves the rear-stability issues that cost points on the high-speed circuits last year.',
    'Every aero surface on {team_poss} {year} contender is new, and {squad} have already logged hours in the simulator working to understand it.',
    'From the nose cone to the diffuser, {team} have gone again, and {squad} arrive at the launch with a reputation to build on.',
    'A leaner rear packaging concept anchors {team_poss} {year} challenger, with {squad} set to discover whether the trade-offs are worth it when the lights go out in testing.',
    'What {team} reveal today is a car that the engineers say reflects a conscious decision to chase peak downforce rather than a broad operating window.',
    '{squad} join {team} in a year the team has framed internally as a reset, with a new car that carries none of last season\'s architectural compromises.',
    'The factory mood at {team} has been quietly confident all winter, and the machine {squad} are set to race suggests there is substance behind that confidence.',
    'Compact, low, and visually striking, {team_poss} launch car makes a statement before {squad} have turned a wheel in anger.',
  ],
  refPos: [
    '{art} {last_pos}-place finish last season set the target every line of this car was drawn against.',
    'The design brief was clear: improve on {art} {last_pos}-place constructors result that left the factory hungry for more.',
    'Closing the chapter on {art} {last_pos}-place campaign, this car represents the team\'s answer to the questions that season raised.',
    'Engineers were handed {art} {last_pos}-place finish as their starting point and asked to find time everywhere.',
    'That {art} {last_pos}-place result was the honest baseline; what the team has built since is an attempt to move substantially beyond it.',
    '{art} {last_pos}-place constructors result gave the development programme a specific and uncomfortable benchmark to beat.',
    'The lessons of {art} {last_pos}-place season are baked into every revised package on show today.',
    'Measuring the ambition of this launch against {art} {last_pos}-place finish last year, the direction of travel is unmistakable.',
    'Last year\'s {last_pos}-place constructors standing sent the drawing office back to first principles over the winter.',
    'From {art} {last_pos}-place championship position, the team\'s stated aim is to move the needle decisively in {year}.',
    'The {last_pos}-place finish that closed out last season is the number the whole factory has been trying to make obsolete.',
    'With {art} {last_pos}-place result as the honest yardstick, the {year} car has been engineered to address every shortcoming that produced it.',
  ],
  refNew: [
    'With no constructors result on the board to measure against, this launch is the only public yardstick on the car.',
    'There is no prior championship finish to anchor expectations, so the car itself must do the talking.',
    'No constructors data exists to set a baseline, which means every lap in testing will be the first hard evidence anyone has.',
    'Without a finishing position in the standings to reference, the technical detail on display today is the sole benchmark available.',
    'The record books hold no constructors result for this squad, so the {year} car enters service as an unknown quantity by definition.',
    'There is simply no prior championship finish on the ledger, and that makes today\'s reveal the first real measure of intent.',
    'No previous constructors campaign provides a frame of reference here; the car and its timing data will have to speak for themselves.',
    'Because no constructors result exists to judge against, the engineering choices visible in this launch carry unusual scrutiny.',
    'The absence of any constructors finish to compare with means the {year} car sets its own starting line from day one of testing.',
    'Without a constructors result to anchor the narrative, the team\'s ambitions must be read from what the drawing office has actually built.',
    'No championship position has been recorded for this team, leaving today\'s unveiling as the only concrete evidence of where they stand.',
    'There is no finishing-position history to draw on, so the technical specification revealed today is the single reference point the paddock has.',
  ],
  tiers: {
    'front-running': {
      prio: 34,
      headline: [
        'The fastest cars of {year} break cover',
        'Front-runners unveiled as {year} pre-season begins',
        'Title contenders show their hand for {year}',
        '{year} championship hopefuls pull back the wraps',
        'Win contenders launch as {year} takes shape',
        'The cars built to lead the grid in {year} arrive',
      ],
      dek: [
        '{n} {teams_word} with genuine podium ambitions have launched their {year} contenders, led by {lead}.',
        '{lead} heads a group of {n} {teams_word} whose cars were built with one purpose, reaching the top step.',
        'From {lead} to the back of this elite pack, {n} {teams_word} believe they have the tools to challenge for wins in {year}.',
        'The {n} {teams_word} at the sharp end of the {year} grid are in the open, with {lead} setting the early benchmark.',
        '{n} {teams_word}, {lead} among them, have laid out cars they expect to see at the front in {year}.',
      ],
      intro: [
        'The cars that will contest race victories in {year} are no longer a secret. {n} {teams_word} with credible championship ambitions have unveiled their contenders, and the engineering statements on show are striking.',
        'Pre-season proper is underway as {n} front-running {teams_word} bring their {year} machines into the open. {lead} arrives with the loudest statement, but the rest of the group have not come to make up the numbers.',
        '{lead} and {n} other {teams_word} with genuine title intentions have launched their {year} cars within days of one another, compressing the field\'s design philosophies into a single revealing week.',
        'The {year} campaign takes shape as {n} {teams_word} at the front of the expected order pull the covers off. Every one of them has been built to win, and the technical differences between them are already a talking point.',
        'Scrutiny falls on {n} {teams_word} as the fastest expected cars of {year} make their public debut. {lead} may lead the conversation, but the entire group has arrived with something to say.',
      ],
      close: [
        'How the gaps between this group actually emerge will only be known once the timing screens light up in testing.',
        'The launches confirm intent; only laps will confirm whether the engineering has delivered on the winter\'s promises.',
        'Whatever the simulations suggested over the winter, the {year} season will settle the order in real time.',
        'Every team in this group believes it can win; which of them is right is a question only the {year} championship can answer.',
        'The pace claims will be tested soon enough, and no launch rendering has ever won a points haul.',
      ],
    },
    midfield: {
      prio: 33,
      headline: [
        'The midfield pack reveals its {year} weapons',
        'Points hunters launch as {year} shapes up',
        'Midfield contenders break cover ahead of {year}',
        '{year} brings fresh cars and reshuffled hopes for the midfield',
        'The dense midfield pack shows its hand for {year}',
        'Upgrade season starts at launch as midfield teams unveil for {year}',
      ],
      dek: [
        '{n} {teams_word} scrapping for points positions have launched their {year} cars, with {lead} setting the tone.',
        'The midfield is rarely decided at the launch, but {n} {teams_word}, {lead} among them, have given the first clues.',
        '{lead} leads {n} midfield {teams_word} into the open, each convinced its winter work has found time in the middle of the pack.',
        '{n} {teams_word} built to compete for every point on offer in {year} have now shown what they are bringing to the fight.',
        'From {lead} to the back of the group, {n} midfield {teams_word} have launched cars that could easily swap positions by the season\'s end.',
      ],
      intro: [
        'The most unpredictable part of the grid is in the open. {n} midfield {teams_word} have launched their {year} machines, knowing the gaps between them will shift almost every fortnight.',
        'History says the midfield order in {year} will look nothing like it does today, but that has not stopped {n} {teams_word} from making confident engineering statements at launch.',
        '{lead} and a clutch of rivals have pulled back the covers on what each of them believes is a step forward. Whether those steps are big enough to move the needle in {year} is the question every points-chasing team is sitting with.',
        'The midfield grid for {year} is taking shape, with {n} {teams_word} now in the open. The margins between them at launch are slim enough that a single aero swing could separate the leaders from the laggards by summer.',
        '{n} {teams_word} in the points-hunting tier have launched their {year} cars, each aware that a good upgrade cycle can lift them and a missed development step can drop them just as fast.',
      ],
      close: [
        'In the midfield, the launch order is irrelevant; what matters is who has found the most performance when the real season begins.',
        'The {year} midfield story will be written over upgrade cycles, not at the launch pad.',
        'Every team here launches with a case to make; whether the data backs it up will emerge round by round.',
        'The launches confirm the winter\'s direction; the races will confirm whether any of these teams found enough of it.',
        'Whatever advantage exists between them today will likely be gone, reversed, and rebuilt before the {year} title is decided.',
      ],
    },
    backmarker: {
      prio: 32,
      headline: [
        'The back of the grid shows its {year} ambitions',
        'Ground-up effort on display as backmarker teams launch for {year}',
        'The teams with most to prove launch their {year} cars',
        '{year} starts here for the teams chasing the field',
        'Ambitious launches as the back of the grid builds toward {year}',
        'Hard yards ahead as the backmarker teams reveal their {year} machines',
      ],
      dek: [
        '{n} {teams_word} facing the toughest challenge on the {year} grid have launched their cars, with {lead} carrying the highest expectations of the group.',
        'The {year} grid is complete at its back end as {n} {teams_word} launch cars built to close the gap to the pack ahead.',
        '{lead} heads a group of {n} {teams_word} who launched with honest appraisals of the distance they need to travel in {year}.',
        '{n} {teams_word} at the back of the expected order have launched for {year}, all of them framing the season as a step in a longer journey.',
        'The cars launched by {n} {teams_word} start from the most difficult position on the {year} grid, but each carries a specific engineering argument for closing the gap.',
      ],
      intro: [
        'Not every car in {year} will fight for points from round one, but the teams at the back of the grid have not come without a plan. {n} {teams_word} have now launched, each with a development arc that extends well beyond the opening race.',
        'The {year} grid is filled in at its rear end as {n} {teams_word} bring their machines into public view. The challenge ahead of each of them is documented and significant, but the launches reveal teams that are working methodically toward the pack.',
        '{lead} and the other teams starting the {year} season from the back of the expected order have now committed their designs to the scrutiny of the paddock. The cars reveal how each of them has chosen to prioritise their limited resources.',
        'The most honest engineering statements in any pre-season often come from the back of the grid. {n} {teams_word} have launched their {year} cars with clear-eyed acknowledgement of the gap to close, alongside specific technical arguments for how they intend to close it.',
        'For the {n} {teams_word} at the rear of the {year} order, the launch is the start of a longer process. The cars on show today will look different by mid-season, and that is entirely by design.',
      ],
      close: [
        'The distance to the midfield is real, but every team here has launched with a development roadmap that does not stop at round one.',
        'Progress in this part of the grid is measured in tenths chipped away over a full season, and the teams here know it.',
        'How much ground these teams can recover in {year} will depend on development pace as much as the car they launch with.',
        'The gap to the pack ahead has been the winter\'s primary brief; whether the answers found are sufficient will take a full season to measure.',
        'Launches here are declarations of direction more than declarations of pace, and the direction from each of these teams is forward.',
      ],
    },
  },
}

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
        'A pre-season pace lead is a head start, not a guarantee, and {fav2} are close enough to make {fav} pay for any slip.',
      ], `${seed}|b3`), sp),
    ),
  })
  // Launch coverage grouped into three pieces by the paddock's pace tier — front-runners, midfield,
  // backmarkers. Each lists every car in its tier (fastest first); a no-repeat picker hands each team
  // a distinct line and reference from the large LAUNCH_COPY pools so a group never reads templated.
  {
    const lyear = ctx.year
    const tierKey = (t: Team) => tierWord(paceRank(ctx, t.id), ctx.teams.length)
    for (const tier of ['front-running', 'midfield', 'backmarker'] as const) {
      const group = [...ctx.teams].filter((t) => tierKey(t) === tier).sort((a, b) => b.carPace - a.carPace)
      if (group.length === 0) continue
      const lseed = `launch-${lyear}-${tier}`
      const lslots = { year: lyear, lead: group[0]?.name ?? '', n: group.length, teams_word: plural(group.length, 'team') }
      const C = LAUNCH_COPY.tiers[tier]
      const usedLine = new Set<string>()
      const usedRef = new Set<string>()
      const teamLine = (t: Team): string => {
        const squad = ctx.drivers.filter((d) => d.teamId === t.id).map((d) => d.name)
        const lastPos = lastSeasonPos(ctx, t.id)
        const ts = {
          team: t.name, team_poss: poss(t.name), squad: listJoin(squad) || 'an unchanged line-up',
          last_pos: lastPos ? ordinal(lastPos) : '', art: lastPos && /^(8|11|18)/.test(String(lastPos)) ? 'an' : 'a', year: lyear,
        }
        const tseed = `launch-${lyear}|${t.id}`
        const line = fill(pickUnique(LAUNCH_COPY.line, `${tseed}|line`, usedLine), ts)
        const ref = fill(pickUnique(lastPos ? LAUNCH_COPY.refPos : LAUNCH_COPY.refNew, `${tseed}|ref`, usedRef), ts)
        return `${line} ${ref}`
      }
      out.push({
        id: lseed, category: 'car_launch_livery', round: 0, priority: C.prio,
        headline: fill(pick(C.headline, `${lseed}|h`), lslots),
        dek: fill(pick(C.dek, `${lseed}|d`), lslots),
        body: paras(
          fill(pick(C.intro, `${lseed}|intro`), lslots),
          ...group.map(teamLine),
          fill(pick(C.close, `${lseed}|close`), lslots),
        ),
      })
    }
  }
  // Rookie spotlights (up to two a season) must not read verbatim like one another. Track the
  // variants used per pool so the second article always draws from the ones the first did not.
  const usedRk: Record<string, Set<string>> = {}
  const pickRk = (pool: string[], seed: string): string => {
    const key = seed.slice(seed.lastIndexOf('|'))
    const used = usedRk[key] ?? (usedRk[key] = new Set<string>())
    const avail = pool.filter((s) => !used.has(s))
    const chosen = pick(avail.length ? avail : pool, seed)
    used.add(chosen)
    return chosen
  }
  // Genuine debutants only: no prior F1 starts AND (historical mode) actually entering this season, so
  // a pre-existing driver seated at a mid-history start year is never spotlighted as a rookie.
  const youngest = ctx.drivers
    .filter((d) => d.teamId !== '' && (careerOf(ctx, d.id)?.starts ?? 0) === 0 && (d.debutYear == null ? d.age <= 22 : d.debutYear === ctx.year))
    .sort((a, b) => a.age - b.age)
    .slice(0, 2)
  for (const d of youngest) {
    const rseed = `rookie-${ctx.year}-${d.id}`
    const rslots = { driver: d.name, driver_last: lastName(d.name), age: d.age, year: ctx.year, team: teamName(ctx, d.teamId), team_poss: poss(teamName(ctx, d.teamId)), driver_poss: poss(lastName(d.name)), ...pronouns(d.gender) }
    out.push({
      id: rseed, category: 'rookie_debut', round: 0, priority: 25,
      headline: fill(pickRk([
        'Young gun {driver_last} steps up for {team} in {year}',
        '{driver_last} at {age}, the rookie {team} are betting on',
        'Can {driver_last} deliver for {team} in {their} debut season',
        '{age}-year-old {driver_last} targets a fast {team} baptism',
        '{driver_poss} moment is here, and {year} will be the proof',
        '{driver_last} arrives in F1 at just {age}',
      ], `${rseed}|h`), rslots),
      dek: fill(pickRk([
        'At just {age}, {driver} joins {team} as one of the youngest drivers on the grid, carrying the weight of a junior career\'s worth of expectations into the harshest spotlight in motorsport.',
        '{driver} is {age} and already on Formula 1\'s starting grid, tasked with matching {team_poss} investment in {them} before the first chequered flag of {year}.',
        'The step from junior formulae to a full {team} race seat is the largest of {driver_poss} career, and {year} is where the world finds out whether {theyre} ready for it.',
        'Formula 1 in {year} hands {driver} a seat at {team}, a scrutinising global audience, and no margin for a gentle learning curve.',
      ], `${rseed}|d`), rslots),
      body: paras(
        fill(pickRk([
          'The jump from junior categories to a full Formula 1 season compresses years of technical learning into a winter\'s worth of preparation, and {driver_last} has had to process that acceleration faster than almost any rival on the {year} grid.',
          'Where the feeder series let {them} find rhythm over a weekend, the freight-train schedule of practice, qualifying and race demands that {driver_last} reads a circuit and extracts the maximum before a single radio call ends.',
          'Media commitments alone scale up sharply at {team}, with press obligations, sponsor appearances and simulator debriefs eating into the hours factory engineers want spent reviewing data.',
          'The moment {driver_last} steps under the garage lights in parc fermé, {they} trades the relative shelter of a junior programme for a broadcast audience that dissects every tenth of a second.',
          '{driver_poss} first Formula 1 winter has meant learning {team_poss} tyre philosophy, aero concept and steering-wheel architecture all at once, a cognitive load that rookies routinely call unlike anything below.',
          'Now racing for {team}, {driver_last} must acclimatise to being scrutinised not just by engineers but by a paddock that will form its verdict on {them} within the opening three weekends.',
        ], `${rseed}|b1`), rslots),
        fill(pickRk([
          'Qualifying is the earliest and starkest test, one flying lap with no second invitation, the format that strips away context and prints a raw number beside {driver_poss} name.',
          '{team_poss} car demands a driver who can manage front-left degradation across a thirty-lap stint, a discipline learned in corners {driver_last} has never driven on compounds {they} has never raced.',
          '{their_cap} teammate stands as the most immediate and inescapable benchmark, sharing the same machinery and the same strategist\'s call-sheet, leaving the data nowhere to hide.',
          'Street circuits arrive without the buffer of long free-practice familiarity, replacing it with a wall on the exit of every barrier-lined chicane and a single shot at the lap.',
          'Racecraft in traffic is where Formula 1 separates the graduate from the arrival, the braking-reference shift, the understeer in dirty air, the half-second window to commit to a move or abort it, all coming faster than in any category below.',
          'Tyre warm-up on a cool out-lap, safety-car restarts and the call to pit or stay out are decisions {driver_last} rehearsed in the simulator but now executes under the full points cost of getting them wrong.',
        ], `${rseed}|b2`), rslots),
        fill(pickRk([
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
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), driver_poss: poss(lastName(m.driverName)), team: m.toTeamName, team_poss: poss(m.toTeamName), next: eos.seasonYear + 1, ...pronouns(ctx.drivers.find((d) => d.id === m.driverId)?.gender) }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 40,
        headline: fill(pick(['{team} hand {driver} a seat for {next}', '{team} hand {driver} a Formula 1 debut', '{driver} lands a maiden F1 drive with {team}', '{team} back youth as {driver} earns a {next} call-up'], `${seed}|h`), slots),
        dek: fill(pick(['{team} have handed {driver} {their} first Formula 1 race seat ahead of {next}.', '{driver} will make {their} Formula 1 debut with {team} after the squad backed {them} for a full-time {next} drive.', '{team} have placed their faith in {driver}, confirming {them} as a race driver for {next}.'], `${seed}|d`), slots),
        body: paras(
          fill(pick([
            '{team} have confirmed {driver} as a race driver for {next}, ending months of speculation over the seat.',
            '{driver} has been handed {their} first Formula 1 race seat by {team}, the appointment confirmed ahead of {next}.',
            '{team} have promoted {driver} to a full race seat for {next}, bringing {them} onto the grid for the first time.',
            'The {next} season will see {driver} make {their} Formula 1 debut, with {team} announcing the signing.',
          ], `${seed}|b1`), slots),
          fill(pick([
            'The step into Formula 1 demands rapid adaptation to faster machinery, heavier tyre degradation and the unceasing pressure of a full race calendar.',
            '{team} will expect {driver} to absorb the demands of a championship season while learning circuits that carry no prior Formula 1 experience.',
            'Moving up from the junior categories brings a new level of aerodynamic complexity, pit-stop strategy and media obligation.',
            '{driver_poss} ability to process information at speed and deliver consistent lap times across a stint will be the measure of {their} opening season.',
          ], `${seed}|b2`), slots),
          texture(`${seed}|q`, [
            '"Getting this seat means everything to me, and I am ready for the challenge ahead," said {driver_last}.',
            '"I know the work this demands, and I will not take a single lap for granted," said {driver_last}.',
            '"This is the opportunity I have worked towards since karting, and I mean to make the most of it," said {driver_last}.',
          ], slots, 72),
        ),
      })
      continue
    }
    if (m.isResignation) {
      const seed = `resign-${m.driverId}-${eos.seasonYear}`
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), driver_poss: poss(lastName(m.driverName)), team: m.toTeamName, team_poss: poss(m.toTeamName), next: eos.seasonYear + 1, until: m.contractExpiresAfterSeason, ...pronouns(ctx.drivers.find((d) => d.id === m.driverId)?.gender) }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 60,
        headline: fill(pick(['{driver} stays at {team} through {until}', '{team} lock in {driver} until {until}', '{driver} commits {their} future to {team}', '{team} secure {driver_poss} signature through {until}', '{driver} re-signs with {team} ahead of {next}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} has extended {their} stay at {team}, signing a new contract that runs through {until}.', '{team} have tied {driver} to a fresh deal through {until}, removing the uncertainty around {their} future.', '{driver} will remain at {team} through {until} after the two sides agreed a new deal.'], `${seed}|d`), slots),
        body: paras(
          fill(pick([
            '{driver} has re-signed with {team}, extending a partnership that will now run through {until}.',
            '{team} have confirmed {driver} will stay under a new contract that extends through {until}.',
            'The {team} line-up is settled into the future after {driver} signed a deal covering {next} and beyond, through {until}.',
            '{driver} and {team} have agreed a contract extension that keeps {them} at the squad through {until}.',
          ], `${seed}|b1`), slots),
          fill(pick([
            'A stable pairing lets {team} pour their engineering resources into car development rather than bedding in a new driver.',
            'Continuity gives {team} a platform to carry hard-won setup knowledge straight from one season into the next.',
            'For {driver}, staying put means {they} can keep building on the working relationships and car understanding already in place.',
            'The renewal takes {driver} out of the market and lets {team_poss} programme run on an unbroken line into {next}.',
          ], `${seed}|b2`), slots),
          texture(`${seed}|q`, [
            '"I feel at home here, and I believe we have unfinished business together," said {driver_last}.',
            '"The trust the team has shown me lets me focus entirely on performance," said {driver_last}.',
            '"We have built something real, and I want to see where we can take it," said {driver_last}.',
          ], slots, 72),
        ),
      })
    } else {
      const seed = `move-${m.driverId}-${eos.seasonYear}`
      const next = eos.seasonYear + 1
      const term = m.contractLength === 1
        ? `a one-year deal for ${next}`
        : `a ${m.contractLength}-year deal through ${m.contractExpiresAfterSeason}`
      const from = m.fromTeamId ? teamName(ctx, m.fromTeamId) : ''
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), driver_poss: poss(lastName(m.driverName)), team: m.toTeamName, team_poss: poss(m.toTeamName), next, until: m.contractExpiresAfterSeason, term, from, ...pronouns(ctx.drivers.find((d) => d.id === m.driverId)?.gender) }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 75,
        headline: fill(pick(['{driver} joins {team} on {term}', '{team} land {driver} in an off-season move', '{driver} makes the switch to {team} for {next}', '{team} snap up {driver} ahead of {next}', '{driver} set for a fresh start at {team}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} will race for {team} from {next} after the two sides agreed {term}.', '{team} have signed {driver} on {term} in one of the biggest moves of the off-season.', '{driver} is moving to {team}, the switch confirmed on {term}.'], `${seed}|d`), slots),
        body: paras(
          fill(pick([
            '{driver} has agreed {term} with {team}, one of the headline moves ahead of {next}.',
            '{team} have secured {driver_poss} signature on {term}, bringing real experience into the fold for {next}.',
            'The arrival of {driver} at {team} on {term} reshapes the grid picture heading into {next}.',
            '{driver} joins {team} on {term}, a move that gives {them} a new platform to work from.',
          ], `${seed}|b1`), slots),
          from
            ? fill(pick([
                '{driver_poss} exit closes {their} time at {from}, leaving behind a vacancy the team must now fill before the season begins.',
                'The move ends a significant chapter for {driver_last} at {from}, and the seat {they} vacate is among the most discussed on the grid.',
                '{from} must now go to market for a replacement after {driver_poss} departure.',
              ], `${seed}|b2`), slots)
            : fill(pick([
                'The deal marks a return to full-time Formula 1 for {driver_last} after a period away from the grid.',
                '{driver_last} re-joins the grid through {team}, bringing experience forged during time outside a race seat.',
                'The signing gives {driver_last} a route back to race weekends, {team} judging the hunger makes {them} the right fit.',
              ], `${seed}|b2`), slots),
          texture(`${seed}|q`, [
            '"The moment I understood what {team} were building, I knew I wanted to be part of it," said {driver_last}.',
            '"There is real potential here, and this is exactly the challenge I was looking for," said {driver_last}.',
            '"I leave with respect for everyone at my old team, but this opportunity was too compelling to pass up," said {driver_last}.',
            'The {team} principal called it "a signing that speaks to our ambition."',
          ], slots, 72),
        ),
      })
    }
  }
  for (const d of eos.droppedDrivers ?? []) {
    const seed = `drop-${d.driverId}-${eos.seasonYear}`
    const slots = { driver: d.driverName, driver_last: lastName(d.driverName), driver_poss: poss(lastName(d.driverName)), team: d.fromTeamName, team_poss: poss(d.fromTeamName), team_art: /^[aeiou]/i.test(d.fromTeamName) ? 'an' : 'a', next: eos.seasonYear + 1, ...pronouns(ctx.drivers.find((x) => x.id === d.driverId)?.gender) }
    out.push({
      id: seed, category: 'driver_exit', round: r, priority: 55,
      headline: fill(pick(['{team} drop {driver} ahead of {next}', '{driver} loses {their} {team} seat for {next}', '{team} move on from {driver} for {next}', '{driver} out as {team} overhaul the {next} line-up', '{driver} confirmed out at {team} for {next}'], `${seed}|h`), slots),
      dek: fill(pick(['{team} will not retain {driver} for {next}, leaving {them} without a race seat.', '{driver_poss} time at {team} is over, the team confirming {they} will not feature in the {next} line-up.', '{driver} faces an uncertain future after {team} confirmed {their} departure ahead of {next}.'], `${seed}|d`), slots),
      body: paras(
        fill(pick([
          '{team} have told {driver} {they} will not be part of the squad for {next}, ending {their} tenure at the team.',
          '{driver} has lost {their} race seat at {team} for {next}, the team confirming the split in a brief statement.',
          'The {next} grid will not include {driver} in {team_art} {team} car after the team confirmed the decision to part ways.',
          '{driver_poss} seat at {team} has gone for {next}, making {them} one of the most prominent free agents on the market.',
        ], `${seed}|b1`), slots),
        fill(pick([
          'Formula 1 runs without sentiment, and the call shows how fast the ground can shift for a driver whatever the past contribution.',
          '{driver_last} now enters a market where the race seats available are far fewer than the drivers chasing one.',
          'The timing leaves {driver} a narrowing window to find an alternative before teams close out their {next} rosters.',
          'Whether a way back opens depends on circumstances largely outside {driver_poss} control, though {their} record will still draw interest.',
        ], `${seed}|b2`), slots),
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
    if (TEAMNEWS[`arrival-${add.teamId}-${eos.seasonYear + 1}`]) continue // bespoke arrival handled by teamTransitions()
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
    if (TEAMNEWS[`departure-${rem.teamId}-${eos.seasonYear}`]) continue // bespoke departure handled by teamTransitions()
    const seed = `exit-${rem.teamId}-${eos.seasonYear}`
    const slots = { team: rem.teamName, team_poss: poss(rem.teamName), year: eos.seasonYear, next: eos.seasonYear + 1, final_pos: rem.finalPosition ? ordinal(rem.finalPosition) : '' }
    const posLine = rem.finalPosition
      ? fill(pick([' They bow out {final_pos} in the constructors\' championship.', ' A final campaign ends {final_pos} among the constructors.'], `${seed}|pos`), slots)
      : ''
    out.push({
      id: seed, category: 'team_exit', round: r, priority: 68,
      headline: fill(pick(['{team} to leave Formula 1 after {year}', '{team} confirm grid exit', 'End of the road for {team}', '{team} bow out of Formula 1'], `${seed}|h`), slots),
      dek: fill(pick(['{team} will depart the grid at the end of {year}.', 'The {year} season is {team_poss} last in Formula 1.', '{team} call time on their Formula 1 entry.'], `${seed}|d`), slots),
      body: paras(
        fill(pick(['{team} will leave the Formula 1 grid after the {year} season.', 'It is the end of {team_poss} time in Formula 1, the team set to depart after {year}.'], `${seed}|p1`), slots) + posLine,
        fill(pick(['The decision draws a line under the team\'s spell in the sport, and their drivers return to the market as free agents.', 'With the seats now vacated, the team\'s drivers re-enter the driver market.'], `${seed}|p2`), slots),
        fill(pick(['A team spokesperson thanked "everyone who made the journey possible."', 'Formula 1 wished the team "the very best for the future."'], `${seed}|q`), slots),
      ),
    })
  }
  return out
}

// ---- Team transition newsroom (rebrand / arrival / departure) ----------------------------------
// Bespoke, historically-grounded copy for known lineage transitions (keyed by lineage id + the year
// the change takes effect, in teamnews-copy.json), blending the real-world why with the game-world
// record. Generic team_entry/team_exit copy in market() covers god-mode/fictional changes that have
// no bespoke key. Fires in the prior season's off-season (round = calendar.length + 1).
const TEAMNEWS = teamnewsCopy as Record<string, { h: string[]; d: string[]; b: string[][] }>

// The lineage's distinct names in chronological order, as prose ("as Lotus and then Caterham").
function lineageNameEra(teamId: string, throughYear: number): string {
  const names: string[] = []
  for (const g of historicalGrids) {
    if (g.year > throughYear) continue
    const t = g.teams.find((x) => x.id === teamId)
    if (t && names[names.length - 1] !== t.name) names.push(t.name)
  }
  if (names.length === 0) return ''
  if (names.length === 1) return `as ${names[0]}`
  return `as ${names.slice(0, -1).join(', ')} and then ${names[names.length - 1]}`
}

// Facts for a transitioning lineage: its game-world record (folded live for wins/podiums/points; the
// just-finished season is added to seasons/best-finish/titles only on the live path, where the
// archived base stops at year-1), plus the era's standout + most recent drivers and the seatless count.
// teamId '' (the grid-grows piece) just returns the shared slots.
function teamTransitionSlots(ctx: NewsContext, eos: EndOfSeasonSummary, teamId: string, extra: Record<string, string | number>): Record<string, string | number> {
  const year = eos.seasonYear
  const next = year + 1
  const gridCount = ctx.teams.length - (eos.gridRemovals?.length ?? 0) + (eos.gridAdditions?.length ?? 0)
  const w = (n: number, s: string, p: string) => (n === 1 ? s : p)

  const tc = ctx.teamCareers?.[teamId]
  const wins = tc?.wins ?? 0, podiums = tc?.podiums ?? 0, poles = tc?.poles ?? 0, points = tc?.points ?? 0
  const cstand = constructorStandingsAfter(ctx, ctx.calendar.length)
  const liveIdx = cstand.findIndex((c) => c.teamId === teamId)
  const liveFinal = liveIdx >= 0 ? liveIdx + 1 : Infinity
  const adj = ctx.live ? 1 : 0 // the just-finished season isn't yet in the archived seasons/best/titles base
  const seasons = (tc?.seasons ?? 0) + adj
  const bestNum = ctx.live ? Math.min(tc?.bestConstructorsFinish ?? Infinity, liveFinal) : (tc?.bestConstructorsFinish ?? Infinity)
  const titles = (tc?.constructorTitles ?? 0) + (ctx.live && eos.constructorChampion === teamId ? 1 : 0)
  const bestFinish = isFinite(bestNum) ? ordinal(bestNum) : 'the midfield'

  // Most-recent drivers from the just-finished season (for {last_driver} + the seatless count).
  const teamDrivers = driverStandingsAfter(ctx, ctx.completedRounds).filter((s) => s.teamId === teamId)
  const last = teamDrivers[0]
  // The lineage's MOST PROLIFIC driver across its whole history (folded live): by wins, then points.
  const top = [...(ctx.teamDriverTallies?.[teamId] ?? [])].sort((a, b) => b.wins - a.wins || b.points - a.points)[0]
  const feat = top && top.wins > 0 ? `won ${top.wins} ${w(top.wins, 'race', 'races')} for the team`
    : top && top.podiums > 0 ? `took ${top.podiums} ${w(top.podiums, 'podium', 'podiums')} in its colours`
    : top && top.points > 0 ? `scored ${top.points} ${w(top.points, 'point', 'points')} in its colours`
    : 'made the most of difficult machinery'
  const topName = top ? lastName(top.driverName) : (last ? lastName(last.driverName) : 'the team')
  const lastDriverName = last ? lastName(last.driverName) : (top ? lastName(top.driverName) : 'a departing driver')
  // Pronouns of the quoted driver (rebrand quote uses the standout; departure uses the most recent).
  const quotedId = extra.kind === 'departure' ? last?.driverId : top?.driverId
  const pr = pronouns(ctx.drivers.find((d) => d.id === quotedId)?.gender)
  const seatlessCount = teamDrivers.length

  const rec = {
    seasons, prior_seasons: seasons, stint_seasons: seasons,
    seasons_word: w(seasons, 'season', 'seasons'), prior_seasons_word: w(seasons, 'season', 'seasons'), stint_seasons_word: w(seasons, 'season', 'seasons'),
    wins, prior_wins: wins, wins_word: w(wins, 'win', 'wins'), prior_wins_word: w(wins, 'win', 'wins'),
    podiums, prior_podiums: podiums, podiums_word: w(podiums, 'podium', 'podiums'), prior_podiums_word: w(podiums, 'podium', 'podiums'),
    poles, prior_poles: poles,
    points, prior_points: points, points_word: w(points, 'point', 'points'), prior_points_word: w(points, 'point', 'points'),
    best_finish: bestFinish, prior_best_finish: bestFinish,
    titles, prior_titles: titles,
    name_era: lineageNameEra(teamId, year),
    top_driver: topName,
    top_driver_feat: feat,
    last_driver: lastDriverName,
    seatless: w(seatlessCount, 'driver', 'drivers'), seatless_count: seatlessCount,
    final_drivers: listJoin(teamDrivers.map((d) => lastName(d.driverName))),
    ...pr,
  }
  return { next, year, entry_year: next, grid_count: gridCount, ...rec, ...extra }
}

function renderTeamArticle(key: string, category: string, r: number, priority: number, copy: { h: string[]; d: string[]; b: string[][] }, slots: Record<string, string | number>): NewsArticle {
  return {
    id: key, category, round: r, priority,
    headline: fill(pick(copy.h, `${key}|h`), slots),
    dek: fill(pick(copy.d, `${key}|d`), slots),
    body: paras(...copy.b.map((pool, i) => fill(pick(pool, `${key}|b${i}`), slots))),
  }
}

function teamTransitions(ctx: NewsContext): NewsArticle[] {
  const eos = ctx.endOfSeason
  if (!eos) return []
  const out: NewsArticle[] = []
  const r = ctx.calendar.length + 1
  const next = eos.seasonYear + 1

  for (const rb of eos.gridRebrands ?? []) {
    const key = `rebrand-${rb.teamId}-${next}`
    const slots = teamTransitionSlots(ctx, eos, rb.teamId, { kind: 'rebrand', team: rb.toName, team_old: rb.fromName, team_new: rb.toName })
    const copy = TEAMNEWS[key]
    if (copy) { out.push(renderTeamArticle(key, 'team_rebrand', r, 72, copy, slots)); continue }
    out.push({
      id: key, category: 'team_rebrand', round: r, priority: 72,
      headline: fill(pick(['{team_old} to race as {team_new} from {next}', '{team_old} rebrands as {team_new}'], `${key}|h`), slots),
      dek: fill('{team_old} will compete under a new name, {team_new}, from {next}.', slots),
      body: paras(
        fill('{team_old} will race as {team_new} from {next}, the latest chapter for an established entry on the grid.', slots),
        fill('The operation, its base and its people carry over under the new identity.', slots),
      ),
    })
  }

  const ggKey = `grid-grows-${next}`
  if ((eos.gridAdditions?.length ?? 0) >= 3 && TEAMNEWS[ggKey]) {
    out.push(renderTeamArticle(ggKey, 'team_entry', r, 74, TEAMNEWS[ggKey], teamTransitionSlots(ctx, eos, '', { kind: 'grid' })))
  }
  for (const add of eos.gridAdditions ?? []) {
    const key = `arrival-${add.teamId}-${next}`
    const copy = TEAMNEWS[key]
    if (!copy) continue // generic team_entry handled in market()
    out.push(renderTeamArticle(key, 'team_entry', r, 70, copy, teamTransitionSlots(ctx, eos, add.teamId, { kind: 'arrival', team: add.teamName })))
  }
  for (const rem of eos.gridRemovals ?? []) {
    const key = `departure-${rem.teamId}-${eos.seasonYear}`
    const copy = TEAMNEWS[key]
    if (!copy) continue // generic team_exit handled in market()
    out.push(renderTeamArticle(key, 'team_exit', r, 68, copy, teamTransitionSlots(ctx, eos, rem.teamId, { kind: 'departure', team: rem.teamName })))
  }
  return out
}

// TRIGGER (live only): three windows — mid-season, three-quarter distance, and the
// penultimate round. The rumours are real: we run the actual driver-market sim on the
// season-to-date with a seeded -10..+10 error applied to each driver's media rating, then
// report the non-trivial moves it spits out as paddock speculation.
function sillySeason(ctx: NewsContext): NewsArticle[] {
  // The rumour windows are all mid-season (rounds N/2, 3N/4, N-1), so they belong in the season's
  // permanent record. Don't gate on endOfSeason — otherwise the whole season's silly-season feed is
  // erased the instant the final race resolves and the newsroom regenerates with endOfSeason set.
  if (!ctx.live || ctx.completedRounds < 2 || ctx.teams.length === 0) return []
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

    // One consolidated silly-season roundup per window, a paragraph per rumour, ordered by how
    // newsworthy the move is — rather than a separate article per move (which buried a round under
    // half a dozen near-identical pieces).
    const dstand = driverStandingsAfter(ctx, r)
    const ordered = [...moves].sort((a, b) => b.mediaScore - a.mediaScore)
    const seed = `silly-${ctx.year}-${r}`
    const moveParas = ordered.map((m) => {
      const fromName = teamName(ctx, m.fromTeamId as string)
      const dpts = dstand.find((s) => s.driverId === m.driverId)?.points ?? 0
      const dRank = dstand.findIndex((s) => s.driverId === m.driverId)
      // Only brag about a points haul when it is actually notable (upper half of the grid).
      const notablePoints = dpts > 0 && dRank >= 0 && dRank < dstand.length / 2
      const toIdx = cstand.findIndex((c) => c.teamId === m.toTeamId)
      const toPos = toIdx >= 0 ? ordinal(toIdx + 1) : ''
      const fromIdx = cstand.findIndex((c) => c.teamId === m.fromTeamId)
      const fromPos = fromIdx >= 0 ? ordinal(fromIdx + 1) : ''
      // Frame the move by its real direction in the constructors order (lower index = better).
      const direction = fromIdx >= 0 && toIdx >= 0 ? (toIdx < fromIdx ? 'up' : toIdx > fromIdx ? 'down' : 'level') : 'unknown'
      const mseed = `${seed}-${m.driverId}`
      const drv = ctx.drivers.find((d) => d.id === m.driverId)
      const veteran = (drv?.age ?? 25) >= 30
      const outOfContract = !!drv && drv.contractExpiresAfterSeason <= ctx.year
      // Ambiguous, unfalsifiable "qualities" that fit "value {driver}'s {appeal}" — age-aware so we
      // never claim something the data could contradict. No leading article.
      const qualities = veteran
        ? ['experience and know-how', 'racecraft and composure', 'steadying influence in the garage', 'big-race temperament', 'sheer mileage', 'marketability', 'professionalism', 'all-round package', 'standing in the paddock', 'reliability between the walls']
        : ['youth and upside', 'raw potential', 'sky-high ceiling', 'fearlessness', 'long-term promise', 'marketability', 'professionalism', 'all-round package', 'standing in the paddock', 'fresh edge']
      const appeal = pick(qualities, `${mseed}|appeal`)
      const wins = winsUpTo(ctx, m.driverId, r)
      const status = wins > 0 ? 'a proven race winner' : (dRank >= 0 && dRank < 4 ? 'an upper-echelon talent' : 'a known quantity')
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), to: m.toTeamName, to_poss: poss(m.toTeamName), from: fromName, window, round: r, driver_points: dpts, to_pos: toPos, from_pos: fromPos, appeal, status }
      // One grounded paragraph per rumour: the link, its real direction, the points (if notable),
      // the appeal/status, and the contract situation.
      const para = compose(`${mseed}:line`, slots,
        sillyCopy.link,
        direction === 'up' ? sillyCopy.dirUp : direction === 'down' ? sillyCopy.dirDown : direction === 'level' ? sillyCopy.dirLevel : [''],
        notablePoints ? sillyCopy.points : [''],
        sillyCopy.appealStatus,
        outOfContract ? sillyCopy.contractUp : sillyCopy.contractTied)
      // A media-pen quote per rumour, fired often (the newsroom wants more voices, not fewer).
      const q = texture(`${mseed}|pen`, sillyCopy.pen, slots, 45)
      return q ? `${para} ${q}` : para
    })
    const top = ordered[0]
    const rslots = { window, round: r, n: ordered.length, moves_word: plural(ordered.length, 'move'), top: top.driverName, top_last: lastName(top.driverName) }
    out.push({
      id: seed, category: 'silly_season', round: r, priority: 30,
      headline: fill(pick(sillyCopy.headline, `${seed}|h`), rslots),
      dek: fill(pick(sillyCopy.dek, `${seed}|d`), rslots),
      body: paras(
        fill(pick(sillyCopy.intro, `${seed}|intro`), rslots),
        ...moveParas,
        fill(pick(sillyCopy.close, `${seed}|close`), rslots),
      ),
    })
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
              [
                '{ahead} leads {behind} {ap} to {bp}, a {gap}-point gap that has opened up inside the same garage.',
                'A {gap}-point margin separates {ahead} from {behind} at {team}, the widest the intra-team gulf has been this season.',
                '{ahead} and {behind} share a pit wall and an engineering group, yet the scoreboard shows {ahead} on {ap} against {behind_last}\'s {bp}.',
              ],
              [
                'A gap of that magnitude between teammates is not noise; it reflects a consistent edge in race execution and qualifying trim.',
                'In a points system where a single position swing is worth four points, a {gap}-point chasm represents multiple race weekends of compounded advantage.',
                'The {gap} points do not merely represent races lost; they represent constructor points that {team} are only half-claiming from their budget.',
              ]),
            trendPara,
            compose(`${id}:p2`, slots,
              [
                '{behind_last} needs to interrupt the current pattern before the mathematics become truly daunting.',
                'For {behind_last}, the most damaging consequence is not the points gap itself but the internal leverage it hands to {ahead_last} when engineering resources are allocated.',
                'A trailing teammate rarely faces pressure from outside the car alone; the data that lands on the engineer\'s desk every Sunday evening tells its own story at {team}.',
              ],
              [
                'Every race weekend {behind_last} fails to close the gap, the burden of expectation compounds.',
                'At {team} the number has now grown large enough that neutrals have stopped calling it a phase and started calling it a hierarchy.',
                'The question for {behind_last} is whether the gap gets addressed through performance or rationalised through excuses, and the paddock is watching for which answer emerges.',
              ]),
            compose(`${id}:p3`, slots,
              [
                'From {ahead_last}\'s perspective the pattern is straightforward: translate car pace into points more efficiently than {behind_last}, round after round.',
                '{ahead_last} has demonstrated the capacity to extract from this car what is available; the issue is that {behind_last} has not matched that benchmark.',
                'The internal pecking order at {team} is hardening into something that will be difficult for {behind_last} to overturn without a clear step forward in raw qualifying pace.',
              ],
              [
                '{behind_last} must identify whether the deficit is mechanical setup, tyre management, or racecraft, because the fix differs in each case.',
                'A single strong weekend can shift the narrative, but {behind_last} needs a string of them to dent a gap this wide.',
                'Until {behind_last} can outscore {ahead_last} on consecutive weekends, the gap will remain the story inside the {team} garage.',
              ]),
            texture(`${id}|q`, [
              '"I am not panicking, we keep working," said {behind_last}.',
              '"The results do not reflect the effort," {behind_last} said.',
              '"My side of the garage will come good," said {behind_last}.',
            ], slots, 62),
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
        const slots = { driver: d.name, driver_last: lastName(d.name), driver_poss: poss(lastName(d.name)), team: teamName(ctx, d.teamId), round: r, recent_runs: formatRecent(recent) }
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
                [
                  '{driver} has posted {recent_runs} in the last three races, a sequence that has dropped the {team} driver well off the scoring pace.',
                  'The recent returns from {driver} make grim reading, {recent_runs} in the last three races with barely a point to show for it.',
                  'The last three races have brought {recent_runs} for {driver}, a run heading firmly the wrong way.',
                ],
                [
                  'That run has cost {driver_last} ground just as the rest of the field keeps banking finishes.',
                  'Points missed in a spell like this are rarely won back, and {driver_last} can feel the order pulling away.',
                  'Whatever the cause, {driver_last} needs to arrest the slide before it defines the season.',
                ]),
              compose(`${id}:p2`, slots,
                [
                  'The concerning aspect for {team} is that no single obvious cause has been identified publicly, which makes the reset harder to engineer.',
                  '{driver_poss} recent finishing positions sit well below what the {team} car has shown it can do.',
                  'For {team}, this is a compounding problem: the constructor loses points from one side of the garage at a time when development pace demands full contribution from both cars.',
                ]),
              slumpTexture,
              texture(`${id}|q`, [
                '"We stay calm and keep digging," said {driver_last}.',
                '"It will turn, I have no doubt," {driver_last} said.',
                '"You do not forget how to drive overnight," said {driver_last}.',
              ], slots, 62),
            ),
          }),
        })
      } else if (avg <= 5) {
        const id = `surge-${ctx.year}-${r}-${d.id}`
        const slots = { driver: d.name, driver_last: lastName(d.name), driver_poss: poss(lastName(d.name)), team: teamName(ctx, d.teamId), round: r, recent_runs: formatRecent(recent) }
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
                [
                  '{driver} has delivered {recent_runs} across the last three rounds, a sequence that places {driver_last} among the outstanding performers on the current grid.',
                  'Back-to-back excellence from {driver}: {recent_runs} in three outings, with a points haul that few rivals can match across the same window.',
                  'The most recent three rounds read {recent_runs} for {driver}, a return that would flatter most drivers on a career-best weekend, let alone as a sustained run.',
                ],
                [
                  'That sequence has lifted {driver_last} meaningfully up the standings and shifted the conversation about where {driver_last} genuinely sits in the championship picture.',
                  'Three consecutive high finishes compound in the standings in ways that single strong races do not; {driver_last} has effectively banked a championship buffer during this run.',
                  'The arithmetic of {recent_runs} means {driver_last} has extracted maximum value from machinery that not every driver on the grid is using as effectively.',
                ]),
              compose(`${id}:p2`, slots,
                [
                  '{driver_last} is at a stage of form where car reads are sharp, tyre decisions are costing less and race management leaves rivals short of opportunity.',
                  'A driver operating at this level tends to create pressure that compounds: rivals start making the mistakes {driver_last} is currently avoiding.',
                  'The data underneath the results suggests {driver_last} is not riding fortune; the consistency of execution across different circuits and conditions points to a driver in control of the process.',
                ],
                [
                  'The question every rival strategist is wrestling with is where the vulnerability lies, because on the evidence of {recent_runs} there is no obvious one to exploit.',
                  'Sustaining a run like this demands that {driver_last} avoids the trap of overdriving; the finishes so far suggest a driver who understands the difference between fast and reckless.',
                  'The most dangerous form in racing is the kind built on reliability rather than luck, and {driver_last}\'s recent run has that quality.',
                ]),
              compose(`${id}:p3`, slots,
                [
                  '{team} are pulling more points from the constructors\' pot than their car\'s pace tier would ordinarily suggest, and {driver_last}\'s run is the primary reason.',
                  'The championship standings now reflect a driver that rivals can no longer treat as a secondary threat; {driver_last} has earned the front-of-mind respect that comes with results.',
                  'At a point in the season when the standings crystallise around the consistent performers, {driver_last} has made a compelling case for inclusion in that group.',
                ],
                [
                  'Whether {driver_last} can extend it beyond three rounds will determine whether this reads as a hot patch or the moment {driver_last} genuinely entered title contention.',
                  'The next test is a circuit that may not suit {driver_poss} natural strengths, and how {driver_last} adapts will say something about the depth of this form.',
                  'Opponents have noted the run and will arrive at the next round with specific game plans; {driver_last} will need to show the surge was built on more than circumstance.',
                ]),
              texture(`${id}|q`, [
                '"Everything is just clicking right now," said {driver_last}.',
                '"I feel completely at one with the car," {driver_last} said.',
                '"Long may it continue," said {driver_last} with a grin.',
              ], slots, 62),
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
        const slots = { team: cs.teamName, team_poss: poss(cs.teamName), pos: ordinal(standingPos), tier: tierWord(pace, total), round: r }
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
              ? ['{team} sit {pos} despite a {tier} car.', '{team} are outscoring their machinery.', '{team} are running {pos}, well above where a {tier} car belongs.']
              : ['{team} sit only {pos} with a {tier} car.', '{team} are not making their pace count.', 'A {tier} car has returned only {pos} for {team}, well short of what it should.'],
              `${id}|d`), slots),
            body: over
              ? paras(
                  compose(`${id}:p1`, slots,
                    [
                      '{team} are {pos} in the constructors\' standings with a car that independent pace data brackets as {tier}, a gap between performance and position that does not close by accident.',
                      'Park the {team} car alongside the competition on raw lap time and you get a {tier} machine; park their results next to the same competition and you see a {pos}-place team.',
                      'The {tier} label on {team_poss} machinery sits oddly against a {pos}-place constructors\' position that {tier} cars have no business occupying.',
                    ],
                    [
                      'The delta between their car\'s objective pace tier and their actual championship position is wide enough to constitute a sustainable competitive advantage in its own right.',
                      'Qualifying well, managing tyres efficiently and converting safety-car windows into net gains adds up, and {team} have done all three more consistently than {tier} teams tend to.',
                      '{team} have demonstrated over multiple rounds that the gap between {tier} car pace and {pos} place in the standings is bridgeable through clean execution.',
                    ]),
                  compose(`${id}:p2`, slots,
                    [
                      'The operational margin they have built comes from decisions rather than horsepower: strategy calls that come early, pit stops that are completed cleanly, and pitstop windows that are not given back through traffic.',
                      'Teams with superior car pace have outpaced {team} on individual lap times this season and still left fewer points on the board, which tells you everything about where the constructors\' championship is actually decided.',
                      'The structural advantage {team} holds has nothing to do with the wind tunnel; it is built in the timing stand, the pit lane, and in drivers who execute rather than spectate.',
                    ],
                    [
                      'The risk that this creates for {team} is one of expectation management: as development cycles tighten, the teams with better cars will close the gap, and the execution margin may not prove sufficient.',
                      'Their rivals are not blind to the overperformance; the teams with faster cars will prioritise closing this gap operationally in the second half of the season.',
                      'Sustaining {pos} into the latter stages of the constructors\' fight requires {team} to keep an error rate near zero while rivals are permitted to catch up on outright pace.',
                    ]),
                  compose(`${id}:p3`, slots,
                    [
                      'If {team} hold {pos} into the final rounds, the conversation will shift from overperformance to simply performance, and that is a significant rebranding of what this team represents.',
                      'The constructors\' position they currently hold controls trackside resources, prize money distributions, and facility investment in ways that compound season over season.',
                      'Every additional race {team} spend {pos} tightens the financial and reputational case for a development cycle that could eventually make the raw car match the standing.',
                    ],
                    [
                      'The pressure on {team} is now to not merely hold the position but justify it when rivals arrive with mid-season development that narrows the gap on paper.',
                      'Staying ahead of teams with faster cars is the hardest thing to sustain over a full season; the question is whether {team_poss} operational edge is sufficient to answer that.',
                      '{team} have earned the right to be where they are on merit, and the only honest test of that is whether they can still say the same at the final round.',
                    ]),
                )
              : paras(
                  compose(`${id}:p1`, slots,
                    [
                      '{team} have the raw material of a {tier} car and only {pos} in the constructors\' standings to show for it, a conversion rate the rest of the paddock will note with interest.',
                      'By pace metrics, {team} operate a {tier} machine; by the actual results column, they sit {pos}, a position no {tier} car should occupy at this stage of the campaign.',
                      'The gap between {team_poss} car pace and their constructors\' position is measurable and widening: a {tier} package deserves more than {pos} on current evidence.',
                    ],
                    [
                      'The squandered pace is not a marginal figure; it translates directly into prize-fund distribution, circuit leverage and the development runway that determines where the team sits in twelve months.',
                      'Formula 1 rewards pace on lap-time sheets and results on the scoreboard; {team} are proving that the two are not the same thing, to their own significant cost.',
                      'A {tier} car earning {pos} constructors\' points means the engineering, manufacturing and driver budgets are not returning what they should, a problem that compounds with every missed weekend.',
                    ]),
                  compose(`${id}:p2`, slots,
                    [
                      'The deficit is operational: pit stop timing, undercut calls, double-stacking decisions, and the management of safety-car periods have collectively cost {team} finishing positions their car\'s pace had already secured.',
                      'Analysis of their race losses points to a pattern of avoidable error rather than pace deficit; the car arrives at the race able to score better and leaves having not done so.',
                      '{team_poss} car pace means they enter most race weekends as a higher-points threat than their tally reflects; the conversion failure is a process and decision-making problem, not a technical one.',
                    ],
                    [
                      'The gap between what their car can score and what it is scoring represents a quantifiable management failure that the {team} leadership is now under public pressure to address.',
                      'Other teams in the {tier} bracket are outscoring {team} on equivalent or worse machinery, which removes the car as a credible explanation for the deficit.',
                      'Execution under pressure is a learnable skill, but {team} have not yet shown they have learned it at the rate the {pos}-place standing demands.',
                    ]),
                  compose(`${id}:p3`, slots,
                    [
                      'The longer {team} sit {pos} with a car capable of better, the harder it becomes to recruit, retain, and motivate the personnel who know exactly what the car should be scoring.',
                      'A {tier} car trapped {pos} in the standings is a resource allocation problem as much as a sporting one: the prize money differential between {pos} and where the car belongs is not trivial.',
                      'The cost of squandering {tier} pace is not just the points not scored today; it is the development budget difference next season that those points would have bought.',
                    ],
                    [
                      'What {team} need is not a new car but a new discipline around the decisions that convert fast machinery into actual championship points.',
                      'A clear operational review, specific accountability for the decisions that cost positions, and a measurable standard for execution are the minimum requirement for closing the gap between where they are and where their car says they should be.',
                      'The second half of the season is short enough that every remaining race must be treated as a recovery opportunity, which leaves {team} no margin for the kind of operational errors that defined the first.',
                    ]),
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
// Stature-scaled career summary for a comeback veteran on the market (driver-to-watch). Real stats only;
// the producer picks the tier from the driver's career record so a former champion reads bigger than a
// journeyman. Slots are filled from DriverCareer.
const VETERAN_CAREER: Record<string, string[]> = {
  champion: [
    '{champ_label} with the {title_years} {titles_word} to {their} name, {driver_last} accumulated {wins} {wins_word} and {poles} {poles_word} across {seasons} {seasons_word} at the top level.',
    '{driver_last} is {champ_label}, the {title_years} {titles_word} backed by {wins} {wins_word} and {poles} {poles_word} in {seasons} {seasons_word} of top-flight racing.',
  ],
  winner: [
    '{driver_last} has taken {wins} {wins_word} and {podiums} {podiums_word} from {starts} {starts_word}, with {poles} {poles_word} underlining {their} one-lap speed.',
    'Over {starts} {starts_word} {driver_last} has earned {wins} {wins_word}, {poles} {poles_word} and {podiums} {podiums_word}, a record that speaks for itself.',
  ],
  podium: [
    '{driver_last} has stood on the podium {podiums} {podiums_word} across {seasons} {seasons_word}, {their} best result a {best_finish} that showed what {they} can do on the right day.',
    'Quick when the car allowed it, {driver_last} collected {podiums} {podiums_word} and {points} {points_word} over {seasons} {seasons_word}, with a best finish of {best_finish}.',
    'Across {seasons} {seasons_word} {driver_last} banked {podiums} {podiums_word} and a best result of {best_finish}, never quite finding the package to convert pace into a win.',
  ],
  points: [
    'Over {seasons} {seasons_word} and {starts} {starts_word}, {driver_last} scored {points} {points_word} with a personal best of {best_finish}, a consistent operator who rarely threw away what the car could give.',
    '{driver_last} brought home {points} {points_word} across {starts} {starts_word}, a best finish of {best_finish} the highlight of {seasons} {seasons_word} in the championship.',
    'A steady hand over {seasons} {seasons_word}, {driver_last} accumulated {points} {points_word} from {starts} {starts_word}, {their} best result a {best_finish}.',
  ],
  journeyman: [
    'Racing since {debut_year}, {driver_last} has {starts} {starts_word} across {seasons} {seasons_word} of top-flight experience, a known quantity whose racecraft has outlasted teams that once doubted it.',
    '{driver_last} brings {starts} {starts_word} and {seasons} {seasons_word} of hard-won experience to the table, having been a fixture in the paddock since {debut_year}.',
    'Since {debut_year}, {driver_last} has completed {starts} {starts_word} across {seasons} {seasons_word}, race-hardened, well-regarded in engineering circles, and still pushing for a seat.',
  ],
}

function driverToWatch(ctx: NewsContext): NewsArticle[] {
  // Fires on a fixed 8-window schedule weighted to the season's end; like silly-season it belongs in the
  // season's permanent record (don't gate on endOfSeason or the retrospective loses the market narrative).
  if (!ctx.live) return []
  const freeAgents = ctx.drivers.filter((d) => d.teamId === '')
  if (freeAgents.length === 0 || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
  const ROUNDS = [7, 12, 16, 19, 21, 22, 23, 24]
  if (ctx.completedRounds < ROUNDS[0]) return out
  // Lock the slate by R7: the top free agents by market perception (driver media score), one per window,
  // each covered exactly once. The ranking is snapshotted as of R7 so the covered set never drifts as the
  // season runs on; which top free agent lands which window does not matter.
  const rankRound = Math.min(7, ctx.completedRounds)
  const rankResults = ctx.raceResults.slice(0, rankRound)
  const rankStand = constructorStandingsAfter(ctx, rankRound)
  const rankInfo7 = rankStand.map((cs, i) => ({ teamId: cs.teamId, points: cs.points, finalPosition: i + 1 }))
  for (const t of ctx.teams) if (!rankInfo7.find((x) => x.teamId === t.id)) rankInfo7.push({ teamId: t.id, points: 0, finalPosition: rankInfo7.length + 1 })
  const perception = computeDriverMediaScores(ctx.drivers, ctx.teams, rankResults, rankInfo7, ctx.teams.length)
  const scoreOf = new Map(perception.map((s) => [s.driverId, s.score]))
  const slate = [...freeAgents]
    .sort((a, b) => (scoreOf.get(b.id) ?? 0) - (scoreOf.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, ROUNDS.length)
  // Fewer than 8 free agents -> fill the LATEST windows (start later in the season), not the earliest.
  const startAt = ROUNDS.length - slate.length
  for (let i = 0; i < slate.length; i++) {
    const r = ROUNDS[startAt + i]
    if (r > ctx.completedRounds) continue
    const fa = slate[i]
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

    // Career stature, picked from the real record, scales the comeback-veteran summary (champion >
    // race-winner > podium finisher > points scorer > journeyman). Only real career facts feed the slots.
    const tier = !c ? 'journeyman'
      : c.titles > 0 ? 'champion'
      : c.wins > 0 ? 'winner'
      : c.podiums > 0 ? 'podium'
      : c.points > 0 ? 'points'
      : 'journeyman'
    const slots: Record<string, string | number> = {
      driver: fa.name, driver_last: lastName(fa.name), age: fa.age, next: ctx.year + 1, to: toTeam,
      to_art: /^[aeiou]/i.test(toTeam) ? 'An' : 'A',
      starts: c?.starts ?? 0, starts_word: plural(c?.starts ?? 0, 'start'),
      seasons: c?.seasons ?? 0, seasons_word: plural(c?.seasons ?? 0, 'season'),
      wins: c?.wins ?? 0, wins_word: plural(c?.wins ?? 0, 'win'),
      poles: c?.poles ?? 0, poles_word: plural(c?.poles ?? 0, 'pole'),
      podiums: c?.podiums ?? 0, podiums_word: plural(c?.podiums ?? 0, 'podium'),
      points: c?.points ?? 0, points_word: plural(c?.points ?? 0, 'point'),
      titles: c?.titles ?? 0, titles_word: plural(c?.titles ?? 0, 'title'),
      title_years: c?.titleYears.length ? listJoin(c.titleYears.map(String)) : '',
      champ_label: (c?.titles ?? 0) === 1 ? 'a former World Champion' : `a ${c?.titles ?? 0}-time World Champion`,
      best_finish: c?.bestFinish ? ordinal(c.bestFinish) : '',
      debut_year: c?.debutYear ?? '',
      pot: fa.peakPotential >= 88 ? 'one of the hottest properties in the junior ranks' : fa.peakPotential >= 80 ? 'a genuine prospect' : 'an intriguing talent',
      ...pronouns(fa.gender),
    }
    const marketLine = toTeam
      ? experienced
        ? fill(pick(['There is a real chance {driver_last} is back on the grid with {to} for {next}.', '{to_art} {to} seat for {next} looks a genuine possibility.'], `${seed}|mkt`), slots)
        : fill(pick(['There is a real chance {driver_last} makes {their} F1 debut with {to} for {next}.', '{to_art} {to} seat for {next} could hand {driver_last} a first F1 drive.', 'A maiden F1 seat with {to} for {next} looks a genuine possibility.'], `${seed}|mkt`), slots)
      : experienced
      ? fill(pick(['For now the seats look full, and a return may have to wait.', 'As things stand, a route back onto the grid looks hard to find.'], `${seed}|mkt`), slots)
      : fill(pick(['For now the seats look full, and a debut may have to wait.', 'As things stand, a first F1 seat looks some way off.'], `${seed}|mkt`), slots)

    if (experienced) {
      const careerLine = fill(pick(VETERAN_CAREER[tier] ?? VETERAN_CAREER.journeyman, `${seed}|rec`), slots)
      out.push({
        id: seed, category: 'driver_to_watch', round: r, priority: 33,
        headline: fill(pick(['Where next for {driver}?', '{driver} eyes a way back', 'A familiar name on the market in {driver}', 'Could {driver} return to the grid?'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} is between seats and weighing the options.', 'Out of a drive for now, {driver_last} is not done yet.', 'A familiar face is on the market.'], `${seed}|d`), slots),
        body: paras(
          fill(pick(['{driver}, {age}, finds {themself} without a seat, a familiar face still chasing a way back.', 'At {age}, {driver} is on the market, and not short of suitors.'], `${seed}|p1`), slots),
          careerLine,
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
          fill(pick(['Those who have watched the junior ranks talk up {their} raw speed and racecraft.', 'A reputation built in the junior single-seater categories, where the results have caught the eye.'], `${seed}|p2`), slots),
          fill(pick(['"There is something special there," one paddock figure said.', '"Keep {driver_last} in mind, you will be hearing that name," said a junior-series insider.'], `${seed}|q`), slots),
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

// --- Article dating + entity tagging (applied centrally so per-producer literals stay terse) ---

// Days a category's story drops relative to its round's race day (negative = before the race).
const CATEGORY_DAY_OFFSET: Record<string, number> = {
  preview_schedule: -4,   // race-week preview
  technical_upgrade: -2,  // upgrade reveal in practice
  car_launch_livery: 0,
  rookie_debut: 0,
  race_report: 0,         // race day (Sunday)
  milestone: 1,           // post-race landmark — drops the day after, so Continue catches it after End Race
  championship_state: 1,  // post-race title reaction — same, the morning after
  feature: 2,
  analysis_opinion: 2,
  driver_to_watch: 3,
  silly_season: 4,
  mid_season_swap: 1,
  driver_signing: 14,     // off-season market, anchored to the finale
  driver_exit: 14,
  career_retirement: 7,
  team_entry: 21, team_exit: 21, team_rebrand: 21,
}

function raceDayOf(ctx: NewsContext, round: number): Date {
  const c = ctx.calendar[round - 1]
  return c ? raceDate(ctx.year, c) : new Date(Date.UTC(ctx.year, 5, 1)) // archived fallback (cosmetic)
}

// The date a story drops (ISO). Pre-season (round 0) anchors ~2 weeks before the opener; the
// off-season (round > N) anchors to the finale; in-season rounds to their race day + offset.
function articleDate(ctx: NewsContext, a: NewsArticle): string {
  const n = ctx.calendar.length
  if (a.round <= 0) return toISODate(addDays(raceDayOf(ctx, 1), a.category === 'car_launch_livery' ? -24 : -14))
  const anchor = a.round > n ? n : a.round
  return toISODate(addDays(raceDayOf(ctx, anchor), CATEGORY_DAY_OFFSET[a.category] ?? 0))
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

type EntTarget = { kind: 'driver' | 'team'; id: string }
interface EntityMatcher { regex: RegExp | null; lookup: Map<string, EntTarget> }

// Engine-side mirror of buildNewsIndex (LinkedText.tsx): longest-first, ambiguity-safe name → entity,
// so an article's tagged ids match exactly what the UI hyperlinks.
function buildEntityMatcher(ctx: NewsContext): EntityMatcher {
  const map = new Map<string, EntTarget | null>()
  const add = (variant: string, target: EntTarget) => {
    const v = variant.trim()
    if (!v) return
    const cur = map.get(v)
    if (cur === undefined) map.set(v, target)
    else if (!cur || cur.kind !== target.kind || cur.id !== target.id) map.set(v, null) // ambiguous → drop
  }
  for (const d of ctx.drivers) {
    if (!d.id || !d.name) continue
    add(d.name, { kind: 'driver', id: d.id })
    add(lastName(d.name), { kind: 'driver', id: d.id })
  }
  for (const t of ctx.teams) {
    if (!t.id || !t.name) continue
    add(t.name, { kind: 'team', id: t.id })
  }
  const lookup = new Map<string, EntTarget>()
  for (const [k, v] of map) if (v) lookup.set(k, v)
  const variants = [...lookup.keys()].sort((a, b) => b.length - a.length)
  const regex = variants.length ? new RegExp(`\\b(${variants.map(escapeRe).join('|')})\\b`, 'g') : null
  return { regex, lookup }
}

function entitiesFor(ctx: NewsContext, a: NewsArticle, m: EntityMatcher): NonNullable<NewsArticle['entities']> {
  const driverIds = new Set<string>()
  const teamIds = new Set<string>()
  if (m.regex) {
    const text = `${a.headline}\n${a.dek}\n${a.body}`
    for (const match of text.matchAll(m.regex)) {
      const t = m.lookup.get(match[0])
      if (!t) continue
      if (t.kind === 'driver') driverIds.add(t.id)
      else teamIds.add(t.id)
    }
  }
  const c = a.round >= 1 && a.round <= ctx.calendar.length ? ctx.calendar[a.round - 1]?.id : undefined
  return { driverIds: [...driverIds], teamIds: [...teamIds], ...(c ? { circuitId: c } : {}) }
}

// TRIGGER (live only; the archived snapshot captures the output): records-driven journalism.
//  - Part F: a driver/team passing another in a CAREER all-time ranking (wins/poles/podiums/points),
//    newsworthy when it reaches the top-K and clears a value floor; a new outright #1 is the big story.
//  - Part G: a SINGLE-SEASON record (drivers: wins/poles/podiums/points/retirements; teams:
//    wins/podiums/points) being broken mid-season, fired at the round it falls. Season one has no
//    prior records, so nothing fires.
function recordNews(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.completedRounds < 1 || ctx.teams.length === 0) return []
  const N = ctx.completedRounds
  const LABEL: Record<RecordMetric, string> = { wins: 'race wins', poles: 'pole positions', podiums: 'podium finishes', points: 'points', dnfs: 'retirements' }
  const careers = ctx.careers ?? {}
  const teamCareers = ctx.teamCareers ?? {}
  const recs = ctx.records
  const driverName = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? recs?.driverNames[id] ?? id
  const teamNameOf = (id: string) => ctx.teams.find((t) => t.id === id)?.name ?? recs?.teamNames[id] ?? id
  // One result row's contribution to a metric (a team sums both cars).
  const gain = (res: RaceResult, key: RecordMetric): number =>
    key === 'wins' ? (res.finishPosition === 1 ? 1 : 0)
      : key === 'poles' ? (res.gridPosition === 1 ? 1 : 0)
        : key === 'podiums' ? (res.finishPosition != null && res.finishPosition <= 3 ? 1 : 0)
          : key === 'dnfs' ? (res.dnf ? 1 : 0)
            : res.points

  type Ev = { round: number; sig: number; type: 'careerLeader' | 'careerClimb' | 'seasonRecord'; slots: Record<string, string | number>; key: string }
  const events: Ev[] = []

  // ===== Part F: career all-time rank overtakes =====
  // Raise the bar in a young world (the issue's "records churn early" concern): a new all-time #1 needs
  // at least one completed prior season to mean anything; a climb into the top few needs deeper history
  // and a higher value floor. `depth` = completed prior seasons.
  const depth = recs?.archivedSeasons ?? 0
  const CLIMB_K = 5
  const CAREER: { key: RecordMetric; leaderFloor: number; climbFloor: number }[] = [
    { key: 'wins', leaderFloor: 5, climbFloor: 12 },
    { key: 'poles', leaderFloor: 5, climbFloor: 12 },
    { key: 'podiums', leaderFloor: 15, climbFloor: 30 },
    { key: 'points', leaderFloor: 200, climbFloor: 600 },
  ]
  const scanOvertakes = (
    ids: string[],
    careerTotal: (id: string, key: RecordMetric) => number,
    roundGain: (id: string, round: number, key: RecordMetric) => number,
    nameOf: (id: string) => string,
    scope: 'd' | 't',
  ) => {
    if (ids.length === 0) return
    ids = [...ids].sort() // deterministic order so rank/selection tie-breaks don't depend on DB/insertion order
    for (const { key, leaderFloor, climbFloor } of CAREER) {
      // cumulative live gain per id through each round, then total-through-r = prior + cum[r].
      const cum = new Map<string, number[]>()
      const prior = new Map<string, number>()
      for (const id of ids) {
        const arr = [0]
        for (let r = 1; r <= N; r++) arr.push(arr[r - 1] + roundGain(id, r, key))
        cum.set(id, arr)
        prior.set(id, careerTotal(id, key) - arr[N])
      }
      const totalAt = (id: string, r: number) => prior.get(id)! + cum.get(id)![r]
      // Precompute, per round, the descending order and a ties-share rank map (1 + count strictly greater).
      const orderAt: string[][] = []
      const rankAt: Map<string, number>[] = []
      for (let r = 0; r <= N; r++) {
        const order = [...ids].sort((a, b) => totalAt(b, r) - totalAt(a, r))
        const m = new Map<string, number>()
        let rank = 0, prevVal = Infinity, seen = 0
        for (const id of order) { seen++; const v = totalAt(id, r); if (v < prevVal) { rank = seen; prevVal = v }; m.set(id, rank) }
        orderAt.push(order); rankAt.push(m)
      }
      for (let r = 1; r <= N; r++) {
        for (const id of ids) {
          if (roundGain(id, r, key) <= 0) continue // only an entity that gained this round can rise
          const newRank = rankAt[r].get(id)!
          if (newRank >= rankAt[r - 1].get(id)!) continue // didn't actually rise this round
          const after = totalAt(id, r)
          let type: 'careerLeader' | 'careerClimb'
          if (newRank === 1) {
            if (depth < 1 || after < leaderFloor) continue
            type = 'careerLeader'
          } else {
            if (depth < 2 || newRank > CLIMB_K || after < climbFloor) continue
            type = 'careerClimb'
          }
          const displaced = orderAt[r - 1][newRank - 1] // who held this rank before the round
          if (!displaced || displaced === id) continue
          if (after <= totalAt(displaced, r)) continue // a tie is not a pass; only strictly exceeding is news
          events.push({
            round: r,
            sig: type === 'careerLeader' ? 1000 + after : 200 + (CLIMB_K - newRank) * 5,
            type,
            slots: { name: nameOf(id), metric: LABEL[key], value: after, rank: ordinal(newRank), passed: nameOf(displaced), prev: totalAt(displaced, r) },
            key: `record-${scope}-career-${key}-${id}-${r}`,
          })
        }
      }
    }
  }
  scanOvertakes(
    Object.keys(careers),
    (id, key) => (careers[id] as unknown as Record<string, number>)[key] ?? 0,
    (id, r, key) => { const res = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === id); return res ? gain(res, key) : 0 },
    driverName, 'd',
  )
  scanOvertakes(
    Object.keys(teamCareers),
    (id, key) => (teamCareers[id] as unknown as Record<string, number>)[key] ?? 0,
    (id, r, key) => (ctx.raceResults[r - 1] ?? []).filter((x) => x.teamId === id).reduce((s, res) => s + gain(res, key), 0),
    teamNameOf, 't',
  )

  // ===== Part G: single-season record breaks =====
  if (recs) {
    const scanSeason = (
      ids: string[], metrics: RecordMetric[], baseline: Partial<Record<RecordMetric, SeasonRecordMark>>,
      roundGain: (id: string, round: number, key: RecordMetric) => number, nameOf: (id: string) => string, scope: 'd' | 't',
    ) => {
      ids = [...ids].sort() // deterministic order so a same-round tie picks the same breaker every time
      for (const key of metrics) {
        const base = baseline[key]
        if (!base) continue // no prior record (e.g. season one) -> nothing to break
        let recValue = base.value, recHolderName = base.holderName, recHolderId: string | null = null, recYear = base.year
        const cum = new Map<string, number>(ids.map((id) => [id, 0]))
        for (let r = 1; r <= N; r++) {
          let bestId = '', bestVal = -1
          for (const id of ids) { const v = cum.get(id)! + roundGain(id, r, key); cum.set(id, v); if (v > bestVal) { bestVal = v; bestId = id } }
          if (bestVal > recValue) {
            // Only news when a DIFFERENT entity takes the record, not when the holder extends it. Compare
            // by id (the archived holder has no live id, so the first live break always fires).
            if (bestId !== recHolderId) {
              events.push({
                round: r, sig: 500 + bestVal, type: 'seasonRecord',
                slots: { name: nameOf(bestId), metric: LABEL[key], value: bestVal, old: recValue, old_holder: recHolderName, old_year: recYear, circuit: circuit(ctx, r) },
                key: `record-${scope}-season-${key}-${bestId}-${r}`,
              })
            }
            recValue = bestVal; recHolderName = nameOf(bestId); recHolderId = bestId; recYear = ctx.year
          }
        }
      }
    }
    scanSeason(
      Object.keys(careers), ['wins', 'poles', 'podiums', 'points', 'dnfs'], recs.seasonDriver,
      (id, r, key) => { const res = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === id); return res ? gain(res, key) : 0 },
      driverName, 'd',
    )
    scanSeason(
      Object.keys(teamCareers), ['wins', 'podiums', 'points'], recs.seasonTeam,
      (id, r, key) => (ctx.raceResults[r - 1] ?? []).filter((x) => x.teamId === id).reduce((s, res) => s + gain(res, key), 0),
      teamNameOf, 't',
    )
  }

  // Cap to the two most significant record stories per round so a record-heavy round doesn't flood.
  const byRound = new Map<number, Ev[]>()
  for (const e of events) { const a = byRound.get(e.round) ?? []; a.push(e); byRound.set(e.round, a) }
  const out: NewsArticle[] = []
  for (const [round, evs] of byRound) {
    evs.sort((a, b) => (b.sig - a.sig) || a.key.localeCompare(b.key)) // stable, deterministic top-2
    for (const e of evs.slice(0, 2)) {
      const c = recordsCopy[e.type]
      const seed = e.key
      out.push({
        id: seed, category: 'record', round,
        priority: e.type === 'careerLeader' ? 60 : e.type === 'seasonRecord' ? 56 : 52,
        headline: fill(pick(c.headline, `${seed}|h`), e.slots),
        dek: fill(pick(c.dek, `${seed}|d`), e.slots),
        body: compose(seed, e.slots, ...c.body),
      })
    }
  }
  return out
}

// ---- Driver-market journalism: a round-15 watch, a round-18 renewals round-up, and an off-season
// retrospective. All three are fed by the store's market beats (ctx.contractWatch / renewals / draft);
// they only run on the live context (archived seasons replay the snapshot taken when these were live).
const WATCH_PIN_ROUND = 15    // matches the store's WATCH_ROUND
const RENEWAL_PIN_ROUND = 18  // matches the store's RENEWAL_ROUND

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

// Round-15 survey of the expiring contracts, graded from the driver's side. Chunked: ONE sentence per
// verdict names the whole group (with their teams), instead of a paragraph per driver.
function contractWatchFeature(ctx: NewsContext): NewsArticle[] {
  const watch = ctx.contractWatch
  if (!ctx.live || !watch || watch.length === 0) return []
  const c = marketFeatureCopy.watch
  const year = ctx.year
  const seed = `contract-watch-${year}`
  const hslots = { n: watch.length, year, next: year + 1 }
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
    id: seed, category: 'silly_season', round: WATCH_PIN_ROUND, priority: 34,
    headline: fill(pick(c.title, `${seed}|h`), hslots),
    dek: fill(pick(c.dek, `${seed}|d`), hslots),
    body,
  })]
}

// Round-18 round-up once the renewal window closes. Chunked: one sentence lists the re-signings (team +
// length), one lists who is heading to the market.
function renewalsFeature(ctx: NewsContext): NewsArticle[] {
  // Fires from round 18 on (incl. the off-season archive snapshot, so it persists to archived seasons).
  if (!ctx.live || ctx.completedRounds < RENEWAL_PIN_ROUND) return []
  const renewals = ctx.renewals ?? []
  const stillExpiring = ctx.drivers.filter((d) => d.teamId !== '' && d.contractExpiresAfterSeason === ctx.year)
  if (renewals.length === 0 && stillExpiring.length === 0) return []
  const c = marketFeatureCopy.renewals
  const year = ctx.year
  const next = year + 1
  const seed = `renewals-roundup-${year}`
  const hslots = { n: renewals.length, m: stillExpiring.length, year, next }
  const renewedNames = listJoin(renewals.map((r) => `${r.driverName} (${r.teamName}, ${r.years}yr)`))
  const expiringNames = listJoin(stillExpiring.map((d) => `${d.name} (${teamName(ctx, d.teamId)})`))
  const body = paras(
    fill(pick(c.intro, `${seed}|intro`), hslots),
    renewals.length ? paras(fill(pick(c.renewed, `${seed}|renewed`), { ...hslots, names: renewedNames }), quoteLine(c.quote_renewed, `${seed}|q-ren`, renewals[0].driverName)) : '',
    stillExpiring.length ? paras(fill(pick(c.expiring, `${seed}|expiring`), { ...hslots, names: expiringNames }), quoteLine(c.quote_expiring, `${seed}|q-exp`, stillExpiring[0].name)) : '',
  )
  return [agreeArticle({
    id: seed, category: 'silly_season', round: RENEWAL_PIN_ROUND, priority: 36,
    headline: fill(pick(c.title, `${seed}|h`), hslots),
    dek: fill(pick(c.dek, `${seed}|d`), hslots),
    body,
  })]
}

// End-of-season retrospective. The marquee move gets a fact-dense sentence (who left whom, where each
// team finished, the term); everything else is chunked into one sentence per category.
function offSeasonFeature(ctx: NewsContext): NewsArticle[] {
  const eos = ctx.endOfSeason
  if (!eos) return []
  const moves = eos.marketMoves ?? []
  const realMoves = moves.filter((m) => m.fromTeamId && m.fromTeamId !== m.toTeamId && m.mediaScore > 0)
  const dropped = eos.droppedDrivers ?? []
  const draft = ctx.draft ?? []
  if (realMoves.length === 0 && dropped.length === 0 && draft.length === 0) return []
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
  const upsets = draft.filter((p) => p.flavour === 'upset')
  const rookies = moves.filter((m) => m.fromTeamId == null && !m.isResignation && m.mediaScore === 0)

  const body = paras(
    marquee ? paras(marqueePara, quoteLine(c.quote_signed, `${seed}|q-sign`, marquee.driverName)) : '',
    otherMoves.length ? fill(pick(c.moves, `${seed}|moves`), { ...hslots, names: listJoin(otherMoves.map((m) => `${m.driverName} (${fromName(m)} to ${m.toTeamName})`)) }) : '',
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
    ...teamTransitions(ctx),
    ...driverToWatch(ctx),
    ...midSeasonSwaps(ctx),
    ...recordNews(ctx),
    ...contractWatchFeature(ctx),
    ...renewalsFeature(ctx),
    ...offSeasonFeature(ctx),
  ]
  // de-dupe by id, then newest round first, higher priority first
  const seen = new Set<string>()
  const deduped = all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
  deduped.sort((a, b) => (b.round - a.round) || (b.priority - a.priority) || a.id.localeCompare(b.id))
  // Stamp each surviving article with the date it drops and the entities it mentions (for the
  // FM-style Continue loop's date-spread + name-follow interruption, and consistent hyperlinking).
  const matcher = buildEntityMatcher(ctx)
  return deduped.slice(0, 400).map((a) => ({ ...a, date: articleDate(ctx, a), entities: entitiesFor(ctx, a, matcher) }))
}

// Small helper so the page can label each card by category without importing the list.
export const CATEGORY_LABELS: Record<string, string> = {
  race_report: 'Race report', milestone: 'Milestone', technical_upgrade: 'Technical',
  championship_state: 'Championship', feature: 'Feature', preview_schedule: 'Preview',
  car_launch_livery: 'Launch', rookie_debut: 'Rookie', driver_signing: 'Transfer',
  driver_exit: 'Transfer', career_retirement: 'Retirement', silly_season: 'Silly season',
  analysis_opinion: 'Analysis', driver_to_watch: 'Driver watch',
  team_entry: 'New team', team_exit: 'Team exit', team_rebrand: 'Rebrand', mid_season_swap: 'Driver change',
  record: 'Record',
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
  { label: 'Grid change', categories: ['team_entry', 'team_exit', 'team_rebrand'] },
  { label: 'Driver change', categories: ['mid_season_swap'] },
  { label: 'Record', categories: ['record'] },
]
