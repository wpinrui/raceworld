import type {
  Driver,
  Team,
  Circuit,
  RaceState,
  DriverRaceState,
  QualifyingResult,
  QualifyingSessionResult,
  GodModeAction,
  TyreState,
} from './types'
import { getMoistureAtLap } from './weather'
import { raceConditions } from './race-conditions'
import { computeTyreLife, recommendTyre } from './tyres'
import { TEMP } from './tyre-temp'
import { planStrategy, initTeamBelief, type TeamBelief } from './pit-ai'
import { pitLaneLoss } from './pit-loss'
import { sampleNormal } from './rng-utils'
import { confidenceFormMean } from './race-results'
import { simulateSlice, LAP_SLICE } from './slice'

// Roll each driver's pre-race form. The roll mean is set by the driver's confidence
// (2 + 0.6c, so c=5 -> mean 5), sampled Normal(mean, 1.8) clamped to [0, 10] (issue #58).
export function rollForms(drivers: Driver[]): Record<string, number> {
  const forms: Record<string, number> = {}
  for (const driver of drivers) {
    const mean = confidenceFormMean(driver.confidence)
    forms[driver.id] = Math.min(10, Math.max(0, sampleNormal(mean, 1.8, Math.random)))
  }
  return forms
}

// Standing-grid spacing: the time interval between adjacent grid slots at lights-out. Seeded into BOTH
// totalTime (so a car starts physically where its slot is) and gap (the interval to the car ahead), so the
// field begins properly bunched. Without this, lap 1 read each car as seconds clear of the car ahead, ran
// the whole field in clean air, and re-sorted it by raw pace in a single lap (the lap-1 overtake flood).
const GRID_SPACING = 0.5

export function initRaceState(
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  qualifyingResults: QualifyingResult[],
  qualifyingSessions: QualifyingSessionResult[],
  forms: Record<string, number>,
  year: number,
  strategyNoise: number = 0.35,
  saveSeed: string = '',
): RaceState {
  // Weather + tyre characteristics are seeded from (year, circuit) so the race runs exactly the
  // forecast and tyre picture a pre-race preview can show. Everything else this race (car form, team
  // beliefs, driver form, per-set tyre luck, lap wear) stays freshly random.
  const { weather, forecast: weatherForecast, compoundDeltas, tyreBaseLife } = raceConditions(saveSeed, year, circuit)
  const lap1Moisture = getMoistureAtLap(weather, 1)

  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))

  // Each team's tyre belief for this race — both drivers feed (and share) it.
  const teamBeliefs: Record<string, TeamBelief> = {}
  // Per-race car form (#65): one roll per team this race — a pace swing for a good or bad weekend,
  // applied equally to both the team's cars. Normal(0, σ) with σ ≈ 5.19 so the quartiles land at
  // ±3.5 (0.6745·σ ≈ 3.5). Added straight to car pace for the race (replaces the narrower trackCompat).
  // Hard-clamped at ±25 (~5 grid positions, ~4.8σ) so the otherwise-unbounded normal tail can't feed
  // an absurd pace into lap time. It's a safety rail, not a shaper: it virtually never binds and leaves
  // the specced distribution (quartiles ±3.5) intact.
  const CAR_FORM_SIGMA = 5.19
  const CAR_FORM_CAP = 25
  const carForm: Record<string, number> = {}
  for (const team of teams) {
    teamBeliefs[team.id] = initTeamBelief(circuit.laps)
    carForm[team.id] = Math.max(-CAR_FORM_CAP, Math.min(CAR_FORM_CAP, sampleNormal(0, CAR_FORM_SIGMA, Math.random)))
  }

  // Sort by grid position
  const sortedResults = [...qualifyingResults].sort(
    (a, b) => a.gridPosition - b.gridPosition,
  )

  const driverStates: DriverRaceState[] = sortedResults.map((qr) => {
    const driver = drivers.find((d) => d.id === qr.driverId)!
    const team = teamMap.get(driver.teamId)!

    const compound = recommendTyre(lap1Moisture)
    const maxLifeLaps = computeTyreLife(tyreBaseLife[compound], driver.smoothness, circuit.laps)

    const tyre: TyreState = {
      compound,
      condition: 100,
      maxLifeLaps,
    }

    const initialPlan = planStrategy(1, circuit.laps, 100, compound, driver.smoothness, teamBeliefs[team.id], weather, weatherForecast, pitLaneLoss(year))

    return {
      driverId: driver.id,
      position: qr.gridPosition,
      totalTime: (qr.gridPosition - 1) * GRID_SPACING,
      lapTimes: [],
      currentTyre: tyre,
      tyreTemp: TEMP.FRESH_TEMP,
      stintLap: 0,
      fuelLaps: circuit.laps,
      form: forms[driver.id] ?? 5,
      retired: false,
      retirementLap: null,
      retirementReason: null,
      mistakeCount: 0,
      worstMistakeLoss: 0,
      lastPitLap: 0,
      pitStops: 0,
      stintHistory: [],
      targetPitLap: initialPlan.targetPitLap,
      targetNextCompound: initialPlan.targetNextCompound,
      gap: qr.gridPosition === 1 ? 0 : GRID_SPACING,
      lapsDown: 0,
      dsq: false,
    }
  })

  return {
    circuitId: circuit.id,
    year,
    totalLaps: circuit.laps,
    currentLap: 1,
    weather,
    weatherForecast,
    drivers: driverStates,
    commentary: [],
    phase: 'pre-race',
    qualifyingResults,
    qualifyingSessions,
    speed: 1,
    paused: false,
    strategyNoise,
    compoundDeltas,
    tyreBaseLife,
    teamBeliefs,
    carForm,
  }
}

// The historical whole-lap tick, now a thin delegate onto the shared slice core (slice.ts): LAP_SLICE
// runs the exact per-lap path, bit-compatible with the pre-extraction engine (race.test.ts's seeded
// characterization snapshot is the gate). Headless racing (sim-ahead, probe scripts) enters here.
export function simulateLap(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  godModeActions?: GodModeAction[],
  // Reserved for cheaper strategy planning on long runs; the live race uses full-fidelity strategy.
  fastStrategy = false,
  // The cars the player drives directly (their push is honoured as set); every other car has its push
  // chosen by the AI heuristic each lap. Empty/absent → all AI (sandbox).
  playerControlledIds?: string[],
): RaceState {
  return simulateSlice(state, drivers, teams, circuit, year, LAP_SLICE, godModeActions, fastStrategy, playerControlledIds)
}
