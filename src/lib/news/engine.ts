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

function circuit(ctx: NewsContext, round: number): string {
  return ctx.calendar[round - 1]?.name ?? `Round ${round}`
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

function marginWord(gap: number | null): string {
  if (gap == null) return 'a clear margin'
  if (gap < 1) return `just ${gap.toFixed(3)}s`
  if (gap < 15) return `${gap.toFixed(1)}s`
  return `a commanding ${gap.toFixed(1)}s`
}

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
    }

    const leadPara = compose(`${seed}:lead`, slots,
      [
        '{winner} won the {circuit}.', '{winner} took victory at the {circuit}.',
        'Victory at the {circuit} went to {winner}.', '{winner} is the winner of the {circuit}.',
        'It was {winner} who came out on top at the {circuit}.', 'The {circuit} belonged to {winner}.',
        '{winner} delivered when it counted at the {circuit}.', 'There was no stopping {winner} at the {circuit}.',
        '{winner} held on to win the {circuit}.', 'A polished afternoon gave {winner} the {circuit}.',
      ],
      [
        'The {team} driver came home {margin} clear of {p2}, with {p3} completing the podium.',
        'A win by {margin} over {p2} sealed it, {p3} third on the rostrum.',
        '{p2} finished {margin} adrift in second, {p3} rounding out the top three.',
        'Behind, {p2} took second and {p3} third, beaten by {margin}.',
        '{margin} covered the win as {p2} and {p3} filled out the podium.',
        '{p2} chased hard but fell {margin} short, {p3} next up.',
        'It was {margin} back to {p2}, with {p3} claiming the final podium spot.',
      ],
      winnerHome
        ? [
            'The win came on home soil.', 'It was a home victory to savour for {winner_last}.',
            'Few wins mean more than one in front of your own crowd.',
          ]
        : [''],
      [
        'It is worth {points} points for {team}.', 'The result banks {points} points.',
        'Another {points}-point haul for {team}.', '{team} leave with {points} hard-earned points.',
        'That is {points} points in the bag for {team}.',
      ],
    )

    const startPool = fromPole
      ? [
          'Starting from pole, {winner_last} controlled the race from the front.',
          '{winner_last} converted pole into a lights-to-flag win.',
          'From the front of the grid {winner_last} was never seriously headed.',
          'Pole turned into a win as {winner_last} dictated the pace throughout.',
          '{winner_last} led every lap that mattered after starting on pole.',
          'It was a copybook drive from pole for {winner_last}.',
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
      ? ['{pole_last} had taken pole by {pole_margin}.', 'Qualifying had gone the way of {pole_last} by {pole_margin}.', 'The pole margin had been {pole_margin}.']
      : ['']
    const stratPool = strat
      ? [
          'The win was built on {strategy}.', '{winner_last} made {strategy} work.',
          '{strategy} proved the right call for {winner_last}.',
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
            '{dnf_list} all dropped out.', 'Out went {dnf_list}.',
            '{dnf_list} did not see the flag.', 'Among them, {dnf_list}.',
            '{dnf_list} were left to rue what might have been.',
          ])

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
        'That makes it {win_ord} win of the campaign for {winner_last}.',
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
        '{winner} leads home {p2} and {p3}.', '{winner} wins the {circuit} by {margin} from {p2}.',
        '{winner} beats {p2} and {p3} to the flag.', '{winner} wins the {circuit} ahead of {p2}.',
        '{winner} controls the {circuit} for {team}.', 'The {team} driver takes the spoils at the {circuit}.',
        '{winner} sees off {p2} to win the {circuit}.', 'Another {circuit} to remember for {winner}.',
      ], `${seed}|d`), slots),
      body: paras(leadPara, startPara, attritionPara, champPara, closerPara),
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
    const slots: Record<string, string | number> = {
      circuit: circuitName, delivered: listJoin(delivered), missed: listJoin(missed),
      n: evs.length, teams: plural(evs.length, 'team'),
      teams_list: listJoin(evs.map((e) => teamName(ctx, e.teamId))),
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
      [
        '{teams_list} all introduced updates.', 'New packages appeared on the {teams_list} cars.',
        'In all, {n} {teams} brought changes.', 'It was {teams_list} leading the charge.',
      ])
    const goodPara = delivered.length
      ? compose(`${seed}:good`, slots,
          [
            '{delivered} appear to have found genuine lap time.',
            'The early read is positive for {delivered}.',
            '{delivered} look to have taken a real step forward.',
            'There were encouraging signs from {delivered}.',
          ],
          [
            'It is a timely boost to the campaign.', 'The investment looks to have paid off.',
            'The numbers back up the optimism.', 'Confidence in the development direction grows.',
          ])
      : ''
    const badPara = missed.length
      ? compose(`${seed}:bad`, slots,
          [
            '{missed} were left disappointed, with little to show for the effort.',
            'For {missed}, the new parts failed to deliver the expected gain.',
            '{missed} head back to the drawing board after a flat update.',
            'Not every gamble paid off, with {missed} finding no real step.',
          ],
          [
            'Development is rarely a straight line.', 'Back at the factory, the data will be pored over.',
            'It is a setback, but not a fatal one.', 'The correlation work begins again.',
          ])
      : ''
    const outlook = compose(`${seed}:outlook`, slots,
      [
        'The upgrade race will only intensify from here.',
        'Every team knows standing still is going backwards.',
        'The development war shows no sign of cooling.',
        'Resources are finite, and the choices only get harder.',
        'The pecking order can shift quickly when the parts land.',
      ],
      [
        'The next few rounds will reveal who got their sums right.',
        'Time will tell whether the gains hold up across circuits.',
        'The true picture often takes a race or two to emerge.',
        'Rivals will be watching the timing screens closely.',
      ])
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
      body: paras(intro, goodPara, badPara, outlook),
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
    const seed = `title-${ctx.year}`
    const slots = { driver: champ.driverName, driver_last: lastName(champ.driverName), team: champ.teamName, year: ctx.year, gap, round: r, wins: champ.wins, wins_word: plural(champ.wins, 'win') }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 100,
      headline: fill(pick([
        '{driver} crowned {year} World Champion', '{driver} seals the {year} title',
        '{driver} is the {year} World Champion', 'Title to {driver} in {year}',
        '{driver_last} is champion of the world', '{driver} conquers {year}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{driver} cannot be caught and is the {year} World Drivers Champion.',
        '{driver} wraps up the {year} crown for {team}.',
        'The {year} championship is settled in {driver}\'s favour.',
      ], `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['{driver} is the {year} World Drivers Champion.', '{driver} has won the {year} World Championship.', 'The {year} title belongs to {driver}.'],
          ['The crown is sealed for {team}.', 'It is a landmark season for {team}.', 'A long campaign ends in glory for {team}.']),
        compose(`${seed}:p2`, slots,
          ['With {wins} {wins_word} on the board, the championship was secured at round {round}.', 'The title was mathematically locked up at round {round}.', '{driver} did enough at round {round} to put the championship beyond reach.'],
          ['The consistency told over a gruelling season.', 'Reliability and results combined to decisive effect.', 'It was a campaign of few weaknesses.']),
        compose(`${seed}:p3`, slots,
          ['For {driver_last}, it is the reward for a season of relentless application.', 'The hard yards of a long year have paid off.', 'It caps a season few could live with.'],
          ['Attention will soon turn to whether the feat can be repeated.', 'The target only grows from here.', 'Rivals must now find a way to respond.']),
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
    const seed = `wcc-${ctx.year}`
    const slots = { team: s[0].teamName, year: ctx.year, gap, round: r }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 95,
      headline: fill(pick([
        '{team} clinch the Constructors title', '{team} are {year} Constructors Champions',
        '{team} seal the Constructors Championship', 'Constructors crown to {team}',
        '{team} rule the {year} Constructors', '{team} take the team title',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{team} have sealed the {year} Constructors Championship.',
        '{team} cannot be caught in the Constructors standings.',
        'The Constructors title is {team} for {year}.',
      ], `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['{team} are the {year} Constructors Champions.', '{team} have won the {year} Constructors Championship.', 'The Constructors crown goes to {team} in {year}.'],
          ['It caps a dominant team effort.', 'Both garages can celebrate.', 'The whole factory shares in this one.']),
        compose(`${seed}:p2`, slots,
          ['The title was secured at round {round} with a {gap}-point cushion.', 'A lead of {gap} points put the title beyond doubt at round {round}.'],
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
    const slots = { leader: s[0].driverName, second: s[1].driverName, leader_last: lastName(s[0].driverName), second_last: lastName(s[1].driverName), gap, remaining, races_left: racesLeft, round: r }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 75,
      headline: fill(pick([
        'Title fight goes down to the wire', '{leader} and {second} locked in a duel',
        'Just {gap} points in it at the top', 'The championship is alive',
        '{leader} holds off {second} in the title race', 'Advantage {leader}, but only just',
        '{gap} points to settle a championship',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        'Only {gap} points split the top two with {races_left} to go.',
        '{leader} leads {second} by {gap} as the season nears its climax.',
        'The run-in is set up for a fight, {gap} points the margin.',
      ], `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['The championship is going to the wire.', 'This title race is far from settled.', 'It is advantage {leader}, but only just.'],
          ['Only {gap} points separate {leader} and {second} with {races_left} remaining.', 'The gap stands at {gap} points with {races_left} left to run.', '{gap} points is all that divides the top two.']),
        compose(`${seed}:p2`, slots,
          ['Every result now matters.', 'A single bad afternoon could swing it.', 'Neither driver can afford a mistake from here.'],
          ['Expect the pressure to tell over the closing rounds.', 'The momentum could turn on any weekend.', 'Small margins will decide a big prize.']),
        compose(`${seed}:p3`, slots,
          ['{leader_last} has the cushion, but {second_last} has the momentum to chase.', 'Both know the next few weeks define their season.', 'Nerves will be tested as much as pace.'],
          ['It is exactly the climax the season deserves.', 'Neutrals could not ask for more.', 'The run-in promises to be a thriller.']),
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
        gap, top_team: cs[0].teamName, third: ds[2]?.driverName ?? ds[1].driverName, round: r,
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
            ['The lead over {second} stands at {gap} points.', '{leader} holds a {gap}-point advantage over {second}.', 'A margin of {gap} points separates {leader} and {second}.'],
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

// TRIGGER: a preview for every round of the calendar (run-up coverage across the whole
// season), plus the upcoming one while the season is live. Frames each round off the
// standings as they stood beforehand.
function previews(ctx: NewsContext): NewsArticle[] {
  const N = ctx.calendar.length
  const out: NewsArticle[] = []
  const upTo = ctx.endOfSeason ? ctx.completedRounds : Math.min(ctx.completedRounds + 1, N)
  for (let r = 1; r <= upTo; r++) {
    const before = driverStandingsAfter(ctx, r - 1)
    const leader = before[0]
    const second = before[1]
    const isOpener = r === 1
    const isNext = !ctx.endOfSeason && r === ctx.completedRounds + 1
    const seed = `preview-${ctx.year}-${r}`
    const circuitName = circuit(ctx, r)
    const slots: Record<string, string | number> = {
      circuit: circuitName, round: r, year: ctx.year,
      leader: leader?.driverName ?? '', leader_last: leader ? lastName(leader.driverName) : '', second: second?.driverName ?? '',
      lead_gap: leader ? leader.points - (second?.points ?? 0) : 0,
    }
    const intro = isOpener
      ? compose(`${seed}:intro`, slots,
          ['The {year} season gets under way at the {circuit}.', 'It all begins at the {circuit}.', 'Round one takes the grid to the {circuit}.', 'The waiting is over, and the {circuit} opens {year}.'],
          ['Every team starts level on points; the form book is about to be written.', 'The long-awaited opener will give the first real read on the pecking order.', 'Months of speculation finally meet the stopwatch.'])
      : compose(`${seed}:intro`, slots,
          ['Round {round} takes the championship to the {circuit}.', 'Next up is the {circuit}.', 'The grid heads to the {circuit} for round {round}.', 'Attention turns to the {circuit}.'],
          ['{leader} arrives as the championship leader.', '{leader} leads the standings by {lead_gap} from {second}.', 'All eyes are on {leader} at the top of the table.'])
    const storyline = isOpener
      ? compose(`${seed}:story`, slots,
          ['Pre-season pointed to a close fight, but only the racing will tell.', 'Expectations are high, and the first laps cannot come soon enough.', 'The pecking order is pure guesswork until the lights go out.'],
          ['Reliability over a race distance is the first real question.', 'Tyre management could shape the opening result.', 'A clean getaway will be worth its weight in points.'])
      : compose(`${seed}:story`, slots,
          ['{second} will be looking to close the gap.', 'The chasing pack needs a strong weekend to keep in touch.', 'A change at the front is never far away on a tricky circuit.'],
          ['Track position is likely to be at a premium.', 'Strategy could prove the difference here.', 'The midfield fight remains as tight as ever.'])
    const watch = compose(`${seed}:watch`, slots,
      [
        'Qualifying could be decisive around here.', 'Expect the long runs to tell a story in practice.',
        'The start will be a flashpoint as always.', 'Weather is the usual wildcard.',
        'Tyre choice will be a talking point all weekend.',
      ],
      [
        'Whoever nails the details should be in the hunt.', 'Small mistakes will be punished.',
        'There is little margin for error at the front.', 'Consistency will be rewarded.',
      ])
    out.push({
      id: seed, category: 'preview_schedule', round: r, priority: isNext ? 80 : 50,
      headline: fill(pick([
        'A preview of the {circuit}', '{circuit} up next', 'What to watch at the {circuit}',
        'Looking ahead to the {circuit}', 'Round {round} at the {circuit}', 'The {circuit} in focus',
        'Setting the stage for the {circuit}', 'Eyes on the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        'The grid heads to the {circuit} for round {round}.',
        'Everything to watch ahead of the {circuit}.',
        'Setting the scene for the {circuit}.',
        'The talking points ahead of the {circuit}.',
      ], `${seed}|d`), slots),
      body: paras(intro, storyline, watch),
    })
  }
  return out
}

// TRIGGER: pre-season (no rounds completed). A season preview, one launch per team, and a
// rookie spotlight for the youngest debutants. Live-only (needs car pace + roster).
function preSeason(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.completedRounds > 0 || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
  const byPace = [...ctx.teams].sort((a, b) => b.carPace - a.carPace)
  const seed = `season-preview-${ctx.year}`
  const sp = { year: ctx.year, fav: byPace[0]?.name ?? '', fav2: byPace[1]?.name ?? '' }
  out.push({
    id: seed, category: 'preview_schedule', round: 0, priority: 85,
    headline: fill(pick(['{year} season preview', 'The {year} grid takes shape', 'What to expect in {year}', 'The {year} season ahead', 'The {year} campaign awaits'], `${seed}|h`), sp),
    dek: fill(pick(['Everything to know ahead of the {year} campaign.', 'Setting the scene for {year}.', 'The storylines that will define {year}.'], `${seed}|d`), sp),
    body: paras(
      compose(`${seed}:p1`, sp,
        ['A new season is almost here.', 'The {year} campaign is on the horizon.', 'Testing is done and the {year} season beckons.'],
        ['{fav} and {fav2} look the early benchmarks on raw car pace.', 'Early pace pointers favour {fav} and {fav2}.', '{fav} carry the favourites tag, with {fav2} expected to push hard.']),
      compose(`${seed}:p2`, sp,
        ['A long calendar lies ahead, and the order rarely settles early.', 'Car pace is only the starting point.', 'The grid looks closer than it has in some time.'],
        ['Development and reliability will decide who is standing at the end.', 'The midfield looks tight, and points could be hard-won.', 'Consistency over a long year tends to win out.']),
      compose(`${seed}:p3`, sp,
        ['Every team will believe it has made a step over the winter.', 'Optimism is high up and down the paddock.', 'The pressure is on from the very first lap.'],
        ['Only the racing will separate hope from reality.', 'The stopwatch will soon sort fact from fiction.', 'It will not be long before the picture clears.']),
    ),
  })
  for (const t of ctx.teams) {
    const squad = ctx.drivers.filter((d) => d.teamId === t.id).map((d) => d.name)
    const tseed = `launch-${ctx.year}-${t.id}`
    const lastPos = lastSeasonPos(ctx, t.id)
    const tslots = { team: t.name, year: ctx.year, squad: listJoin(squad) || 'Their driver pairing', tier: tierWord(paceRank(ctx, t.id), ctx.teams.length), last_pos: lastPos ? ordinal(lastPos) : '' }
    out.push({
      id: tseed, category: 'car_launch_livery', round: 0, priority: 30,
      headline: fill(pick(['{team} reveal their {year} car', '{team} pull the covers off for {year}', '{team} launch their {year} challenger', 'First look at the {year} {team}', '{team} unveil for {year}'], `${tseed}|h`), tslots),
      dek: fill(pick(['{team} launch their {year} challenger.', '{squad} front the {team} launch.', 'A new look for {team} in {year}.'], `${tseed}|d`), tslots),
      body: paras(
        compose(`${tseed}:p1`, tslots,
          ['{team} have unveiled their {year} car.', 'The covers are off the {year} {team}.', '{team} have presented their {year} challenger.'],
          ['{squad} lead the charge.', '{squad} carry the team hopes.', 'The driver line-up is led by {squad}.']),
        compose(`${tseed}:p2`, tslots,
          lastPos
            ? ['They finished {last_pos} in last season\'s constructors and want more.', 'After {last_pos} in the constructors last year, the bar is set.', 'Coming off {last_pos} last season, the target is to climb.']
            : ['As a {tier} outfit, expectations are set accordingly.', 'The team goes in eyeing realistic targets for a {tier} package.', 'Much will depend on how the {tier} car develops over the year.'],
          ['Reliability out of the box would be a fine start.', 'The early races will set the tone.', 'A solid baseline is the immediate goal.']),
        compose(`${tseed}:p3`, tslots,
          ['Behind the scenes, the real work has only just begun.', 'Launch glamour quickly gives way to the grind of a season.', 'The factory will already be chasing the next gains.'],
          ['Testing will offer the first honest read.', 'The stopwatch will deliver the verdict soon enough.', 'Ambition will meet reality on track shortly.']),
      ),
    })
  }
  const youngest = ctx.drivers.filter((d) => d.teamId !== '').sort((a, b) => a.age - b.age).slice(0, 2)
  for (const d of youngest) {
    if (d.age > 22) continue
    const rseed = `rookie-${ctx.year}-${d.id}`
    const rslots = { driver: d.name, driver_last: lastName(d.name), age: d.age, year: ctx.year, team: teamName(ctx, d.teamId) }
    out.push({
      id: rseed, category: 'rookie_debut', round: 0, priority: 25,
      headline: fill(pick(['Spotlight on {driver}', 'Can {driver} make the step?', '{driver} is one to watch in {year}', 'The rise of {driver}', '{driver} ready for the big stage'], `${rseed}|h`), rslots),
      dek: fill(pick(['{driver}, {age}, is one to watch in {year}.', 'A big {year} awaits {driver}.', 'Youth gets its chance at {team}.'], `${rseed}|d`), rslots),
      body: paras(
        compose(`${rseed}:p1`, rslots,
          ['At just {age}, {driver} is among the youngest on the grid.', '{driver}, {age}, steps up with plenty of expectation.', 'Few arrive into {year} with as much to prove as {driver}, {age}.'],
          ['The seat at {team} is a real opportunity.', '{team} have handed over genuine responsibility.', 'It is a platform any young driver would want.']),
        compose(`${rseed}:p2`, rslots,
          ['The learning curve is steep, but the talent is there.', 'A strong rookie campaign would change the conversation quickly.', 'Patience will be needed, but the upside is clear.'],
          ['Mistakes are part of the apprenticeship.', 'Consistency will matter more than the occasional headline.', 'Out-pacing a teammate is the first real marker.']),
        compose(`${rseed}:p3`, rslots,
          ['The paddock will be watching closely.', 'Reputations can be made fast at this level.', 'Expectation is a weight as much as a privilege.'],
          ['{driver_last} has the chance to announce himself.', 'A point or two early would settle the nerves.', 'The first season is all about laying foundations.']),
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
        ),
      })
    } else {
      const seed = `move-${m.driverId}-${eos.seasonYear}`
      const next = eos.seasonYear + 1
      const term = m.contractLength === 1
        ? `a one-year deal for ${next}`
        : `a ${m.contractLength}-year deal through ${m.contractExpiresAfterSeason}`
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), team: m.toTeamName, next, until: m.contractExpiresAfterSeason, term }
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
            ['A fresh environment can rejuvenate a career.', 'New machinery brings new expectations.', 'The fit, on paper, looks a strong one.']),
          compose(`${seed}:p3`, slots,
            ['{driver_last} now faces the task of adapting quickly.', 'Pre-season will be about building chemistry.', 'The pressure to deliver follows any big move.'],
            ['It is one of the headline transfers of the off-season.', 'The grid for {next} suddenly looks different.', 'Rivals will take note of the realignment.']),
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
    const slots = { driver: name, driver_last: lastName(name), year: eos.seasonYear }
    out.push({
      id: seed, category: 'career_retirement', round: r, priority: 65,
      headline: fill(pick(['{driver} retires from the sport', '{driver} calls time on a career', '{driver} announces retirement', 'Curtain falls for {driver}', '{driver} steps away for good'], `${seed}|h`), slots),
      dek: fill(pick(['{driver} brings the curtain down after {year}.', 'A career ends in {year}.', '{driver} steps away from the grid.'], `${seed}|d`), slots),
      body: paras(
        compose(`${seed}:p1`, slots,
          ['{driver} has announced retirement at the end of {year}.', 'The {year} season was the last for {driver}.', '{driver} is calling time on a racing career.'],
          ['It closes the book on a familiar name.', 'The grid loses a known quantity.', 'An era, of sorts, comes to an end.']),
        compose(`${seed}:p2`, slots,
          ['The seat now opens up for the next generation.', 'A new face will inherit the cockpit.', 'Attention turns to who replaces them.'],
          ['Such departures are part of the sport rhythm.', 'The grid is forever renewing itself.', 'One chapter closes as another waits to begin.']),
        compose(`${seed}:p3`, slots,
          ['{driver_last} departs with the respect of the paddock.', 'The memories will outlast the results.', 'Few walk away on their own terms.'],
          ['The sport moves on, but not without a nod of thanks.', 'It is the end of a long road.', 'A fond farewell from all corners of the paddock.']),
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
    // dropping them keeps the reported rumours fully deterministic.
    const moves = projection.marketMoves.filter((m) => !m.isResignation && m.fromTeamId != null && m.mediaScore > 0)
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
      const toIdx = cstand.findIndex((c) => c.teamId === m.toTeamId)
      const toPos = toIdx >= 0 ? ordinal(toIdx + 1) : ''
      const seed = `silly-${ctx.year}-${r}-${m.driverId}`
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), to: m.toTeamName, from: fromName, window, round: r, driver_points: dpts, to_pos: toPos }
      out.push({
        id: seed, category: 'silly_season', round: r, priority: 30,
        headline: fill(pick([
          'Rumour has {driver} linked with {to}', '{driver} on {to}\'s radar', 'Could {driver} swap {from} for {to}?',
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
          compose(`${seed}:p2`, slots,
            ['On paper, the fit makes a certain sense.', 'The logic behind the link is not hard to see.', 'There is a clear rationale on both sides.'],
            dpts > 0
              ? ['{driver_last} has {driver_points} points to show for the season so far.', 'A return of {driver_points} points this year has not gone unnoticed.']
              : [''],
            toPos
              ? ['{to}, {to_pos} in the constructors, are hunting an upgrade.', 'For {to}, sitting {to_pos}, it would be a statement of intent.']
              : [''],
            ['{to} would gain a known quantity.', 'For {driver_last}, it could mean a step up.', 'Each party has something the other wants.']),
          compose(`${seed}:p3`, slots,
            ['Nothing is signed, and {from} will not give up {driver_last} easily.', 'It remains speculation, but a persistent kind.', 'Whether it comes off is another matter entirely.'],
            ['Silly season has a long way still to run.', 'Expect the story to develop over the coming rounds.', 'The driver market rarely moves in a straight line.']),
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
  const featuredAt = new Map<string, number>()
  const recencyPenalty = (subject: string, r: number): number => {
    const last = featuredAt.get(subject)
    if (last == null) return 0
    const gap = r - last
    return gap <= 0 || gap >= 4 ? 0 : (4 - gap) * 8
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
      const slots = { team: a.teamName, ahead: a.driverName, ahead_last: lastName(a.driverName), behind: b.driverName, behind_last: lastName(b.driverName), ap: a.points, bp: b.points, gap, round: r }
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
            compose(`${id}:p2`, slots,
              ['The pressure is mounting on the other side of the garage.', '{behind} badly needs a result to steady things.', 'Questions are starting to follow {behind} around the paddock.'],
              ['Team dynamics can sour quickly when the gap grows.', 'A turnaround is still possible, but time is a factor.', 'Confidence, once dented, is hard to rebuild.']),
            compose(`${id}:p3`, slots,
              ['For {ahead_last}, it is validation of a strong run.', 'The momentum is firmly with {ahead_last}.', 'Internally, the pecking order looks increasingly settled.'],
              ['{behind_last} will back himself to respond.', 'A reset over the coming rounds is the only answer.', 'The second half offers a chance to put it right.']),
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
        const slots = { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId), round: r }
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
                ['Recent finishes have been well outside the points for {team}.', 'A string of weekends has gone unrewarded for {team}.', 'The results simply have not come.']),
              compose(`${id}:p2`, slots,
                ['Questions are being asked about the {driver_last} slump.', 'The paddock is starting to wonder where the turnaround comes from.', 'Confidence can be fragile when the points stop.'],
                ['A strong weekend would settle plenty of nerves.', 'There is time to recover, but not endless time.', 'The underlying pace will need to resurface fast.']),
              compose(`${id}:p3`, slots,
                ['{team} will be working hard to find the root cause.', 'Whether it is the car or the driver is the question being asked.', 'Often these runs end as suddenly as they begin.'],
                ['One clean weekend can change everything.', 'The talent does not vanish overnight.', 'A reset is needed, and quickly.']),
            ),
          }),
        })
      } else if (avg <= 5) {
        const id = `surge-${ctx.year}-${r}-${d.id}`
        const slots = { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId), round: r }
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
                ['Recent finishes have been right at the sharp end for {team}.', 'Result after result has gone the right way.', 'The points are stacking up nicely for {team}.']),
              compose(`${id}:p2`, slots,
                ['Confidence is a powerful thing, and {driver_last} has it in spades.', 'When a driver is hot, the whole team lifts with them.', 'Momentum like this is hard to manufacture and easy to lose.'],
                ['Rivals will be eager to halt the run.', 'The challenge now is to sustain it.', 'Form this good rarely lasts forever, but while it does it is formidable.']),
              compose(`${id}:p3`, slots,
                ['It has dragged {team} up the order with it.', 'The standings reflect a driver at the top of their game.', 'The numbers tell the story of a genuine hot streak.'],
                ['Keeping it going is the only goal now.', 'The bandwagon is rolling.', 'On this evidence, anything looks possible.']),
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

    if (candidates.length === 0) continue
    const best = candidates
      .map((c) => ({ c, adj: c.score - recencyPenalty(c.subject, r) }))
      .sort((x, y) => y.adj - x.adj || x.c.subject.localeCompare(y.c.subject))[0]
    if (best.adj < THRESHOLD) continue
    out.push(best.c.make())
    featuredAt.set(best.c.subject, r)
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
    ...titleFight(ctx),
    ...features(ctx),
    ...analysis(ctx),
    ...sillySeason(ctx),
    ...previews(ctx),
    ...market(ctx),
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
  analysis_opinion: 'Analysis',
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
]
