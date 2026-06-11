import type { NewsContext, NewsArticle } from './engine'
import type { Team } from '@/lib/sim/types'
import { teamName, paceRank, tierWord, careerOf, lastSeasonPos } from './lookups'
import { paras, poss } from './copy'
import { pick, fill, ordinal, lastName, listJoin, plural, pronouns } from './util'

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

// TRIGGER: a season preview, one launch per team, and a rookie spotlight for the youngest
// debutants. These are round-0 stories that PERSIST all season (the newsroom is a feed, not a
// snapshot of the current round) — they sort to the bottom once racing starts, but never vanish.
// Live-only (needs car pace + roster).
export function preSeason(ctx: NewsContext): NewsArticle[] {
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
