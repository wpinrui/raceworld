import type { NewsContext, NewsArticle } from './engine'
import type { RaceResult } from '@/lib/sim/types'
import { teamName, circuit } from './lookups'
import { driverStandingsAfter, constructorStandingsAfter } from './news-standings'
import { sortedResults, marginWord, poleMargin, strategyPhrase, startingTyre } from './result-format'
import { isHomeRace, winsUpTo } from './season-history'
import { driverMaxPerRace, getPoints } from '@/lib/sim/points'
import { paras, poss, wxHeadlineBucket, texture } from './copy'
import { pick, chance, fill, ordinal, lastName, listJoin, plural, compose, pronouns } from './util'
import wxCopy from './weather-report-copy.json'

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

export function raceReports(ctx: NewsContext): NewsArticle[] {
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
