import type { NewsContext, NewsArticle } from './engine'
import { driverStandingsAfter, constructorStandingsAfter } from './news-standings'
import { driverMaxPerRace, constructorMaxPerRace } from '@/lib/sim/points'
import { lastName, plural, fill, pick, pronouns } from './util'
import { paras, poss, texture } from './copy'

// TRIGGER: the mathematical clinch of either title — the splashy "champion crowned" moment,
// emitted at the exact round it was secured (or the final round if it went to the end).
export function championship(ctx: NewsContext): NewsArticle[] {
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
