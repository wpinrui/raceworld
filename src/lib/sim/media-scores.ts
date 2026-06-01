import type {
  Driver,
  Team,
  RaceResult,
  DriverMediaScore,
  TeamMediaScore,
  ConstructorSeasonRecord,
} from './types'

export function computeDriverMediaScores(
  drivers: Driver[],
  _teams: Team[],
  raceResults: RaceResult[][],
  constructorRankInfo: Array<{ teamId: string; points: number; finalPosition: number }>,
  totalTeams: number,
): DriverMediaScore[] {
  // Component A is a percentile within the current grid only — free agents (who
  // didn't race) are not part of the championship and must not dilute it.
  const pointsMap = new Map<string, number>()
  for (const d of drivers) if (d.teamId !== '') pointsMap.set(d.id, 0)
  for (const round of raceResults) {
    for (const r of round) {
      if (pointsMap.has(r.driverId)) pointsMap.set(r.driverId, (pointsMap.get(r.driverId) ?? 0) + r.points)
    }
  }

  const sortedPoints = [...pointsMap.values()].sort((a, b) => a - b)
  const N = sortedPoints.length

  function componentA(driverId: string): number {
    if (!pointsMap.has(driverId)) return 0 // not on the grid (free agent)
    const pts = pointsMap.get(driverId) ?? 0
    const rankFromBottom = sortedPoints.filter((p) => p < pts).length
    return N > 1 ? (rankFromBottom / (N - 1)) * 100 : 50
  }

  // Teammate H2H around a neutral baseline of 50 — NOT anchored to the
  // teammate's (car-suppressed) score, so a bad car can't penalise B twice.
  function componentB(driver: Driver): number {
    if (driver.teamId === '') return 50 // free agent: no teammate
    const teammates = drivers.filter((d) => d.teamId === driver.teamId && d.id !== driver.id)
    if (teammates.length === 0) return 50

    const teammate = teammates[0]
    let qualWins = 0, qualTotal = 0
    let raceWins = 0, raceTotal = 0

    for (const round of raceResults) {
      const dr = round.find((r) => r.driverId === driver.id)
      const tr = round.find((r) => r.driverId === teammate.id)
      if (!dr || !tr) continue

      const dq = dr.q1Time ?? dr.q2Time ?? dr.q3Time
      const tq = tr.q1Time ?? tr.q2Time ?? tr.q3Time
      if (dq !== null && tq !== null) {
        qualTotal++
        if (dq < tq) qualWins++
      }

      const df = dr.dnf ? null : dr.finishPosition
      const tf = tr.dnf ? null : tr.finishPosition
      if (df !== null || tf !== null) {
        raceTotal++
        if (df !== null && (tf === null || df < tf)) raceWins++
      }
    }

    const qualH2H = qualTotal > 0 ? qualWins / qualTotal : 0.5
    const raceH2H = raceTotal > 0 ? raceWins / raceTotal : 0.5
    const h2hRatio = 0.4 * qualH2H + 0.6 * raceH2H
    return Math.max(0, Math.min(100, 50 + (h2hRatio - 0.5) * 40))
  }

  function componentC(driver: Driver): number {
    const info = constructorRankInfo.find((c) => c.teamId === driver.teamId)
    if (!info) return 50

    const teamDrivers = drivers.filter((d) => d.teamId === driver.teamId)
    const teamTotal = teamDrivers.reduce((s, d) => s + (pointsMap.get(d.id) ?? 0), 0)
    const driverPts = pointsMap.get(driver.id) ?? 0
    const actualShare = teamTotal > 0 ? driverPts / teamTotal : 0.5
    const raw = (actualShare - 0.5) * (info.finalPosition / totalTeams)
    return Math.max(0, Math.min(100, (raw + 0.5) * 100))
  }

  return drivers.map((driver) => {
    const A = componentA(driver.id)
    const B = componentB(driver)
    const C = componentC(driver)
    // A free agent has no results, so their raw pace is converted into a
    // narrative swing — the only signal we have on an unproven driver.
    const paceNarrative = driver.teamId === '' ? Math.max(-20, Math.min(20, (driver.pace - 68) * 0.8)) : 0
    const score = Math.max(0, Math.min(100, 0.5 * A + 0.3 * B + 0.2 * C + driver.narrativeModifier + paceNarrative))
    return { driverId: driver.id, score }
  })
}

export function computeTeamMediaScores(
  teams: Team[],
  history: ConstructorSeasonRecord[],
  currentSeasonInfo: Array<{ teamId: string; points: number; finalPosition: number }>,
): TeamMediaScore[] {
  const priorSeasons = [...new Set(history.map((r) => r.seasonYear))]
    .sort((a, b) => b - a)
    .slice(0, 2)

  function weightedPoints(teamId: string): number {
    const curr = currentSeasonInfo.find((c) => c.teamId === teamId)?.points ?? 0
    let total = curr * 3
    let weightSum = 3

    priorSeasons.forEach((yr, idx) => {
      const pts = history.find((r) => r.teamId === teamId && r.seasonYear === yr)?.points ?? 0
      const w = idx === 0 ? 2 : 1
      total += pts * w
      weightSum += w
    })

    return total / weightSum
  }

  const wpValues = teams.map((t) => weightedPoints(t.id))
  const maxWp = Math.max(...wpValues, 1)

  return teams.map((team, idx) => ({
    teamId: team.id,
    score: Math.max(0, Math.min(100, (wpValues[idx] / maxWp) * 100)),
  }))
}
