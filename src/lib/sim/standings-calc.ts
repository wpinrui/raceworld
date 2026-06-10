import type { DriverStanding, ConstructorStanding } from './types'

export function sortDriverStandings(standings: DriverStanding[]): DriverStanding[] {
  return standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    for (let pos = 1; pos <= 22; pos++) {
      const diff =
        b.results.filter((r) => r === pos).length - a.results.filter((r) => r === pos).length
      if (diff !== 0) return diff
    }
    return 0
  })
}

export function sortConstructorStandings(standings: ConstructorStanding[]): ConstructorStanding[] {
  return standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    // Countback (same rule as the driver sort): most of the best finishing position first — 1sts, then 2nds,
    // and so on — counted across BOTH cars. Replaces the old wins-only tiebreak, which left every 0-point,
    // 0-win team in arbitrary order (so a team with two 9ths could sit below teams whose best was 15th).
    const aFinishes = a.results.flat()
    const bFinishes = b.results.flat()
    for (let pos = 1; pos <= 22; pos++) {
      const diff = bFinishes.filter((r) => r === pos).length - aFinishes.filter((r) => r === pos).length
      if (diff !== 0) return diff
    }
    return 0
  })
}
