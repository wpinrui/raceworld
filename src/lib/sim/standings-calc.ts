import type { DriverStanding, ConstructorStanding, Driver, Team, RaceResult } from './types'

// Countback depth when points are level: compare how many P1 finishes each driver has, then P2, and so
// on. Bounded by the largest grid the game fields (current calendars run ≤20 cars, so 22 has headroom).
const COUNTBACK_DEPTH = 22

export function sortDriverStandings(standings: DriverStanding[]): DriverStanding[] {
  return standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    for (let pos = 1; pos <= COUNTBACK_DEPTH; pos++) {
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

// Standings are derived purely from race history, never from CURRENT grid membership,
// so god-mode mid-season moves (release, reassign — even cut-and-rehire to the same
// team) stay correct: a driver's points follow the DRIVER, a team's points stay with
// the TEAM that scored them.
export function computeDriverStandings(
  drivers: Driver[],
  teams: Team[],
  raceResults: RaceResult[][],
): DriverStanding[] {
  const map = new Map<string, DriverStanding>()
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const teamName = (teamId: string) =>
    teams.find((t) => t.id === teamId)?.name ?? (teamId === '' ? 'Free agent' : teamId)

  const ensure = (driverId: string, name: string, teamId: string): DriverStanding => {
    let s = map.get(driverId)
    if (!s) {
      s = {
        driverId, driverName: name, teamId, teamName: teamName(teamId),
        points: 0, wins: 0, results: Array(raceResults.length).fill(null),
      }
      map.set(driverId, s)
    }
    return s
  }

  // Currently-seated drivers always appear (even on 0 points)…
  for (const d of drivers) if (d.teamId !== '') ensure(d.id, d.name, d.teamId)

  // …plus everyone who scored this season, keyed by driver — including drivers since
  // released (shown as free agents) or moved teams. Points = all they scored, anywhere.
  for (let round = 0; round < raceResults.length; round++) {
    for (const result of raceResults[round]) {
      const live = driverById.get(result.driverId)
      const s = ensure(result.driverId, live?.name ?? result.driverName, live?.teamId ?? '')
      s.points += result.points
      if (result.finishPosition === 1) s.wins++
      s.results[round] = result.dnf ? null : result.finishPosition
    }
  }

  return sortDriverStandings([...map.values()])
}

export function computeConstructorStandings(
  teams: Team[],
  drivers: Driver[],
  raceResults: RaceResult[][],
): ConstructorStanding[] {
  const map = new Map<string, ConstructorStanding>()

  // Drivers who raced for each team this season, in order of first appearance — so a
  // mid-season swap keeps every driver's row and attributes points to the team they
  // scored for, not whoever holds the seat now.
  const teamDriverOrder = new Map<string, string[]>()
  for (const round of raceResults) {
    for (const r of round) {
      if (!teamDriverOrder.has(r.teamId)) teamDriverOrder.set(r.teamId, [])
      const order = teamDriverOrder.get(r.teamId)!
      if (!order.includes(r.driverId)) order.push(r.driverId)
    }
  }

  for (const team of teams) {
    const order = teamDriverOrder.get(team.id) ?? drivers.filter((d) => d.teamId === team.id).map((d) => d.id)
    map.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      points: 0,
      wins: 0,
      results: order.map(() => Array(raceResults.length).fill(null)),
    })
  }

  for (let round = 0; round < raceResults.length; round++) {
    for (const result of raceResults[round]) {
      const standing = map.get(result.teamId)
      if (!standing) continue
      standing.points += result.points
      if (result.finishPosition === 1) standing.wins++
      const idx = (teamDriverOrder.get(result.teamId) ?? []).indexOf(result.driverId)
      if (idx >= 0) standing.results[idx][round] = result.dnf ? null : result.finishPosition
    }
  }

  return sortConstructorStandings([...map.values()])
}
