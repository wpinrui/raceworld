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
//  - analysis_opinion : expectation checkpoints (~twice a season, over/under preseason billing) plus the
//                       end-of-season teammate-battle verdicts. (The old single-per-round opinion column was removed.)

import type {
  Driver, Team, RaceResult, DevUpgradeEvent,
  EndOfSeasonSummary, Circuit, SeasonPhase, ConstructorSeasonRecord, RaceWeather,
} from '@/lib/sim/types'
import { computeDriverMediaScores, computeTeamMediaScores } from '@/lib/sim/media-scores'
import { driverMaxPerRace, constructorMaxPerRace, getPoints } from '@/lib/sim/points'
import { computeRetentionDeltas, runDriverMarket } from '@/lib/sim/free-agency'
import type { RenewalResult, DraftPick, ContractWatch } from '@/lib/sim/driver-market'
import { marketWatchRound, marketRenewalRound } from '@/lib/sim/driver-market'
import { pick, chance, fill, ordinal, lastName, listJoin, plural, compose, mulberry32, clamp, pronouns } from './util'
import { raceDate, toISODate, addDays, daysBetween } from '@/lib/sim/calendar-dates'
import { buildSeasonAnalysis, previewCast, titleArcEvents, constructorArcEvents } from './season-analysis'
import seasonPreviewCopy from './season-preview-copy.json'
import arcCopy from './title-arc-copy.json'
import constructorArcCopy from './constructor-arc-copy.json'
import seasonReviewCopy from './season-review-copy.json'
import milestoneCopy from './milestone-copy.json'
import recordsCopy from './records-copy.json'
import marketFeatureCopy from './market-feature-copy.json'
import teamnewsCopy from './teamnews-copy.json'
import wxCopy from './weather-report-copy.json'
import { driverArcs, teammateBattles, crossTeamDuels, championshipShape, constructorShape, teamArcs, runnerUpArc, clinchRound, bestOfRestBattle, backmarkerStory } from './archetypes'
import driverArcCopy from './driver-arc-copy.json'
import crossTeamDuelCopy from './cross-team-duel-copy.json'
import bestOfRestCopy from './best-of-rest-copy.json'
import backmarkerCopy from './backmarker-copy.json'
import teammateBattleCopy from './teammate-battle-copy.json'
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
  seasonStartCarPace?: Record<string, number>  // teamId -> carPace at round 0. Only the first-season fallback for
                                   // the media car projection (#88); normally projection anchors on last season's finish.
  priorDriverMediaScores?: Record<string, number>  // driverId -> last season's end-of-year media score (#88), the
                                   // basis for this season's driver expectation. Absent -> pace+narrative fallback.
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
  // Real-world team changes taking effect NEXT season, decided at THIS season's start. The team-transition
  // producer announces them ~4/5 through the season. (Live: the approved set from the store. Archived: the
  // season -> next-season roster diff.) Distinct from endOfSeason.gridAdditions/Removals (god-mode, off-season).
  nextSeasonChanges?: {
    rebrands: { teamId: string; fromName: string; toName: string }[]
    additions: { teamId: string; teamName: string }[]
    removals: { teamId: string; teamName: string; finalPosition: number | null }[]
  }
  // Driver-market beats for the market journalism (all optional — present only on the live context):
  contractWatch?: ContractWatch[]  // round-15 verdicts on expiring contracts (could-do-better/right-place/lucky)
  renewals?: RenewalResult[]       // round-18 in-season contract renewals
  draft?: DraftPick[]              // end-of-season Signing Day picks (ordered, best seat first)
  signingDayRevealed?: number      // signings the player has revealed on the Signing Day board (gates the recap)
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
  // True for forward-looking previews of an upcoming round (e.g. title-scenario "what X needs at race N").
  // articleDate drops these in their round's race WEEK rather than at the category's post-race offset, so
  // they interrupt BEFORE the round they preview instead of after it.
  preview?: boolean
  // Overrides the category's default day offset (e.g. the season review + year-end expectation piece drop ON
  // finale day so they are there the moment the off-season Season Review is reached, not two days later).
  dayOffset?: number
}

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

// Headline weather modifier bucket (weather race-report news): a drying day reads as "drying",
// otherwise the descriptor escalates with how wet the track got at its peak.
function wxHeadlineBucket(wx: RaceWeather): 'damp' | 'wet' | 'heavy' | 'drying' {
  if (wx.shape === 'drying') return 'drying'
  if (wx.peakMoisture >= 0.70) return 'heavy'
  if (wx.peakMoisture >= 0.35) return 'wet'
  return 'damp'
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
// Crash phrasings for a 'collision-damage' DNF (issue #61) — covers both solo driver errors (#59)
// and wheel-to-wheel overtake collisions (#60), now lumped under one reason. Each slots after "with".
const CRASH_REASONS = [
  'a spin into the barriers at the exit of a high-speed corner',
  'a lock-up that beached the car in the gravel',
  'a misjudgement under braking that ended in the wall',
  'a collision with the car ahead while fighting for position',
  'contact between the two cars in a wheel-to-wheel battle',
  'a clash with a rival during an overtake attempt',
  'a loss of control at turn entry that sent the car into the barrier',
  'a coming-together with the car in front',
  'a mid-corner slide that the driver could not catch',
]

// Phrasings for each stored technical-failure type (issue #61) — the news reads the real reason
// rather than inventing one. Keyed by RetirementReason's technical members.
const TECHNICAL_REASONS: Record<string, string[]> = {
  engine: ['an engine failure', 'a blown engine', 'a power-unit failure', 'a sudden loss of power'],
  gearbox: ['a gearbox failure', 'a transmission problem', 'a jammed gearbox'],
  hydraulics: ['a hydraulics failure', 'a loss of hydraulic pressure', 'a hydraulics leak'],
  electrical: ['an electrical failure', 'an electronics problem', 'an electrical gremlin'],
  suspension: ['a suspension failure', 'a broken suspension', 'terminal suspension damage'],
  brakes: ['brake failure', 'a brake problem', 'brakes that faded away'],
  clutch: ['a clutch failure', 'a clutch problem', 'a slipping clutch'],
  overheating: ['an overheating engine', 'cooling problems', 'a temperature that ran away'],
}

// Fallback for a DNF with no stored reason (e.g. a season archived before reasons were tracked and
// regenerated from results rather than replayed). Generic, race-ending mechanical causes.
const GENERIC_MECHANICAL = ['a power-unit failure', 'a hydraulics leak', 'a gearbox problem', 'brake failure', 'a suspension failure', 'an electrical failure']

// One-sentence mention of a NOTABLE non-DNF consistency mistake (issue #59). Slots: {m_last},
// {m_loss} (whole seconds), {m_pos} (ordinal finish), {m_team}, plus the driver's pronouns.
const NOTABLE_MISTAKE_POOL = [
  '{m_last} lost {m_loss} seconds to a lock-up at the braking zone, eventually salvaging {m_pos} for {m_team}.',
  'A spin at the exit of the complex cost {m_last} the best part of {m_loss} seconds, though {they} gathered it up and came home {m_pos}.',
  '{m_last} ran wide on to the kerbs and dropped {m_loss} seconds before rejoining, finishing {m_pos}.',
  'The recovery drive from {m_last} was necessary after an error mid-race cost {them} {m_loss} seconds and several places, finishing {m_pos}.',
  '{m_last} overcooked the entry to the hairpin and shed {m_loss} seconds in the gravel, then hauled back to {m_pos}.',
  'A momentary loss of the rear under braking dropped {m_last} {m_loss} seconds off the pace, and {they} eventually crossed the line {m_pos}.',
  '{m_last} tagged the inside kerb and spun, gifting {m_loss} seconds to the chasing pack before recovering to {m_pos}.',
  '{they_cap} will point to {m_loss} seconds dropped in a single off-track moment, but {m_last} did enough to finish {m_pos}.',
]

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
    // Constructors' standings, for the opening-round coda: after one race the WDC "lead" is just the win,
    // so the first-round report speaks to the constructors' championship instead.
    const cAfterR = constructorStandingsAfter(ctx, r)
    const cLeaderTeam = cAfterR[0]
    const remaining = N - r
    const racesLeft = `${remaining} ${plural(remaining, 'race')}`
    const clinched = !!leader && afterR.length >= 2 && remaining > 0 && leadGap > remaining * driverMaxPerRace(ctx.year)

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
    // Weather angle (weather race-report news): the per-race summary rides on every result row. On a
    // wet race the headline gains a conditions modifier ("the rain-soaked {circuit}"); dry stays plain.
    const wx = results.find((x) => x.weather)?.weather ?? null
    const circuitWx = wx?.rained
      ? `${pick(wxCopy.headline[wxHeadlineBucket(wx)], `${seed}|wxh`)} ${circuitName}`
      : circuitName
    // Read the stored retirementReason (issue #61): collision-damage → a crash phrase, a technical
    // type → its own phrasings, absent → a generic mechanical fallback. De-duplicated within a race
    // so the same phrasing doesn't appear twice in one report.
    const poolFor = (x: RaceResult): string[] => {
      const r = x.retirementReason
      if (r === 'collision-damage' || x.crashed) return CRASH_REASONS
      if (r && TECHNICAL_REASONS[r]) return TECHNICAL_REASONS[r]
      return GENERIC_MECHANICAL
    }
    const usedReasons = new Set<string>()
    const reasonFor = (x: RaceResult): string => {
      const pool = poolFor(x)
      const seeded = pick(pool, `${seed}|why-${x.driverId}`)
      const chosen = usedReasons.has(seeded)
        ? (pool.filter((rr) => !usedReasons.has(rr))[0] ?? seeded)
        : seeded
      usedReasons.add(chosen)
      return chosen
    }
    const dnfReasoned = listJoin(dnfs.map((x) => `${lastName(x.driverName)} with ${reasonFor(x)}`))
    const dnfSoloLaps = dnfSolo?.lapsCompleted ?? 0
    const poleRunnerUp = results.find((x) => x.gridPosition === 2)
    const slots: Record<string, string | number> = {
      winner: p1.driverName, winner_last: lastName(p1.driverName), team: p1.teamName,
      p2: p2?.driverName ?? '', p2_last: p2 ? lastName(p2.driverName) : '', p3: p3?.driverName ?? '',
      circuit: circuitName, circuit_wx: circuitWx, margin, points: p1.points, pole: pole?.driverName ?? '', pole_last: pole ? lastName(pole.driverName) : '',
      pole_runner_up: poleRunnerUp ? lastName(poleRunnerUp.driverName) : '',
      mover: mover?.driverName ?? '', mover_from: ordinal(mover?.gridPosition ?? 0), mover_to: ordinal(mover?.finishPosition ?? 0),
      mover_gain: moverGain, leader: leader?.driverName ?? '', second: afterR[1]?.driverName ?? '',
      leader_last: leader ? lastName(leader.driverName) : '', second_last: afterR[1] ? lastName(afterR[1].driverName) : '',
      lead_gap: leadGap, lead_gap_pts: plural(leadGap, 'point'), leader_points: leader?.points ?? 0, round: r, races_left: racesLeft,
      c_leader: cLeaderTeam?.teamName ?? '', c_second: cAfterR[1]?.teamName ?? '', prev_leader: afterPrev[0]?.driverName ?? '',
      dnf_list: listJoin(dnfNames), dnf_count: dnfs.length, cars: plural(dnfs.length, 'car'),
      dnf_reasoned: dnfReasoned, dnf_word: dnfs.length === 2 ? 'both' : 'all',
      dnf_solo_reason: dnfSolo ? pick(poolFor(dnfSolo), `${seed}|why-${dnfSolo.driverId}`) : '',
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
    const moverPool = moverGain >= 4 && mover && getPoints(mover.finishPosition ?? 99, ctx.year) > 0
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
          'Qualifying had gone to {pole_last} by {pole_margin}.',
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

    // Championship coda (#88, reworked): tell the title fight as a story. Lead with what moved THIS race —
    // the protagonists' actual results and the swing from one race ago — and reframe entirely when a new
    // name takes the lead or climbs into the top two (the old margin is then irrelevant; positions moved).
    const champPara = ((): string => {
      if (!leader) return ''
      if (clinched) {
        // Only call it a clinch if it happened THIS race. If the title was already secure a race ago, this is a
        // margin update, not a fresh crowning — name where it was actually sealed instead (#88).
        const remPrev = N - (r - 1)
        const clinchedBefore = afterPrev.length >= 2 && remPrev > 0 && (afterPrev[0].points - afterPrev[1].points) > remPrev * driverMaxPerRace(ctx.year)
        if (!clinchedBefore) return compose(`${seed}:champ`, slots, [
          '{leader} can no longer be caught in the championship.',
          'The result puts the title beyond doubt, {leader} now uncatchable with {lead_gap} {lead_gap_pts} in hand and {races_left} left.',
          '{leader} has effectively wrapped up the championship, {lead_gap} {lead_gap_pts} clear with {races_left} to run.',
          'The arithmetic is settled, {leader} now champion with {lead_gap} {lead_gap_pts} in hand and {races_left} remaining.',
        ])
        // Already champion: find the round it was sealed at and report the updated margin instead.
        let clinchRound = 0
        for (let k = 1; k < r; k++) {
          const st = driverStandingsAfter(ctx, k)
          if (st.length >= 2 && N - k > 0 && st[0].points - st[1].points > (N - k) * driverMaxPerRace(ctx.year)) { clinchRound = k; break }
        }
        const clinchPhrase = clinchRound ? `at the ${circuit(ctx, clinchRound)}${clinchRound === r - 1 ? ' last weekend' : ''}` : 'earlier this season'
        return compose(`${seed}:champ`, { ...slots, year: ctx.year, clinch_phrase: clinchPhrase }, [
          '{leader}, who was named {year} World Champion {clinch_phrase}, is now {lead_gap} {lead_gap_pts} ahead of second-placed {second_last}.',
          'Already crowned {year} champion {clinch_phrase}, {leader} now leads {second_last} by {lead_gap} {lead_gap_pts} with {races_left} to run.',
          'With the title already settled {clinch_phrase}, {leader_last} sits {lead_gap} {lead_gap_pts} clear of {second_last}.',
        ])
      }
      if (r === 1) return compose(`${seed}:champ`, slots, [
        "{c_leader} lead the constructors' championship after the opening round.",
        "Round one puts {c_leader} top of the constructors' standings, ahead of {c_second}.",
        "The constructors' championship opens with {c_leader} on top.",
        "{c_leader} take the early constructors' lead, {c_second} the nearest of the rest.",
      ])
      const second = afterR[1]
      if (!second) return `${lastName(leader.driverName)} heads the championship after the ${circuitName}.`
      if (remaining === 0) return `${lastName(leader.driverName)} is crowned ${ctx.year} World Drivers' Champion, ${leadGap} ${plural(leadGap, 'point')} clear of ${lastName(second.driverName)}.`
      // A title protagonist's result THIS race, as a bare noun ("win") and a verb ("won").
      const raceFin = (id: string): { noun: string; verb: string } => {
        const res = results.find((x) => x.driverId === id)
        if (!res || res.finishPosition == null) return res?.dnf ? { noun: 'retirement', verb: 'retired' } : { noun: 'absence', verb: 'did not start' }
        if (res.dnf) return { noun: 'retirement', verb: 'retired' }
        if (res.finishPosition === 1) return { noun: 'win', verb: 'won' }
        return { noun: `${ordinal(res.finishPosition)}-place finish`, verb: `finished ${ordinal(res.finishPosition)}` }
      }
      const ld = lastName(leader.driverName), sd = lastName(second.driverName)
      const prL = pronouns(ctx.drivers.find((d) => d.id === leader.driverId)?.gender)
      const gapPts = plural(leadGap, 'point')
      const priorRankOf = (id: string) => (afterPrev.findIndex((s) => s.driverId === id) + 1) || afterPrev.length + 1

      // A new name has taken the championship lead: lead with the takeover and how far they have climbed.
      if (leadChanged) {
        const climbed = priorRankOf(leader.driverId)
        const verb = climbed >= 4 ? 'catapults' : climbed === 3 ? 'lifts' : 'moves'
        const from = climbed >= 3 ? `, up from ${ordinal(climbed)} before the ${circuitName}` : ''
        return `${ld}'s ${raceFin(leader.driverId).noun} ${verb} ${prL.them} into the championship lead${from}. ${prL.they_cap} now leads ${sd}, who ${raceFin(second.driverId).verb}, by ${leadGap} ${gapPts} with ${racesLeft} remaining.`
      }
      // Same leader, but a new name has climbed into second: frame it as entering the conversation.
      const prevSecondId = afterPrev[1]?.driverId
      if (prevSecondId && prevSecondId !== second.driverId) {
        const climbed = priorRankOf(second.driverId)
        const prS = pronouns(ctx.drivers.find((d) => d.id === second.driverId)?.gender)
        const from = climbed >= 3 ? `, up from ${ordinal(climbed)} before the ${circuitName}` : ''
        return `${sd}'s ${raceFin(second.driverId).noun} lifts ${prS.them} into championship contention${from}. ${prS.they_cap} now sits ${leadGap} ${gapPts} behind ${ld} with ${racesLeft} remaining.`
      }
      // Same top two: how did the gap move this race, and why?
      const leaderRacePts = results.find((x) => x.driverId === leader.driverId)?.points ?? 0
      const secondRacePts = results.find((x) => x.driverId === second.driverId)?.points ?? 0
      const raceSwing = leaderRacePts - secondRacePts
      const prevGap = leadGap - raceSwing
      if (Math.abs(raceSwing) >= 4) {
        return `${sd}'s ${raceFin(second.driverId).noun} and ${ld}'s ${raceFin(leader.driverId).noun} ${raceSwing < 0 ? 'cut' : 'stretched'} the title gap from ${prevGap} to ${leadGap} ${gapPts}, ${ld} leading ${sd} with ${racesLeft} remaining.`
      }
      const moved = raceSwing !== 0 ? `, ${raceSwing < 0 ? 'down' : 'up'} from ${prevGap}` : ''
      return `${ld} leads ${sd} by ${leadGap} ${gapPts}${moved} with ${racesLeft} remaining.`
    })()

    // Notable non-DNF consistency mistake (issue #59): the single most significant one per race,
    // gated to a newsworthy magnitude — a wobble of 5 seconds or more. Crash-outs are not eligible
    // here; they are already covered in the attrition paragraph.
    const topMistake = sorted
      .filter((x) => !x.dnf && (x.mistakes ?? 0) > 0 && (x.worstMistakeLoss ?? 0) >= 5)
      .sort((a, b) => (b.worstMistakeLoss ?? 0) - (a.worstMistakeLoss ?? 0))[0] ?? null
    const mistakePara = topMistake
      ? compose(`${seed}:mistake`, {
          m_last: lastName(topMistake.driverName),
          m_loss: Math.round(topMistake.worstMistakeLoss ?? 0),
          m_pos: ordinal(topMistake.finishPosition ?? 1), // non-DNF always has a position; guard avoids "0th"
          m_team: topMistake.teamName,
          ...pronouns(ctx.drivers.find((d) => d.id === topMistake.driverId)?.gender),
        }, NOTABLE_MISTAKE_POOL)
      : ''

    // Weather paragraph: a wet race always gets a short conditions line naming who handled the wet
    // best (relative wet pace; never a position/gap claim, since the master is often not the winner).
    // A dry race gets a flavoured line only sometimes (more often when rain had been forecast), and
    // never the bland "it was dry".
    const wxMaster = wx?.wetMasterId ? ctx.drivers.find((d) => d.id === wx.wetMasterId) : undefined
    const weatherPara = !wx
      ? ''
      : wx.rained
      ? (() => {
          const masterName = wxMaster?.name ?? wx.wetMasterName ?? ''
          const pool = masterName && wx.shape !== 'dry' ? wxCopy.wet[wx.shape] : wxCopy.wetNoMaster
          return compose(`${seed}:wx`, {
            circuit: circuitName, wx_master: masterName, wx_master_last: lastName(masterName),
            wx_master_team: wxMaster ? teamName(ctx, wxMaster.teamId) : '',
            ...pronouns(wxMaster?.gender),
          }, pool)
        })()
      : chance(`${seed}:wx`, wx.forecastThreatenedRain ? 55 : 18)
      ? compose(`${seed}:wx`, { circuit: circuitName }, wx.forecastThreatenedRain ? wxCopy.dryThreatened : wxCopy.dryFlavour)
      : ''

    // Win-streak / dense-stretch modifier for the dek (#88): a current run of wins is the story, so when one
    // exists the dek leads with it ("to win his 4th race in a row", "for 6 wins in 7 races").
    const streakDek = ((): string => {
      const wonR = (k: number) => (ctx.raceResults[k - 1] ?? []).some((x) => x.driverId === p1.driverId && x.finishPosition === 1)
      let streak = 0
      for (let k = r; k >= 1 && wonR(k); k--) streak++
      let tail = ''
      if (streak >= 3) tail = `to win ${pronouns(ctx.drivers.find((d) => d.id === p1.driverId)?.gender).their} ${ordinal(streak)} race in a row`
      else {
        let best: { w: number; W: number } | null = null
        for (let W = Math.min(r, 7); W >= 5; W--) {
          let w = 0
          for (let k = r - W + 1; k <= r; k++) if (wonR(k)) w++
          if (w >= 4 && W - w <= 2 && (!best || w > best.w)) best = { w, W }
        }
        if (best) tail = `for ${best.w} wins in ${best.W} races`
      }
      if (!tail) return ''
      const m = hasMargin ? `, finishing ${margin} clear of ${p2?.driverName ?? 'the field'},` : ''
      return `${p1.driverName} won the ${circuitName}${m} ${tail}.`
    })()

    out.push({
      id: seed, category: 'race_report', round: r, priority: 90,
      headline: fill(pick([
        '{winner} wins the {circuit_wx}', '{winner_last} triumphs at the {circuit_wx}', '{winner_last} holds on for {circuit_wx} victory',
        '{winner_last} dominates from start to finish at the {circuit_wx}', '{team} celebrate as {winner_last} takes {circuit_wx} honours',
        '{winner_last} converts pace into victory at the {circuit_wx}', '{winner_last} sees off {p2_last} to win the {circuit_wx}',
        'Victory for {winner_last} at the {circuit_wx}', '{winner_last} moves clear after the {circuit_wx}', '{winner_last} delivers at the {circuit_wx}',
        '{team} claim the {circuit_wx} through {winner_last}', '{winner} masters the {circuit_wx}',
      ], `${seed}|h`), slots),
      dek: streakDek || fill(pick([
        '{winner} took victory at the {circuit}, with {p2} and {p3} completing the podium.',
        ...(hasMargin ? ['{winner} won the {circuit}, finishing {margin} clear of {p2}.'] : []),
        '{winner_last} delivered a controlled drive to win the {circuit} ahead of {p2} and {p3}.',
        '{winner} claimed {their} {win_ord} win of the season at the {circuit}.',
        '{team} top the podium at the {circuit} as {winner_last} holds off {p2_last}.',
        '{winner_last} wins the {circuit} and tightens {their} grip on the season.',
        'A composed afternoon from {winner_last} puts {team} on the top step at the {circuit}.',
      ], `${seed}|d`), slots),
      body: paras(leadPara, startPara, weatherPara, attritionPara, mistakePara, texturePara, champPara, quotePara),
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
    const clinched = remaining <= 0 || (s.length >= 2 && gap > remaining * driverMaxPerRace(ctx.year))
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
    const clinched = remaining <= 0 || (s.length >= 2 && gap > remaining * constructorMaxPerRace(ctx.year))
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

// The championship arc (#88): a sparse, trajectory-driven narrative on the title fight — the comeback/
// erosion story, the leader pulling clear, or the run-in maths. Replaces titleFight + titleScenario; the
// factual clinch/lead-change stays in `championship`. Fires only at inflections (see titleArcEvents).
function championshipArc(ctx: NewsContext): NewsArticle[] {
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
function constructorArc(ctx: NewsContext): NewsArticle[] {
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

// The season review (#88): the end-of-season retrospective that pays off the preview — how the title was
// won, who beat or missed their preseason projection, the best of the rest. Replaces the old `feature`
// producer (keeps the `feature` category). Grounded in the season-analysis deltas + title trajectory.
function seasonReview(ctx: NewsContext): NewsArticle[] {
  // Live only — the expectation basis (prior media scores, constructor history) exists only on the live
  // context; the archived feed is served from the snapshot captured here at season end. Without this guard
  // the results-only archived rebuild yields a degenerate all-equal expectation and bogus over/under deltas.
  if (!ctx.live || (!ctx.endOfSeason && ctx.completedRounds < ctx.calendar.length)) return []
  const analysis = buildSeasonAnalysis(ctx)
  const t = analysis.driverTitle
  if (!t.currentLeaderId || t.series.length === 0) return []
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const tn = (id: string) => teamName(ctx, id)
  const champion = t.currentLeaderId
  const runnerUp = t.series[t.series.length - 1]?.secondId ?? null
  const constructorChampion = analysis.constructorTitle.currentLeaderId
  const sm = championshipShape(ctx, analysis) // full #88 title-battle taxonomy + combination modifiers
  const cs = constructorShape(ctx, analysis)
  const ruArc = runnerUpArc(ctx, analysis)
  const arc = teamArcs(ctx, analysis)[0] ?? null
  const teamHalf = Math.ceil(ctx.teams.length / 2)
  const teamPointsOf = (id: string) => { let p = 0; for (let r = 1; r <= analysis.completedRounds; r++) for (const cc of ctx.raceResults[r - 1] ?? []) if (cc.teamId === id) p += cc.points; return p }
  // Only a real over/under-performance: a 2+ place swing, and (over) the team actually scored, or (under) it
  // was fancied with somewhere to fall. A 0-point backmarker creeping up one place is not a story.
  const teamOver = analysis.teamDeltas.find((d) => d.delta >= 2 && d.id !== constructorChampion && teamPointsOf(d.id) > 0)?.id
  const teamUnder = analysis.teamDeltas.find((d) => d.delta <= -2 && d.expectedRank <= teamHalf)?.id
  const c = seasonReviewCopy as Record<string, string[]>
  const seed = `season-review-${ctx.year}`
  const cap = (k: string) => k[0].toUpperCase() + k.slice(1)
  const championDriver = ctx.drivers.find((d) => d.id === champion)
  const champTeam = championDriver ? tn(championDriver.teamId) : ''
  const ruLast = runnerUp ? lastName(dn(runnerUp)) : ''
  // Top two shared a garage: name the runner-up as the champion's teammate inline (#88), no separate sentence.
  const runnerUpRef = sm.teammatePair && runnerUp ? `${pronouns(championDriver?.gender).their} ${champTeam} teammate ${ruLast}` : ruLast
  // Champion's lead trajectory + identity, for the late-wobble modifier copy.
  let peakLead = 0, peakRound = 0
  for (const g of t.series) if (g.leaderId === champion && g.gap > peakLead) { peakLead = g.gap; peakRound = g.round }
  let sdRound = 0
  for (const g of t.series) if (g.round > peakRound && g.leaderId === champion && g.gap < 10) { sdRound = g.round; break }
  // The lead's low point STRICTLY after its peak. If the runner-up actually overtook (the lead went negative,
  // i.e. the champion stopped being the leader), describe that instead of quoting a number.
  let lowestLead = peakLead, lostLead = false
  for (const g of t.series) {
    if (g.round <= peakRound) continue
    if (g.leaderId === champion) lowestLead = Math.min(lowestLead, g.gap)
    else lostLead = true
  }
  const leadErosion = lostLead ? 'and briefly take it over altogether' : `all the way down to ${lowestLead}`
  const runnerUpDriver = runnerUp ? ctx.drivers.find((d) => d.id === runnerUp) : undefined
  const champPron = pronouns(championDriver?.gender)
  const championTitleOrdinal = ordinal((ctx.careers?.[champion]?.titleYears ?? []).filter((y) => y < ctx.year).length + 1)
  // Wet-weather points split (champion vs runner-up) + the champion's latest wet win, for the wet-aided modifier.
  let champWetPts = 0, ruWetPts = 0, wetRaces = 0, wetWinGp = ''
  for (let r = 1; r <= analysis.completedRounds; r++) {
    const rr = ctx.raceResults[r - 1] ?? []
    if (!((rr.find((x) => x.weather)?.weather?.rained) ?? false)) continue
    wetRaces++
    const c = rr.find((x) => x.driverId === champion)
    if (c) { champWetPts += c.points; if (c.finishPosition === 1) wetWinGp = circuit(ctx, r) }
    if (runnerUp) { const u = rr.find((x) => x.driverId === runnerUp); if (u) ruWetPts += u.points }
  }
  const wetWinClause = wetWinGp ? `, including a crucial win at the ${wetWinGp}` : ''
  // Champion + runner-up headline stats for the shape lines (wins, podiums, longest consecutive win streak).
  const seasonStat = (id: string | null) => {
    let w = 0, pod = 0, streak = 0, cur = 0
    for (let r = 1; r <= analysis.completedRounds; r++) {
      const res = id ? (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === id) : undefined
      if (res?.finishPosition === 1) { w++; cur++; if (cur > streak) streak = cur } else cur = 0
      if (res?.finishPosition != null && res.finishPosition <= 3) pod++
    }
    return { w, pod, streak }
  }
  const champStat = seasonStat(champion)
  const ruStat = seasonStat(runnerUp)
  const finalStand = driverStandingsAfter(ctx, analysis.completedRounds)
  const thirdLast = finalStand[2] ? lastName(finalStand[2].driverName) : ''
  const slots: Record<string, string | number> = {
    year: ctx.year, champion: dn(champion), champion_last: lastName(dn(champion)),
    runner_up: runnerUp ? dn(runnerUp) : '', runner_up_last: runnerUp ? lastName(dn(runnerUp)) : '',
    runner_up_ref: runnerUpRef, champ_team: champTeam,
    peak_lead: peakLead, peak_round: peakRound, lead_erosion: leadErosion,
    peak_gp: peakRound ? circuit(ctx, peakRound) : '',
    single_digit_gp: sdRound ? circuit(ctx, sdRound) : '',
    champion_subj: champPron.they, champion_poss: champPron.their, champion_obj: champPron.them,
    runner_up_poss: pronouns(runnerUpDriver?.gender).their,
    champion_title_ordinal: championTitleOrdinal,
    champion_wins: champStat.w, champion_podiums: champStat.pod, win_streak: champStat.streak,
    total_races: analysis.completedRounds, runner_up_wins: ruStat.w, third_last: thirdLast,
    wet_races_str: `${wetRaces} ${plural(wetRaces, 'race')}`,
    champion_wet_points: champWetPts, runner_up_wet_points: ruWetPts, wet_win_clause: wetWinClause,
    early_leader: sm.earlyLeaderId ? dn(sm.earlyLeaderId) : '', early_leader_last: sm.earlyLeaderId ? lastName(dn(sm.earlyLeaderId)) : '',
    gap: t.currentGap, gap_pts: plural(t.currentGap, 'point'),
    constructor_champion: constructorChampion ? tn(constructorChampion) : '',
  }
  // Champion section + any combination modifiers (#88: teammate fight / late wobble / wet-aided run).
  let champSection = fill(pick(c[`champion${sm.shape}`], `${seed}|champ`), slots)
  // At most ONE champion modifier — don't double up same-category archetypes. Priority: late wobble, then wet.
  const mod = sm.lateWobble ? pick(c.champLateWobble, `${seed}|mlw`) : sm.wetAided ? pick(c.champWetAided, `${seed}|mwa`) : ''
  if (mod) champSection = `${champSection} ${fill(mod, slots)}`
  const sections: string[] = [champSection]
  // The runner-up's side of the title fight (#88).
  if (ruArc) {
    const fN = analysis.completedRounds
    const finalRes = ctx.raceResults[fN - 1] ?? []
    const finalWinner = finalRes.find((x) => x.finishPosition === 1)
    const finalOrd = (id: string | null) => {
      const r = id ? finalRes.find((x) => x.driverId === id) : undefined
      return r ? (r.dnf || r.finishPosition == null ? 'down the order' : ordinal(r.finishPosition)) : ''
    }
    const gbf = ruArc.gapBeforeFinal ?? ruArc.finalGap
    sections.push(fill(pick(c[`runnerUp${cap(ruArc.key)}`], `${seed}|ru`), {
      ...slots,
      peak_deficit: ruArc.peakDeficit, final_gap: ruArc.finalGap, late_wins: ruArc.lateWins,
      dnf_gp: ruArc.dnfRound ? circuit(ctx, ruArc.dnfRound) : '',
      gap_before_final: Math.max(0, gbf), led_by: Math.max(0, -gbf),
      final_race_gp: circuit(ctx, fN),
      final_winner_last: finalWinner ? lastName(ctx.drivers.find((d) => d.id === finalWinner.driverId)?.name ?? '') : '',
      champion_final_pos: finalOrd(champion), runner_up_final_pos: finalOrd(runnerUp),
    }))
  }
  // Constructors' title shape + the drivers-sealed-early modifier (#88).
  if (constructorChampion) {
    const consTitle = analysis.constructorTitle
    const consRunnerUp = consTitle.series[consTitle.series.length - 1]?.secondId ?? null
    const otherTeamId = cs.otherId ?? null // the wins-leader (WinsVsPoints) or the title rival (LeadTradedLate)
    // One pass over results: every team's points + wins, then the final constructors' order.
    const teamAgg = new Map<string, { points: number; wins: number }>()
    for (const tm of ctx.teams) teamAgg.set(tm.id, { points: 0, wins: 0 })
    for (let r = 1; r <= analysis.completedRounds; r++) for (const cc of ctx.raceResults[r - 1] ?? []) {
      const a = teamAgg.get(cc.teamId)
      if (a) { a.points += cc.points; if (cc.finishPosition === 1) a.wins++ }
    }
    const teamOrder = [...teamAgg.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.points - a.points)
    const aggOf = (id: string | null) => (id ? teamAgg.get(id) ?? { points: 0, wins: 0 } : { points: 0, wins: 0 })
    const consWins = aggOf(constructorChampion).wins
    const consPoints = aggOf(constructorChampion).points
    const consRunnerUpPoints = aggOf(consRunnerUp).points
    const consOtherWins = aggOf(otherTeamId).wins
    const consOtherPoints = aggOf(otherTeamId).points
    const otherPos = otherTeamId ? teamOrder.findIndex((x) => x.id === otherTeamId) + 1 : 0
    // The wins-leader's placing clause, used only when they were NOT the points runner-up (fast but unreliable).
    const consOtherExtra = otherTeamId && consRunnerUp && otherTeamId !== consRunnerUp
      ? ` ${tn(otherTeamId)} ended up ${ordinal(otherPos)} with ${consOtherPoints} ${plural(consOtherPoints, 'point')}.`
      : ''
    // Champion team's seats by season points (lead seat first) for the one-car-carried framing.
    const seatRows = ctx.drivers.filter((d) => d.teamId === constructorChampion).map((d) => {
      let points = 0, wins = 0, podiums = 0
      for (let r = 1; r <= analysis.completedRounds; r++) {
        const res = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === d.id)
        if (!res) continue
        points += res.points
        if (res.finishPosition === 1) wins++
        if (res.finishPosition != null && res.finishPosition <= 3) podiums++
      }
      return { id: d.id, name: d.name, points, wins, podiums }
    }).sort((a, b) => b.points - a.points)
    const lead = seatRows[0], other = seatRows[1]
    const cMax = constructorMaxPerRace(ctx.year)
    const consBeat = consTitle.currentGap <= cMax ? 'edged out' : consTitle.currentGap <= cMax * 3 ? 'saw off' : 'comfortably beat'
    // Consecutive constructors' titles ending this season (this year + unbroken prior P1 finishes in history).
    let consTitlesInRow = 1
    for (let y = ctx.year - 1; (ctx.constructorHistory ?? []).some((h) => h.seasonYear === y && h.teamId === constructorChampion && h.finalPosition === 1); y--) consTitlesInRow++
    const consTitleStreak = consTitlesInRow === 2 ? 'back-to-back titles' : `a ${ordinal(consTitlesInRow)} consecutive title`
    // When the drivers' title was sealed, for the drivers-sealed-early modifier copy.
    const dClinchRound = clinchRound(analysis.driverTitle.series, driverMaxPerRace(ctx.year), analysis.totalRounds)
    const driversClinchAgo = dClinchRound ? analysis.completedRounds - dClinchRound : 0
    const consSlots = {
      ...slots,
      cons_other: otherTeamId ? tn(otherTeamId) : '',
      cons_other_wins: consOtherWins, cons_other_points: consOtherPoints,
      cons_other_position: otherPos ? ordinal(otherPos) : '', cons_other_extra: consOtherExtra,
      cons_wins_gap: Math.max(0, consOtherWins - consWins),
      champ_driver1: lead ? lead.name : '', champ_driver2: other ? other.name : '',
      carried_driver: lead ? lead.name : '', carried_driver_last: lead ? lastName(lead.name) : '',
      carried_driver_points: lead?.points ?? 0,
      carried_driver_wins: lead?.wins ?? 0, carried_driver_wins_str: `${lead?.wins ?? 0} ${plural(lead?.wins ?? 0, 'win')}`,
      carried_driver_podiums: lead?.podiums ?? 0, carried_driver_podiums_str: `${lead?.podiums ?? 0} ${plural(lead?.podiums ?? 0, 'podium')}`,
      other_driver: other ? other.name : '', other_driver_last: other ? lastName(other.name) : '', other_driver_points: other?.points ?? 0,
      cons_wins: consWins, cons_races: analysis.completedRounds, cons_points: consPoints, cons_margin: consTitle.currentGap, cons_lead_changes: consTitle.leadChanges,
      cons_titles_in_row: consTitlesInRow, cons_title_streak: consTitleStreak,
      drivers_clinch_ago: driversClinchAgo, drivers_clinch_ago_str: `${driversClinchAgo} ${plural(driversClinchAgo, 'round')} ago`,
      drivers_clinch_gp: dClinchRound ? circuit(ctx, dClinchRound) : '',
      cons_runner_up: consRunnerUp ? tn(consRunnerUp) : '', cons_runner_up_points: consRunnerUpPoints,
      champ_team_drivers: listJoin(seatRows.map((r) => r.name)),
      cons_beat: consBeat,
    }
    let consSection = fill(pick(c[`cons${cs.shape}`], `${seed}|cons`), consSlots)
    if (cs.driversSealedEarly) consSection = `${consSection} ${fill(pick(c.consDriversSealedEarly, `${seed}|cse`), consSlots)}`
    sections.push(consSection)
  }
  // The season's standout team arc away from the title (#88: flop / dev surge / dev fade / dead seat).
  if (arc) {
    const arcExp = analysis.teamExpectations.get(arc.teamId)?.expectedRank
    const arcActual = analysis.teamDeltas.find((d) => d.id === arc.teamId)?.actualRank
    let arcPoints = 0
    for (let r = 1; r <= analysis.completedRounds; r++) for (const cc of ctx.raceResults[r - 1] ?? []) if (cc.teamId === arc.teamId) arcPoints += cc.points
    const finalStandings = driverStandingsAfter(ctx, analysis.completedRounds)
    const wdcPos = new Map(finalStandings.map((s, i) => [s.driverId, i + 1]))
    const driverPts = new Map(finalStandings.map((s) => [s.driverId, s.points]))
    const arcTeamDrivers = ctx.drivers.filter((d) => d.teamId === arc.teamId).map((d) => ({ name: d.name, pos: wdcPos.get(d.id) ?? 99 })).sort((a, b) => a.pos - b.pos)
    const ad1 = arcTeamDrivers[0], ad2 = arcTeamDrivers[1]
    const arcSlots = {
      ...slots, team: tn(arc.teamId),
      arc_driver: arc.driverId ? dn(arc.driverId) : '', arc_driver_last: arc.driverId ? lastName(dn(arc.driverId)) : '',
      arc_other: arc.otherId ? dn(arc.otherId) : '', arc_other_last: arc.otherId ? lastName(dn(arc.otherId)) : '',
      team_expected_pos: arcExp ? ordinal(arcExp) : '', team_final_pos: arcActual ? ordinal(arcActual) : '', team_points: arcPoints,
      early_phase_pos: arc.earlyRank ? ordinal(arc.earlyRank) : '', late_phase_pos: arc.lateRank ? ordinal(arc.lateRank) : '',
      arc_driver1: ad1?.name ?? '', arc_driver2: ad2?.name ?? '',
      arc_driver1_wdc: ad1 ? ordinal(ad1.pos) : '', arc_driver2_wdc: ad2 ? ordinal(ad2.pos) : '',
      arc_driver_points: arc.driverId ? (driverPts.get(arc.driverId) ?? 0) : 0,
      arc_other_points: arc.otherId ? (driverPts.get(arc.otherId) ?? 0) : 0,
    }
    sections.push(fill(pick(c[`teamArc${cap(arc.key)}`], `${seed}|tarc`), arcSlots))
  }
  // Driver over/under-performers are now the rich year-end expectation piece (expectationCheck at K=N), so the
  // review itself sticks to the title, constructors, and the standout team arc — no vague one-liners here.
  // Biggest over/under-performing team vs its projection, grounded in projected vs final constructors' position
  // and points. Skipped when it is the same team the standout team-arc already covered (no double-mention).
  const teamStat = (id: string) => {
    const d = analysis.teamDeltas.find((x) => x.id === id)
    return { ...slots, team: tn(id), team_expected_pos: d ? ordinal(d.expectedRank) : '', team_final_pos: d ? ordinal(d.actualRank) : '', team_points: teamPointsOf(id) }
  }
  if (teamOver && teamOver !== arc?.teamId) sections.push(fill(pick(c.teamOver, `${seed}|tover`), teamStat(teamOver)))
  if (teamUnder && teamUnder !== arc?.teamId) sections.push(fill(pick(c.teamUnder, `${seed}|tunder`), teamStat(teamUnder)))
  return [{
    id: seed, category: 'feature', round: ctx.completedRounds, priority: 88, dayOffset: 0,
    headline: fill(pick(c.headline, `${seed}|h`), slots),
    dek: fill(pick(c.dek, `${seed}|d`), slots),
    body: paras(...sections),
  }]
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
  else if (gain >= 6 && mover && getPoints(mover.finishPosition ?? 99, ctx.year) > 0) pool = ['{mover} was the standout last time, charging from {mover_from} to {mover_to} and into the points, and will want more of the same.', 'Few impressed like {mover} at the {prev_circuit}, up from {mover_from} to a points finish in {mover_to}.']
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
    const availLeft = remaining * driverMaxPerRace(ctx.year)
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
// last-season reference using {art} {last_pos} WHEN one exists. A team with no prior result on record (the
// replay's first archived year, or a genuine newcomer) gets no reference line at all — we never narrate the
// absence of a benchmark. Pools are deliberately large so the no-repeat picker gives every car a distinct line.
const LAUNCH_COPY: {
  line: string[]; refPos: string[]
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
        '{lead} and {others} other {others_word} with genuine title intentions have launched their {year} cars within days of one another, compressing the field\'s design philosophies into a single revealing week.',
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
        '{lead} heads a group of {n} midfield {teams_word} into the open, each convinced its winter work has found time in the middle of the pack.',
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

// The season preview (#88): introduces the season's protagonists across tiers from the media-projection
// expectation model (season-analysis), replacing the old pace-only preview blurb. Forward-looking, round 0.
// Copy is Sonnet-authored (season-preview-copy.json); this only resolves the cast to name slots and assembles
// the non-empty sections. The reigning champion's stature is always credited; every new team is named.
function seasonPreview(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.teams.length === 0 || ctx.completedRounds > 0) return []
  const analysis = buildSeasonAnalysis(ctx)
  const cast = previewCast(ctx, analysis)
  const c = seasonPreviewCopy
  const seed = `season-preview-${ctx.year}`
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const champion = cast.reigningChampion ? dn(cast.reigningChampion) : ''
  const topExpected = [...analysis.driverExpectations.values()].sort((a, b) => a.expectedRank - b.expectedRank)[0]?.driverId
  const topFavId = cast.titleFavourites[0] ?? topExpected
  // When the reigning champion is also the top favourite, {fav} becomes the leading CHALLENGER (so the
  // headline doesn't name the same driver twice); otherwise {fav} is the top favourite itself.
  const championIsTopFav = !!cast.reigningChampion && topFavId === cast.reigningChampion
  const challengerId = cast.titleFavourites.find((id) => id !== cast.reigningChampion) ?? topExpected
  const fav = dn((championIsTopFav ? challengerId : topFavId) ?? '')
  const slots = { year: ctx.year, fav, champion, constructor: cast.reigningConstructor ? teamName(ctx, cast.reigningConstructor) : '' }

  // Data-driven cast facts: every descriptor below is a real career/market figure, so the copy tracks the
  // world rather than asserting a hardcoded label. Missing data degrades to the plainest TRUE label.
  const draftBy = new Map((ctx.draft ?? []).map((p) => [p.driverId, p]))
  const facts = (id: string) => {
    const d = ctx.drivers.find((x) => x.id === id)
    const car = ctx.careers?.[id]
    const team = teamName(ctx, d?.teamId ?? '')
    const prev = draftBy.get(id)?.prevTeamName ?? ''
    return {
      name: d?.name ?? id, team,
      titles: car?.titles ?? 0, wins: car?.wins ?? 0, starts: car?.starts ?? 0, seasons: car?.seasons ?? 0, age: d?.age ?? 0,
      rookie: (car?.starts ?? 0) === 0,
      veteran: (car?.seasons ?? 0) >= 4,
      fromTeam: prev && prev !== team ? prev : '', // prior team from the Signing Day draft ('' = pool/rookie/stayer)
    }
  }
  type Facts = ReturnType<typeof facts>
  // Favourite / dark-horse name: car always, plus the strongest career mark (champion > race-winner).
  const favTag = (f: Facts) => (f.titles >= 2 ? `, ${f.titles}-time champion` : f.titles === 1 ? ', former champion' : f.wins > 0 ? ', race-winner' : '')
  const favName = (f: Facts) => `${f.name} (${f.team}${favTag(f)})`
  // Veteran name: age (always real, the defining veteran fact) plus the headline achievement when one
  // exists. Never cites starts/seasons — in an early save those are near-zero and read as misleading.
  const vetTag = (f: Facts, ageSeen: boolean) => {
    const ach = f.titles >= 1 ? `${f.titles}-time champion` : f.wins > 0 ? `${f.wins} career ${plural(f.wins, 'win')}` : ''
    return `${ageSeen ? `also ${f.age}` : `age ${f.age}`}${ach ? `, ${ach}` : ''}`
  }
  // A veteran name list that collapses a repeated age to "also N", so two same-age veterans in one
  // sentence don't both read "age 37".
  const vetNames = (vs: typeof cast.veterans): string[] => {
    const seen = new Set<number>()
    return vs.map((v) => {
      const f = facts(v.driverId)
      const out = `${f.name} (${vetTag(f, seen.has(f.age))})`
      seen.add(f.age)
      return out
    })
  }
  // New-team driver: strongest framing — champion, then where they were signed from, then veteran/rookie.
  const ntPhrase = (f: Facts) =>
    f.titles >= 2 ? `${f.titles}-time champion ${f.name}`
    : f.titles === 1 ? `former champion ${f.name}`
    : f.fromTeam ? `ex-${f.fromTeam} driver ${f.name}`
    : f.veteran ? `veteran ${f.name}`
    : f.wins > 0 ? `race-winner ${f.name}`
    : f.starts > 0 ? `the experienced ${f.name}`
    : `rookie ${f.name}`

  const sections: string[] = []
  if (champion) sections.push(fill(pick(c.reigning, `${seed}|reign`), slots))
  if (cast.titleFavourites.length) sections.push(fill(pick(c.favourites, `${seed}|fav`), { ...slots, names: listJoin(cast.titleFavourites.map((id) => favName(facts(id)))) }))
  if (cast.darkHorses.length) sections.push(fill(pick(c.darkHorses, `${seed}|dh`), { ...slots, names: listJoin(cast.darkHorses.map((id) => favName(facts(id)))) }))
  if (cast.bestOfRest.length) sections.push(fill(pick(c.bestOfRest, `${seed}|bor`), { ...slots, teams: listJoin(cast.bestOfRest.map((id) => teamName(ctx, id))) }))
  const resurgent = vetNames(cast.veterans.filter((v) => v.kind === 'resurgent'))
  const twilight = vetNames(cast.veterans.filter((v) => v.kind === 'twilight'))
  if (resurgent.length) sections.push(fill(pick(c.veteransResurgent, `${seed}|vr`), { ...slots, names: listJoin(resurgent) }))
  if (twilight.length) sections.push(fill(pick(c.veteransTwilight, `${seed}|vt`), { ...slots, names: listJoin(twilight) }))
  if (cast.rookies.length) sections.push(fill(pick(c.rookies, `${seed}|rk`), { ...slots, names: listJoin(cast.rookies.map(dn)) }))
  if (cast.newTeams.length) {
    if (cast.newTeams.length >= ctx.teams.length) {
      // Whole grid is new (first season of a save, no constructor history) — one line, not a bio per team.
      sections.push(fill(pick(c.newTeams.allNew, `${seed}|nt-all`), slots))
    } else {
      const ntLine = (tid: string, i: number): string => {
        const team = teamName(ctx, tid)
        const ds = ctx.drivers.filter((d) => d.teamId === tid).map((d) => facts(d.id))
        const anchors = ds.filter((f) => !f.rookie)
        const rookies = ds.filter((f) => f.rookie)
        const base = { ...slots, team }
        if (anchors.length && rookies.length) return fill(pick(c.newTeams.anchorAndRookie, `${seed}|nt${i}`), { ...base, anchors: listJoin(anchors.map(ntPhrase)), rookies: listJoin(rookies.map(ntPhrase)) })
        if (anchors.length) return fill(pick(c.newTeams.anchorLed, `${seed}|nt${i}`), { ...base, anchors: listJoin(anchors.map(ntPhrase)) })
        return fill(pick(c.newTeams.allRookie, `${seed}|nt${i}`), { ...base, names: listJoin(ds.map((f) => f.name)) })
      }
      const shown = cast.newTeams.slice(0, 3)
      let text = shown.map((tid, i) => ntLine(tid, i)).join(' ')
      const extra = cast.newTeams.slice(3)
      if (extra.length) text += ` ${listJoin(extra.map((id) => teamName(ctx, id)))} also join the grid for the first time.`
      sections.push(text)
    }
  }

  const hArr = !champion ? c.headlineNoChamp : championIsTopFav ? c.headlineDefendingFav : c.headline
  const dArr = !champion ? c.dekNoChamp : championIsTopFav ? c.dekDefendingFav : c.dek
  const headline = fill(pick(hArr, `${seed}|h`), slots)
  const dek = fill(pick(dArr, `${seed}|d`), slots)
  const body = paras(fill(pick(c.intro, `${seed}|intro`), slots), ...sections)
  return [{ id: seed, category: 'preview_schedule', round: 0, priority: 85, headline, dek, body }]
}

function preSeason(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
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
      const lslots = { year: lyear, lead: group[0]?.name ?? '', n: group.length, teams_word: plural(group.length, 'team'), others: group.length - 1, others_word: plural(group.length - 1, 'team') }
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
        // No prior constructors result (the replay's first archived year, or a genuine newcomer): just describe
        // the car. Never narrate the ABSENCE of a benchmark — if there's no result, there's no sentence (#88).
        const ref = lastPos ? fill(pickUnique(LAUNCH_COPY.refPos, `${tseed}|ref`, usedRef), ts) : ''
        return ref ? `${line} ${ref}` : line
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
function teamTransitionSlots(ctx: NewsContext, teamId: string, extra: Record<string, string | number>): Record<string, string | number> {
  const year = ctx.year
  const next = year + 1
  const ch = ctx.nextSeasonChanges
  const gridCount = ctx.teams.length - (ch?.removals.length ?? 0) + (ch?.additions.length ?? 0)
  const w = (n: number, s: string, p: string) => (n === 1 ? s : p)

  const tc = ctx.teamCareers?.[teamId]
  const wins = tc?.wins ?? 0, podiums = tc?.podiums ?? 0, poles = tc?.poles ?? 0, points = tc?.points ?? 0
  // The article lands mid-season, so the record reads "through the season so far": wins/podiums/points
  // fold in the in-progress year and the season count includes it, but best-finish/titles use only
  // completed seasons (this year's standing isn't settled yet).
  const seasons = (tc?.seasons ?? 0) + (ctx.live ? 1 : 0)
  const bestFinish = tc?.bestConstructorsFinish != null ? ordinal(tc.bestConstructorsFinish) : 'the midfield'
  const titles = tc?.constructorTitles ?? 0

  // Current drivers (for {last_driver} + the seatless count): they go to the market when the team goes.
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
  const ch = ctx.nextSeasonChanges
  if (!ch) return []
  const out: NewsArticle[] = []
  const next = ctx.year + 1
  // Decided at the season's start, announced ~4/5 of the way through it; the change takes effect next year.
  const r = Math.max(1, Math.round((ctx.calendar.length * 4) / 5))
  if (ctx.completedRounds < r) return [] // not reached yet (live); archived seasons are complete

  for (const rb of ch.rebrands) {
    const key = `rebrand-${rb.teamId}-${next}`
    const slots = teamTransitionSlots(ctx, rb.teamId, { kind: 'rebrand', team: rb.toName, team_old: rb.fromName, team_new: rb.toName })
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
  if (ch.additions.length >= 3 && TEAMNEWS[ggKey]) {
    out.push(renderTeamArticle(ggKey, 'team_entry', r, 74, TEAMNEWS[ggKey], teamTransitionSlots(ctx, '', { kind: 'grid' })))
  }
  for (const add of ch.additions) {
    const key = `arrival-${add.teamId}-${next}`
    const copy = TEAMNEWS[key]
    if (!copy) continue // generic team_entry handled in market()
    out.push(renderTeamArticle(key, 'team_entry', r, 70, copy, teamTransitionSlots(ctx, add.teamId, { kind: 'arrival', team: add.teamName })))
  }
  for (const rem of ch.removals) {
    const key = `departure-${rem.teamId}-${ctx.year}`
    const copy = TEAMNEWS[key]
    if (!copy) continue // generic team_exit handled in market()
    out.push(renderTeamArticle(key, 'team_exit', r, 68, copy, teamTransitionSlots(ctx, rem.teamId, { kind: 'departure', team: rem.teamName })))
  }
  return out
}

// Driver-arc retrospectives (#88): the season's individual stories — an overachiever dragging a lesser car
// to podiums, a preseason pick who flopped, a fast start that deflated, a rookie beating a veteran teammate,
// a rookie podium, a late-career resurgence. End-of-season, sparse (top 3 most newsworthy across the grid).
function driverArc(ctx: NewsContext): NewsArticle[] {
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
function teammateBattle(ctx: NewsContext): NewsArticle[] {
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
function crossTeamDuel(ctx: NewsContext): NewsArticle[] {
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
function bestOfRest(ctx: NewsContext): NewsArticle[] {
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
function backmarker(ctx: NewsContext): NewsArticle[] {
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

// Expectation-vs-actual checkpoint (#88): ~twice a season (one-third, two-thirds), who is running above or
// below their PRESEASON projection — drivers and teams. Compares the season-analysis preseason expectation
// (round-independent) against the actual standings AT that checkpoint round. Supersedes the analysis
// producer's form-slump/surge and team-vs-car-pace angles. Live only (needs the expectation basis).
function expectationCheck(ctx: NewsContext): NewsArticle[] {
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

// Free-agent spotlight windows, weighted to the season's end: the last `tail` rounds are covered every
// round (consistent late coverage) and the gap between earlier windows grows by one each step (sparser
// early). Generated from the season length, so it stays robust across era-accurate calendars (#64)
// instead of hardcoding a 24-round schedule. e.g. 24 rounds -> [2,8,13,17,20,22,23,24]; 16 -> [5,9,12,14,15,16].
function driverWatchWindows(totalRounds: number, tail = 3, maxWindows = 8): number[] {
  const rounds: number[] = []
  let r = totalRounds
  let gap = 1
  for (let step = 0; r >= 1 && rounds.length < maxWindows; step++) {
    rounds.push(r)
    if (step + 1 >= tail) gap++ // past the every-round tail, widen the gap each window going earlier
    r -= gap
  }
  return rounds.reverse()
}

function driverToWatch(ctx: NewsContext): NewsArticle[] {
  // Fires on an end-weighted window schedule; like silly-season it belongs in the season's permanent
  // record (don't gate on endOfSeason or the retrospective loses the market narrative).
  if (!ctx.live) return []
  const freeAgents = ctx.drivers.filter((d) => d.teamId === '')
  if (freeAgents.length === 0 || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
  const ROUNDS = driverWatchWindows(ctx.calendar.length)
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
  // Forward-looking previews (title-scenario clinch/finale pieces, `a.preview`) share the
  // championship_state category with the post-race "champion crowned" reaction, but must drop in their
  // round's race WEEK, BEFORE that race — not at the +1 post-race offset, which fired them a round late,
  // after the very race they previewed (same date-driven-interrupt class as #53). Reactions keep their offset.
  const offset = a.preview ? -4 : (a.dayOffset ?? CATEGORY_DAY_OFFSET[a.category] ?? 0)
  const raw = addDays(raceDayOf(ctx, anchor), offset)
  // The day offset is cosmetic intra-round ordering only — it must NOT push a story past its round's
  // NEXT race, or the date-driven Continue-loop interrupt (continue-loop.ts) fires a round or more late
  // and disagrees with the round the newsroom buckets it under (issue #53; e.g. team_* at +21 days on a
  // mid-season round 19 would otherwise land past rounds 20-21). Clamp an in-season story to the eve of
  // its next race; off-season stories (round > n) anchor to the finale and have no next race to cross.
  if (a.round < n) {
    const nextRaceEve = addDays(raceDayOf(ctx, a.round + 1), -1)
    if (raw.getTime() > nextRaceEve.getTime()) return toISODate(nextRaceEve)
  }
  return toISODate(raw)
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

// ---- Driver-market journalism: a contract watch, a renewals round-up, and an off-season
// retrospective. All three are fed by the store's market beats (ctx.contractWatch / renewals / draft);
// they only run on the live context (archived seasons replay the snapshot taken when these were live).
// The watch / renewal rounds are placed proportionally per season (marketWatchRound / marketRenewalRound),
// matching the store exactly so each article's date lands on the round its mechanic actually ran.

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
function contractWatchFeature(ctx: NewsContext): NewsArticle[] {
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
function renewalsFeature(ctx: NewsContext): NewsArticle[] {
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
function offSeasonFeature(ctx: NewsContext): NewsArticle[] {
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

export function generateNews(ctx: NewsContext): NewsArticle[] {
  const all = [
    ...seasonPreview(ctx),
    ...preSeason(ctx),
    ...raceReports(ctx),
    ...milestones(ctx),
    ...technicalRoundup(ctx),
    ...championship(ctx),
    ...championshipArc(ctx),
    ...constructorArc(ctx),
    ...seasonReview(ctx),
    ...driverArc(ctx),
    ...teammateBattle(ctx),
    ...crossTeamDuel(ctx),
    ...bestOfRest(ctx),
    ...backmarker(ctx),
    ...expectationCheck(ctx),
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
  // de-dupe by id, then order the feed STRICTLY BY DATE (newest first), with priority as the within-day
  // tiebreak (#116). Round+priority put a same-round preview (which drops pre-race) above the race report
  // and technical pieces that actually follow it in time; date order fixes that.
  const seen = new Set<string>()
  const deduped = all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
  const dated = deduped.map((a) => ({ ...a, date: articleDate(ctx, a) }))
  dated.sort((a, b) => b.date.localeCompare(a.date) || (b.priority - a.priority) || a.id.localeCompare(b.id))
  // Tag the surviving stories with the entities they mention (for the Continue loop's name-follow
  // interruption and consistent hyperlinking).
  const matcher = buildEntityMatcher(ctx)
  return dated.slice(0, 400).map((a) => ({ ...a, entities: entitiesFor(ctx, a, matcher) }))
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
