import type { RaceResult, Team } from '@/lib/sim/types'
import type { CarPaceSnapshot } from '@/lib/store/season-store'

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
  const paceAt = (round: number, teamId: string): number => (carPaceHistory.find((h) => h.round === round) ?? start)?.paces[teamId] ?? 0

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

    // Expected position = field rank by car pace that round (1 = fastest car).
    const expected = new Map<string, number>()
    ;[...racers].sort((a, b) => paceAt(r, b.teamId) - paceAt(r, a.teamId)).forEach((res, idx) => expected.set(res.driverId, idx + 1))

    const teamBest = new Map<string, number>()
    const teamDeltas = new Map<string, number[]>()
    const dRow: Row = { round: r }
    for (const res of round) {
      if (res.teamId === '') continue
      driverSeen.set(res.driverId, { driverId: res.driverId, driverName: res.driverName, teamId: res.teamId })
      if (res.dnf || res.finishPosition == null) continue
      teamBest.set(res.teamId, Math.min(teamBest.get(res.teamId) ?? Infinity, res.finishPosition))
      const exp = expected.get(res.driverId)
      if (exp == null) continue
      const delta = exp - res.finishPosition
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
