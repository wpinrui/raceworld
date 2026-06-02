// Templated FM-style news engine. Pure + deterministic: given a snapshot of the season
// (the live store + calendar), it returns a feed of articles. No LLM, no API cost, no DB.
//
// Each producer below is a category; its leading comment states the TRIGGER — the data
// condition that makes the news fire. "Flavour" pieces (opinion, rumour, incident colour)
// additionally pass through a seeded `chance()` gate so not every eligible condition fires
// every round, but the same condition always resolves the same way (stable feed).

import type {
  Driver, Team, RaceResult, DriverStanding, ConstructorStanding, DevUpgradeEvent,
  EndOfSeasonSummary, Circuit, SeasonPhase,
} from '@/lib/sim/types'
import { pick, chance, fill, ordinal, lastName, listJoin, plural } from './util'

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
  endOfSeason: EndOfSeasonSummary | null
  calendar: Circuit[]
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

function art(
  id: string, category: string, round: number, priority: number,
  headlines: string[], deks: string[], bodies: string[], slots: Record<string, string | number>,
): NewsArticle {
  return {
    id, category, round, priority,
    headline: fill(pick(headlines, id + '|h'), slots),
    dek: fill(pick(deks, id + '|d'), slots),
    body: fill(pick(bodies, id + '|b'), slots),
  }
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

// car-pace rank: 1 = fastest car on the grid.
function paceRank(ctx: NewsContext, teamId: string): number {
  const sorted = [...ctx.teams].sort((a, b) => b.carPace - a.carPace)
  return sorted.findIndex((t) => t.id === teamId) + 1
}

function tierWord(rank: number, total: number): string {
  if (rank <= Math.max(2, total / 3)) return 'front-running'
  if (rank <= (2 * total) / 3) return 'midfield'
  return 'backmarker'
}

// --- Producers ---------------------------------------------------------------

// TRIGGER: every completed round. The winner of that race.
function raceReviews(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const res = sortedResults(ctx.raceResults[r - 1] ?? [])
    const podium = res.filter((x) => !x.dnf && x.finishPosition != null).slice(0, 3)
    if (podium.length === 0) continue
    const [p1, p2, p3] = podium
    const gap = p2 && p2.totalTime != null && p1.totalTime != null ? (p2.totalTime - p1.totalTime) : null
    const margin = gap == null ? 'a comfortable margin' : gap < 1 ? `just ${gap.toFixed(3)}s` : `${gap.toFixed(1)}s`
    out.push(art(
      `review-${ctx.year}-${r}`, 'race_review', r, 90,
      [
        '{winner} wins the {circuit}',
        '{winner} takes victory at the {circuit}',
        '{winner} triumphs in the {circuit}',
      ],
      ['{winner} leads home {p2} and {p3} at the {circuit}.'],
      [
        '{winner} won the {circuit} by {margin}, finishing ahead of {p2} and {p3}. It is another {points}-point haul for the {team} driver.',
        'A controlled drive handed {winner} victory in the {circuit}, {margin} clear of {p2}, with {p3} completing the podium.',
        '{winner} sealed the {circuit} ahead of {p2} and {p3}, banking {points} points for {team}.',
      ],
      {
        winner: p1.driverName, p2: p2?.driverName ?? '', p3: p3?.driverName ?? '',
        team: p1.teamName, circuit: circuit(ctx, r), margin, points: p1.points,
      },
    ))
  }
  return out
}

// TRIGGER: every completed round. The pole-sitter (grid position 1).
function qualifying(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const res = ctx.raceResults[r - 1] ?? []
    const pole = res.find((x) => x.gridPosition === 1)
    const front2 = res.find((x) => x.gridPosition === 2)
    if (!pole) continue
    out.push(art(
      `quali-${ctx.year}-${r}`, 'qualifying', r, 70,
      ['{driver} on pole for the {circuit}', '{driver} grabs {circuit} pole', '{driver} fastest in {circuit} qualifying'],
      ['{driver} starts the {circuit} from pole, {second} alongside.'],
      [
        '{driver} put the {team} on pole for the {circuit}, with {second} lining up second on the grid.',
        'It was {driver} who topped qualifying for the {circuit}, beating {second} to top spot.',
      ],
      { driver: pole.driverName, team: pole.teamName, circuit: circuit(ctx, r), second: front2?.driverName ?? 'the field' },
    ))
  }
  return out
}

// TRIGGER: a driver retired (DNF) in a completed round. Reliability vs incident framing is
// chosen at random (we know that they retired, not why), seeded for stability.
function retirements(ctx: NewsContext): NewsArticle[] {
  const out: NewsArticle[] = []
  for (let r = 1; r <= ctx.completedRounds; r++) {
    const dnfs = (ctx.raceResults[r - 1] ?? []).filter((x) => x.dnf)
    for (const d of dnfs) {
      const id = `dnf-${ctx.year}-${r}-${d.driverId}`
      const reliability = chance(id, 55)
      out.push(art(
        id, reliability ? 'reliability_dnf' : 'crash_incident', r, 40,
        reliability
          ? ['{driver} retires from the {circuit}', 'Trouble ends {driver} {circuit} run']
          : ['{driver} out of the {circuit} after incident', '{circuit} ends early for {driver}'],
        reliability
          ? ['A mechanical problem ended {driver} race at the {circuit}.']
          : ['{driver} failed to see the flag at the {circuit}.'],
        reliability
          ? ['{driver} was forced to retire the {team} from the {circuit}, a costly {laps}-lap afternoon for no reward.']
          : ['{driver} {circuit} came to a premature end, leaving {team} to count the cost after {laps} laps.'],
        { driver: d.driverName, team: d.teamName, circuit: circuit(ctx, r), laps: d.lapsCompleted },
      ))
    }
  }
  return out
}

// TRIGGER: a car-development upgrade was delivered this round (M3 dev cycles).
function upgrades(ctx: NewsContext): NewsArticle[] {
  return ctx.upgradeEvents.filter((e) => e.round >= 1 && e.round <= ctx.completedRounds).map((e) => {
    const id = `upg-${ctx.year}-${e.round}-${e.teamId}`
    const name = teamName(ctx, e.teamId)
    return e.failed
      ? art(id, 'technical_upgrade', e.round, 35,
          ['{team} upgrade misses the mark', '{team} new parts fail to deliver'],
          ['{team} brought updates to the {circuit} but found little gain.'],
          ['{team} arrived at the {circuit} with an upgrade package, but the expected step forward did not materialise.'],
          { team: name, circuit: circuit(ctx, e.round) })
      : art(id, 'technical_upgrade', e.round, 45,
          ['{team} brings upgrades to the {circuit}', '{team} unlocks pace with new parts'],
          ['{team} introduced a development package at the {circuit}.'],
          ['{team} brought a fresh upgrade to the {circuit} and looks to have found useful lap time, a welcome boost to its campaign.'],
          { team: name, circuit: circuit(ctx, e.round) })
  })
}

// TRIGGER: standings after the latest completed round. Leader + gap, and a clinch story if
// the title is mathematically secured.
function championship(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds === 0) return []
  const out: NewsArticle[] = []
  const r = ctx.completedRounds
  const ds = ctx.driverStandings
  const remaining = ctx.calendar.length - ctx.completedRounds
  if (ds.length >= 1) {
    const leader = ds[0]
    const gap = leader.points - (ds[1]?.points ?? 0)
    const clinched = remaining <= 0 || gap > remaining * DRIVER_MAX_PER_RACE
    if (clinched) {
      out.push(art(`title-${ctx.year}`, 'championship_state', r, 100,
        ['{driver} crowned {year} World Champion', '{driver} seals the {year} title'],
        ['{driver} cannot be caught and is the {year} World Drivers Champion.'],
        ['{driver} has wrapped up the {year} World Championship for {team}, the gap of {gap} points now beyond reach with {remaining} {races} left.'],
        { driver: leader.driverName, team: leader.teamName, year: ctx.year, gap, remaining, races: plural(remaining, 'race') }))
    } else if (ds.length >= 2) {
      out.push(art(`champ-${ctx.year}-${r}`, 'championship_state', r, 60,
        ['{leader} leads the title race by {gap}', '{gap}-point cushion for {leader}'],
        ['{leader} heads {second} after {r} rounds.'],
        ['{leader} tops the standings on {points} points after {r} rounds, {gap} clear of {second}. {remaining} {races} remain to settle it.'],
        { leader: leader.driverName, second: ds[1].driverName, gap, points: leader.points, r, remaining, races: plural(remaining, 'race') }))
    }
  }
  // Constructors clinch
  const cs = ctx.constructorStandings
  if (cs.length >= 2) {
    const cgap = cs[0].points - cs[1].points
    if (remaining <= 0 || cgap > remaining * CONSTRUCTOR_MAX_PER_RACE) {
      out.push(art(`wcc-${ctx.year}`, 'championship_state', r, 95,
        ['{team} clinch the Constructors Championship', '{team} are {year} Constructors Champions'],
        ['{team} have sealed the {year} Constructors title.'],
        ['{team} have secured the {year} Constructors Championship, {gap} points clear at the top.'],
        { team: cs[0].teamName, year: ctx.year, gap: cgap }))
    }
  }
  return out
}

// TRIGGER (preview): a season is in progress and there is an upcoming round.
function preview(ctx: NewsContext): NewsArticle[] {
  const next = ctx.completedRounds + 1
  if (ctx.endOfSeason || next > ctx.calendar.length || ctx.completedRounds === 0) return []
  const leader = ctx.driverStandings[0]
  return [art(`preview-${ctx.year}-${next}`, 'preview_schedule', next, 80,
    ['Preview: the {circuit}', '{circuit} up next', 'What to watch at the {circuit}'],
    ['The grid heads to the {circuit} for round {next}.'],
    ['Round {next} takes the championship to the {circuit}. {leader} arrives as the man to beat at the top of the standings.'],
    { circuit: circuit(ctx, next), next, leader: leader?.driverName ?? 'the championship leader' })]
}

// TRIGGER: pre-season (no rounds completed). One launch piece per team + a season preview.
function preSeason(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds > 0 || ctx.teams.length === 0) return []
  const out: NewsArticle[] = []
  out.push(art(`season-preview-${ctx.year}`, 'preview_schedule', 0, 85,
    ['{year} season preview', 'The {year} grid takes shape'],
    ['Everything to know ahead of the {year} campaign.'],
    ['The {year} season is almost here. {fav} and {fav2} are early favourites on raw car pace, but a long calendar lies ahead.'],
    {
      year: ctx.year,
      fav: [...ctx.teams].sort((a, b) => b.carPace - a.carPace)[0]?.name ?? '',
      fav2: [...ctx.teams].sort((a, b) => b.carPace - a.carPace)[1]?.name ?? '',
    }))
  for (const t of ctx.teams) {
    const squad = ctx.drivers.filter((d) => d.teamId === t.id).map((d) => d.name)
    out.push(art(`launch-${ctx.year}-${t.id}`, 'car_launch_livery', 0, 30,
      ['{team} reveal their {year} car', '{team} pull the covers off for {year}'],
      ['{team} launch their {year} challenger.'],
      ['{team} have unveiled their {year} car. {squad} lead the charge as the {tier} team eyes its targets for the year.'],
      { team: t.name, year: ctx.year, squad: listJoin(squad) || 'Their driver pairing', tier: tierWord(paceRank(ctx, t.id), ctx.teams.length) }))
  }
  // rookie watch: youngest grid drivers
  const youngest = ctx.drivers.filter((d) => d.teamId !== '').sort((a, b) => a.age - b.age).slice(0, 2)
  for (const d of youngest) {
    if (d.age > 22) continue
    out.push(art(`rookie-${ctx.year}-${d.id}`, 'rookie_debut', 0, 25,
      ['Spotlight on {driver}', 'Can {driver} make the step?'],
      ['{driver}, {age}, is one to watch in {year}.'],
      ['At just {age}, {driver} is among the youngest on the grid and carries real expectation into {year} with {team}.'],
      { driver: d.name, age: d.age, year: ctx.year, team: teamName(ctx, d.teamId) }))
  }
  return out
}

// TRIGGER: end-of-season market resolved. Signings/re-signings/exits/retirements.
function market(ctx: NewsContext): NewsArticle[] {
  const eos = ctx.endOfSeason
  if (!eos) return []
  const r = ctx.calendar.length + 1   // off-season: newest
  const out: NewsArticle[] = []
  for (const m of eos.marketMoves ?? []) {
    if (m.isResignation) {
      out.push(art(`resign-${m.driverId}-${eos.seasonYear}`, 'driver_signing', r, 60,
        ['{driver} stays at {team}', '{team} keep {driver}'],
        ['{driver} has re-signed with {team}.'],
        ['{driver} will remain at {team}, with a deal running until {until}. Continuity for both parties.'],
        { driver: m.driverName, team: m.toTeamName, until: m.contractExpiresAfterSeason }))
    } else {
      out.push(art(`move-${m.driverId}-${eos.seasonYear}`, 'driver_signing', r, 75,
        ['{driver} signs for {team}', '{team} land {driver}'],
        ['{driver} switches to {team} for {next}.'],
        ['{driver} has agreed a move to {team} from {next}, signing through {until}. A notable shake-up in the driver market.'],
        { driver: m.driverName, team: m.toTeamName, next: eos.seasonYear + 1, until: m.contractExpiresAfterSeason }))
    }
  }
  for (const d of eos.droppedDrivers ?? []) {
    out.push(art(`drop-${d.driverId}-${eos.seasonYear}`, 'driver_exit', r, 55,
      ['{driver} dropped by {team}', '{driver} loses {team} seat'],
      ['{driver} is out at {team} for {next}.'],
      ['{driver} has been let go by {team} and enters the off-season without a seat, on the market for {next}.'],
      { driver: d.driverName, team: d.fromTeamName, next: eos.seasonYear + 1 }))
  }
  for (const id of eos.retiredDriverIds ?? []) {
    const d = ctx.drivers.find((x) => x.id === id)
    const name = d?.name ?? id
    out.push(art(`retire-${id}-${eos.seasonYear}`, 'career_retirement', r, 65,
      ['{driver} retires from the sport', '{driver} calls time on a career'],
      ['{driver} brings the curtain down after {year}.'],
      ['{driver} has announced retirement at the end of {year}, closing the book on a career in the sport.'],
      { driver: name, year: eos.seasonYear }))
  }
  return out
}

// TRIGGER (flavour, gated): mid-season, a driver out of contract at season's end. Silly-season speculation.
function sillySeason(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds === 0 || ctx.endOfSeason) return []
  const r = ctx.completedRounds
  const out: NewsArticle[] = []
  for (const d of ctx.drivers.filter((x) => x.teamId !== '' && x.contractExpiresAfterSeason <= ctx.year)) {
    const id = `silly-${ctx.year}-${r}-${d.id}`
    if (!chance(id, 45)) continue
    out.push(art(id, 'silly_season', r, 30,
      ['{driver} future in focus', 'Where next for {driver}?', '{driver} linked with a move'],
      ['{driver} is out of contract at the end of {year}.'],
      ['{driver} contract with {team} expires at the end of {year}, and the paddock is already weighing up the {driver_last} situation as silly season heats up.'],
      { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId), year: ctx.year }))
  }
  return out
}

// Recent finishing positions for a driver (most recent first), from standings results.
function recentFinishes(ctx: NewsContext, driverId: string, n: number): number[] {
  const row = ctx.driverStandings.find((s) => s.driverId === driverId)
  if (!row) return []
  return row.results.slice(0, ctx.completedRounds).filter((x): x is number => x != null).slice(-n).reverse()
}

// TRIGGER (opinion, gated): a driver being clearly out-scored by their teammate.
function teammateBattles(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds < 2 || ctx.endOfSeason) return []
  const r = ctx.completedRounds
  const out: NewsArticle[] = []
  for (const t of ctx.teams) {
    const pair = ctx.driverStandings.filter((s) => s.teamId === t.id)
    if (pair.length < 2) continue
    const [a, b] = [...pair].sort((x, y) => y.points - x.points)
    const id = `tm-${ctx.year}-${r}-${t.id}`
    if (a.points - b.points < 20 || !chance(id, 50)) continue
    out.push(art(id, 'analysis_opinion', r, 35,
      ['{ahead} has the upper hand at {team}', '{behind} struggling in the {team} intra-team fight'],
      ['{ahead} leads {behind} {ap} to {bp} in the {team} garage.'],
      ['The intra-team battle at {team} is increasingly one-sided: {ahead} ({ap} pts) has pulled clear of {behind} ({bp} pts), and the pressure is mounting on the other side of the garage.'],
      { team: t.name, ahead: a.driverName, behind: b.driverName, ap: a.points, bp: b.points }))
  }
  return out
}

// TRIGGER (opinion, gated): a driver on a poor run of recent finishes (avg outside the top 12).
function formSlumps(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds < 3 || ctx.endOfSeason) return []
  const r = ctx.completedRounds
  const out: NewsArticle[] = []
  for (const d of ctx.drivers.filter((x) => x.teamId !== '')) {
    const recent = recentFinishes(ctx, d.id, 3)
    if (recent.length < 3) continue
    const avg = recent.reduce((s, x) => s + x, 0) / recent.length
    const id = `slump-${ctx.year}-${r}-${d.id}`
    if (avg < 12 || !chance(id, 40)) continue
    out.push(art(id, 'analysis_opinion', r, 30,
      ['Pressure builds on {driver}', '{driver} searching for answers', 'A worrying run for {driver}'],
      ['{driver} has slipped down the order in recent rounds.'],
      ['{driver} endures a difficult run, with recent finishes well outside the points for {team}. Questions are starting to be asked about the {driver_last} slump.'],
      { driver: d.name, driver_last: lastName(d.name), team: teamName(ctx, d.teamId) }))
  }
  return out
}

// TRIGGER (opinion, gated): a team over- or under-performing its car-pace tier in the standings.
function teamTrajectory(ctx: NewsContext): NewsArticle[] {
  if (ctx.completedRounds < 3 || ctx.endOfSeason) return []
  const r = ctx.completedRounds
  const total = ctx.teams.length
  const out: NewsArticle[] = []
  ctx.constructorStandings.forEach((cs, idx) => {
    const standingPos = idx + 1
    const pace = paceRank(ctx, cs.teamId)
    const id = `traj-${ctx.year}-${r}-${cs.teamId}`
    const delta = pace - standingPos // positive = punching above car pace
    if (Math.abs(delta) < 2 || !chance(id, 45)) return
    if (delta > 0) {
      out.push(art(id, 'analysis_opinion', r, 28,
        ['{team} are punching above their weight', 'Overachieving {team} defy the form book'],
        ['{team} sit {pos} despite a {tier} car.'],
        ['{team} have been one of the stories of the season, running {pos} in the standings with what is, on paper, a {tier} car. Maximum points from a modest package.'],
        { team: cs.teamName, pos: ordinal(standingPos), tier: tierWord(pace, total) }))
    } else {
      out.push(art(id, 'analysis_opinion', r, 28,
        ['{team} underdelivering on their potential', 'Has {team} hit a ceiling?'],
        ['{team} sit only {pos} with a {tier} car.'],
        ['{team} are leaving points on the table: a {tier} car has only delivered {pos} in the standings, and the paddock is questioning where it is going wrong.'],
        { team: cs.teamName, pos: ordinal(standingPos), tier: tierWord(pace, total) }))
    }
  })
  return out
}

// TRIGGER (opinion): late-season tight title fight (final third of the calendar, small gap).
function titleFight(ctx: NewsContext): NewsArticle[] {
  if (ctx.endOfSeason || ctx.completedRounds < (2 * ctx.calendar.length) / 3) return []
  const ds = ctx.driverStandings
  if (ds.length < 2) return []
  const gap = ds[0].points - ds[1].points
  const remaining = ctx.calendar.length - ctx.completedRounds
  if (gap > remaining * DRIVER_MAX_PER_RACE || gap > 40) return []
  return [art(`fight-${ctx.year}-${ctx.completedRounds}`, 'championship_state', ctx.completedRounds, 75,
    ['Title fight goes down to the wire', '{leader} and {second} locked in a duel'],
    ['Just {gap} points split the top two with {remaining} to go.'],
    ['The championship is alive: only {gap} points separate {leader} and {second} with {remaining} {races} remaining. Every result now matters.'],
    { leader: ds[0].driverName, second: ds[1].driverName, gap, remaining, races: plural(remaining, 'race') })]
}

export function generateNews(ctx: NewsContext): NewsArticle[] {
  const all = [
    ...preSeason(ctx),
    ...raceReviews(ctx),
    ...qualifying(ctx),
    ...retirements(ctx),
    ...upgrades(ctx),
    ...championship(ctx),
    ...titleFight(ctx),
    ...teammateBattles(ctx),
    ...formSlumps(ctx),
    ...teamTrajectory(ctx),
    ...sillySeason(ctx),
    ...preview(ctx),
    ...market(ctx),
  ]
  // de-dupe by id, then newest round first, higher priority first
  const seen = new Set<string>()
  const deduped = all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
  deduped.sort((a, b) => (b.round - a.round) || (b.priority - a.priority) || a.id.localeCompare(b.id))
  return deduped.slice(0, 200)
}

// Small helper so the page can label each card by category without importing the list.
export const CATEGORY_LABELS: Record<string, string> = {
  race_review: 'Race', qualifying: 'Qualifying', reliability_dnf: 'Retirement', crash_incident: 'Incident',
  technical_upgrade: 'Technical', championship_state: 'Championship', preview_schedule: 'Preview',
  car_launch_livery: 'Launch', rookie_debut: 'Rookie', driver_signing: 'Transfer', driver_exit: 'Transfer',
  career_retirement: 'Retirement', silly_season: 'Silly season', analysis_opinion: 'Analysis',
}
