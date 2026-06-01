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
  const pointsMap = new Map<string, number>()
  for (const d of drivers) pointsMap.set(d.id, 0)
  for (const round of raceResults) {
    for (const r of round) {
      pointsMap.set(r.driverId, (pointsMap.get(r.driverId) ?? 0) + r.points)
    }
  }

  const sortedPoints = [...pointsMap.values()].sort((a, b) => a - b)
  const N = sortedPoints.length

  function componentA(driverId: string): number {
    const pts = pointsMap.get(driverId) ?? 0
    const rankFromBottom = sortedPoints.filter((p) => p < pts).length
    return N > 1 ? (rankFromBottom / (N - 1)) * 100 : 50
  }

  // Drivers who never took part in a race this season have no results-based
  // signal. The media falls back to raw ability (pace-weighted overall) so a
  // strong free-agent prospect outranks a weak one instead of all tying at zero.
  const racedIds = new Set<string>()
  for (const round of raceResults) for (const r of round) racedIds.add(r.driverId)

  function abilityScore(driver: Driver): number {
    const ovr = 0.6 * driver.pace + 0.2 * driver.smoothness + 0.1 * driver.overtaking + 0.1 * driver.wetWeatherPace
    return Math.max(0, Math.min(100, ovr + driver.narrativeModifier))
  }

  const aScores = new Map<string, number>()
  for (const d of drivers) aScores.set(d.id, componentA(d.id))

  function componentB(driver: Driver): number {
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
    const teammateA = aScores.get(teammate.id) ?? 50
    return Math.max(0, Math.min(100, teammateA + (h2hRatio - 0.5) * 40))
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
    if (!racedIds.has(driver.id)) {
      return { driverId: driver.id, score: abilityScore(driver) }
    }
    const A = aScores.get(driver.id) ?? 50
    const B = componentB(driver)
    const C = componentC(driver)
    const score = Math.max(0, Math.min(100, 0.5 * A + 0.3 * B + 0.2 * C + driver.narrativeModifier))
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
