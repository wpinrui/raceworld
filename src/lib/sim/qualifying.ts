import type {
  Driver,
  Team,
  Circuit,
  QualifyingResult,
  QualifyingSessionResult,
  QualifyingLap,
  TyreCompound,
  TyreState,
  WeatherPoint,
} from './types'
import { computeLapTime } from './engine'

function rollSessionMoisture(): number {
  if (Math.random() < 0.67) {
    return 0
  }
  return Math.min(1, 0.01 + Math.random() * 0.99)
}

function selectQualifyingTyre(moisture: number): TyreCompound {
  if (moisture < 0.10) return 'soft'
  if (moisture <= 0.35) return 'intermediate'
  return 'wet'
}

function simulateQualifyingLap(
  driver: Driver,
  team: Team,
  circuit: Circuit,
  moisture: number,
  form: number,
): number {
  const compound = selectQualifyingTyre(moisture)
  const tyre: TyreState = {
    compound,
    condition: 100,
    maxLifeLaps: 999,
  }
  const weather: WeatherPoint[] = [{ lap: 1, moisture }]

  const result = computeLapTime({
    driver,
    team,
    tyre,
    form,
    fuelLaps: 0,
    lap: 1,
    totalLaps: 1,
    weather,
    gapToCarAhead: Infinity,
    carAheadLapTime: null,
    circuitFlatModifier: circuit.flatModifier,
  })

  return result.lapTime
}

export function runQualifying(
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  forms: Record<string, number>,
): { results: QualifyingResult[]; sessions: QualifyingSessionResult[] } {
  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))

  // Build initial results map
  const qualResults = new Map<string, QualifyingResult>()
  for (const driver of drivers) {
    qualResults.set(driver.id, {
      driverId: driver.id,
      gridPosition: 0,
      bestTime: null,
      q1Time: null,
      q2Time: null,
      q3Time: null,
    })
  }

  const sessions: QualifyingSessionResult[] = []

  // Track which drivers are still active
  let activeDriverIds = drivers.map((d) => d.id)
  const eliminatedInQ1: string[] = []
  const eliminatedInQ2: string[] = []

  // Determine group sizes
  const totalDrivers = drivers.length
  // Q1: all drivers; eliminate bottom (totalDrivers - 15) to get 15 for Q2
  // Q2: 15 remaining; eliminate bottom 5 to get 10 for Q3
  const q1Eliminate = Math.max(0, totalDrivers - 15)
  const q2Eliminate = 5

  // --- Q1 ---
  const q1Moisture = rollSessionMoisture()
  const q1SessionLaps: QualifyingLap[] = []

  for (const driverId of activeDriverIds) {
    const driver = drivers.find((d) => d.id === driverId)!
    const team = teamMap.get(driver.teamId)!
    const form = forms[driverId] ?? 5

    const lap1 = simulateQualifyingLap(driver, team, circuit, q1Moisture, form)
    const lap2 = simulateQualifyingLap(driver, team, circuit, q1Moisture, form)
    const best = Math.min(lap1, lap2)

    q1SessionLaps.push({ driverId, lap1, lap2, best })

    const result = qualResults.get(driverId)!
    result.q1Time = best
    result.bestTime = best
  }

  // Sort by best time ascending (null last)
  q1SessionLaps.sort((a, b) => {
    if (a.best === null && b.best === null) return 0
    if (a.best === null) return 1
    if (b.best === null) return -1
    return a.best - b.best
  })

  // Eliminate bottom drivers from Q1
  const q1Eliminated = q1SessionLaps.slice(q1SessionLaps.length - q1Eliminate).map((l) => l.driverId)
  eliminatedInQ1.push(...q1Eliminated)

  sessions.push({
    session: 'Q1',
    results: q1SessionLaps,
    eliminated: q1Eliminated,
  })

  // Set grid positions for Q1 eliminated (P16-20 or beyond)
  // We'll assign positions after all sessions
  activeDriverIds = activeDriverIds.filter((id) => !q1Eliminated.includes(id))

  // --- Q2 ---
  const q2Moisture = rollSessionMoisture()
  const q2SessionLaps: QualifyingLap[] = []

  for (const driverId of activeDriverIds) {
    const driver = drivers.find((d) => d.id === driverId)!
    const team = teamMap.get(driver.teamId)!
    const form = forms[driverId] ?? 5

    const lap1 = simulateQualifyingLap(driver, team, circuit, q2Moisture, form)
    const lap2 = simulateQualifyingLap(driver, team, circuit, q2Moisture, form)
    const best = Math.min(lap1, lap2)

    q2SessionLaps.push({ driverId, lap1, lap2, best })

    const result = qualResults.get(driverId)!
    result.q2Time = best
    if (result.bestTime === null || best < result.bestTime) {
      result.bestTime = best
    }
  }

  q2SessionLaps.sort((a, b) => {
    if (a.best === null && b.best === null) return 0
    if (a.best === null) return 1
    if (b.best === null) return -1
    return a.best - b.best
  })

  const q2Eliminate2 = Math.max(0, activeDriverIds.length - 10)
  const q2Eliminated = q2SessionLaps.slice(q2SessionLaps.length - q2Eliminate2).map((l) => l.driverId)
  eliminatedInQ2.push(...q2Eliminated)

  sessions.push({
    session: 'Q2',
    results: q2SessionLaps,
    eliminated: q2Eliminated,
  })

  activeDriverIds = activeDriverIds.filter((id) => !q2Eliminated.includes(id))

  // --- Q3 ---
  const q3Moisture = rollSessionMoisture()
  const q3SessionLaps: QualifyingLap[] = []

  for (const driverId of activeDriverIds) {
    const driver = drivers.find((d) => d.id === driverId)!
    const team = teamMap.get(driver.teamId)!
    const form = forms[driverId] ?? 5

    const lap1 = simulateQualifyingLap(driver, team, circuit, q3Moisture, form)
    const lap2 = simulateQualifyingLap(driver, team, circuit, q3Moisture, form)
    const best = Math.min(lap1, lap2)

    q3SessionLaps.push({ driverId, lap1, lap2, best })

    const result = qualResults.get(driverId)!
    result.q3Time = best
    if (result.bestTime === null || best < result.bestTime) {
      result.bestTime = best
    }
  }

  q3SessionLaps.sort((a, b) => {
    if (a.best === null && b.best === null) return 0
    if (a.best === null) return 1
    if (b.best === null) return -1
    return a.best - b.best
  })

  sessions.push({
    session: 'Q3',
    results: q3SessionLaps,
    eliminated: [],
  })

  // --- Assign grid positions ---
  // P1-10: Q3 order
  let gridPos = 1
  for (const lap of q3SessionLaps) {
    qualResults.get(lap.driverId)!.gridPosition = gridPos++
  }

  // P11-15: Q2 order (eliminated from Q2, best to worst in Q2)
  for (const lap of q2SessionLaps) {
    if (q2Eliminated.includes(lap.driverId)) {
      qualResults.get(lap.driverId)!.gridPosition = gridPos++
    }
  }

  // P16+: Q1 order (eliminated from Q1, best to worst in Q1)
  for (const lap of q1SessionLaps) {
    if (q1Eliminated.includes(lap.driverId)) {
      qualResults.get(lap.driverId)!.gridPosition = gridPos++
    }
  }

  const results = Array.from(qualResults.values()).sort(
    (a, b) => a.gridPosition - b.gridPosition,
  )

  return { results, sessions }
}
