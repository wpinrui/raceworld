import type {
  Driver,
  Team,
  RaceResult,
  DriverMediaScore,
  TeamMediaScore,
  ConstructorSeasonRecord,
  MarketMove,
} from './types'
import { sampleNormal } from './rng-utils'
import { FAKER_LOCALES, FAKER_LOCALE_CODES } from '@/data/driver-name-pool'

// ─── Media score computation ────────────────────────────────────────────────

export function computeDriverMediaScores(
  drivers: Driver[],
  _teams: Team[],
  raceResults: RaceResult[][],
  constructorRankInfo: Array<{ teamId: string; points: number; finalPosition: number }>,
  totalTeams: number,
): DriverMediaScore[] {
  // Compute total season points per driver
  const pointsMap = new Map<string, number>()
  for (const d of drivers) pointsMap.set(d.id, 0)
  for (const round of raceResults) {
    for (const r of round) {
      pointsMap.set(r.driverId, (pointsMap.get(r.driverId) ?? 0) + r.points)
    }
  }

  // Component A: bottom-up percentile of season points
  const sortedPoints = [...pointsMap.values()].sort((a, b) => a - b)
  const N = sortedPoints.length

  function componentA(driverId: string): number {
    const pts = pointsMap.get(driverId) ?? 0
    const rankFromBottom = sortedPoints.filter((p) => p < pts).length
    return N > 1 ? (rankFromBottom / (N - 1)) * 100 : 50
  }

  // Precompute A scores so B can reference teammate's A
  const aScores = new Map<string, number>()
  for (const d of drivers) aScores.set(d.id, componentA(d.id))

  // Component B: H2H vs teammate
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

      // Qualifying H2H
      const dq = dr.q1Time ?? dr.q2Time ?? dr.q3Time
      const tq = tr.q1Time ?? tr.q2Time ?? tr.q3Time
      if (dq !== null && tq !== null) {
        qualTotal++
        if (dq < tq) qualWins++
      }

      // Race H2H
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

  // Component C: car-adjusted overperformance
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
  // Collect up to 2 most recent prior seasons (current already passed in)
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

// ─── Retirements ────────────────────────────────────────────────────────────

export function determineRetirements(
  drivers: Driver[],
  driverMediaScores: DriverMediaScore[],
  currentYear: number,
): string[] {
  const scoreMap = new Map(driverMediaScores.map((s) => [s.driverId, s.score]))
  const retired: string[] = []

  for (const driver of drivers) {
    const score = scoreMap.get(driver.id) ?? 50
    const tooOld = driver.age > driver.primeEnd + 5
    const scoreTooLow = score < 27
    if (tooOld || scoreTooLow) retired.push(driver.id)
  }

  return retired
}

// ─── Driver market / free agency ────────────────────────────────────────────

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

  // Age modifier
  if (driver.age > driver.primeEnd) {
    minLen = 1; maxLen = 1
  } else if (driver.primeEnd - driver.age <= 2) {
    maxLen = Math.max(minLen, maxLen - 1)
  }

  // ±1 noise
  if (rng() < 0.10) {
    const bump = rng() < 0.5 ? 1 : -1
    minLen = Math.max(1, minLen + bump)
    maxLen = Math.max(minLen, maxLen + bump)
  }

  // Top free agent can get 5yr if not past prime
  if (isBestFreeAgent && driver.age <= driver.primeEnd) {
    maxLen = Math.max(maxLen, 5)
  }

  const len = Math.floor(rng() * (maxLen - minLen + 1)) + minLen
  return Math.max(1, Math.min(5, len))
}

let generatedCounter = 0

function pickLocaleIndex(): number {
  return Math.floor(Math.random() * FAKER_LOCALES.length)
}

function pickName(usedNames: Set<string>): { name: string; nationality: string } {
  for (let attempt = 0; attempt < 40; attempt++) {
    const idx = pickLocaleIndex()
    const f = FAKER_LOCALES[idx]
    const sex = Math.random() < 0.05 ? 'female' : 'male'
    const name = `${f.person.firstName(sex)} ${f.person.lastName()}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return { name, nationality: FAKER_LOCALE_CODES[idx] }
    }
  }
  generatedCounter++
  return { name: `Driver ${generatedCounter}`, nationality: 'GB' }
}

/** Generate a pool of free-agent drivers for the market (teamId = ''). */
export function generateFreeAgentPool(
  count: number,
  year: number,
  existingDrivers: Driver[],
  rng: () => number,
): Driver[] {
  const usedNames = new Set(existingDrivers.map((d) => d.name))
  const pool: Driver[] = []

  for (let i = 0; i < count; i++) {
    generatedCounter++
    const { name, nationality } = pickName(usedNames)

    const age = 17 + Math.floor(rng() * 5) // 17–21
    const peakPotential = Math.max(55, Math.min(99, Math.round(sampleNormal(72, 10, rng))))
    // Young drivers sit at ~80% of their ceiling — high-potential ones already look promising
    const statCap = Math.floor(peakPotential * 0.92)
    const paceMean = peakPotential * 0.80
    const pace = Math.max(45, Math.min(statCap, Math.round(sampleNormal(paceMean, 5, rng))))
    const stat = () => Math.max(40, Math.min(statCap, Math.round(sampleNormal(pace - 2, 6, rng))))
    const primeEnd = Math.max(age + 1, Math.round(Math.max(27, Math.min(35, sampleNormal(30, 2, rng)))))

    pool.push({
      id: `gen-${year}-${generatedCounter}`,
      name,
      teamId: '',
      nationality,
      pace,
      wetWeatherPace: stat(),
      overtaking: stat(),
      smoothness: stat(),
      age,
      peakPotential,
      primeEnd,
      narrativeModifier: 0,
      contractExpiresAfterSeason: year - 1, // no active contract
    })
  }

  return pool
}

let rookieCounter = 0

function generateRookie(teamId: string, newYear: number, rng: () => number): Driver {
  rookieCounter++
  const stat = () => Math.max(55, Math.min(78, Math.round(sampleNormal(68, 5, rng))))
  const { name, nationality } = pickName(new Set())
  return {
    id: `rookie-${teamId}-${newYear}-${rookieCounter}`,
    name,
    nationality,
    teamId,
    pace: stat(),
    wetWeatherPace: stat(),
    overtaking: stat(),
    smoothness: stat(),
    age: 19 + Math.floor(rng() * 3),
    peakPotential: Math.max(72, Math.min(92, Math.round(sampleNormal(82, 6, rng)))),
    primeEnd: 29 + Math.floor(rng() * 3),
    narrativeModifier: 0,
    contractExpiresAfterSeason: newYear,
  }
}

export function runDriverMarket(
  drivers: Driver[],
  teams: Team[],
  retiredDriverIds: string[],
  driverMediaScores: DriverMediaScore[],
  teamMediaScores: TeamMediaScore[],
  newYear: number,
  rng: () => number,
): { updatedDrivers: Driver[]; marketMoves: MarketMove[] } {
  const scoreMap = new Map(driverMediaScores.map((s) => [s.driverId, s.score]))
  const teamScoreMap = new Map(teamMediaScores.map((s) => [s.teamId, s.score]))
  const currentYear = newYear - 1

  // Drivers staying (active contract, not retired, on a real team)
  const stayingDriverIds = new Set(
    drivers
      .filter(
        (d) =>
          d.teamId !== '' &&
          d.contractExpiresAfterSeason > currentYear &&
          !retiredDriverIds.includes(d.id),
      )
      .map((d) => d.id),
  )

  // Free agents: expired/uncontracted grid drivers + market pool (teamId=''), not retired
  const freeAgents = drivers
    .filter(
      (d) =>
        !retiredDriverIds.includes(d.id) &&
        !stayingDriverIds.has(d.id),
    )
    .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))

  // Vacant seats per team
  const seatsPerTeam = new Map<string, number>()
  for (const team of teams) {
    const filled = drivers.filter((d) => d.teamId === team.id && stayingDriverIds.has(d.id)).length
    seatsPerTeam.set(team.id, Math.max(0, 2 - filled))
  }

  const marketMoves: MarketMove[] = []
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
    })
  }

  // Fill any still-vacant seats with generated rookies
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
      })
    }
  }

  // Build final driver list:
  // - Keep staying drivers unchanged
  // - Apply updates to placed free agents
  // - Unplaced free agents stay with teamId='' (remain in market pool)
  // - Drop retired drivers
  // - Add rookies placed into teams
  const updatedDrivers = [
    ...drivers
      .filter((d) => !retiredDriverIds.includes(d.id))
      .map((d) => {
        const update = driverUpdates.get(d.id)
        return update ? { ...d, ...update } : d
      }),
    ...rookies,
  ]

  return { updatedDrivers, marketMoves }
}
