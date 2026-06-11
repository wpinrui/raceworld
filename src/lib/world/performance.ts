import type { RaceResult, Team } from '@/lib/sim/types'
import type { CarPaceSnapshot } from '@/lib/store/season-helpers'

// Correlate car performance with results across the season. We expose, all keyed by round so they can
// share an x-axis: car pace per team, each team's best finish, and the over/under-performance (expected
// finish from pace rank minus actual finish) at both team and driver granularity.

type Row = { round: number } & Record<string, number>

export interface PerfDriver { driverId: string; driverName: string; teamId: string }

export interface PerformanceData {
  rounds: number
  paceRows: Row[]        // car pace per team, incl. round 0 (season start)
  teamFinishRows: Row[]  // each team's best finish that round (lower = better)
  teamDeltaRows: Row[]   // over/under per team (expected - actual; +ve = beat the car)
  driverDeltaRows: Row[] // over/under per driver
  drivers: PerfDriver[]  // drivers who raced, for the chip selector
}

export function buildPerformanceData(
  raceResults: RaceResult[][],
  carPaceHistory: CarPaceSnapshot[],
  teams: Team[],
): PerformanceData {
  const start = carPaceHistory.find((h) => h.round === 0)
  // The car that RACED round r is the pre-race car: this round's upgrade lands after the race, so the
  // relevant pace is the prior snapshot (round 0 for round 1). Using round r's snapshot would credit a
  // team with an upgrade it didn't yet have during the race.
  const racePace = (round: number, teamId: string): number => (carPaceHistory.find((h) => h.round === round - 1) ?? start)?.paces[teamId] ?? 0

  const paceRows: Row[] = [...carPaceHistory].sort((a, b) => a.round - b.round).map((s) => ({ round: s.round, ...s.paces }))

  const teamFinishRows: Row[] = []
  const teamDeltaRows: Row[] = []
  const driverDeltaRows: Row[] = []
  const driverSeen = new Map<string, PerfDriver>()
  let rounds = 0

  raceResults.forEach((round, i) => {
    if (!round || round.length === 0) return
    const r = i + 1
    rounds = r
    const racers = round.filter((res) => res.teamId !== '')

    // Rank teams by the pace they raced on; a team's two cars "should" finish around 2*rank-0.5 (the
    // midpoint of its grid slots). Both team-mates share this baseline, so a driver's delta reflects how
    // they did against the car rather than an arbitrary split within the pair.
    const teamRank = new Map<string, number>()
    ;[...new Set(racers.map((res) => res.teamId))].sort((a, b) => racePace(r, b) - racePace(r, a)).forEach((teamId, idx) => teamRank.set(teamId, idx + 1))
    const expectedOf = (teamId: string): number => 2 * (teamRank.get(teamId) ?? teams.length) - 0.5

    const teamBest = new Map<string, number>()
    const teamDeltas = new Map<string, number[]>()
    const dRow: Row = { round: r }
    for (const res of round) {
      if (res.teamId === '') continue
      driverSeen.set(res.driverId, { driverId: res.driverId, driverName: res.driverName, teamId: res.teamId })
      if (res.dnf || res.finishPosition == null) continue
      teamBest.set(res.teamId, Math.min(teamBest.get(res.teamId) ?? Infinity, res.finishPosition))
      const delta = Math.round((expectedOf(res.teamId) - res.finishPosition) * 10) / 10
      dRow[res.driverId] = delta
      const arr = teamDeltas.get(res.teamId) ?? []
      arr.push(delta)
      teamDeltas.set(res.teamId, arr)
    }
    driverDeltaRows.push(dRow)

    const fRow: Row = { round: r }
    const tRow: Row = { round: r }
    for (const t of teams) {
      const best = teamBest.get(t.id)
      if (best != null && best !== Infinity) fRow[t.id] = best
      const arr = teamDeltas.get(t.id)
      if (arr && arr.length) tRow[t.id] = Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10
    }
    teamFinishRows.push(fRow)
    teamDeltaRows.push(tRow)
  })

  const drivers = [...driverSeen.values()].sort((a, b) => a.teamId.localeCompare(b.teamId) || a.driverName.localeCompare(b.driverName))
  return { rounds, paceRows, teamFinishRows, teamDeltaRows, driverDeltaRows, drivers }
}
