import type { NewsContext, NewsArticle } from './engine'
import { lastName, fill, pick } from './util'

// Pre-season testing recap (#126): a dated read on the test running order so the test board is
// revisitable as news. Lap times are observable but true pace is hidden by fuel/tyre choices, so the
// copy stays cautious. Drops at the testing stop (opener - 10) and persists through the season's feed.
export function preSeasonTesting(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || !ctx.preSeasonTest) return []
  const e = ctx.preSeasonTest.entries
  if (e.length < 2) return []
  const top = e[0]; const second = e[1]
  const gap = Math.max(0, second.lapTime - top.lapTime).toFixed(3)
  const seed = `pretest-${ctx.year}`
  const third = e[2]
  const gap3 = third ? Math.max(0, third.lapTime - top.lapTime).toFixed(3) : ''
  const slots = { year: ctx.year, circuit: ctx.preSeasonTest.circuitName, top: top.driverName, top_last: lastName(top.driverName), top_team: top.teamName, second: second.driverName, gap, third: third?.driverName ?? '', gap3 }
  const headline = fill(pick([
    '{top_last} quickest in {year} testing',
    '{top_last} tops the {year} testing order',
    '{top_team} set the {year} testing pace',
  ], `${seed}|h`), slots)
  const dek = fill(pick([
    '{top} set the fastest time of {year} pre-season testing at the {circuit}.',
    '{top_team} led the {year} test order at the {circuit}.',
  ], `${seed}|d`), slots)
  const body = fill(pick(third ? [
    '{top} topped {year} pre-season testing at the {circuit}, {gap}s clear of {second} and {gap3}s up on {third}.',
    '{top} was fastest as {year} testing closed at the {circuit}, {gap}s ahead of {second}, {gap3}s ahead of {third}.',
  ] : [
    '{top} topped {year} pre-season testing at the {circuit}, {gap}s clear of {second}.',
  ], `${seed}|b`), slots)
  return [{ id: seed, category: 'feature', round: 1, dayOffset: -10, priority: 72, headline, dek, body }]
}
