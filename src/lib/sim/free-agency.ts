import type { Driver, Team, DriverMediaScore, TeamMediaScore, MarketMove, SeatContest, SeatContestDriver, DroppedDriver, RaceResult } from './types'
import { sampleNormal } from './rng-utils'
import { generateRookie } from './driver-generation'

// --- Fit-based retention (tuned in scripts/market-sim.mjs to ~4 changes/season) ---
// A team OFFERS to re-sign an expiring driver with a probability tied to how he did
// vs what his car's pace rank predicted (delta): P(offer) = sigmoid((delta+SHIFT)/SCALE).
// The offer is a strong retention thumb but NOT a lock — he still goes through the
// market and can leave for a better team that wants him, or be replaced if his team
// passed on him. A driver who beats his car keeps his seat through the noise of a
// fluctuating media rank; a clear underperformer is far likelier to be let go.
const OFFER_SHIFT = -4
const OFFER_SCALE = 2
const RETENTION_BONUS = 25 // perceived-value boost a team gives an incumbent it offered
const STAY_PULL = 12 // a driver's pull to re-sign with his current team
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

// delta = finish vs the car's PACE-RANK expectation, race-weighted. Expected seat
// finish = 2·carPaceRank − 0.5; perf = 0.3·avgGrid + 0.7·avgRace. Positive = beat the
// car. Returns a plain record so it can ride along in the persisted season summary.
export function computeRetentionDeltas(
  drivers: Driver[],
  teams: Team[],
  raceResults: RaceResult[][],
): Record<string, number> {
  const paceRank = new Map<string, number>()
  ;[...teams].sort((a, b) => b.carPace - a.carPace).forEach((t, i) => paceRank.set(t.id, i + 1))
  const agg = new Map<string, { grid: number; race: number; n: number }>()
  for (const round of raceResults) {
    const field = round.length || 20
    for (const r of round) {
      if (!agg.has(r.driverId)) agg.set(r.driverId, { grid: 0, race: 0, n: 0 })
      const a = agg.get(r.driverId)!
      a.grid += r.gridPosition
      a.race += r.dnf || r.finishPosition == null ? field : r.finishPosition
      a.n++
    }
  }
  const out: Record<string, number> = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    const a = agg.get(d.id)
    if (!a || a.n === 0) continue
    const expected = 2 * (paceRank.get(d.teamId) ?? teams.length) - 0.5
    const perf = 0.3 * (a.grid / a.n) + 0.7 * (a.race / a.n)
    out[d.id] = expected - perf
  }
  return out
}

// Contract length scales with a driver's STANDING among next season's grid
// (their media percentile, 0 = weakest, 1 = strongest), not an absolute media
// score — the absolute scale is compressed and uncertain, whereas the bottom
// third of the grid getting ~1-year deals is robust by construction. Sampled with
// normal noise so no length is ever impossible for a given driver, just weighted.
function contractLength(
  driver: Driver,
  percentile: number,
  isBestFreeAgent: boolean,
  rng: () => number,
): number {
  // Past their prime: short rolling deals — mostly 1 year, occasionally 2.
  if (driver.age > driver.primeEnd) {
    return Math.max(1, Math.min(2, Math.round(sampleNormal(1.3, 0.6, rng))))
  }

  let meanLen = 1 + percentile * 3 // weakest ≈ 1yr, strongest ≈ 4yr
  if (driver.primeEnd - driver.age <= 2) meanLen -= 0.7 // nearing decline: shorter
  const maxLen = isBestFreeAgent ? 5 : 4
  return Math.max(1, Math.min(maxLen, Math.round(sampleNormal(meanLen, 0.9, rng))))
}

const RETIREMENT_SEASONS_OUT = 5

// Ring rust: when a team weighs a free agent who is currently OUT of F1 (no seat
// last season), their perceived value takes this flat hit. Keeps the grid from
// churning wildly as pool drivers and seated drivers trade places every year —
// big enough to favour proven drivers, small enough that a star prospect breaks in.
const OUT_OF_F1_PENALTY = 5

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
  retentionDelta: Record<string, number>,
  newYear: number,
  rng: () => number,
): { updatedDrivers: Driver[]; marketMoves: MarketMove[]; seatContests: SeatContest[]; droppedDrivers: DroppedDriver[] } {
  const scoreMap = new Map(driverMediaScores.map((s) => [s.driverId, s.score]))
  const teamScoreMap = new Map(teamMediaScores.map((s) => [s.teamId, s.score]))
  const teamNameMap = new Map(teams.map((t) => [t.id, t.name]))
  const driverMedia = (id: string) => scoreMap.get(id) ?? 0
  // A team absent from the media map has no reputation yet — a brand-new constructor added by the
  // real-world transition AFTER the scores were computed. It must be the LEAST attractive seat (0), not
  // a mid-grid default (50); otherwise free agents (even the reigning champion) rank a backmarker
  // startup like a midfielder and the matching can sign them there.
  const teamMedia = (id: string) => teamScoreMap.get(id) ?? 0
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

  // Each expiring driver's current team OFFERS to re-sign him with a probability tied
  // to how he did vs his car (delta). An offer is a strong retention thumb, not a lock.
  const offered = new Set<string>()
  for (const fa of freeAgents) {
    if (fa.teamId === '') continue // pool drivers have no incumbent team
    if (rng() < sigmoid(((retentionDelta[fa.id] ?? 0) + OFFER_SHIFT) / OFFER_SCALE)) offered.add(fa.id)
  }

  // Preferences are sampled once and then fixed, so the matching is stable.
  // Team's perceived value: an incumbent it offered to gets a retention boost;
  // everyone else competes on media (+ youth upside, − ring rust).
  const tpKey = (teamId: string, driverId: string) => `${teamId}|${driverId}`
  const teamPerceived = new Map<string, number>()
  for (const t of openTeams) {
    for (const fa of freeAgents) {
      const youth = Math.max(0, Math.min(4, 23 - fa.age))
      const rust = fa.teamId === '' ? OUT_OF_F1_PENALTY : 0
      const base = fa.teamId === t.id && offered.has(fa.id)
        ? driverMedia(fa.id) + RETENTION_BONUS
        : driverMedia(fa.id) + youth - rust
      teamPerceived.set(tpKey(t.id, fa.id), base + sampleNormal(0, 8, rng))
    }
  }
  // Each free agent ranks open-seat teams by team media + noise, plus a pull to stay
  // at their current team — so they only leave for a clearly better seat that wants them.
  const prefList = new Map<string, string[]>()
  for (const fa of freeAgents) {
    const ranked = openTeams
      .map((t) => ({ id: t.id, v: teamMedia(t.id) + (fa.teamId === t.id ? STAY_PULL : 0) + sampleNormal(0, 10, rng) }))
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

  // Media percentile across next season's grid (stayers + everyone signed now),
  // used to scale contract length. Excludes the unsigned pool so a signing's length
  // reflects standing against the drivers it shares a grid with.
  const nextGridMedia: number[] = []
  for (const id of stayingDriverIds) nextGridMedia.push(driverMedia(id))
  for (const t of openTeams) for (const did of held.get(t.id)!) nextGridMedia.push(driverMedia(did))
  const sortedGrid = [...nextGridMedia].sort((a, b) => a - b)
  const gridPercentile = (m: number) =>
    sortedGrid.length > 1 ? sortedGrid.filter((x) => x < m).length / (sortedGrid.length - 1) : 0.5

  for (const t of openTeams) {
    for (const did of held.get(t.id)!) {
      const d = faById.get(did)!
      const score = driverMedia(did)
      const len = contractLength(d, gridPercentile(score), did === bestFreeAgentId, rng)
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

  // Dropped = had a seat last season, contract expired, signed nowhere this window.
  const droppedDrivers: DroppedDriver[] = drivers
    .filter((d) => !stayingDriverIds.has(d.id) && d.teamId !== '' && !driverUpdates.has(d.id))
    .map((d) => ({
      driverId: d.id,
      driverName: d.name,
      fromTeamId: d.teamId,
      fromTeamName: teamNameMap.get(d.teamId) ?? d.teamId,
      mediaScore: driverMedia(d.id),
    }))

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

  return { updatedDrivers, marketMoves, seatContests, droppedDrivers }
}
