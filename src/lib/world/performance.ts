import type { RaceResult, Team } from '@/lib/sim/types'
import type { CarPaceSnapshot } from '@/lib/store/season-store'

// Correlate car performance with results. From the per-round car-pace snapshots and the race results we
// derive, for every finisher, the pace of the car they drove and where it actually finished (the scatter),
// and per team per round, how the result compared to what the car's pace ranked it to do (the delta).

export interface PacePoint {
  round: number
  driverId: string
  driverName: string
  teamId: string
  pace: number   // the team's car pace that round (0-100)
  finish: number // actual finishing position
}

// One row per round: { round, [teamId]: delta }, delta = expected finish (from pace rank) - actual finish.
// Positive => the team finished better than the car's pace predicted (overperformance).
export type TeamDeltaRow = { round: number } & Record<string, number>

export interface PerformanceData {
  points: PacePoint[]
  deltaRows: TeamDeltaRow[]
  rounds: number
}

export function buildPerformanceData(
  raceResults: RaceResult[][],
  carPaceHistory: CarPaceSnapshot[],
  teams: Team[],
): PerformanceData {
  const start = carPaceHistory.find((h) => h.round === 0)
  const paceAt = (round: number, teamId: string): number => {
    const snap = carPaceHistory.find((h) => h.round === round) ?? start
    return snap?.paces[teamId] ?? 0
  }

  const points: PacePoint[] = []
  const deltaRows: TeamDeltaRow[] = []
  let rounds = 0

  raceResults.forEach((round, i) => {
    if (!round || round.length === 0) return
    const r = i + 1
    rounds = r
    const racers = round.filter((res) => res.teamId !== '')

    // Expected position = rank among the field by car pace that round (1 = fastest car).
    const expected = new Map<string, number>()
    ;[...racers].sort((a, b) => paceAt(r, b.teamId) - paceAt(r, a.teamId)).forEach((res, idx) => expected.set(res.driverId, idx + 1))

    const teamDeltas = new Map<string, number[]>()
    for (const res of round) {
      if (res.dnf || res.finishPosition == null || res.teamId === '') continue
      points.push({ round: r, driverId: res.driverId, driverName: res.driverName, teamId: res.teamId, pace: paceAt(r, res.teamId), finish: res.finishPosition })
      const exp = expected.get(res.driverId)
      if (exp == null) continue
      const arr = teamDeltas.get(res.teamId) ?? []
      arr.push(exp - res.finishPosition)
      teamDeltas.set(res.teamId, arr)
    }

    const row: TeamDeltaRow = { round: r }
    for (const t of teams) {
      const arr = teamDeltas.get(t.id)
      if (arr && arr.length) row[t.id] = Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10
    }
    deltaRows.push(row)
  })

  return { points, deltaRows, rounds }
}

// Least-squares fit of finish against pace, with R². Used to draw the scatter's trend line and report
// how tightly pace predicts results.
export function regression(points: { pace: number; finish: number }[]): { slope: number; intercept: number; r2: number } | null {
  const n = points.length
  if (n < 2) return null
  const mx = points.reduce((s, p) => s + p.pace, 0) / n
  const my = points.reduce((s, p) => s + p.finish, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (const p of points) {
    const dx = p.pace - mx, dy = p.finish - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const r = sxy / Math.sqrt(sxx * syy || 1)
  return { slope, intercept: my - slope * mx, r2: r * r }
}
