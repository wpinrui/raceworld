import type { NewsContext, NewsArticle } from './engine'
import { historicalGrids } from '@/data/history/grids'
import { TEAMNEWS } from './team-news'
import { driverStandingsAfter } from './news-standings'
import { lastName, ordinal, listJoin, fill, pick, pronouns } from './util'
import { paras } from './copy'

// ---- Team transition newsroom (rebrand / arrival / departure) ----------------------------------
// Bespoke, historically-grounded copy for known lineage transitions (keyed by lineage id + the year
// the change takes effect, in teamnews-copy.json), blending the real-world why with the game-world
// record. Generic team_entry/team_exit copy in market() covers god-mode/fictional changes that have
// no bespoke key. Fires in the prior season's off-season (round = calendar.length + 1).

// The lineage's distinct names in chronological order, as prose ("as Lotus and then Caterham").
function lineageNameEra(teamId: string, throughYear: number): string {
  const names: string[] = []
  for (const g of historicalGrids) {
    if (g.year > throughYear) continue
    const t = g.teams.find((x) => x.id === teamId)
    if (t && names[names.length - 1] !== t.name) names.push(t.name)
  }
  if (names.length === 0) return ''
  if (names.length === 1) return `as ${names[0]}`
  return `as ${names.slice(0, -1).join(', ')} and then ${names[names.length - 1]}`
}

// Facts for a transitioning lineage: its game-world record (folded live for wins/podiums/points; the
// just-finished season is added to seasons/best-finish/titles only on the live path, where the
// archived base stops at year-1), plus the era's standout + most recent drivers and the seatless count.
// teamId '' (the grid-grows piece) just returns the shared slots.
function teamTransitionSlots(ctx: NewsContext, teamId: string, extra: Record<string, string | number>): Record<string, string | number> {
  const year = ctx.year
  const next = year + 1
  const ch = ctx.nextSeasonChanges
  const gridCount = ctx.teams.length - (ch?.removals.length ?? 0) + (ch?.additions.length ?? 0)
  const w = (n: number, s: string, p: string) => (n === 1 ? s : p)

  const tc = ctx.teamCareers?.[teamId]
  const wins = tc?.wins ?? 0, podiums = tc?.podiums ?? 0, poles = tc?.poles ?? 0, points = tc?.points ?? 0
  // The article lands mid-season, so the record reads "through the season so far": wins/podiums/points
  // fold in the in-progress year and the season count includes it, but best-finish/titles use only
  // completed seasons (this year's standing isn't settled yet).
  const seasons = (tc?.seasons ?? 0) + (ctx.live ? 1 : 0)
  const bestFinish = tc?.bestConstructorsFinish != null ? ordinal(tc.bestConstructorsFinish) : 'the midfield'
  const titles = tc?.constructorTitles ?? 0

  // Current drivers (for {last_driver} + the seatless count): they go to the market when the team goes.
  const teamDrivers = driverStandingsAfter(ctx, ctx.completedRounds).filter((s) => s.teamId === teamId)
  const last = teamDrivers[0]
  // The lineage's MOST PROLIFIC driver across its whole history (folded live): by wins, then points.
  const top = [...(ctx.teamDriverTallies?.[teamId] ?? [])].sort((a, b) => b.wins - a.wins || b.points - a.points)[0]
  const feat = top && top.wins > 0 ? `won ${top.wins} ${w(top.wins, 'race', 'races')} for the team`
    : top && top.podiums > 0 ? `took ${top.podiums} ${w(top.podiums, 'podium', 'podiums')} in its colours`
    : top && top.points > 0 ? `scored ${top.points} ${w(top.points, 'point', 'points')} in its colours`
    : 'made the most of difficult machinery'
  const topName = top ? lastName(top.driverName) : (last ? lastName(last.driverName) : 'the team')
  const lastDriverName = last ? lastName(last.driverName) : (top ? lastName(top.driverName) : 'a departing driver')
  // Pronouns of the quoted driver (rebrand quote uses the standout; departure uses the most recent).
  const quotedId = extra.kind === 'departure' ? last?.driverId : top?.driverId
  const pr = pronouns(ctx.drivers.find((d) => d.id === quotedId)?.gender)
  const seatlessCount = teamDrivers.length

  const rec = {
    seasons, prior_seasons: seasons, stint_seasons: seasons,
    seasons_word: w(seasons, 'season', 'seasons'), prior_seasons_word: w(seasons, 'season', 'seasons'), stint_seasons_word: w(seasons, 'season', 'seasons'),
    wins, prior_wins: wins, wins_word: w(wins, 'win', 'wins'), prior_wins_word: w(wins, 'win', 'wins'),
    podiums, prior_podiums: podiums, podiums_word: w(podiums, 'podium', 'podiums'), prior_podiums_word: w(podiums, 'podium', 'podiums'),
    poles, prior_poles: poles,
    points, prior_points: points, points_word: w(points, 'point', 'points'), prior_points_word: w(points, 'point', 'points'),
    best_finish: bestFinish, prior_best_finish: bestFinish,
    titles, prior_titles: titles,
    name_era: lineageNameEra(teamId, year),
    top_driver: topName,
    top_driver_feat: feat,
    last_driver: lastDriverName,
    seatless: w(seatlessCount, 'driver', 'drivers'), seatless_count: seatlessCount,
    final_drivers: listJoin(teamDrivers.map((d) => lastName(d.driverName))),
    ...pr,
  }
  return { next, year, entry_year: next, grid_count: gridCount, ...rec, ...extra }
}

function renderTeamArticle(key: string, category: string, r: number, priority: number, copy: { h: string[]; d: string[]; b: string[][] }, slots: Record<string, string | number>): NewsArticle {
  return {
    id: key, category, round: r, priority,
    headline: fill(pick(copy.h, `${key}|h`), slots),
    dek: fill(pick(copy.d, `${key}|d`), slots),
    body: paras(...copy.b.map((pool, i) => fill(pick(pool, `${key}|b${i}`), slots))),
  }
}

export function teamTransitions(ctx: NewsContext): NewsArticle[] {
  const ch = ctx.nextSeasonChanges
  if (!ch) return []
  const out: NewsArticle[] = []
  const next = ctx.year + 1
  // Decided at the season's start, announced ~4/5 of the way through it; the change takes effect next year.
  const r = Math.max(1, Math.round((ctx.calendar.length * 4) / 5))
  if (ctx.completedRounds < r) return [] // not reached yet (live); archived seasons are complete

  for (const rb of ch.rebrands) {
    const key = `rebrand-${rb.teamId}-${next}`
    const slots = teamTransitionSlots(ctx, rb.teamId, { kind: 'rebrand', team: rb.toName, team_old: rb.fromName, team_new: rb.toName })
    const copy = TEAMNEWS[key]
    if (copy) { out.push(renderTeamArticle(key, 'team_rebrand', r, 72, copy, slots)); continue }
    out.push({
      id: key, category: 'team_rebrand', round: r, priority: 72,
      headline: fill(pick(['{team_old} to race as {team_new} from {next}', '{team_old} rebrands as {team_new}'], `${key}|h`), slots),
      dek: fill('{team_old} will compete under a new name, {team_new}, from {next}.', slots),
      body: paras(
        fill('{team_old} will race as {team_new} from {next}, the latest chapter for an established entry on the grid.', slots),
        fill('The operation, its base and its people carry over under the new identity.', slots),
      ),
    })
  }

  const ggKey = `grid-grows-${next}`
  if (ch.additions.length >= 3 && TEAMNEWS[ggKey]) {
    out.push(renderTeamArticle(ggKey, 'team_entry', r, 74, TEAMNEWS[ggKey], teamTransitionSlots(ctx, '', { kind: 'grid' })))
  }
  for (const add of ch.additions) {
    const key = `arrival-${add.teamId}-${next}`
    const copy = TEAMNEWS[key]
    if (!copy) continue // generic team_entry handled in market()
    out.push(renderTeamArticle(key, 'team_entry', r, 70, copy, teamTransitionSlots(ctx, add.teamId, { kind: 'arrival', team: add.teamName })))
  }
  for (const rem of ch.removals) {
    const key = `departure-${rem.teamId}-${ctx.year}`
    const copy = TEAMNEWS[key]
    if (!copy) continue // generic team_exit handled in market()
    out.push(renderTeamArticle(key, 'team_exit', r, 68, copy, teamTransitionSlots(ctx, rem.teamId, { kind: 'departure', team: rem.teamName })))
  }
  return out
}
