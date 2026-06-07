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
// WeatherPoint used in computeLapTime call signature only
import { computeLapTime } from './engine'
import { DEFAULT_COMPOUND_DELTAS } from './tyres'

function selectQualifyingTyre(): TyreCompound {
  return 'soft' // M1: always dry, always softs in qualifying
}

function simulateQualifyingLap(
  driver: Driver,
  team: Team,
  circuit: Circuit,
  form: number,
): number {
  const tyre: TyreState = {
    compound: selectQualifyingTyre(),
    condition: 100,
    maxLifeLaps: 999,
  }
  const weather: WeatherPoint[] = [{ lap: 1, moisture: 0 }]

  const result = computeLapTime({
    driver, team, tyre, form,
    fuelLaps: 0, lap: 1,
    weather, compoundDeltas: DEFAULT_COMPOUND_DELTAS,
    gapToCarAhead: Infinity, carAheadLapTime: null,
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

  // Determine group sizes. Q3 always holds exactly 10. The (totalDrivers - 10) eliminations are split as
  // evenly as possible between Q1 and Q2 (the canonical even-grid case is (x - 10) / 2 each); Q1 takes the
  // larger half. Q2's own cut (below) then always reduces the field to 10, whatever the grid size.
  const totalDrivers = drivers.length
  const eliminateTotal = Math.max(0, totalDrivers - 10)
  const q1Eliminate = Math.ceil(eliminateTotal / 2)

  // --- Q1 ---
  const q1SessionLaps: QualifyingLap[] = []

  for (const driverId of activeDriverIds) {
    const driver = drivers.find((d) => d.id === driverId)!
    const team = teamMap.get(driver.teamId)!
    const form = forms[driverId] ?? 5

    const lap1 = simulateQualifyingLap(driver, team, circuit, form)
    const lap2 = simulateQualifyingLap(driver, team, circuit, form)
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
  const q2SessionLaps: QualifyingLap[] = []

  for (const driverId of activeDriverIds) {
    const driver = drivers.find((d) => d.id === driverId)!
    const team = teamMap.get(driver.teamId)!
    const form = forms[driverId] ?? 5

    const lap1 = simulateQualifyingLap(driver, team, circuit, form)
    const lap2 = simulateQualifyingLap(driver, team, circuit, form)
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
  const q3SessionLaps: QualifyingLap[] = []

  for (const driverId of activeDriverIds) {
    const driver = drivers.find((d) => d.id === driverId)!
    const team = teamMap.get(driver.teamId)!
    const form = forms[driverId] ?? 5

    const lap1 = simulateQualifyingLap(driver, team, circuit, form)
    const lap2 = simulateQualifyingLap(driver, team, circuit, form)
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
