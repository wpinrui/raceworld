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
//  - championship_state: only the clinch moments + a late-season title-fight watch.
//  - feature          : a long state-of-the-season read at half-distance + a season review.
//  - silly_season     : only at three points (mid / three-quarter / penultimate round), and the
//                       rumours are produced by actually running the market sim with a seeded
//                       -10..+10 error on each driver's media rating.
//  - analysis_opinion : expectation checkpoints (~twice a season, over/under preseason billing) plus the
//                       end-of-season teammate-battle verdicts. (The old single-per-round opinion column was removed.)

import type {
  Driver, Team, RaceResult, DevUpgradeEvent, TeamDevPlan, PreSeasonTest,
  EndOfSeasonSummary, Circuit, SeasonPhase, ConstructorSeasonRecord,
} from '@/lib/sim/types'
import { championshipArc, constructorArc } from './championship-arc'
import { driverArc, teammateBattle, crossTeamDuel, bestOfRest, backmarker } from './season-features'
import { contractWatchFeature, renewalsFeature, offSeasonFeature } from './market-features'
import { championship } from './championship'
import { raceReports } from './race-reports'
import { seasonReview } from './season-review'
import { titleScenario } from './title-scenario'
import { milestones } from './milestones'
import { recordNews } from './record-news'
import { legends } from './legends'
import { driverToWatch } from './driver-to-watch'
import { midSeasonSwaps } from './mid-season-swaps'
import { expectationCheck } from './expectation-check'
import { teamTransitions } from './team-transitions'
import { seasonPreview } from './season-preview'
import { preSeason } from './pre-season'
import { previews } from './previews'
import { market } from './market'
import { preSeasonTesting } from './pre-season-testing'
import type { RenewalResult, DraftPick, ContractWatch } from '@/lib/sim/driver-market'
import { lastName } from './util'
import { raceDate, toISODate, addDays } from '@/lib/sim/calendar-dates'

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

// "Remember this driver?" legends series (#93). One retired driver's career, assembled SERVER-SIDE
// from the archive (it spans per-race / per-season / all-time queries the client cannot run), so the
// engine producer only renders prose from these facts. A driver is eligible once retired — i.e. their
// last season raced is RETIREMENT_SEASONS_OUT years behind the context year. See buildLegendData.
export interface LegendProfile {
  driverId: string
  name: string
  gender: string                 // for gendered pronouns; resolved server-side (history data / live capture)
  teams: string[]                // distinct teams driven for, most-raced first
  firstYear: number
  lastYear: number               // last season raced
  seasons: number
  starts: number
  wins: number
  podiums: number
  poles: number
  points: number
  titles: number
  titleYears: number[]
  bestSeason?: { year: number; team: string; wins: number; points: number; wccPos: number | null }
  signatureWin?: { year: number; circuit: string; fromGrid: number }  // a standout win (biggest grid-to-win charge)
  runnerUpYears: number[]        // seasons finished championship runner-up — the near-misses
  teammateH2H?: { teammate: string; years: string; qualWins: number; qualLosses: number; raceWins: number; raceLosses: number }
  successor?: { name: string; wins: number; titles: number }  // who took their last seat, and what they made of it
  rivals: { name: string; relation: 'teammate' | 'title' | 'peer'; titles: number; wins: number }[]
  allTimeRank: { metric: 'wins' | 'podiums' | 'points' | 'titles'; rank: number; value: number } | null  // best all-time standing
  allTimeRanks: Record<'wins' | 'poles' | 'podiums' | 'points', { rank: number; value: number } | null>  // per-metric, for the conclusion
  peak: { wdc: number; year: number; team: string; teamWcc: number | null } | null  // best championship finish + car level
  lastSeason: { year: number; team: string; wdc: number | null; teamWcc: number | null; wins: number; replacedBy: string | null; tm: { name: string; qual: string; race: string; beaten: boolean } | null } | null
  marqueeRival: { name: string; kind: 'title' | 'teammate' | 'peer'; detail: string } | null  // the rival that matters most, + why
}
export interface LegendFeature { driverId: string; date: string; profile: LegendProfile }  // date = the 4-month-grid slot
export interface LegendDataset { features: LegendFeature[] }

export interface NewsContext {
  year: number
  saveSeed?: string                // per-save seed (live only); seeds the preview's race conditions to match the race
  phase: SeasonPhase
  completedRounds: number          // raceResults.length
  drivers: Driver[]                // full roster incl. free agents (teamId === '')
  teams: Team[]
  raceResults: RaceResult[][]      // [round-1]
  upgradeEvents: DevUpgradeEvent[]
  devPlans?: TeamDevPlan[]         // pending dev plans (next upgrade round + pre-rolled outcome), for the
                                   // forward-looking upgrade beat in the preview. Live only — absent on archives.
  preSeasonTest?: PreSeasonTest | null // this season's pre-season test result, for the dated testing recap (#126). Live only.
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
  legends?: LegendDataset   // this year's "remember this driver?" features (#93), assembled server-side. Optional —
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
  // An exact ISO drop date, bypassing the round + offset derivation entirely. Used by the legends series
  // (#93), whose 4-month cadence is independent of the race calendar. See articleDate.
  absoluteDate?: string
}

// --- Safe-detail helpers: every value below is an observable fact (results, fixed circuit
// metadata, nationality) or a count derived from results, so it can never contradict the game.

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

// --- Article dating + entity tagging (applied centrally so per-producer literals stay terse) ---

// Days a category's story drops relative to its round's race day (negative = before the race).
const CATEGORY_DAY_OFFSET: Record<string, number> = {
  preview_schedule: -4,   // race-week preview
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
  legends: 0,             // unused in practice — legends carry an absoluteDate (their 4-month-grid slot)
}

function raceDayOf(ctx: NewsContext, round: number): Date {
  const c = ctx.calendar[round - 1]
  return c ? raceDate(ctx.year, c) : new Date(Date.UTC(ctx.year, 5, 1)) // archived fallback (cosmetic)
}

// The date a story drops (ISO). Pre-season (round 0) anchors ~2 weeks before the opener; the
// off-season (round > N) anchors to the finale; in-season rounds to their race day + offset.
function articleDate(ctx: NewsContext, a: NewsArticle): string {
  const n = ctx.calendar.length
  // Legends (#93) are scheduled on an absolute 4-month grid that does not align to any round, so they
  // carry their own date; use it verbatim rather than deriving from a round + offset.
  if (a.absoluteDate) return a.absoluteDate
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

// ---- Driver-market journalism: a contract watch, a renewals round-up, and an off-season
// retrospective. All three are fed by the store's market beats (ctx.contractWatch / renewals / draft);
// they only run on the live context (archived seasons replay the snapshot taken when these were live).

export function generateNews(ctx: NewsContext): NewsArticle[] {
  const all = [
    ...seasonPreview(ctx),
    ...preSeasonTesting(ctx),
    ...preSeason(ctx),
    ...raceReports(ctx),
    ...milestones(ctx),
    ...championship(ctx),
    ...titleScenario(ctx),
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
    ...legends(ctx),
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
  race_report: 'Race report', milestone: 'Milestone',
  championship_state: 'Championship', feature: 'Feature', preview_schedule: 'Preview',
  car_launch_livery: 'Launch', rookie_debut: 'Rookie', driver_signing: 'Transfer',
  driver_exit: 'Transfer', career_retirement: 'Retirement', silly_season: 'Silly season',
  analysis_opinion: 'Analysis', driver_to_watch: 'Driver watch',
  team_entry: 'New team', team_exit: 'Team exit', team_rebrand: 'Rebrand', mid_season_swap: 'Driver change',
  record: 'Record', legends: 'Legends',
}

// The complete, ordered filter taxonomy. The page renders one chip per entry (always, so
// the legend is stable), disabling those with no article in the selected season. A chip can
// cover several categories (e.g. both transfer sides share one "Transfer" chip).
export const NEWS_FILTERS: { label: string; categories: string[] }[] = [
  { label: 'Race report', categories: ['race_report'] },
  { label: 'Milestone', categories: ['milestone'] },
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
  { label: 'Legends', categories: ['legends'] },
]
