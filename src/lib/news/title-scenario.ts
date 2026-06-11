import type { NewsContext, NewsArticle } from './engine'
import { getPoints, driverMaxPerRace, constructorMaxPerRace } from '@/lib/sim/points'
import { driverStandingsAfter, constructorStandingsAfter } from './news-standings'
import { circuit } from './lookups'
import { lastName, ordinal, plural, listJoin, fill, pick, pronouns, compose } from './util'
import { paras } from './copy'
import titleCopy from './titlescenario-copy.json'

// TRIGGER: going into a round, a title (drivers and/or constructors) can be mathematically
// clinched there. Lays out exactly what must happen, RaceFans-style. The two championships are
// checked INDEPENDENTLY — they can fall at completely different races, and each gets its own
// piece. No sprints here, so the per-race maximum is a win under THIS season's era points table
// (a 1998 win is 10, a 2010+ win is 25) plus, in 2019-2024 only, the fastest-lap point (issue #63) —
// all the maxima and position thresholds below derive from getPoints/driverMaxPerRace, never a flat table.
export function titleScenario(ctx: NewsContext): NewsArticle[] {
  const N = ctx.calendar.length
  const out: NewsArticle[] = []
  const upTo = ctx.endOfSeason ? ctx.completedRounds : Math.min(ctx.completedRounds + 1, N)
  // Position points under THIS season's era system (issue #63) — 0 for non-scoring slots. Drives all
  // the "finishes no higher than Pth" / "clinches with a Pth or better" prose so it's correct for
  // top-6 (1996-2002) and top-8 (2003-2009) replays, not just the modern top-10 table.
  const F1 = Array.from({ length: 10 }, (_, i) => getPoints(i + 1, ctx.year))
  const lastScoring = F1.filter((p) => p > 0).length // last points-paying position this era (6/8/10)
  const drvMax = driverMaxPerRace(ctx.year)         // most a driver can take in one race (FL-aware)
  const wccMax = constructorMaxPerRace(ctx.year)    // most a constructor can take in one race (FL-aware)
  // Best (lowest-number) finish a rival may take while the leader still clinches (points < A). Returns
  // lastScoring+1 = "outside the points" when even the last scoring position would still reach A.
  const clinchPos = (A: number) => { for (let p = 1; p <= lastScoring; p++) if (F1[p - 1] < A) return p; return lastScoring + 1 }
  // Can each title be clinched at round rr (and is it not already won)?
  const drvCanClinch = (rr: number) => { const d = driverStandingsAfter(ctx, rr - 1); if (d.length < 2) return false; const a = (d[0].points - d[1].points) + drvMax - (N - rr) * drvMax; return a > 0 && a <= 2 * drvMax }
  const wccCanClinch = (rr: number) => { const c = constructorStandingsAfter(ctx, rr - 1); if (c.length < 2) return false; const a = (c[0].points - c[1].points) + wccMax - (N - rr) * wccMax; return a > 0 && a <= 2 * wccMax }

  for (let r = 2; r <= upTo; r++) {
    const rem = N - r // races AFTER round r
    if (rem < 1) continue // round r is the finale; that is its own kind of decider
    const racesLeft = `${rem} ${plural(rem, 'race')}`

    // --- Drivers ---
    const ds = driverStandingsAfter(ctx, r - 1)
    if (ds.length >= 2 && drvCanClinch(r)) {
      const L = ds[0]
      const S = ds[1]
      const G = L.points - S.points
      // Points swing the leader needs over the nearest rival to clinch (negative = can even
      // lose ground and still clinch). This covers EVERY result combination, not just a win.
      const clinchMargin = rem * drvMax - G + 1
      // Worst finish that still clinches if the rival scores nothing (lowest points >= margin).
      let worstPos = 1
      for (let p = 10; p >= 1; p--) { if (F1[p - 1] >= clinchMargin) { worstPos = p; break } }
      // Win-scenario conditions for any rival who could otherwise survive the leader winning. We
      // only list a rival once the requirement is real (3rd or lower); "no higher than 2nd" is
      // vacuous, since a rival cannot beat a winning leader anyway.
      const conds: string[] = []
      for (const j of ds.slice(1)) {
        if (j.points + (rem + 1) * drvMax < L.points) continue // out of mathematical contention
        const A = (L.points + F1[0]) - j.points - rem * drvMax // F1[0] = a win under this era
        if (A > F1[1]) continue // even at 2nd (era points) this rival cannot deny a winning leader
        const pos = clinchPos(A)
        conds.push(pos > lastScoring ? `${lastName(j.driverName)} finishes outside the points` : `${lastName(j.driverName)} finishes no higher than ${ordinal(pos)}`)
      }
      let streak = 0
      for (let k = r - 1; k >= 1; k--) { const w = (ctx.raceResults[k - 1] ?? []).find((x) => x.finishPosition === 1); if (w && w.driverId === L.driverId) streak++; else break }
      const seed = `scenario-${ctx.year}-${r}`
      const slots: Record<string, string | number> = {
        leader: L.driverName, leader_last: lastName(L.driverName), s_last: lastName(S.driverName),
        circuit: circuit(ctx, r), next_circuit: circuit(ctx, r + 1), year: ctx.year,
        rem, races_left: racesLeft, wins: L.wins, wins_word: plural(L.wins, 'win'), streak,
        conds: conds.length ? listJoin(conds) : '',
        clinch_margin: clinchMargin, margin_pts: plural(Math.abs(clinchMargin), 'point'),
        worst_pos: ordinal(worstPos), surv: 1 - clinchMargin, surv_pts: plural(1 - clinchMargin, 'point'),
      }
      // The win scenario. When the lead is so big the leader clinches even by losing ground
      // (clinchMargin <= 0), a "win the race" line undersells it — finishing ahead of the rival is
      // already enough — so it is dropped and the swing line below carries the real scenario.
      const winText = clinchMargin > 0
        ? (conds.length
            ? fill(pick(['Win the {circuit}, and {leader_last} is champion provided {conds}.', 'Victory at the {circuit} crowns {leader_last}, as long as {conds}.'], `${seed}|win`), slots)
            : fill(pick(['Win the {circuit}, and the title is {leader_last}\'s whatever the others do.', 'A win at the {circuit} settles it outright.'], `${seed}|win`), slots))
        : ''
      // The full swing (covers finishing other than first) and the flip side into the next race.
      const swingText = clinchMargin <= 0
        ? fill(pick(['Such is the lead that {leader_last} is champion at the {circuit} unless {s_last} outscores them by {surv} {surv_pts}.', '{leader_last} clinches barring {s_last} outscoring them by {surv} {surv_pts}.'], `${seed}|sw`), slots) + ' ' + fill(pick(['Only that keeps the fight alive into the {next_circuit}.', 'Anything short of that and it is done.'], `${seed}|sw2`), slots)
        : clinchMargin <= F1[1]
        ? fill(pick(['{leader_last} need not even win: outscoring {s_last} by {clinch_margin} {margin_pts} is enough, so even {worst_pos} would do should {s_last} draw a blank.', 'A win is not essential, with {leader_last} clinching by outscoring {s_last} by {clinch_margin} {margin_pts}; even {worst_pos} settles it if {s_last} fails to score.'], `${seed}|sw`), slots) + ' ' + fill(pick(['Anything less, and the title race goes on to the {next_circuit}.', 'Short of that swing, the championship heads to the {next_circuit}.'], `${seed}|sw2`), slots)
        : fill(pick(['Only a win will do, and even then {leader_last} must outscore {s_last} by {clinch_margin} {margin_pts} to settle it.', 'Nothing short of victory can clinch it here, with {leader_last} needing to outscore {s_last} by {clinch_margin} {margin_pts}.'], `${seed}|sw`), slots) + ' ' + fill(pick(['Fail to manage it, and the title goes to the {next_circuit}.', 'If not, the championship rolls on to the {next_circuit}.'], `${seed}|sw2`), slots)
      out.push({
        id: seed, category: 'championship_state', round: r, priority: 86,
        headline: fill(pick([
          'How {leader_last} can be crowned champion at the {circuit}',
          'What {leader_last} needs to seal the title at the {circuit}',
          '{leader} can wrap up the drivers title at the {circuit}',
          'Drivers crown within reach for {leader} at the {circuit}',
          '{leader_last} eyes the title at the {circuit}',
        ], `${seed}|h`), slots),
        dek: fill(pick([
          '{leader} can seal the {year} drivers title at the {circuit}, with {races_left} to spare.',
          'The permutations for {leader_last} to be champion at the {circuit}.',
          '{leader} has a shot at the {year} crown at the {circuit}.',
        ], `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots,
            ['{leader} can be crowned {year} World Champion at the {circuit}.', 'The {year} drivers title could be {leader_last}\'s by the end of the {circuit}.', '{leader_last} has the chance to wrap it up at the {circuit}.'],
            ['It would come with {races_left} to spare.', 'A title sealed with {races_left} still to run would be some statement.']),
          compose(`${seed}:form`, slots,
            ['{leader_last} has {wins} {wins_word} this season.', 'With {wins} {wins_word} banked, {leader_last} has earned the chance.'],
            streak >= 2 ? ['{streak} straight wins have brought the crown within touching distance.', 'A {streak}-race winning run has made it close to a formality.'] : ['']),
          winText,
          swingText,
        ),
      })
    }

    // --- Constructors (entirely separate timing) ---
    const cs = constructorStandingsAfter(ctx, r - 1)
    if (cs.length >= 2 && wccCanClinch(r)) {
      const CG = cs[0].points - cs[1].points
      const diffNeeded = rem * wccMax - CG // net swing the lead team needs this race
      // A team's maximum from one race is a 1-2 (43); behind a rival's 1-2 the chaser can do no
      // better than 3rd and 4th (27), so a 1-2 nets at least 16 on the rival. That is the test for
      // whether locking out the top two guarantees the title regardless of the rival's result.
      const oneTwo = F1[0] + F1[1]
      const oneTwoGuarantees = (oneTwo - (F1[2] + F1[3])) > diffNeeded
      const rivalCapIfOneTwo = Math.max(0, oneTwo - (diffNeeded + 1)) // rival's combined cap for a 1-2 to clinch
      const seed = `wcc-scenario-${ctx.year}-${r}`
      const slots: Record<string, string | number> = {
        lead_team: cs[0].teamName, rival_team: cs[1].teamName, cg: CG, circuit: circuit(ctx, r), next_circuit: circuit(ctx, r + 1), year: ctx.year,
        rem, races_left: racesLeft, net_needed: diffNeeded + 1, surv_margin: -diffNeeded, rival_cap: rivalCapIfOneTwo,
      }
      // The points swing the lead team needs (or, when the lead is huge, what would keep it open).
      const W = titleCopy.wccDecider
      const marginText = fill(pick(diffNeeded >= 0 ? W.marginPos : W.marginNeg, `${seed}|m`), slots)
      const scenarioText = fill(pick(oneTwoGuarantees ? W.scenarioGuaranteed : W.scenarioCap, `${seed}|sc`), slots)
      const closeText = fill(pick(W.close, `${seed}|cl`), slots)
      out.push({
        id: seed, category: 'championship_state', round: r, priority: 84,
        headline: fill(pick(W.headline, `${seed}|h`), slots),
        dek: fill(pick(W.dek, `${seed}|d`), slots),
        body: paras(
          compose(`${seed}:p1`, slots, W.p1a, W.p1b),
          marginText,
          scenarioText,
          closeText,
        ),
      })
    }
  }

  // --- Finale deciders: the last round, with a title still alive going in. Only as a live preview
  // of the upcoming finale (not retrospectively), so it never contradicts the post-race clinch piece.
  const fr = N
  if (fr >= 2 && !ctx.endOfSeason && fr === ctx.completedRounds + 1) {
    // Drivers: leader can clinch unless the nearest rival outscores them by more than the gap.
    const ds = driverStandingsAfter(ctx, fr - 1)
    if (ds.length >= 2) {
      const G = ds[0].points - ds[1].points
      if (G >= 0 && G <= driverMaxPerRace(ctx.year)) { // alive: one race can still change hands at the top
        const seed = `finale-drv-${ctx.year}`
        const slots: Record<string, string | number> = {
          leader: ds[0].driverName, leader_last: lastName(ds[0].driverName), s: ds[1].driverName, s_last: lastName(ds[1].driverName),
          circuit: circuit(ctx, fr), year: ctx.year, gap: G, gap_pts: plural(G, 'point'), need: G + 1, need_pts: plural(G + 1, 'point'),
          ...pronouns(ctx.drivers.find((d) => d.id === ds[0].driverId)?.gender),
        }
        const D = titleCopy.finaleDrv
        const body = G === 0
          ? paras(fill(pick(D.p1Zero, `${seed}|p1`), slots), fill(pick(D.mZero, `${seed}|m`), slots))
          : paras(
              fill(pick(D.p1Lead, `${seed}|p1`), slots),
              fill(pick(D.mLead, `${seed}|m`), slots),
              fill(pick(D.win, `${seed}|w`), slots),
              fill(pick(D.riv, `${seed}|riv`), slots),
            )
        out.push({
          id: seed, category: 'championship_state', round: fr, priority: 92,
          headline: fill(pick(D.headline, `${seed}|h`), slots),
          dek: fill(pick(D.dek, `${seed}|d`), slots),
          body,
        })
      }
    }
    // Constructors: a 1-2 always extends the lead, so it settles it whatever the rival does.
    const csF = constructorStandingsAfter(ctx, fr - 1)
    if (csF.length >= 2) {
      const CG = csF[0].points - csF[1].points
      if (CG >= 0 && CG <= constructorMaxPerRace(ctx.year)) {
        const seed = `finale-wcc-${ctx.year}`
        const slots: Record<string, string | number> = {
          lead_team: csF[0].teamName, rival_team: csF[1].teamName, circuit: circuit(ctx, fr), year: ctx.year,
          cg: CG, cg_pts: plural(CG, 'point'), need: CG + 1, need_pts: plural(CG + 1, 'point'),
        }
        const W = titleCopy.finaleWcc
        const body = CG === 0
          ? paras(fill(pick(W.p1Zero, `${seed}|p1`), slots), fill(pick(W.mZero, `${seed}|m`), slots))
          : paras(
              fill(pick(W.p1Lead, `${seed}|p1`), slots),
              fill(pick(W.mLead, `${seed}|m`), slots),
              fill(pick(W.win, `${seed}|w`), slots),
            )
        out.push({
          id: seed, category: 'championship_state', round: fr, priority: 89,
          headline: fill(pick(W.headline, `${seed}|h`), slots),
          dek: fill(pick(W.dek, `${seed}|d`), slots),
          body,
        })
      }
    }
  }
  // Every title-scenario piece is a forward-looking PREVIEW of an upcoming round (driver/constructor
  // clinch chances + the two finale deciders), so they all drop in race week — not at championship_state's
  // post-race offset, which fired them after the very race they previewed. See articleDate.
  return out.map((a) => ({ ...a, preview: true }))
}
