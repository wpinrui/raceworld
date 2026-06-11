import type { NewsContext } from './engine'

// Milestone detection math carved out of engine.ts: career/constructor running totals through a round and
// the step-crossing checks. Pure reads of NewsContext (no text rendering — that stays with the producers).

export type MileCat = 'wins' | 'podiums' | 'poles' | 'points' | 'starts'

// ctx.careers holds the total INCLUDING the whole completed season, so we subtract this season back
// out and re-add only rounds 1..r. Counting matches foldLiveSeason exactly (a start per entry incl.
// DNFs, a pole on grid P1, a podium on a top-three finish, a win on P1). Null with no career record.
export function careerTotalsThroughRound(ctx: NewsContext, id: string, r: number): { starts: number; points: number; podiums: number; wins: number; poles: number } | null {
  const c = ctx.careers?.[id]
  if (!c) return null
  let sSt = 0, sPt = 0, sPo = 0, sWi = 0, sPl = 0 // whole completed season
  let aSt = 0, aPt = 0, aPo = 0, aWi = 0, aPl = 0 // rounds 1..r only
  for (let k = 1; k <= ctx.completedRounds; k++) {
    const res = (ctx.raceResults[k - 1] ?? []).find((x) => x.driverId === id)
    if (!res) continue
    const fp = res.finishPosition
    const st = 1, pt = res.points
    const po = fp != null && fp <= 3 ? 1 : 0
    const wi = fp === 1 ? 1 : 0
    const pl = res.gridPosition === 1 ? 1 : 0
    sSt += st; sPt += pt; sPo += po; sWi += wi; sPl += pl
    if (k <= r) { aSt += st; aPt += pt; aPo += po; aWi += wi; aPl += pl }
  }
  return {
    starts: c.starts - sSt + aSt, points: c.points - sPt + aPt,
    podiums: c.podiums - sPo + aPo, wins: c.wins - sWi + aWi, poles: c.poles - sPl + aPl,
  }
}

// Team (constructor) milestone steps. A team scores far faster than a driver (two cars), so the
// steps are coarser than the per-driver ones. First ever, then every: 50 Grands Prix, 100 points,
// 25 podiums, 10 wins, 10 poles. (Tweak these numbers to taste — they are the only knob.)
const TEAM_MILESTONE_STEP: Record<'starts' | 'points' | 'podiums' | 'wins' | 'poles', number> = {
  starts: 50, points: 100, podiums: 25, wins: 10, poles: 10,
}
export function teamMilestoneCrossed(cat: keyof typeof TEAM_MILESTONE_STEP, before: number, after: number): number | null {
  if (before < 1 && after >= 1) return 1
  const s = TEAM_MILESTONE_STEP[cat]
  if (after >= s && Math.floor(after / s) > Math.floor(before / s)) return Math.floor(after / s) * s
  return null
}

// A team's constructor career totals as of AFTER round `r` of this season (ctx.teamCareers holds the
// total INCLUDING the whole completed season, so strip the season and re-add rounds 1..r). `starts`
// is distinct Grands Prix entered. Null with no team-career record.
export function teamTotalsThroughRound(ctx: NewsContext, teamId: string, r: number): { starts: number; points: number; podiums: number; wins: number; poles: number } | null {
  const c = ctx.teamCareers?.[teamId]
  if (!c) return null
  let sSt = 0, sPt = 0, sPo = 0, sWi = 0, sPl = 0
  let aSt = 0, aPt = 0, aPo = 0, aWi = 0, aPl = 0
  for (let k = 1; k <= ctx.completedRounds; k++) {
    const cars = (ctx.raceResults[k - 1] ?? []).filter((x) => x.teamId === teamId)
    if (cars.length === 0) continue
    let pt = 0, po = 0, wi = 0, pl = 0
    for (const res of cars) { const fp = res.finishPosition; pt += res.points; if (fp != null && fp <= 3) po++; if (fp === 1) wi++; if (res.gridPosition === 1) pl++ }
    sSt += 1; sPt += pt; sPo += po; sWi += wi; sPl += pl
    if (k <= r) { aSt += 1; aPt += pt; aPo += po; aWi += wi; aPl += pl }
  }
  return { starts: c.races - sSt + aSt, points: c.points - sPt + aPt, podiums: c.podiums - sPo + aPo, wins: c.wins - sWi + aWi, poles: c.poles - sPl + aPl }
}

// Significance ordering across every milestone kind, so the most newsworthy one leads the per-race
// roundup: wins > podiums > poles > points > starts, and within a category a first-ever (value 1)
// outranks any recurring step.
export function milestoneSig(cat: MileCat, value: number): number {
  const rank: Record<MileCat, number> = { wins: 5, podiums: 4, poles: 3, points: 2, starts: 1 }
  return rank[cat] * 1_000_000 + (value === 1 ? 500_000 : value)
}
