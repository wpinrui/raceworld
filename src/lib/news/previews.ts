import type { NewsContext, NewsArticle } from './engine'
import type { RaceResult } from '@/lib/sim/types'
import { teamName, circuit, CIRCUIT_TRAITS } from './lookups'
import { driverStandingsAfter, constructorStandingsAfter, recentFinishesUpTo } from './news-standings'
import { wonBefore } from './season-history'
import { driverMaxPerRace, getPoints } from '@/lib/sim/points'
import { buildSeasonAnalysis, previewCast } from './season-analysis'
import { raceConditions } from '@/lib/sim/race-conditions'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { paras, poss, texture } from './copy'
import { pick, chance, fill, ordinal, lastName, listJoin, plural, compose, pronouns } from './util'

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

export function previews(ctx: NewsContext): NewsArticle[] {
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
