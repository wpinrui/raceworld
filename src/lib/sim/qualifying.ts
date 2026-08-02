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

// Out-lap penalty: the first qualifying run is a touch slower than the second (warm-up / track evolution),
// so lap 1 is generated exactly like lap 2 plus this offset. Best-of-2 still counts, so lap 1 mostly acts
// as a banker the driver falls back on only if they botch lap 2.
const LAP_ONE_PENALTY = 0.35

// Qualifying gets its own noise model (issue: more teammate variation). A symmetric baseline keeps near-
// equal teammates close to a coin-flip, and an occasional one-sided "compromised lap" (a mistake / traffic
// / yellow) lets even a much faster driver drop the odd session. Both scale off the same consistency
// spread the race uses (R = 1.2 - 0.01*consistency): at consistency 80, ~±0.30s baseline plus a 10% chance
// of losing 0.5–1.0s.
function qualifyingNoise(consistency: number, rng: () => number = Math.random): number {
  const r = 1.2 - 0.01 * consistency
  const baseline = (rng() * 2 - 1) * 0.75 * r // symmetric: tight for close teammates
  const compromisedLap = rng() < 0.25 * r ? 0.5 + rng() * 0.5 : 0 // occasional botched lap: 0.5–1.0s, one-sided
  return baseline + compromisedLap
}

type Sectors = [number, number, number]

// Sector boundaries are 30% / 40% / 30% of the lap by distance, so the PERFECT (noise-free) lap splits in
// those proportions. The lap's deviation from perfect (the noise, plus any out-lap penalty) is shared
// across the three sectors with jittered ~equal weights so the loss is somewhat even, and S3 takes the
// exact remainder so the three sectors always sum back to the final lap time.
function splitSectors(perfect: number, deviation: number, total: number): Sectors {
  const j = () => 1 + (Math.random() - 0.5) * 0.8
  const w = [j(), j(), j()]
  const wsum = w[0] + w[1] + w[2]
  const s1 = perfect * 0.3 + deviation * (w[0] / wsum)
  const s2 = perfect * 0.4 + deviation * (w[1] / wsum)
  return [s1, s2, total - s1 - s2]
}

function simulateQualifyingLap(
  driver: Driver,
  team: Team,
  circuit: Circuit,
  form: number,
  lapPenalty: number,
): { time: number; sectors: Sectors } {
  const tyre: TyreState = {
    compound: selectQualifyingTyre(),
    condition: 100,
    maxLifeLaps: 999,
  }
  const weather: WeatherPoint[] = [{ lap: 1, moisture: 0 }]

  const noiseVal = qualifyingNoise(driver.consistency)
  const result = computeLapTime({
    driver, team, tyre, form,
    fuelLaps: 0, lap: 1,
    weather, compoundDeltas: DEFAULT_COMPOUND_DELTAS,
    gapToCarAhead: Infinity, carAheadLapTime: null,
    circuitFlatModifier: circuit.flatModifier,
    circuitStraightness: circuit.straightness,
    noiseOverride: noiseVal,
  })

  const time = result.lapTime + lapPenalty
  const perfect = result.lapTime - noiseVal // computeLapTime with the noise removed = the deterministic lap
  return { time, sectors: splitSectors(perfect, time - perfect, time) }
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

    const r1 = simulateQualifyingLap(driver, team, circuit, form, LAP_ONE_PENALTY)
    const r2 = simulateQualifyingLap(driver, team, circuit, form, 0)
    const lap1 = r1.time
    const lap2 = r2.time
    const best = Math.min(lap1, lap2)

    q1SessionLaps.push({ driverId, lap1, lap2, best, lap1Sectors: r1.sectors, lap2Sectors: r2.sectors })

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

    const r1 = simulateQualifyingLap(driver, team, circuit, form, LAP_ONE_PENALTY)
    const r2 = simulateQualifyingLap(driver, team, circuit, form, 0)
    const lap1 = r1.time
    const lap2 = r2.time
    const best = Math.min(lap1, lap2)

    q2SessionLaps.push({ driverId, lap1, lap2, best, lap1Sectors: r1.sectors, lap2Sectors: r2.sectors })

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

    const r1 = simulateQualifyingLap(driver, team, circuit, form, LAP_ONE_PENALTY)
    const r2 = simulateQualifyingLap(driver, team, circuit, form, 0)
    const lap1 = r1.time
    const lap2 = r2.time
    const best = Math.min(lap1, lap2)

    q3SessionLaps.push({ driverId, lap1, lap2, best, lap1Sectors: r1.sectors, lap2Sectors: r2.sectors })

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
