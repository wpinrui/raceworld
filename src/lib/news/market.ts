import type { NewsContext, NewsArticle } from './engine'
import { teamName, careerOf } from './lookups'
import { driverStandingsAfter } from './news-standings'
import { paras, poss, texture } from './copy'
import { TEAMNEWS } from './team-news'
import { lastName, pronouns, fill, pick, listJoin, plural, ordinal, chance } from './util'

// TRIGGER: end-of-season market resolved. Signings / re-signings / exits / retirements.
export function market(ctx: NewsContext): NewsArticle[] {
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
