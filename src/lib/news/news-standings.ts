import type { NewsContext } from './engine'
import { countbackCompare } from '@/lib/sim/standings-calc'

// News-layer standings and finish-history derived from the result slices (not the current roster), so they
// read identically for live and archived contexts. Carved out of engine.ts.

export interface SimpleStanding {
  driverId: string; driverName: string; teamId: string; teamName: string; points: number; wins: number
  positions: number[]  // non-DNF finishing positions, for the shared countback tiebreak
}

// Driver standings as they stood AFTER `round` completed rounds (0 = before any race). Built from the
// result slices so it works identically for live and archived contexts (teamName follows the rows, not the
// current roster). Ties break by the shared countback (P1 count, then P2, …) so this agrees with the
// standings screen and the season-analysis trajectory.
export function driverStandingsAfter(ctx: NewsContext, round: number): SimpleStanding[] {
  const map = new Map<string, SimpleStanding>()
  for (let r = 0; r < round && r < ctx.raceResults.length; r++) {
    for (const res of ctx.raceResults[r] ?? []) {
      let s = map.get(res.driverId)
      if (!s) {
        s = { driverId: res.driverId, driverName: res.driverName, teamId: res.teamId, teamName: res.teamName, points: 0, wins: 0, positions: [] }
        map.set(res.driverId, s)
      }
      s.points += res.points
      if (res.finishPosition === 1) s.wins++
      if (!res.dnf && res.finishPosition != null) s.positions.push(res.finishPosition)
      s.teamId = res.teamId
      s.teamName = res.teamName
    }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || countbackCompare(a.positions, b.positions))
}

export function constructorStandingsAfter(ctx: NewsContext, round: number): { teamId: string; teamName: string; points: number }[] {
  const map = new Map<string, { teamId: string; teamName: string; points: number; wins: number }>()
  for (let r = 0; r < round && r < ctx.raceResults.length; r++) {
    for (const res of ctx.raceResults[r] ?? []) {
      let s = map.get(res.teamId)
      if (!s) { s = { teamId: res.teamId, teamName: res.teamName, points: 0, wins: 0 }; map.set(res.teamId, s) }
      s.points += res.points
      if (res.finishPosition === 1) s.wins++
      s.teamName = res.teamName
    }
  }
  return [...map.values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .map(({ teamId, teamName, points }) => ({ teamId, teamName, points }))
}

// Most-recent-first finishing positions for a driver up to and including `round`. A DNF
// counts as a notional 30th so a run of retirements reads as a slump.
export function recentFinishesUpTo(ctx: NewsContext, driverId: string, round: number, n: number): number[] {
  const out: number[] = []
  for (let r = Math.min(round, ctx.raceResults.length); r >= 1 && out.length < n; r--) {
    const row = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === driverId)
    if (!row) continue
    out.push(row.dnf || row.finishPosition == null ? 30 : row.finishPosition)
  }
  return out
}
