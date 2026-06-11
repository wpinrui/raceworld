import type { NewsContext } from './engine'
import { sortedResults } from './result-format'

// In-season history queries over the result rows — "has X happened yet / how many so far". Pure reads of
// NewsContext (no mutation); carved out of engine.ts. Bounds are 1-based round numbers.

// Has this driver won earlier in the season (rounds 1..before-1)?
export function wonBefore(ctx: NewsContext, driverId: string, before: number): boolean {
  for (let r = 1; r < before; r++) {
    if ((ctx.raceResults[r - 1] ?? []).some((x) => x.driverId === driverId && x.finishPosition === 1)) return true
  }
  return false
}

// Has this driver reached the podium earlier in the season (rounds 1..before-1)?
export function podiumBefore(ctx: NewsContext, driverId: string, before: number): boolean {
  for (let r = 1; r < before; r++) {
    if ((ctx.raceResults[r - 1] ?? []).some((x) => x.driverId === driverId && !x.dnf && x.finishPosition != null && x.finishPosition <= 3)) return true
  }
  return false
}

// A driver racing in their own country (driver nationality === circuit country, both ISO-2).
export function isHomeRace(ctx: NewsContext, driverId: string, round: number): boolean {
  const c = ctx.calendar[round - 1]
  const nat = ctx.drivers.find((d) => d.id === driverId)?.nationality ?? ''
  return !!c && !!nat && c.country === nat
}

// Wins a driver has up to and including `round`, this season.
export function winsUpTo(ctx: NewsContext, driverId: string, round: number): number {
  let n = 0
  for (let r = 1; r <= round && r <= ctx.raceResults.length; r++) {
    if ((ctx.raceResults[r - 1] ?? []).some((x) => x.driverId === driverId && x.finishPosition === 1)) n++
  }
  return n
}

// Whether this team has already had a 1-2 earlier this season (before `round`).
export function teamOneTwoBefore(ctx: NewsContext, teamId: string, round: number): boolean {
  for (let r = 1; r < round; r++) {
    const top2 = sortedResults(ctx.raceResults[r - 1] ?? []).filter((x) => !x.dnf && x.finishPosition != null).slice(0, 2)
    if (top2.length === 2 && top2[0].teamId === teamId && top2[1].teamId === teamId) return true
  }
  return false
}
