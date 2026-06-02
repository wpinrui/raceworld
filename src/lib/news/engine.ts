// Templated FM-style news engine. Pure + deterministic: given a snapshot of a season
// (the live store + calendar, or a context rebuilt from the archive DB), it returns a feed
// of articles. No LLM, no API cost.
//
// Variety without an LLM: bodies are assembled by `compose()` from independent fragment
// pools (opener x detail x closer), so a handful of authored strings yield hundreds of
// stable-but-distinct paragraphs. Each article seeds its picks off its own id, so wording
// never flickers between renders but reads differently article-to-article.
//
// Cadence: most categories are paced, not fired every race.
//  - race_report      : one per race, consolidating result + start + attrition + title picture.
//  - technical_upgrade : one ROUNDUP per race, and only when a team actually upgraded.
//  - championship_state: only the clinch moments + a late-season title-fight watch.
//  - silly_season     : only at three points (mid / three-quarter / penultimate round), and the
//                       rumours are produced by actually running the market sim with a seeded
//                       -10..+10 error on each driver's media rating.
//  - analysis_opinion : sprinkled across all rounds via a seeded `chance()` gate.

import type {
  Driver, Team, RaceResult, DriverStanding, ConstructorStanding, DevUpgradeEvent,
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
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
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

function marginWord(gap: number | null): string {
  if (gap == null) return 'a clear margin'
  if (gap < 1) return `just ${gap.toFixed(3)}s`
  if (gap < 15) return `${gap.toFixed(1)}s`
  return `a commanding ${gap.toFixed(1)}s`
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

    const circuitName = circuit(ctx, r)
    const seed = `report-${ctx.year}-${r}`
    const slots: Record<string, string | number> = {
      winner: p1.driverName, winner_last: lastName(p1.driverName), team: p1.teamName,
      p2: p2?.driverName ?? '', p3: p3?.driverName ?? '', circuit: circuitName,
      margin, points: p1.points, pole: pole?.driverName ?? '',
      mover: mover?.driverName ?? '', mover_from: ordinal(mover?.gridPosition ?? 0), mover_to: ordinal(mover?.finishPosition ?? 0),
      mover_gain: moverGain, leader: leader?.driverName ?? '', second: afterR[1]?.driverName ?? '',
      lead_gap: leadGap, leader_points: leader?.points ?? 0, round: r, races_left: racesLeft,
      dnf_list: listJoin(dnfNames), dnf_count: dnfs.length, cars: plural(dnfs.length, 'car'),
    }

    const leadPara = compose(`${seed}:lead`, slots,
      [
        '{winner} won the {circuit}.',
        '{winner} took victory at the {circuit}.',
        'Victory at the {circuit} went to {winner}.',
        '{winner} is the winner of the {circuit}.',
        'It was {winner} who came out on top at the {circuit}.',
        'The {circuit} belonged to {winner}.',
      ],
      [
        'The {team} driver came home {margin} clear of {p2}, with {p3} completing the podium.',
        'A win by {margin} over {p2} sealed it, {p3} third on the rostrum.',
        '{p2} finished {margin} adrift in second, {p3} rounding out the top three.',
        'Behind, {p2} took second and {p3} third, beaten by {margin}.',
        '{margin} covered the win as {p2} and {p3} filled out the podium.',
      ],
      [
        'It is worth {points} points for {team}.',
        'The result banks {points} points.',
        'Another {points}-point haul for {team}.',
        '',
      ],
    )

    const startPool = fromPole
      ? [
          'Starting from pole, {winner} controlled the race from the front.',
          '{winner} converted pole into a lights-to-flag win.',
          'From the front of the grid {winner} was never seriously headed.',
          'Pole turned into a win as {winner} dictated the pace throughout.',
        ]
      : pole
      ? [
          '{pole} had started from pole, but it was {winner} who took the flag.',
          'Pole-sitter {pole} could not convert as {winner} came through.',
          '{winner} got the better of pole-man {pole} when it mattered most.',
          'The pole, taken by {pole}, did not translate into the win.',
        ]
      : ['{winner} judged the race perfectly to take the win.']
    const moverPool = moverGain >= 4 && mover
      ? [
          'The drive of the day belonged to {mover}, up from {mover_from} to {mover_to}.',
          '{mover} made the biggest gains, climbing from {mover_from} to {mover_to}.',
          'A charge from {mover} lit up the order, {mover_gain} places gained.',
          '{mover} carved through the field from {mover_from} to {mover_to}.',
        ]
      : ['']
    const startPara = compose(`${seed}:story`, slots, startPool, moverPool)

    const attritionPara = dnfs.length === 0
      ? compose(`${seed}:dnf`, slots, [
          'A clean race saw the full field reach the flag.',
          'There were no retirements; every car was classified.',
          'Reliability held across the grid with nobody dropping out.',
          'For once the race ran without a single retirement.',
        ])
      : compose(`${seed}:dnf`, slots,
          [
            '{dnf_count} {cars} failed to finish.',
            'The race claimed {dnf_count} {cars}.',
            'Attrition accounted for {dnf_count} {cars}.',
            'There were {dnf_count} retirements.',
          ],
          [
            '{dnf_list} all dropped out.',
            'Out went {dnf_list}.',
            '{dnf_list} did not see the flag.',
            'Among them, {dnf_list}.',
          ])

    const champPool = !leader
      ? ['']
      : clinched
      ? [
          'With the win, {leader} cannot now be caught in the championship.',
          'The result puts the title beyond doubt: {leader} is uncatchable.',
          '{leader} has effectively wrapped up the championship, {lead_gap} clear with {races_left} to run.',
        ]
      : leadChanged
      ? [
          'The result swings the championship: {leader} now leads.',
          'There is a new name on top of the standings in {leader}.',
          '{leader} takes over at the head of the table, {lead_gap} ahead of {second}.',
        ]
      : [
          'In the championship, {leader} stays in front, {lead_gap} clear of {second}.',
          '{leader} retains the points lead on {leader_points}, {lead_gap} up on {second}.',
          'Atop the standings, {leader} holds firm with a {lead_gap}-point cushion over {second}.',
        ]
    const champPara = compose(`${seed}:champ`, slots, champPool)

    const body = [leadPara, startPara, attritionPara, champPara].filter(Boolean).join('\n\n')
    out.push({
      id: seed, category: 'race_report', round: r, priority: 90,
      headline: fill(pick([
        '{winner} wins the {circuit}', '{winner} takes the {circuit}', '{winner} triumphs at the {circuit}',
        '{winner} masters the {circuit}', '{winner} conquers the {circuit}', '{winner} seals {circuit} victory',
        '{winner} on top at the {circuit}', '{winner} delivers at the {circuit}', '{circuit}: {winner} takes the win',
        'Victory for {winner} at the {circuit}', '{winner} reigns at the {circuit}', '{winner_last} wins the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{winner} leads home {p2} and {p3}.',
        '{margin} the margin as {winner} wins from {p2}.',
        '{winner} beats {p2} and {p3} to the flag.',
        'A {margin} win for {winner} at the {circuit}.',
        '{winner} controls the {circuit} for {team}.',
        'The {team} driver takes the spoils at the {circuit}.',
      ], `${seed}|d`), slots),
      body,
    })
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
    const paras: string[] = []
    paras.push(compose(`${seed}:intro`, slots,
      [
        'The {circuit} brought a fresh wave of development to the grid.',
        'Several teams arrived at the {circuit} carrying new parts.',
        'The technical battle stepped up a gear at the {circuit}.',
        'Upgrade season rolled on at the {circuit}.',
      ],
      [
        '{teams_list} all introduced updates.',
        'New packages appeared on the {teams_list} cars.',
        'In all, {n} {teams} brought changes.',
      ]))
    if (delivered.length)
      paras.push(compose(`${seed}:good`, slots,
        [
          '{delivered} appear to have found genuine lap time.',
          'The early read is positive for {delivered}.',
          '{delivered} look to have taken a real step forward.',
        ],
        [
          'It is a timely boost to the campaign.',
          'The investment looks to have paid off.',
          '',
        ]))
    if (missed.length)
      paras.push(compose(`${seed}:bad`, slots, [
        '{missed} were left disappointed, with little to show for the effort.',
        'For {missed}, the new parts failed to deliver the expected gain.',
        '{missed} head back to the drawing board after a flat update.',
      ]))
    out.push({
      id: seed, category: 'technical_upgrade', round: r, priority: 45,
      headline: fill(pick([
        'Upgrade roundup: the {circuit}', 'Development watch: {circuit}', 'New parts at the {circuit}',
        'Who brought what to the {circuit}', 'Technical roundup: {circuit}', 'The development race at the {circuit}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{n} {teams} brought updates to the {circuit}.',
        'A look at the new parts at the {circuit}.',
        'The upgrade battle at the {circuit}.',
      ], `${seed}|d`), slots),
      body: paras.filter(Boolean).join('\n\n'),
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
    const slots = { driver: champ.driverName, team: champ.teamName, year: ctx.year, gap, round: r, wins: champ.wins, wins_word: plural(champ.wins, 'win') }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 100,
      headline: fill(pick([
        '{driver} crowned {year} World Champion', '{driver} seals the {year} title',
        '{driver} is the {year} World Champion', 'Title to {driver} in {year}',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{driver} cannot be caught and is the {year} World Drivers Champion.',
        '{driver} wraps up the {year} crown for {team}.',
        'The {year} championship is settled in {driver} favour.',
      ], `${seed}|d`), slots),
      body: [
        compose(`${seed}:p1`, slots,
          ['{driver} is the {year} World Drivers Champion.', '{driver} has won the {year} World Championship.', 'The {year} title belongs to {driver}.'],
          ['The crown is sealed for {team}.', 'It is a landmark season for {team}.', '']),
        compose(`${seed}:p2`, slots,
          ['With {wins} {wins_word} to the name, the championship was secured at round {round}.', 'The title was mathematically locked up at round {round}.', '{driver} did enough at round {round} to put the championship beyond reach.']),
      ].filter(Boolean).join('\n\n'),
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
      ], `${seed}|h`), slots),
      dek: fill(pick([
        '{team} have sealed the {year} Constructors Championship.',
        '{team} cannot be caught in the Constructors standings.',
        'The Constructors title is {team} for {year}.',
      ], `${seed}|d`), slots),
      body: [
        compose(`${seed}:p1`, slots,
          ['{team} are the {year} Constructors Champions.', '{team} have won the {year} Constructors Championship.', 'The Constructors crown goes to {team} in {year}.'],
          ['It caps a dominant team effort.', 'Both garages can celebrate.', '']),
        compose(`${seed}:p2`, slots,
          ['The title was secured at round {round} with a {gap}-point cushion.', 'A lead of {gap} points put the title beyond doubt at round {round}.']),
      ].filter(Boolean).join('\n\n'),
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
    const slots = { leader: s[0].driverName, second: s[1].driverName, gap, remaining, races_left: racesLeft, round: r }
    out.push({
      id: seed, category: 'championship_state', round: r, priority: 75,
      headline: fill(pick([
        'Title fight goes down to the wire', '{leader} and {second} locked in a duel',
        'Just {gap} points in it at the top', 'The championship is alive',
        '{leader} holds off {second} in the title race',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        'Only {gap} points split the top two with {races_left} to go.',
        '{leader} leads {second} by {gap} as the season nears its climax.',
        'The run-in is set up for a fight, {gap} points the margin.',
      ], `${seed}|d`), slots),
      body: [
        compose(`${seed}:p1`, slots,
          ['The championship is going to the wire.', 'This title race is far from settled.', 'It is advantage {leader}, but only just.'],
          ['Only {gap} points separate {leader} and {second} with {races_left} remaining.', 'The gap stands at {gap} points with {races_left} left to run.']),
        compose(`${seed}:p2`, slots,
          ['Every result now matters.', 'A single bad afternoon could swing it.', 'Neither driver can afford a mistake from here.'],
          ['Expect the pressure to tell over the closing rounds.', 'The momentum could turn on any weekend.', '']),
      ].filter(Boolean).join('\n\n'),
    })
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
      leader: leader?.driverName ?? '', second: second?.driverName ?? '',
      lead_gap: leader ? leader.points - (second?.points ?? 0) : 0,
    }
    const intro = isOpener
      ? compose(`${seed}:intro`, slots,
          ['The {year} season gets under way at the {circuit}.', 'It all begins at the {circuit}.', 'Round one takes the grid to the {circuit}.'],
          ['Every team starts level on points; the form book is about to be written.', 'The long-awaited opener will give the first real read on the pecking order.', ''])
      : compose(`${seed}:intro`, slots,
          ['Round {round} takes the championship to the {circuit}.', 'Next up is the {circuit}.', 'The grid heads to the {circuit} for round {round}.'],
          ['{leader} arrives as the championship leader.', '{leader} leads the standings by {lead_gap} from {second}.', 'All eyes are on {leader} at the top of the table.'])
    const angle = isOpener
      ? compose(`${seed}:angle`, slots,
          ['Pre-season pointed to a close fight, but only the racing will tell.', 'Expectations are high, and the first laps cannot come soon enough.', ''])
      : compose(`${seed}:angle`, slots,
          ['{second} will be looking to close the gap.', 'The chasing pack needs a strong weekend to keep in touch.', 'A change at the front is never far away on a tricky circuit.'])
    out.push({
      id: seed, category: 'preview_schedule', round: r, priority: isNext ? 80 : 50,
      headline: fill(pick([
        'Preview: the {circuit}', '{circuit} up next', 'What to watch at the {circuit}',
        'Looking ahead to the {circuit}', 'Round {round}: the {circuit}', 'The {circuit} in focus',
      ], `${seed}|h`), slots),
      dek: fill(pick([
        'The grid heads to the {circuit} for round {round}.',
        'Everything to watch ahead of the {circuit}.',
        'Setting the scene for the {circuit}.',
      ], `${seed}|d`), slots),
      body: [intro, angle].filter(Boolean).join('\n\n'),
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
    headline: fill(pick(['{year} season preview', 'The {year} grid takes shape', 'What to expect in {year}', '{year}: the season ahead'], `${seed}|h`), sp),
    dek: fill(pick(['Everything to know ahead of the {year} campaign.', 'Setting the scene for {year}.', 'The storylines that will define {year}.'], `${seed}|d`), sp),
    body: [
      compose(`${seed}:p1`, sp,
        ['A new season is almost here.', 'The {year} campaign is on the horizon.', 'Testing is done and the {year} season beckons.'],
        ['{fav} and {fav2} look the early benchmarks on raw car pace.', 'Early pace pointers favour {fav} and {fav2}.', '{fav} carry the favourites tag, with {fav2} expected to push hard.']),
      compose(`${seed}:p2`, sp,
        ['A long calendar lies ahead, and the order rarely settles early.', 'But car pace is only the starting point; development and reliability will decide it.', 'The midfield looks tight, and points could be hard-won.']),
    ].filter(Boolean).join('\n\n'),
  })
  for (const t of ctx.teams) {
    const squad = ctx.drivers.filter((d) => d.teamId === t.id).map((d) => d.name)
    const tseed = `launch-${ctx.year}-${t.id}`
    const tslots = { team: t.name, year: ctx.year, squad: listJoin(squad) || 'Their driver pairing', tier: tierWord(paceRank(ctx, t.id), ctx.teams.length) }
    out.push({
      id: tseed, category: 'car_launch_livery', round: 0, priority: 30,
      headline: fill(pick(['{team} reveal their {year} car', '{team} pull the covers off for {year}', '{team} launch their {year} challenger', 'First look: the {year} {team}'], `${tseed}|h`), tslots),
      dek: fill(pick(['{team} launch their {year} challenger.', '{squad} front the {team} launch.', 'A new look for {team} in {year}.'], `${tseed}|d`), tslots),
      body: [
        compose(`${tseed}:p1`, tslots,
          ['{team} have unveiled their {year} car.', 'The covers are off the {year} {team}.', '{team} have presented their {year} challenger.'],
          ['{squad} lead the charge.', '{squad} carry the team hopes.', 'The driver line-up is led by {squad}.']),
        compose(`${tseed}:p2`, tslots,
          ['As a {tier} outfit, expectations are set accordingly.', 'The team goes in eyeing realistic targets for a {tier} package.', 'Much will depend on how the {tier} car develops over the year.']),
      ].filter(Boolean).join('\n\n'),
    })
  }
  const youngest = ctx.drivers.filter((d) => d.teamId !== '').sort((a, b) => a.age - b.age).slice(0, 2)
  for (const d of youngest) {
    if (d.age > 22) continue
    const rseed = `rookie-${ctx.year}-${d.id}`
    const rslots = { driver: d.name, age: d.age, year: ctx.year, team: teamName(ctx, d.teamId) }
    out.push({
      id: rseed, category: 'rookie_debut', round: 0, priority: 25,
      headline: fill(pick(['Spotlight on {driver}', 'Can {driver} make the step?', '{driver}: one to watch in {year}', 'The rise of {driver}'], `${rseed}|h`), rslots),
      dek: fill(pick(['{driver}, {age}, is one to watch in {year}.', 'A big {year} awaits {driver}.', 'Youth gets its chance at {team}.'], `${rseed}|d`), rslots),
      body: [
        compose(`${rseed}:p1`, rslots,
          ['At just {age}, {driver} is among the youngest on the grid.', '{driver}, {age}, steps up with plenty of expectation.', 'Few arrive into {year} with as much to prove as {driver}, {age}.'],
          ['The seat at {team} is a real opportunity.', '{team} have handed over genuine responsibility.', '']),
        compose(`${rseed}:p2`, rslots,
          ['The learning curve is steep, but the talent is there.', 'A strong rookie campaign would change the conversation quickly.', 'Patience will be needed, but the upside is clear.']),
      ].filter(Boolean).join('\n\n'),
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
      // a rookie slotting into an empty seat — light touch, not a "signing" splash
      const seed = `rookie-sign-${m.driverId}-${eos.seasonYear}`
      const slots = { driver: m.driverName, team: m.toTeamName, next: eos.seasonYear + 1 }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 40,
        headline: fill(pick(['{team} hand {driver} a debut', '{driver} promoted to {team}', '{team} bet on rookie {driver}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} steps up to {team} for {next}.', 'A maiden seat for {driver}.'], `${seed}|d`), slots),
        body: compose(`${seed}:p1`, slots,
          ['{team} have handed a debut to {driver} for {next}.', '{driver} earns a first seat with {team} from {next}.'],
          ['It is a vote of confidence in youth.', 'The team backs raw potential over experience.', '']),
      })
      continue
    }
    if (m.isResignation) {
      const seed = `resign-${m.driverId}-${eos.seasonYear}`
      const slots = { driver: m.driverName, team: m.toTeamName, until: m.contractExpiresAfterSeason }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 60,
        headline: fill(pick(['{driver} stays at {team}', '{team} keep {driver}', '{driver} re-signs with {team}', '{team} tie down {driver}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} has re-signed with {team}.', 'Continuity at {team}.', '{driver} commits to {team} through {until}.'], `${seed}|d`), slots),
        body: [
          compose(`${seed}:p1`, slots,
            ['{driver} will remain at {team}.', '{team} have kept hold of {driver}.', '{driver} has put pen to paper with {team} again.'],
            ['The new deal runs until {until}.', 'The contract extends through {until}.', '']),
          compose(`${seed}:p2`, slots,
            ['It is continuity both parties wanted.', 'Stability looks the priority for the team.', 'A settled line-up is no small advantage.']),
        ].filter(Boolean).join('\n\n'),
      })
    } else {
      const seed = `move-${m.driverId}-${eos.seasonYear}`
      const slots = { driver: m.driverName, team: m.toTeamName, next: eos.seasonYear + 1, until: m.contractExpiresAfterSeason }
      out.push({
        id: seed, category: 'driver_signing', round: r, priority: 75,
        headline: fill(pick(['{driver} signs for {team}', '{team} land {driver}', '{driver} joins {team}', '{team} swoop for {driver}'], `${seed}|h`), slots),
        dek: fill(pick(['{driver} switches to {team} for {next}.', 'A new chapter for {driver} at {team}.', '{team} make their move for {driver}.'], `${seed}|d`), slots),
        body: [
          compose(`${seed}:p1`, slots,
            ['{driver} has agreed a move to {team}.', '{team} have signed {driver}.', '{driver} is on the way to {team}.'],
            ['The deal starts in {next} and runs through {until}.', 'The contract runs through {until}.', 'It takes effect from {next}.']),
          compose(`${seed}:p2`, slots,
            ['It is a notable shake-up in the driver market.', 'The move reshapes the grid for {next}.', 'Expect knock-on effects up and down the paddock.']),
        ].filter(Boolean).join('\n\n'),
      })
    }
  }
  for (const d of eos.droppedDrivers ?? []) {
    const seed = `drop-${d.driverId}-${eos.seasonYear}`
    const slots = { driver: d.driverName, team: d.fromTeamName, next: eos.seasonYear + 1 }
    out.push({
      id: seed, category: 'driver_exit', round: r, priority: 55,
      headline: fill(pick(['{driver} dropped by {team}', '{driver} loses {team} seat', '{team} part ways with {driver}', 'No {next} seat for {driver}'], `${seed}|h`), slots),
      dek: fill(pick(['{driver} is out at {team} for {next}.', '{driver} faces an uncertain future.', 'The end of the road at {team} for {driver}.'], `${seed}|d`), slots),
      body: [
        compose(`${seed}:p1`, slots,
          ['{driver} has been let go by {team}.', '{team} will not retain {driver}.', '{driver} is without a seat after {team} moved on.'],
          ['The {next} grid will have to find room, if it can.', 'A return for {next} is far from guaranteed.', '']),
        compose(`${seed}:p2`, slots,
          ['It is a harsh end to the chapter.', 'The market is unforgiving at this level.', 'Few second chances come along once a seat is lost.']),
      ].filter(Boolean).join('\n\n'),
    })
  }
  for (const id of eos.retiredDriverIds ?? []) {
    const d = ctx.drivers.find((x) => x.id === id)
    const name = d?.name ?? id
    const seed = `retire-${id}-${eos.seasonYear}`
    const slots = { driver: name, year: eos.seasonYear }
    out.push({
      id: seed, category: 'career_retirement', round: r, priority: 65,
      headline: fill(pick(['{driver} retires from the sport', '{driver} calls time on a career', '{driver} announces retirement', 'Curtain falls for {driver}'], `${seed}|h`), slots),
      dek: fill(pick(['{driver} brings the curtain down after {year}.', 'A career ends in {year}.', '{driver} steps away from the grid.'], `${seed}|d`), slots),
      body: [
        compose(`${seed}:p1`, slots,
          ['{driver} has announced retirement at the end of {year}.', 'The {year} season was the last for {driver}.', '{driver} is calling time on a racing career.'],
          ['It closes the book on a familiar name.', 'The grid loses a known quantity.', '']),
        compose(`${seed}:p2`, slots,
          ['The seat now opens up for the next generation.', 'A new face will inherit the cockpit.', 'Attention turns to who replaces them.']),
      ].filter(Boolean).join('\n\n'),
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
    // include teams with no points so component C / team media has every team
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
    // Only genuine team switches (an established driver moving) make a rumour — re-signings
    // and rookie fill-ins are noise here.
    const moves = projection.marketMoves.filter((m) => !m.isResignation && m.fromTeamId != null && m.mediaScore > 0)
    const window = r === N - 1 ? 'with the season nearly over' : r >= (3 * N) / 4 ? 'as the campaign enters its closing stretch' : 'at the midway point of the season'

    if (moves.length === 0) {
      // Quiet market is itself a (gated) story.
      const seed = `silly-quiet-${ctx.year}-${r}`
      if (!chance(seed, 50)) continue
      const slots = { window, round: r }
      out.push({
        id: seed, category: 'silly_season', round: r, priority: 28,
        headline: fill(pick(['A quiet driver market, for now', 'Silly season slow to ignite', 'No movement yet on the grid'], `${seed}|h`), slots),
        dek: fill(pick(['The paddock rumour mill is unusually still {window}.', 'Few seats look likely to change hands.'], `${seed}|d`), slots),
        body: compose(`${seed}:p1`, slots,
          ['For all the talk, the driver market is quiet {window}.', 'The grid looks settled {window}.'],
          ['Most teams appear content with their current line-ups.', 'No obvious dominoes are poised to fall just yet.']),
      })
      continue
    }

    for (const m of moves) {
      const fromName = teamName(ctx, m.fromTeamId as string)
      const seed = `silly-${ctx.year}-${r}-${m.driverId}`
      const slots = { driver: m.driverName, driver_last: lastName(m.driverName), to: m.toTeamName, from: fromName, window, round: r }
      out.push({
        id: seed, category: 'silly_season', round: r, priority: 30,
        headline: fill(pick([
          'Rumour: {driver} linked with {to}', '{driver} on {to} radar', 'Could {driver} swap {from} for {to}?',
          '{to} eyeing a move for {driver}', 'Paddock talk: {driver} to {to}?', 'Speculation grows around {driver}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{driver} is being linked with a switch to {to}.', 'Talk of a {driver} move is gathering pace.',
          '{to} are said to admire {driver}.',
        ], `${seed}|d`), slots),
        body: [
          compose(`${seed}:p1`, slots,
            ['The paddock is buzzing with talk of {driver}.', '{driver} has become a name to watch in the market.', 'Speculation is building around the future of {driver}.'],
            ['Sources suggest {to} are weighing up a move {window}.', '{to} are understood to have registered interest {window}.', 'A switch from {from} to {to} is the talk of the rumour mill {window}.']),
          compose(`${seed}:p2`, slots,
            ['Nothing is signed, and {from} will not give up {driver_last} easily.', 'It remains speculation, but the fit makes a certain sense.', 'Whether it comes off is another matter entirely.'],
            ['Silly season has a long way still to run.', 'Expect the story to develop over the coming rounds.', 'The driver market rarely moves in a straight line.']),
        ].filter(Boolean).join('\n\n'),
      })
    }
  }
  return out
}

// TRIGGER (opinion, gated, per round): a driver being clearly out-scored by their teammate.
function teammateBattles(ctx: NewsContext): NewsArticle[] {
  if (ctx.endOfSeason) return []
  const out: NewsArticle[] = []
  for (let r = 3; r <= ctx.completedRounds; r++) {
    const stand = driverStandingsAfter(ctx, r)
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
      const id = `tm-${ctx.year}-${r}-${teamId}`
      if (a.points - b.points < 25 || !chance(id, 28)) continue
      const slots = { team: a.teamName, ahead: a.driverName, behind: b.driverName, ap: a.points, bp: b.points, gap: a.points - b.points, round: r }
      out.push({
        id, category: 'analysis_opinion', round: r, priority: 35,
        headline: fill(pick([
          '{ahead} has the upper hand at {team}', '{behind} struggling in the {team} fight',
          'The {team} garage is becoming one-sided', '{ahead} pulling clear of {behind}',
        ], `${id}|h`), slots),
        dek: fill(pick([
          '{ahead} leads {behind} {ap} to {bp} at {team}.',
          'A {gap}-point gap inside the {team} garage.',
          '{behind} has work to do against {ahead}.',
        ], `${id}|d`), slots),
        body: [
          compose(`${id}:p1`, slots,
            ['The intra-team battle at {team} is increasingly one-sided.', 'There is a clear number one emerging at {team}.', 'The {team} pairing is no longer evenly matched.'],
            ['{ahead} ({ap} pts) has pulled clear of {behind} ({bp} pts).', '{ahead} holds a {gap}-point edge over {behind}.', '{ahead} leads {behind} by {gap} points.']),
          compose(`${id}:p2`, slots,
            ['The pressure is mounting on the other side of the garage.', '{behind} badly needs a result to steady things.', 'Questions are starting to follow {behind} around the paddock.'],
            ['Team dynamics can sour quickly when the gap grows.', 'A turnaround is still possible, but time is a factor.', '']),
        ].filter(Boolean).join('\n\n'),
      })
    }
  }
  return out
}

// TRIGGER (opinion, gated, per round): a driver on a poor recent run (last-3 avg outside top 12).
function formSlumps(ctx: NewsContext): NewsArticle[] {
  if (ctx.endOfSeason) return []
  const out: NewsArticle[] = []
  for (let r = 3; r <= ctx.completedRounds; r++) {
    for (const d of ctx.drivers.filter((x) => x.teamId !== '')) {
      const recent = recentFinishesUpTo(ctx, d.id, r, 3)
      if (recent.length < 3) continue
      const avg = recent.reduce((s, x) => s + x, 0) / recent.length
      const id = `slump-${ctx.year}-${r}-${d.id}`
      if (avg < 12 || !chance(id, 22)) continue
      const slots = { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId), round: r }
      out.push({
        id, category: 'analysis_opinion', round: r, priority: 30,
        headline: fill(pick([
          'Pressure builds on {driver}', '{driver} searching for answers', 'A worrying run for {driver}',
          'What has gone wrong for {driver}?', '{driver} stuck in a rut',
        ], `${id}|h`), slots),
        dek: fill(pick([
          '{driver} has slipped down the order in recent rounds.',
          'Points have dried up for {driver}.',
          'A difficult spell for the {team} driver.',
        ], `${id}|d`), slots),
        body: [
          compose(`${id}:p1`, slots,
            ['{driver} is enduring a difficult run.', 'The last few rounds have been bleak for {driver}.', 'Form has deserted {driver} at the worst time.'],
            ['Recent finishes have been well outside the points for {team}.', 'A string of weekends has gone unrewarded for {team}.', 'The results simply have not come.']),
          compose(`${id}:p2`, slots,
            ['Questions are being asked about the {driver_last} slump.', 'The paddock is starting to wonder where the turnaround comes from.', 'Confidence can be fragile when the points stop.'],
            ['A strong weekend would settle plenty of nerves.', 'There is time to recover, but not endless time.', '']),
        ].filter(Boolean).join('\n\n'),
      })
    }
  }
  return out
}

// TRIGGER (opinion, gated, per round, live only): a team over/under-performing its car-pace
// tier in the standings (needs real car pace, so archived contexts skip it).
function teamTrajectory(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.endOfSeason) return []
  const total = ctx.teams.length
  const out: NewsArticle[] = []
  for (let r = 3; r <= ctx.completedRounds; r++) {
    const cstand = constructorStandingsAfter(ctx, r)
    cstand.forEach((cs, idx) => {
      const standingPos = idx + 1
      const pace = paceRank(ctx, cs.teamId)
      const id = `traj-${ctx.year}-${r}-${cs.teamId}`
      const delta = pace - standingPos // positive = punching above car pace
      if (Math.abs(delta) < 2 || !chance(id, 22)) return
      const slots = { team: cs.teamName, pos: ordinal(standingPos), tier: tierWord(pace, total), round: r }
      if (delta > 0) {
        out.push({
          id, category: 'analysis_opinion', round: r, priority: 28,
          headline: fill(pick([
            '{team} are punching above their weight', 'Overachieving {team} defy the form book',
            'How are {team} doing it?', '{team} the overperformers of the season',
          ], `${id}|h`), slots),
          dek: fill(pick(['{team} sit {pos} despite a {tier} car.', '{team} are outscoring their machinery.', 'A {tier} car, a flattering position for {team}.'], `${id}|d`), slots),
          body: [
            compose(`${id}:p1`, slots,
              ['{team} have been one of the stories of the season.', '{team} keep defying their car.', 'Few expected {team} to be where they are.'],
              ['They sit {pos} with what is, on paper, a {tier} package.', 'A {tier} car has them running {pos} in the standings.', 'The results outstrip the {tier} machinery beneath them.']),
            compose(`${id}:p2`, slots,
              ['Maximum points from a modest package is a credit to the operation.', 'Execution has been the difference, weekend after weekend.', 'Whether they can sustain it is the question.']),
          ].filter(Boolean).join('\n\n'),
        })
      } else {
        out.push({
          id, category: 'analysis_opinion', round: r, priority: 28,
          headline: fill(pick([
            '{team} underdelivering on their potential', 'Has {team} hit a ceiling?',
            '{team} leaving points on the table', 'Underwhelming {team} fall short',
          ], `${id}|h`), slots),
          dek: fill(pick(['{team} sit only {pos} with a {tier} car.', '{team} are not making their pace count.', 'A {tier} car, a disappointing return for {team}.'], `${id}|d`), slots),
          body: [
            compose(`${id}:p1`, slots,
              ['{team} are leaving points on the table.', '{team} are not getting the most from their car.', 'Something is not clicking at {team}.'],
              ['A {tier} car has only delivered {pos} in the standings.', 'They sit {pos} despite genuinely {tier} pace.', 'The position flatters nobody given the {tier} machinery.']),
            compose(`${id}:p2`, slots,
              ['The paddock is questioning where it is going wrong.', 'Operational mistakes have been costly.', 'Pressure is building to turn pace into results.']),
          ].filter(Boolean).join('\n\n'),
        })
      }
    })
  }
  return out
}

export function generateNews(ctx: NewsContext): NewsArticle[] {
  const all = [
    ...preSeason(ctx),
    ...raceReports(ctx),
    ...technicalRoundup(ctx),
    ...championship(ctx),
    ...titleFight(ctx),
    ...teammateBattles(ctx),
    ...formSlumps(ctx),
    ...teamTrajectory(ctx),
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
  race_report: 'Race report', technical_upgrade: 'Technical', championship_state: 'Championship',
  preview_schedule: 'Preview', car_launch_livery: 'Launch', rookie_debut: 'Rookie',
  driver_signing: 'Transfer', driver_exit: 'Transfer', career_retirement: 'Retirement',
  silly_season: 'Silly season', analysis_opinion: 'Analysis',
}
