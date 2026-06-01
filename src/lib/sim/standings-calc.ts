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
    return b.wins - a.wins
  })
}
