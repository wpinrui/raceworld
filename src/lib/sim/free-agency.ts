import type { Driver, Team, DriverMediaScore, TeamMediaScore, MarketMove, SeatContest } from './types'
import { sampleNormal } from './rng-utils'
import { generateRookie } from './driver-generation'

function contractLength(
  driver: Driver,
  mediaScore: number,
  isBestFreeAgent: boolean,
  rng: () => number,
): number {
  let minLen: number, maxLen: number

  if (mediaScore >= 80) { minLen = 3; maxLen = 4 }
  else if (mediaScore >= 60) { minLen = 2; maxLen = 3 }
  else { minLen = 1; maxLen = 2 }

  if (driver.age > driver.primeEnd) {
    minLen = 1; maxLen = 1
  } else if (driver.primeEnd - driver.age <= 2) {
    maxLen = Math.max(minLen, maxLen - 1)
  }

  if (rng() < 0.10) {
    const bump = rng() < 0.5 ? 1 : -1
    minLen = Math.max(1, minLen + bump)
    maxLen = Math.max(minLen, maxLen + bump)
  }

  if (isBestFreeAgent && driver.age <= driver.primeEnd) {
    maxLen = Math.max(maxLen, 5)
  }

  const len = Math.floor(rng() * (maxLen - minLen + 1)) + minLen
  return Math.max(1, Math.min(5, len))
}

const RETIREMENT_SEASONS_OUT = 5

// Run after the driver market has settled. A driver holding a seat for the
// coming season resets to 0; a driver without one accrues another season out
// of F1 and is removed from the market once they reach RETIREMENT_SEASONS_OUT.
export function applyMarketAttrition(
  drivers: Driver[],
): { drivers: Driver[]; retiredDriverIds: string[] } {
  const retiredDriverIds: string[] = []
  const updated: Driver[] = []

  for (const d of drivers) {
    const seasonsOut = d.teamId === '' ? (d.seasonsSinceF1Seat ?? 0) + 1 : 0
    if (seasonsOut >= RETIREMENT_SEASONS_OUT) {
      retiredDriverIds.push(d.id)
      continue
    }
    updated.push({ ...d, seasonsSinceF1Seat: seasonsOut })
  }

  return { drivers: updated, retiredDriverIds }
}

export function runDriverMarket(
  drivers: Driver[],
  teams: Team[],
  driverMediaScores: DriverMediaScore[],
  teamMediaScores: TeamMediaScore[],
  newYear: number,
  rng: () => number,
): { updatedDrivers: Driver[]; marketMoves: MarketMove[]; seatContests: SeatContest[] } {
  const scoreMap = new Map(driverMediaScores.map((s) => [s.driverId, s.score]))
  const teamScoreMap = new Map(teamMediaScores.map((s) => [s.teamId, s.score]))
  const currentYear = newYear - 1

  const stayingDriverIds = new Set(
    drivers
      .filter(
        (d) =>
          d.teamId !== '' &&
          d.contractExpiresAfterSeason > currentYear,
      )
      .map((d) => d.id),
  )

  const freeAgents = drivers
    .filter((d) => !stayingDriverIds.has(d.id))
    .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))

  const seatsPerTeam = new Map<string, number>()
  for (const team of teams) {
    const filled = drivers.filter((d) => d.teamId === team.id && stayingDriverIds.has(d.id)).length
    seatsPerTeam.set(team.id, Math.max(0, 2 - filled))
  }

  // Each free agent's most-wanted team (deterministic desire, no noise) — used
  // to attribute who else was chasing a seat once it's won.
  const preferredTeam = new Map<string, string>()
  for (const fa of freeAgents) {
    let bestId = teams[0]?.id ?? '', bestVal = -Infinity
    for (const t of teams) {
      const v = (teamScoreMap.get(t.id) ?? 50) + (fa.teamId === t.id ? 5 : 0)
      if (v > bestVal) { bestVal = v; bestId = t.id }
    }
    preferredTeam.set(fa.id, bestId)
  }

  const marketMoves: MarketMove[] = []
  const seatContests: SeatContest[] = []
  const driverUpdates = new Map<string, Partial<Driver>>()
  const placedIds = new Set<string>()

  const bestFreeAgentId = freeAgents[0]?.id

  for (const fa of freeAgents) {
    const vacantTeams = teams.filter((t) => (seatsPerTeam.get(t.id) ?? 0) > 0)
    if (vacantTeams.length === 0) break

    const scored = vacantTeams.map((t) => {
      const base = teamScoreMap.get(t.id) ?? 50
      const incumbentBonus = fa.teamId === t.id ? 5 : 0
      return { team: t, perceived: base + incumbentBonus + sampleNormal(0, 10, rng) }
    })
    scored.sort((a, b) => b.perceived - a.perceived)

    const chosen = scored[0].team
    seatsPerTeam.set(chosen.id, (seatsPerTeam.get(chosen.id) ?? 0) - 1)

    const faScore = scoreMap.get(fa.id) ?? 50
    const isBest = fa.id === bestFreeAgentId
    const len = contractLength(fa, faScore, isBest, rng)

    driverUpdates.set(fa.id, {
      teamId: chosen.id,
      contractExpiresAfterSeason: currentYear + len,
    })

    // Rivals = still-unsigned free agents who also wanted this team but were
    // edged out (lower media score, processed later).
    const rivals = freeAgents
      .filter((r) => r.id !== fa.id && !placedIds.has(r.id) && preferredTeam.get(r.id) === chosen.id)
      .map((r) => ({ driverId: r.id, driverName: r.name, mediaScore: scoreMap.get(r.id) ?? 0 }))
      .sort((a, b) => b.mediaScore - a.mediaScore)
    if (rivals.length > 0) {
      seatContests.push({
        teamId: chosen.id,
        teamName: chosen.name,
        winnerDriverId: fa.id,
        winnerDriverName: fa.name,
        winnerMediaScore: faScore,
        incumbent: fa.teamId === chosen.id,
        rivals,
      })
    }

    placedIds.add(fa.id)

    marketMoves.push({
      driverId: fa.id,
      driverName: fa.name,
      fromTeamId: fa.teamId === '' ? null : fa.teamId,
      toTeamId: chosen.id,
      toTeamName: chosen.name,
      contractLength: len,
      contractExpiresAfterSeason: currentYear + len,
      mediaScore: faScore,
      isResignation: fa.teamId === chosen.id,
    })
  }

  const rookies: Driver[] = []
  for (const team of teams) {
    const remaining = seatsPerTeam.get(team.id) ?? 0
    for (let i = 0; i < remaining; i++) {
      const rookie = generateRookie(team.id, newYear, rng)
      rookies.push(rookie)
      marketMoves.push({
        driverId: rookie.id,
        driverName: rookie.name,
        fromTeamId: null,
        toTeamId: team.id,
        toTeamName: team.name,
        contractLength: 1,
        contractExpiresAfterSeason: newYear,
        mediaScore: 0,
        isResignation: false,
      })
    }
  }

  const updatedDrivers = [
    ...drivers.map((d) => {
      const update = driverUpdates.get(d.id)
      if (update) return { ...d, ...update }
      // A free agent who didn't sign this window holds no seat — clear any
      // stale teamId left over from an expired contract.
      if (!stayingDriverIds.has(d.id) && d.teamId !== '') return { ...d, teamId: '' }
      return d
    }),
    ...rookies,
  ]

  return { updatedDrivers, marketMoves, seatContests }
}
