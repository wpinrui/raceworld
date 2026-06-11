import type { NewsContext, NewsArticle } from './engine'
import { teamName, circuit } from './lookups'
import { driverStandingsAfter } from './news-standings'
import { driverMaxPerRace, constructorMaxPerRace } from '@/lib/sim/points'
import { buildSeasonAnalysis } from './season-analysis'
import { championshipShape, constructorShape, teamArcs, runnerUpArc, clinchRound } from './archetypes'
import { paras } from './copy'
import { pick, fill, ordinal, lastName, listJoin, plural, pronouns } from './util'
import seasonReviewCopy from './season-review-copy.json'

// The season review (#88): the end-of-season retrospective that pays off the preview — how the title was
// won, who beat or missed their preseason projection, the best of the rest. Replaces the old `feature`
// producer (keeps the `feature` category). Grounded in the season-analysis deltas + title trajectory.
export function seasonReview(ctx: NewsContext): NewsArticle[] {
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
