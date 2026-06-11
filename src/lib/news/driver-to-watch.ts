import type { NewsContext, NewsArticle } from './engine'
import { computeDriverMediaScores, computeTeamMediaScores } from '@/lib/sim/media-scores'
import { computeRetentionDeltas, runDriverMarket } from '@/lib/sim/free-agency'
import { constructorStandingsAfter } from './news-standings'
import { careerOf } from './lookups'
import { lastName, plural, ordinal, listJoin, fill, pick, pronouns, mulberry32, clamp } from './util'
import { paras } from './copy'

// Stature-scaled career summary for a comeback veteran on the market (driver-to-watch). Real stats only;
// the producer picks the tier from the driver's career record so a former champion reads bigger than a
// journeyman. Slots are filled from DriverCareer.
const VETERAN_CAREER: Record<string, string[]> = {
  champion: [
    '{champ_label_cap} with the {title_years} {titles_word} to {their} name, {driver_last} accumulated {wins} {wins_word} and {poles} {poles_word} across {seasons} {seasons_word} at the top level.',
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

export function driverToWatch(ctx: NewsContext): NewsArticle[] {
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
      champ_label_cap: (c?.titles ?? 0) === 1 ? 'A former World Champion' : `A ${c?.titles ?? 0}-time World Champion`,
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
