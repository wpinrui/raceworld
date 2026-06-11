import type { NewsContext, NewsArticle } from './engine'
import { careerOf, teamName } from './lookups'
import { lastName, plural, ordinal, fill, pick } from './util'
import { paras } from './copy'

// TRIGGER: a mid-season driver change at a team (god-mode), detected straight from the race
// results — a seat's occupant changes partway through the year. Reports the axed driver's form to
// that point (grounded, so the "why" never overclaims) and introduces the replacement, using the
// career record to tell a returning hand from a debutant.
export function midSeasonSwaps(ctx: NewsContext): NewsArticle[] {
  const N = ctx.completedRounds
  if (N < 2) return []
  // Per team, each driver's first/last round and stats to date.
  type Stint = { first: number; last: number; starts: number; points: number; best: number | null; name: string }
  const byTeam = new Map<string, Map<string, Stint>>()
  for (let round = 1; round <= N; round++) {
    for (const res of ctx.raceResults[round - 1] ?? []) {
      if (!res.teamId) continue
      let team = byTeam.get(res.teamId)
      if (!team) { team = new Map(); byTeam.set(res.teamId, team) }
      let d = team.get(res.driverId)
      if (!d) { d = { first: round, last: round, starts: 0, points: 0, best: null, name: res.driverName }; team.set(res.driverId, d) }
      d.last = round; d.starts++; d.points += res.points
      const fp = res.finishPosition
      if (fp != null && (d.best == null || fp < d.best)) d.best = fp
    }
  }
  const out: NewsArticle[] = []
  for (const [teamId, drivers] of byTeam) {
    for (const [repId, rep] of drivers) {
      if (rep.first <= 1) continue // a regular, not a mid-season arrival
      const k = rep.first
      // Whose seat did they take? A driver whose last round was exactly the one before.
      let axed: Stint | null = null
      for (const [aid, a] of drivers) {
        if (aid !== repId && a.last === k - 1 && a.first <= k - 1) { axed = a; break }
      }
      if (!axed) continue
      const seed = `swap-${teamId}-${repId}-${k}`
      const cr = careerOf(ctx, repId)
      const repExperienced = !!(cr && (cr.wins > 0 || cr.podiums > 0 || cr.starts > rep.starts))
      const slots: Record<string, string | number> = {
        team: teamName(ctx, teamId), axed: axed.name, axed_last: lastName(axed.name),
        rep: rep.name, rep_last: lastName(rep.name), round: k,
        a_starts: axed.starts, a_starts_word: plural(axed.starts, 'round'),
        a_pts: axed.points, a_pts_word: plural(axed.points, 'point'),
        a_best: axed.best ? ordinal(axed.best) : '', cr_starts: cr?.starts ?? 0, cr_starts_word: plural(cr?.starts ?? 0, 'start'),
      }
      // The "why" is grounded in the axed driver's actual form to that point — never inflated.
      const whyLine = axed.points === 0
        ? fill(pick(['{a_starts} {a_starts_word} brought no points, and {team} have opted for a change.', 'A pointless run over {a_starts} {a_starts_word} has cost {axed_last} the seat.'], `${seed}|why`), slots)
        : fill(pick(['{axed_last} leaves the seat with {a_pts} {a_pts_word} and a best finish of {a_best} from {a_starts} {a_starts_word}.', 'Over {a_starts} {a_starts_word}, {axed_last} managed {a_pts} {a_pts_word}, best finish {a_best}.'], `${seed}|why`), slots)
      const repLine = repExperienced
        ? fill(pick(['In comes {rep}, who brings {cr_starts} {cr_starts_word} of experience.', '{rep} steps in, no stranger to the grid with {cr_starts} {cr_starts_word} to their name.'], `${seed}|rep`), slots)
        : fill(pick(['In comes {rep}, handed a Grand Prix debut.', '{rep} steps up for a first taste of Formula 1.'], `${seed}|rep`), slots)
      out.push({
        id: seed, category: 'mid_season_swap', round: k, priority: 52,
        headline: fill(pick(['{team} replace {axed_last} with {rep_last}', '{axed_last} axed by {team} mid-season', '{rep_last} called up as {team} drop {axed_last}', 'Mid-season change at {team}'], `${seed}|h`), slots),
        dek: fill(pick(['{team} swap {axed_last} for {rep_last} from round {round}.', 'A mid-season driver change at {team}.', '{rep_last} replaces {axed_last} at {team}.'], `${seed}|d`), slots),
        body: paras(
          fill(pick(['{team} have made a mid-season change, replacing {axed} with {rep} from round {round}.', '{team} have pulled the trigger mid-season, drafting in {rep} in place of {axed}.'], `${seed}|p1`), slots),
          whyLine,
          repLine,
          fill(pick(['"It is a difficult call, but the right one for the team," a {team} spokesperson said.', '"I am grateful for the chance and ready to deliver," said {rep_last}.'], `${seed}|q`), slots),
        ),
      })
    }
  }
  return out
}
