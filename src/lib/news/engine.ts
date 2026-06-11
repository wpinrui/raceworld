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
import { driverMaxPerRace, constructorMaxPerRace, getPoints } from '@/lib/sim/points'
import { driverStandingsAfter, constructorStandingsAfter, recentFinishesUpTo } from './news-standings'
import { sortedResults, marginWord, poleMargin, strategyPhrase, startingTyre } from './result-format'
import { wonBefore, isHomeRace, winsUpTo } from './season-history'
import { teamName, circuit, CIRCUIT_TRAITS, careerOf } from './lookups'
import { paras, poss, wxHeadlineBucket, texture } from './copy'
import { championshipArc, constructorArc } from './championship-arc'
import { driverArc, teammateBattle, crossTeamDuel, bestOfRest, backmarker } from './season-features'
import { contractWatchFeature, renewalsFeature, offSeasonFeature } from './market-features'
import { championship } from './championship'
import { titleScenario } from './title-scenario'
import { milestones } from './milestones'
import { recordNews } from './record-news'
import { legends } from './legends'
import { driverToWatch } from './driver-to-watch'
import { midSeasonSwaps } from './mid-season-swaps'
import { expectationCheck } from './expectation-check'
import { teamTransitions } from './team-transitions'
import { TEAMNEWS } from './team-news'
import { seasonPreview } from './season-preview'
import { preSeason } from './pre-season'
import { preSeasonTesting } from './pre-season-testing'
import { raceConditions } from '@/lib/sim/race-conditions'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import type { RenewalResult, DraftPick, ContractWatch } from '@/lib/sim/driver-market'
import { pick, chance, fill, ordinal, lastName, listJoin, plural, compose, pronouns } from './util'
import { raceDate, toISODate, addDays } from '@/lib/sim/calendar-dates'
import { buildSeasonAnalysis, previewCast } from './season-analysis'
import seasonReviewCopy from './season-review-copy.json'
import wxCopy from './weather-report-copy.json'
import { championshipShape, constructorShape, teamArcs, runnerUpArc, clinchRound } from './archetypes'

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
    // First half of the calendar: frame by how far INTO the season we are; second half: how much is LEFT.
    const progress = r <= N / 2 ? `, ${r} ${plural(r, 'race')} into the season` : ` with ${remaining} ${plural(remaining, 'race')} remaining`
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
          'The win was built on {strategy} from {start_tyre}, with {winner_last} making the pit calls the rivals could not replicate.',
          '{team} committed to {strategy} on {start_tyre} from the outset and {winner_last} drove it to perfection.',
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
        let clinchR = 0
        for (let k = 1; k < r; k++) {
          const st = driverStandingsAfter(ctx, k)
          if (st.length >= 2 && N - k > 0 && st[0].points - st[1].points > (N - k) * driverMaxPerRace(ctx.year)) { clinchR = k; break }
        }
        const clinchPhrase = clinchR ? `at the ${circuit(ctx, clinchR)}${clinchR === r - 1 ? ' last weekend' : ''}` : 'earlier this season'
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
        return `${ld}'s ${raceFin(leader.driverId).noun} ${verb} ${prL.them} into the championship lead${from}. ${prL.they_cap} now leads ${sd}, who ${raceFin(second.driverId).verb}, by ${leadGap} ${gapPts}${progress}.`
      }
      // Same leader, but a new name has climbed into second: frame it as entering the conversation.
      const prevSecondId = afterPrev[1]?.driverId
      if (prevSecondId && prevSecondId !== second.driverId) {
        const climbed = priorRankOf(second.driverId)
        const prS = pronouns(ctx.drivers.find((d) => d.id === second.driverId)?.gender)
        const from = climbed >= 3 ? `, up from ${ordinal(climbed)} before the ${circuitName}` : ''
        return `${sd}'s ${raceFin(second.driverId).noun} lifts ${prS.them} into championship contention${from}. ${prS.they_cap} now sits ${leadGap} ${gapPts} behind ${ld}${progress}.`
      }
      // Same top two: how did the gap move this race, and why?
      const leaderRacePts = results.find((x) => x.driverId === leader.driverId)?.points ?? 0
      const secondRacePts = results.find((x) => x.driverId === second.driverId)?.points ?? 0
      const raceSwing = leaderRacePts - secondRacePts
      const prevGap = leadGap - raceSwing
      if (Math.abs(raceSwing) >= 4) {
        return `${sd}'s ${raceFin(second.driverId).noun} and ${ld}'s ${raceFin(leader.driverId).noun} ${raceSwing < 0 ? 'cut' : 'stretched'} the title gap from ${prevGap} to ${leadGap} ${gapPts}, ${ld} leading ${sd}${progress}.`
      }
      const moved = raceSwing !== 0 ? `, ${raceSwing < 0 ? 'down' : 'up'} from ${prevGap}` : ''
      return `${ld} leads ${sd} by ${leadGap} ${gapPts}${moved}${progress}.`
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
// One form talking point from last time out, framed against CAR expectation (#88 preview spec):
// either a standout who did well and might keep it going, OR (never both) a driver/team who fell
// short and must turn it around. Omitted entirely when everyone ran roughly to their machinery.
// Car pace as it stood GOING INTO `round`: the current pace rolled back over every upgrade delivered
// at that round or later. A stable quantity (later upgrades cancel out), so any preview built from it
// reads identically however much the season has since moved on — news that never silently mutates.
function carPaceBeforeRound(ctx: NewsContext, round: number): Map<string, number> {
  const m = new Map(ctx.teams.map((t) => [t.id, t.carPace]))
  for (const e of ctx.upgradeEvents ?? []) {
    if (e.round >= round && !e.failed) m.set(e.teamId, (m.get(e.teamId) ?? 0) - e.paceDelta)
  }
  return m
}

function previewTalkingPoint(ctx: NewsContext, r: number, seed: string): string {
  const prev = r - 1
  if (prev < 1 || prev > ctx.raceResults.length) return ''
  const results = ctx.raceResults[prev - 1] ?? []
  if (results.length === 0) return ''
  const standings = driverStandingsAfter(ctx, prev)   // championship going into round r
  const prevCircuit = circuit(ctx, prev)
  const winner = results.find((x) => x.finishPosition === 1)

  // Sharpest "did well, can it continue" hooks, named outright and outranking the form read: a win
  // streak, or a maiden win of the season.
  let streak = 0
  if (winner) for (let k = prev; k >= 1; k--) { const w = (ctx.raceResults[k - 1] ?? []).find((x) => x.finishPosition === 1); if (w && w.driverId === winner.driverId) streak++; else break }
  const maiden = !!winner && prev >= 2 && !wonBefore(ctx, winner.driverId, prev)
  if (winner && (streak >= 2 || maiden)) {
    const wslots = { prev_circuit: prevCircuit, streak, w: lastName(winner.driverName) }
    const wpool = streak >= 2
      ? ['{w} arrives on a {streak}-race winning streak, and nobody has found an answer.', 'The question is whether anyone can halt {w}, winner of the last {streak}.']
      : ['{w} arrives fresh off a maiden win of the season at the {prev_circuit}.', 'Confidence will be sky-high in the {w} camp after a breakthrough win last time out.']
    return fill(pick(wpool, `${seed}|tp`), wslots)
  }

  // Form vs car: a seated driver's expected finishing slot is their rank when the whole field is
  // ordered by car pace. Last race's finish minus that slot says who beat their machinery (kept it
  // up) and who fell short of it (needs a turnaround). A DNF counts as finishing last + 1.
  // Car pace as it stood for the LAST race (round prev): upgrades are live from the round they're
  // delivered, so round prev's pace INCLUDES round-prev's upgrade — hence carPaceBeforeRound(prev + 1).
  const paceBefore = carPaceBeforeRound(ctx, prev + 1)
  const carPaceOf = (teamId: string) => paceBefore.get(teamId) ?? 0
  const seated = ctx.drivers.filter((d) => d.teamId)
  const fieldSize = seated.length || results.length
  const expSlot = new Map<string, number>([...seated].sort((a, b) => carPaceOf(b.teamId) - carPaceOf(a.teamId)).map((d, i) => [d.id, i + 1]))
  const teamPaceRank = new Map<string, number>([...ctx.teams].sort((a, b) => carPaceOf(b.id) - carPaceOf(a.id)).map((t, i) => [t.id, i + 1]))
  const champPos = new Map<string, number>(standings.map((s, i) => [s.driverId, i + 1]))
  const half = Math.ceil(fieldSize / 2)
  const topCut = Math.max(5, Math.ceil(fieldSize / 3))   // "high in the championship"
  const exp = (id: string) => expSlot.get(id) ?? fieldSize
  const finSlot = (x: RaceResult) => (x.dnf || x.finishPosition == null ? fieldSize + 1 : x.finishPosition)
  const dev = (x: RaceResult) => exp(x.driverId) - finSlot(x)            // + beat the car, - fell short
  const scored = (x: RaceResult) => getPoints(x.finishPosition ?? 99, ctx.year) > 0

  // Turnaround: a title-relevant driver (high in the championship, or a genuine front car) who fell
  // well short of that car last time — a retirement, or a finish well below where the car belongs.
  let turn: RaceResult | null = null; let turnStr = 0
  for (const x of results) {
    const high = (champPos.get(x.driverId) ?? fieldSize) <= topCut || exp(x.driverId) <= 6
    if (!high) continue
    const shortfall = x.dnf ? (fieldSize - exp(x.driverId)) + 4 : -dev(x)
    const fellShort = x.dnf || (!scored(x) && exp(x.driverId) <= half) || dev(x) <= -4
    if (fellShort && shortfall > turnStr) { turn = x; turnStr = shortfall }
  }

  // Keep-it-up: a driver low in the championship who dragged a slower car into the points, or
  // otherwise clearly beat its level last time.
  let keep: RaceResult | null = null; let keepStr = 0
  for (const x of results) {
    const low = (champPos.get(x.driverId) ?? fieldSize) > half
    if (!low) continue
    const beat = (scored(x) && exp(x.driverId) > half) || dev(x) >= 5
    if (beat && dev(x) >= 4 && dev(x) > keepStr) { keep = x; keepStr = dev(x) }
  }

  // Team form: both cars pulling the same way — a slower team scoring twice, or a front team both
  // out of the points — is a team story that competes with the driver candidates on strength.
  let teamCand: { teamId: string; dir: 'over' | 'under'; cars: RaceResult[] } | null = null; let teamStr = 0
  for (const tm of ctx.teams) {
    const cars = results.filter((x) => x.teamId === tm.id)
    if (cars.length < 2) continue
    const rank = teamPaceRank.get(tm.id) ?? ctx.teams.length
    const avgDev = cars.reduce((a, c) => a + dev(c), 0) / cars.length
    if (cars.every(scored) && rank > Math.ceil(ctx.teams.length / 2) && avgDev >= 4 && avgDev > teamStr) {
      teamCand = { teamId: tm.id, dir: 'over', cars }; teamStr = avgDev
    } else if (cars.every((c) => c.dnf || !scored(c)) && rank <= 3 && -avgDev >= 4 && -avgDev > teamStr) {
      teamCand = { teamId: tm.id, dir: 'under', cars }; teamStr = -avgDev
    }
  }

  // Everyone ran roughly to their car — omit (no forced talking point).
  const best = Math.max(turnStr, keepStr, teamStr)
  if (best < 4) return ''

  if (teamCand && teamStr === best) {
    const cars = teamCand.cars.slice().sort((a, b) => finSlot(a) - finSlot(b))
    const tslots = {
      prev_circuit: prevCircuit, t_team: teamName(ctx, teamCand.teamId),
      t_fins: listJoin(cars.map((c) => (c.dnf || c.finishPosition == null ? 'a retirement' : ordinal(c.finishPosition)))),
      t_car_exp: ordinal(teamPaceRank.get(teamCand.teamId) ?? ctx.teams.length),
    }
    const tpool = teamCand.dir === 'over'
      ? ['{t_team} scored with both cars at the {prev_circuit}, {t_fins}, a haul the {t_car_exp}-quickest car rarely delivers; the question is whether they can back it up.']
      : ['{t_team} left the {prev_circuit} pointless with both cars, {t_fins}, despite running the {t_car_exp}-quickest car, and will want to put it right here.']
    return fill(pick(tpool, `${seed}|tp`), tslots)
  }

  if (turn && turnStr >= keepStr) {
    const byChamp = (champPos.get(turn.driverId) ?? fieldSize) <= topCut
    const ord = ordinal(turn.finishPosition ?? fieldSize)
    const dslots = {
      prev_circuit: prevCircuit, d_last: lastName(turn.driverName), d_team: teamName(ctx, turn.teamId),
      d_champ: ordinal(champPos.get(turn.driverId) ?? fieldSize), d_car_exp: ordinal(exp(turn.driverId)),
      d_result: turn.dnf ? 'retired' : `could only finish ${ord}`,
      d_result_after: turn.dnf ? 'retiring' : `finishing only ${ord}`,
    }
    // Lead on championship position only when it is genuinely high; otherwise the story is a fast
    // car wasted, so stay on the car.
    const dpool = byChamp
      ? [
          '{d_last}, {d_champ} in the championship, {d_result} at the {prev_circuit} from a car good enough for {d_car_exp}, and needs a response here.',
          'All eyes on {d_last} after {d_result_after} last time out, a long way short of a car good enough for {d_car_exp}.',
        ]
      : [
          '{d_last} {d_result} at the {prev_circuit}, a long way short of a {d_team} good enough for {d_car_exp}, and needs a response here.',
          'All eyes on {d_last} after {d_result_after} last time out, well short of a {d_team} good enough for {d_car_exp}.',
        ]
    return fill(pick(dpool, `${seed}|tp`), dslots)
  }

  if (keep) {
    const podium = (keep.finishPosition ?? 99) <= 3
    const dslots = {
      prev_circuit: prevCircuit, d_last: lastName(keep.driverName), d_team: teamName(ctx, keep.teamId),
      d_fin: ordinal(keep.finishPosition ?? fieldSize), d_car_exp: ordinal(exp(keep.driverId)),
    }
    const dpool = podium
      ? [
          '{d_last} hauled {d_team} onto the podium at the {prev_circuit}, {d_fin} from a car rated nearer {d_car_exp}; the question is whether the run can continue.',
          '{d_last} put a {d_team} rated {d_car_exp} on the podium last time, {d_fin} at the {prev_circuit}, and will fancy more of the same.',
        ]
      : [
          '{d_last} dragged {d_team} into the points at the {prev_circuit}, {d_fin} from a car rated nearer {d_car_exp}; the question is whether the run can continue.',
          '{d_last} was the over-achiever last time, {d_fin} at the {prev_circuit} in a {d_team} rated {d_car_exp}, and will fancy more of the same.',
        ]
    return fill(pick(dpool, `${seed}|tp`), dslots)
  }

  return ''
}

// TRIGGER: a preview for every round of the calendar (run-up coverage across the whole
// season), plus the upcoming one while the season is live. Frames each round off the
// standings as they stood beforehand.
// Season-opener preview body (#88): a sharp, fully data-driven piece — a lead hook, the field around it, one
// wildcard, then the calendar. Every sentence carries a name or a number; no "the form book is blank" filler.
// Sourced from the expectation model, careers, and last season's constructors' finishes.
function openerPiece(ctx: NewsContext): string {
  const analysis = buildSeasonAnalysis(ctx)
  const cast = previewCast(ctx, analysis)
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const titles = (id: string) => ctx.careers?.[id]?.titles ?? 0
  const wins = (id: string) => ctx.careers?.[id]?.wins ?? 0
  const teamOf = (id: string) => teamName(ctx, ctx.drivers.find((d) => d.id === id)?.teamId ?? '')
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const an = (s: string) => (/^[aeiou]/i.test(s) ? 'an' : 'a')
  // Driver with their strongest career mark appended (champion > race-winner), or just the name.
  const tagged = (id: string) => { const t = titles(id); const r = t >= 2 ? `${t}-time champion` : t === 1 ? 'former champion' : wins(id) > 0 ? 'race-winner' : ''; return r ? `${dn(id)}, ${r},` : dn(id) }
  const byRank = [...analysis.driverExpectations.values()].sort((a, b) => a.expectedRank - b.expectedRank).map((e) => e.driverId)
  const expOf = (id: string) => analysis.driverExpectations.get(id)?.expectedRank ?? 99
  const N = ctx.calendar.length
  const beats: string[] = []
  const named = new Set<string>()

  // The biggest winter move: a driver who switched teams (prior team from the Signing Day draft), taken in
  // order of who the media most fancies for the title (best projected rank).
  const draftBy = new Map((ctx.draft ?? []).map((p) => [p.driverId, p]))
  const fromTeam = (id: string) => { const prev = draftBy.get(id)?.prevTeamName ?? ''; return prev && prev !== teamOf(id) ? prev : '' }
  const topMover = byRank.find((id) => fromTeam(id))

  // Beat 1 — the lead hook, sharpest first: a title-contender's winter move, else the title defence, else the
  // two most-fancied drivers. ("The winter" is a time of year, not an agent — it never makes or picks anyone.)
  const champ = cast.reigningChampion
  if (topMover && expOf(topMover) <= 3) {
    const pr = pronouns(ctx.drivers.find((d) => d.id === topMover)?.gender)
    const rival = byRank.find((id) => id !== topMover)
    named.add(topMover); if (rival) named.add(rival)
    const rivalBit = rival ? ` ${tagged(rival)} is the name most likely to stop ${pr.them}.` : ''
    beats.push(`${tagged(topMover)} begins ${ctx.year} in ${teamOf(topMover)} colours after leaving ${fromTeam(topMover)}, among the favourites for the title.${rivalBit}`)
  } else if (champ) {
    const t = titles(champ)
    const pr = pronouns(ctx.drivers.find((d) => d.id === champ)?.gender)
    const challenger = cast.titleFavourites.find((id) => id !== champ) ?? byRank.find((id) => id !== champ)
    named.add(champ); if (challenger) named.add(challenger)
    const chal = challenger ? ` ${tagged(challenger)} leads the names tipped to stop ${pr.them}.` : ''
    beats.push(`${dn(champ)}, ${t >= 2 ? `${t}-time champion` : 'reigning champion'}, opens ${ctx.year}${t >= 1 ? ` chasing a ${ordinal(t + 1)} title` : ''}.${chal}`)
  } else if (byRank.length >= 2) {
    named.add(byRank[0]); named.add(byRank[1])
    beats.push(`${tagged(byRank[0])} and ${tagged(byRank[1])} are the names to beat in ${ctx.year}.`)
  }

  // Beat 2 — the field: who is tipped to split the leaders, plus a team rated above last season's constructors'
  // finish and one rated below it.
  const splitter = byRank.find((id) => !named.has(id))
  const lastYear = (ctx.constructorHistory ?? []).reduce((m, h) => Math.max(m, h.seasonYear), -Infinity)
  const lastFin = (teamId: string) => (ctx.constructorHistory ?? []).find((h) => h.seasonYear === lastYear && h.teamId === teamId)?.finalPosition
  const moves = ctx.teams.map((tm) => ({ id: tm.id, exp: analysis.teamExpectations.get(tm.id)?.expectedRank, lf: lastFin(tm.id) })).filter((x): x is { id: string; exp: number; lf: number } => x.exp != null && x.lf != null)
  const riser = moves.filter((x) => x.lf - x.exp >= 2).sort((a, b) => (b.lf - b.exp) - (a.lf - a.exp))[0]
  const faller = moves.filter((x) => x.exp - x.lf >= 2).sort((a, b) => (b.exp - b.lf) - (a.exp - a.lf))[0]
  const fieldBits: string[] = []
  if (splitter) fieldBits.push(`${dn(splitter)} (${teamOf(splitter)}) is tipped to split them`)
  if (riser) fieldBits.push(`${teamName(ctx, riser.id)} is tipped to climb from ${ordinal(riser.lf)} to ${ordinal(riser.exp)}`)
  if (faller) fieldBits.push(`${teamName(ctx, faller.id)}, ${ordinal(faller.lf)} a year ago, is rated only ${ordinal(faller.exp)}`)
  if (fieldBits.length) beats.push(`${cap(fieldBits[0])}${fieldBits.length > 1 ? `, while ${fieldBits.slice(1).join(', and ')}` : ''}.`)

  // Beat 3 — one wildcard: a dark horse, a veteran's last stand, or a rookie (unless the whole grid is new).
  const seated = ctx.drivers.filter((d) => d.teamId !== '').length
  const dh = cast.darkHorses[0]
  const vet = cast.veterans.find((v) => v.kind === 'twilight')
  if (dh) {
    const tExp = analysis.teamExpectations.get(ctx.drivers.find((d) => d.id === dh)?.teamId ?? '')?.expectedRank
    beats.push(`The wildcard is ${dn(dh)}, among the highest-rated drivers in the field but in ${an(teamOf(dh))} ${teamOf(dh)} car projected no higher than ${ordinal(tExp ?? 0)}.`)
  } else if (vet) {
    beats.push(`${dn(vet.driverId)}, ${ctx.drivers.find((d) => d.id === vet.driverId)?.age}, lines up for what may be a final campaign.`)
  } else if (cast.rookies.length && cast.rookies.length <= seated / 2) {
    beats.push(`${dn(cast.rookies[0])} arrives as the rookie to watch.`)
  }

  // Beat 4 — the calendar.
  beats.push(`${N} rounds, starting here at the ${circuit(ctx, 1)}.`)
  return paras(...beats)
}

// Upgrade component names — invented flavour confined to the failed-part spokesperson quote below. We
// only know a team upgraded and whether it worked, never the actual part, so this is colour, not claim.
const UPGRADE_PARTS = ['front wing', 'floor', 'rear wing', 'diffuser', 'sidepod package', 'suspension package', 'beam wing', 'front-wing endplate']

// Per-round development beat (#88 preview spec): the upgrade(s) landing at round r and how, on pace,
// they shift the order. The outcome is deterministic — pre-rolled in devPlans for rounds still to come,
// recorded in the upgrade log once delivered — and the pre-round car pace is recovered by rolling the
// current pace back over later upgrades, so a preview reads identically whether r is the upcoming race
// or one long past (the article never mutates). A delivering upgrade that holds rank gets a gap-closing
// line; a failed one a spokesperson quote. Omitted only when nothing is due that round.
function previewUpgradeOutlook(ctx: NewsContext, r: number): string {
  if (ctx.teams.length === 0) return ''
  // Upgrades at round r: rounds still to come read the pending plan, rounds already run read the
  // delivered log. Normalised to the same {teamId, delta, failed} shape so the copy is identical.
  const upgrades = r > ctx.completedRounds
    ? (ctx.devPlans ?? []).filter((p) => p.nextUpgradeRound === r).map((p) => ({ teamId: p.teamId, delta: p.pendingFailed ? 0 : (p.pendingPaceDelta ?? 0), failed: !!p.pendingFailed }))
    : (ctx.upgradeEvents ?? []).filter((e) => e.round === r).map((e) => ({ teamId: e.teamId, delta: e.paceDelta, failed: e.failed }))
  if (upgrades.length === 0) return ''
  const circuitName = circuit(ctx, r)
  const tn = (id: string) => teamName(ctx, id)
  const before = carPaceBeforeRound(ctx, r)
  const curOrder = [...ctx.teams].sort((a, b) => (before.get(b.id) ?? 0) - (before.get(a.id) ?? 0))
  const curRank = new Map(curOrder.map((t, i) => [t.id, i + 1]))
  const bumped = new Map(before)
  for (const u of upgrades) if (!u.failed) bumped.set(u.teamId, (bumped.get(u.teamId) ?? 0) + u.delta)
  const projOrder = [...ctx.teams].sort((a, b) => (bumped.get(b.id) ?? 0) - (bumped.get(a.id) ?? 0))
  const projRank = new Map(projOrder.map((t, i) => [t.id, i + 1]))

  type Item = { kind: 'mover' | 'gap' | 'fail'; prio: number; text: string }
  const items: Item[] = []
  for (const u of upgrades) {
    const team = tn(u.teamId)
    const sd = `upg-${ctx.year}-${r}-${u.teamId}`
    // Failed upgrade — a spokesperson conceding the new part has not given up its time.
    if (u.failed || u.delta <= 0) {
      const part = pick(UPGRADE_PARTS, `${sd}|part`)
      items.push({ kind: 'fail', prio: 1, text: fill(pick([
        'A {team} spokesperson admitted the team is still struggling to extract the time from its new {part}.',
        'At {team}, a spokesperson conceded the new {part} has yet to give up the lap time they were chasing.',
        '{team} arrive with a new {part}, though a spokesperson admitted it has not yet delivered the step on the stopwatch.',
      ], sd), { team, part }) })
      continue
    }
    const from = curRank.get(u.teamId) ?? ctx.teams.length
    const to = projRank.get(u.teamId) ?? from
    if (to < from) {
      const behind = projOrder[to] // team at projected rank to + 1
      const passed = behind && (curRank.get(behind.id) ?? 0) < from ? tn(behind.id) : ''
      const slots = { team, team_poss: poss(team), circuit: circuitName, from: ordinal(from), to: ordinal(to), passed }
      const text = passed
        ? fill(pick([
            '{team} bring their next development step to the {circuit}, a package projected to lift them from {from} to {to}, ahead of {passed} once it is fitted.',
            'The {circuit} marks {team_poss} next upgrade, projected to move them from {from} to {to} on pace, clear of {passed}.',
            '{team_poss} next package, due at the {circuit}, projects to climb them from {from} to {to}, past {passed}.',
          ], sd), slots)
        : fill(pick([
            '{team} bring their next development step to the {circuit}, projected to climb from {from} to {to} in the order once it lands.',
            'The {circuit} brings {team_poss} next upgrade, set to lift them from {from} to {to} on pace.',
            '{team_poss} next package, due at the {circuit}, projects to lift them to {to} from {from}.',
          ], sd), slots)
      items.push({ kind: 'mover', prio: 3, text })
    } else if (from > 1) {
      // A: delivers but holds rank — aim the step at the car immediately ahead.
      const ahead = tn(curOrder[from - 2].id)
      const slots = { team, team_poss: poss(team), circuit: circuitName, ahead }
      items.push({ kind: 'gap', prio: 2, text: fill(pick([
        '{team} bring their next development step to the {circuit}, aimed at closing the gap to {ahead} ahead.',
        '{team_poss} next upgrade, due at the {circuit}, is aimed at reeling in {ahead} in front.',
        'The {circuit} brings {team_poss} next package, a step they hope narrows the gap to {ahead}.',
      ], sd), slots) })
    }
    // from === 1 with no rank change: already top with nobody ahead to chase — omit.
  }
  if (items.length === 0) return ''

  // Cap at two sentences. Keep a failed-upgrade quote when present (alongside the best positive line);
  // otherwise show the two strongest positives (mover before gap-closer).
  const fails = items.filter((i) => i.kind === 'fail')
  const positives = items.filter((i) => i.kind !== 'fail').sort((a, b) => b.prio - a.prio)
  const chosen = (fails.length ? [positives[0], fails[0]] : positives.slice(0, 2)).filter((x): x is Item => !!x)
  return chosen.map((it) => it.text).join(' ')
}

// Race-logistics beat (#88 preview spec): lap count, the forecast the race will actually run (weather
// is seeded from year+circuit, so this IS the race's forecast — and, like a real forecast, it may be
// wrong), and a hedged pre-race read of the likely pit-stop spread from this race's (also seeded) tyre
// life, lap count and era pit-loss. Only attaches to the upcoming race.
function previewRaceLogistics(ctx: NewsContext, r: number): string {
  const circ = ctx.calendar[r - 1]
  if (!circ) return ''
  const laps = circ.laps
  const circuitName = circuit(ctx, r)
  const sd = `logi-${ctx.year}-${r}`
  const { forecast, tyreBaseLife } = raceConditions(ctx.saveSeed ?? '', ctx.year, circ)
  const peak = forecast.reduce((m, p) => Math.max(m, p.moisture), 0)

  // Wet forecast: strategy is weather-led, so frame on the crossover, not a stop count.
  if (peak >= 0.1) {
    const firstWet = forecast.find((p) => p.moisture >= 0.1)?.lap ?? laps
    const frac = firstWet / laps
    const when = frac <= 0.34 ? 'from early on' : frac <= 0.67 ? 'around mid-distance' : 'in the closing stages'
    return fill(pick([
      'The {circuit} runs to {laps} laps, but rain is forecast {when}, leaving the race on the slick-to-intermediate crossover.',
      '{laps} laps await at the {circuit}, with showers forecast {when}; the timing of the switch to wets could shape the result.',
      'Rain is forecast {when} at the {circuit}, putting its {laps} laps at the mercy of the crossover and how each team reads it.',
    ], sd), { circuit: circuitName, laps, when })
  }

  // Dry: a stop-count spread. The longest viable dry stint is the hardest tyre run by a smooth driver
  // (the fewest-stops line); the alternative is one more stop for fresher rubber. Different races land
  // different counts because the tyre life is seeded per race.
  const lo = Math.max(1, Math.ceil(laps / Math.max(1, tyreBaseLife.hard * laps * 1.3)) - 1)
  const hi = lo + 1
  // Article baked into the value so fill()'s a/an pass can't trip on "one" ("a one-stop", never "an").
  const word = (n: number) => `a ${n === 1 ? 'one' : n === 2 ? 'two' : n === 3 ? 'three' : String(n)}-stop`
  const base = fill(pick([
    'A dry forecast leaves the {circuit}, over {laps} laps, on an open call: we could see some teams take {lo} while others run {hi}.',
    'Over {laps} dry laps at the {circuit}, the split looks to be {lo} on the harder tyre against {hi} on softer rubber.',
    'Expect {laps} dry laps at the {circuit} to divide the field between {lo} and {hi}.',
  ], sd), { circuit: circuitName, laps, lo: word(lo), hi: word(hi) })
  const note = pitLaneLoss(ctx.year) >= 27
    ? pick([' The long pit lane here makes the extra stop costly.', ' A slow pit lane nudges teams toward the lower count.'], `${sd}|n`)
    : ''
  return base + note
}

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

    // Grid talking point from last time out (non-opener rounds; the opener uses openerPiece instead).
    const talkingPoint = previewTalkingPoint(ctx, r, seed)
    // Development + logistics beats attach to every preview (not just the upcoming one) and are built
    // from round-stable data, so a past race's preview keeps exactly the words it had pre-race.
    const upgradeOutlook = isOpener ? '' : previewUpgradeOutlook(ctx, r)
    const raceLogistics = isOpener ? '' : previewRaceLogistics(ctx, r)

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

    // Stake beat. While the title is live it is leader vs chaser; once places lock from the top (the
    // driver below cannot make up the gap with the points still on offer), it shifts to the highest
    // still-contested championship position — the battle for P2, else P3, and so on.
    let secured = 0
    for (let k = 0; k + 1 < before.length; k++) {
      if (before[k].points - before[k + 1].points > availLeft) secured = k + 1
      else break
    }
    // The leader's win tally is a live-title detail; once a place is locked and the stake has shifted
    // to the fight below, it would tag the champion's wins onto a P2/P3 story, so drop it then.
    const winsLine = secured === 0 && (leader?.wins ?? 0) > 0
      ? fill(pick(['{leader_last} carries {leader_wins} {wins_word} into the weekend.', '{leader_last} has {leader_wins} {wins_word} to {their} name so far.'], `${seed}:wins`), slots)
      : ''
    const openA = before[secured]
    const openB = before[secured + 1]
    let chaseLine: string
    if (secured >= 1 && openA && openB) {
      const aLast = lastName(openA.driverName); const bLast = lastName(openB.driverName)
      const gap = openA.points - openB.points
      const lead = secured === 1 ? 'With the title secured' : `With 1st to ${ordinal(secured)} in the championship secured`
      const margin = gap === 0 ? `level with ${bLast}` : `${gap} ${plural(gap, 'point')} ahead of ${bLast}`
      chaseLine = `${lead}, the focus turns to ${aLast} and ${bLast}, fighting over ${ordinal(secured + 1)}. ${aLast} has ${openA.points} ${plural(openA.points, 'point')}, ${margin}.`
    } else if (secured >= 1) {
      chaseLine = `With the championship order settled, the ${circuitName} is about race wins and pride.`
    } else {
      chaseLine = fill(pick(
        leadGap === 0
          ? ['{second_last} is level on points with {leader_last} at the top.']
          : remaining <= 5
          ? ['With just {remaining} {rounds_word} left, time is short for {second_last}.', '{second_last} is running out of road, {remaining} {rounds_word} remaining.']
          : ['{second_last} sits {lead_gap} {gap_pts} behind {leader_last} and will fancy a response.', 'The job for {second_last} is to chip into a {lead_gap}-point deficit to {leader_last}.', '{second_last} has ground to make up on {leader_last}.'],
        `${seed}:stake`), slots)
    }
    const stakePara = [chaseLine, winsLine].filter(Boolean).join(' ')

    const body = isOpener
      ? openerPiece(ctx)
      : paras(
          compose(`${seed}:intro`, slots,
            ['Round {round} takes the championship to the {circuit}.', 'The grid heads to the {circuit} for round {round}.', 'The {circuit} is next, round {round} of the season.'],
            ['{leader} leads on {leader_points} points, {gap_desc}{lead_gap} {gap_pts} clear of {second}.', '{leader} arrives {gap_desc}{lead_gap} {gap_pts} ahead of {second}.', 'It is {leader} who tops the table, {gap_desc}{lead_gap} {gap_pts} up on {second}.']),
          talkingPoint,
          stakePara,
          compose(`${seed}:wcc`, slots,
            cbefore[1]
              ? ['In the constructors, {top_team} lead {wcc_second} by {wcc_gap} {wcc_pts}.', '{top_team} head the teams standings, {wcc_gap} {wcc_pts} clear of {wcc_second}.']
              : ['{top_team} head the constructors\' championship.']),
          upgradeOutlook,
          raceLogistics,
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
