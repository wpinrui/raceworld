import type { Driver, Team, DriverMediaScore, TeamMediaScore, MarketMove, SeatContest, SeatContestDriver } from './types'
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

// Ring rust: when a team weighs a free agent who is currently OUT of F1 (no seat
// last season), their perceived value takes this flat hit. Keeps the grid from
// churning wildly as pool drivers and seated drivers trade places every year —
// big enough to favour proven drivers, small enough that a star prospect breaks in.
const OUT_OF_F1_PENALTY = 8

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
  const driverMedia = (id: string) => scoreMap.get(id) ?? 0
  const teamMedia = (id: string) => teamScoreMap.get(id) ?? 50
  const currentYear = newYear - 1
  const round1 = (n: number) => Math.round(n * 10) / 10

  const stayingDriverIds = new Set(
    drivers
      .filter((d) => d.teamId !== '' && d.contractExpiresAfterSeason > currentYear)
      .map((d) => d.id),
  )

  const freeAgents = drivers.filter((d) => !stayingDriverIds.has(d.id))
  const faById = new Map(freeAgents.map((d) => [d.id, d]))

  const capacity = new Map<string, number>()
  for (const team of teams) {
    const filled = drivers.filter((d) => d.teamId === team.id && stayingDriverIds.has(d.id)).length
    capacity.set(team.id, Math.max(0, 2 - filled))
  }
  const openTeams = teams.filter((t) => (capacity.get(t.id) ?? 0) > 0)

  // Preferences are sampled once and then fixed, so the matching is stable.
  // Team's perceived value of a driver: media + incumbent bonus + noise (§142).
  const tpKey = (teamId: string, driverId: string) => `${teamId}|${driverId}`
  const teamPerceived = new Map<string, number>()
  for (const t of openTeams) {
    for (const fa of freeAgents) {
      const incumbent = fa.teamId === t.id ? 5 : 0
      const rust = fa.teamId === '' ? OUT_OF_F1_PENALTY : 0
      teamPerceived.set(tpKey(t.id, fa.id), driverMedia(fa.id) + incumbent - rust + sampleNormal(0, 10, rng))
    }
  }
  // Each free agent's ranking of open-seat teams: team media + noise, desc.
  const prefList = new Map<string, string[]>()
  for (const fa of freeAgents) {
    const ranked = openTeams
      .map((t) => ({ id: t.id, v: teamMedia(t.id) + sampleNormal(0, 10, rng) }))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.id)
    prefList.set(fa.id, ranked)
  }

  // Driver-proposing deferred acceptance (Gale–Shapley, teams have capacity).
  const held = new Map<string, Set<string>>()        // teamId -> tentatively-held driverIds
  const applicants = new Map<string, Set<string>>()  // teamId -> everyone who ever proposed
  for (const t of openTeams) { held.set(t.id, new Set()); applicants.set(t.id, new Set()) }
  const nextProposal = new Map<string, number>(freeAgents.map((d) => [d.id, 0]))
  const free = freeAgents.map((d) => d.id)

  while (free.length > 0) {
    const did = free.pop()!
    const prefs = prefList.get(did)!
    const idx = nextProposal.get(did)!
    if (idx >= prefs.length) continue // no teams left to try — stays unsigned
    const tid = prefs[idx]
    nextProposal.set(did, idx + 1)

    applicants.get(tid)!.add(did)
    const pool = held.get(tid)!
    pool.add(did)

    if (pool.size > (capacity.get(tid) ?? 0)) {
      const ranked = [...pool].sort(
        (a, b) => (teamPerceived.get(tpKey(tid, b)) ?? 0) - (teamPerceived.get(tpKey(tid, a)) ?? 0),
      )
      const cap = capacity.get(tid) ?? 0
      held.set(tid, new Set(ranked.slice(0, cap)))
      for (const dropped of ranked.slice(cap)) {
        if (nextProposal.get(dropped)! < prefList.get(dropped)!.length) free.push(dropped)
      }
    }
  }

  // Settle: tentative holds become signings.
  const bestFreeAgentId = [...freeAgents].sort((a, b) => driverMedia(b.id) - driverMedia(a.id))[0]?.id
  const marketMoves: MarketMove[] = []
  const seatContests: SeatContest[] = []
  const driverUpdates = new Map<string, Partial<Driver>>()

  for (const t of openTeams) {
    for (const did of held.get(t.id)!) {
      const d = faById.get(did)!
      const score = driverMedia(did)
      const len = contractLength(d, score, did === bestFreeAgentId, rng)
      driverUpdates.set(did, { teamId: t.id, contractExpiresAfterSeason: currentYear + len })
      marketMoves.push({
        driverId: did,
        driverName: d.name,
        fromTeamId: d.teamId === '' ? null : d.teamId,
        toTeamId: t.id,
        toTeamName: t.name,
        contractLength: len,
        contractExpiresAfterSeason: currentYear + len,
        mediaScore: score,
        isResignation: d.teamId === t.id,
      })
    }

    // Record the seat battle: who the team signed and who it turned away.
    const apps = applicants.get(t.id)!
    if (apps.size === 0) continue
    const winnersSet = held.get(t.id)!
    const toEntry = (did: string): SeatContestDriver => {
      const d = faById.get(did)!
      return {
        driverId: did,
        driverName: d.name,
        teamPerceived: round1(teamPerceived.get(tpKey(t.id, did)) ?? 0),
        incumbent: d.teamId === t.id,
      }
    }
    const byPerceived = (a: SeatContestDriver, b: SeatContestDriver) => b.teamPerceived - a.teamPerceived
    seatContests.push({
      teamId: t.id,
      teamName: t.name,
      seats: capacity.get(t.id) ?? 0,
      winners: [...winnersSet].map(toEntry).sort(byPerceived),
      rivals: [...apps].filter((id) => !winnersSet.has(id)).map(toEntry).sort(byPerceived),
    })
  }

  // Any seat still empty (more seats than free agents) goes to a rookie.
  const rookies: Driver[] = []
  for (const team of teams) {
    const remaining = (capacity.get(team.id) ?? 0) - (held.get(team.id)?.size ?? 0)
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
