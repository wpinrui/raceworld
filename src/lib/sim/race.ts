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
  TeamTyreAssumptions,
} from './types'
import { generateWeatherCurve, getMoistureAtLap } from './weather'
import { computeTyreLife, degradeTyre, recommendTyre } from './tyres'
import { computeLapTime } from './engine'
import { decidePit, planStrategy, sampleTeamAssumptions } from './pit-ai'
import { generateCommentary } from './commentary'
import { sampleNormal, sampleExponential } from './rng-utils'
import { confidenceFormMean } from './race-results'
import { perLapTechnicalDNF, sampleTechnicalFailure } from './reliability'

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

export function initRaceState(
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  qualifyingResults: QualifyingResult[],
  qualifyingSessions: QualifyingSessionResult[],
  forms: Record<string, number>,
  strategyNoise: number = 0.35,
): RaceState {
  const weather = generateWeatherCurve(circuit.laps)
  const lap1Moisture = getMoistureAtLap(weather, 1)

  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))

  // Sample one set of tyre assumptions per team — both drivers share these
  const teamAssumptions: Record<string, TeamTyreAssumptions> = {}
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
    teamAssumptions[team.id] = sampleTeamAssumptions(circuit.laps, strategyNoise)
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
    const maxLifeLaps = computeTyreLife(compound, driver.smoothness, circuit.laps)

    const tyre: TyreState = {
      compound,
      condition: 100,
      maxLifeLaps,
    }

    const assumptions = teamAssumptions[team.id]
    const initialPlan = planStrategy(1, circuit.laps, 100, compound, maxLifeLaps, assumptions)

    return {
      driverId: driver.id,
      position: qr.gridPosition,
      totalTime: 0,
      lapTimes: [],
      currentTyre: tyre,
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
      gap: (qr.gridPosition - 1) * 0.5,
      dsq: false,
    }
  })

  return {
    circuitId: circuit.id,
    totalLaps: circuit.laps,
    currentLap: 1,
    weather,
    drivers: driverStates,
    commentary: [],
    phase: 'pre-race',
    qualifyingResults,
    qualifyingSessions,
    speed: 1,
    paused: false,
    strategyNoise,
    teamAssumptions,
    carForm,
  }
}

export function simulateLap(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  godModeActions?: GodModeAction[],
): RaceState {
  const driverMap = new Map<string, Driver>(drivers.map((d) => [d.id, d]))
  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))

  // Deep-copy driver states
  let driverStates: DriverRaceState[] = state.drivers.map((d) => ({
    ...d,
    currentTyre: { ...d.currentTyre },
    lapTimes: [...d.lapTimes],
  }))

  // Step 1: Apply god mode actions
  if (godModeActions && godModeActions.length > 0) {
    driverStates = driverStates.map((ds) => {
      const actions = godModeActions.filter((a) => a.driverId === ds.driverId)
      if (actions.length === 0) return ds

      let updated = { ...ds, currentTyre: { ...ds.currentTyre } }
      for (const action of actions) {
        if (action.type === 'set-tyre-condition' && action.value !== undefined) {
          updated = {
            ...updated,
            currentTyre: { ...updated.currentTyre, condition: action.value },
          }
        } else if (action.type === 'force-retire') {
          updated = {
            ...updated,
            retired: true,
            retirementLap: state.currentLap,
            retirementReason: sampleTechnicalFailure(),
          }
        } else if (action.type === 'set-form' && action.value !== undefined) {
          updated = { ...updated, form: action.value }
        }
      }
      return updated
    })
  }

  // Sort by position order for processing
  const sortedByPosition = [...driverStates].sort((a, b) => a.position - b.position)

  const prevMoisture = getMoistureAtLap(state.weather, Math.max(1, state.currentLap - 1))
  const currentMoisture = getMoistureAtLap(state.weather, state.currentLap)

  // Per-lap technical-failure chance for this race — flat across cars, varying only by era (issue #61).
  const techDNFPerLap = perLapTechnicalDNF(year, state.totalLaps)

  // Track lap times this lap for gap logic
  const lapTimesThisLap = new Map<string, number>()

  // Step 2: Process each driver in position order
  const updatedStates = new Map<string, DriverRaceState>(
    driverStates.map((d) => [d.driverId, d]),
  )

  for (const ds of sortedByPosition) {
    let current = { ...updatedStates.get(ds.driverId)!, currentTyre: { ...updatedStates.get(ds.driverId)!.currentTyre } }

    // 2a. Technical failure (issue #61) — era-scaled per-lap chance, a specific failure type.
    if (!current.retired && Math.random() < techDNFPerLap) {
      current = {
        ...current,
        retired: true,
        retirementLap: state.currentLap,
        retirementReason: sampleTechnicalFailure(),
      }
      updatedStates.set(current.driverId, current)
      continue
    }

    // 2b. If retired, skip
    if (current.retired) {
      updatedStates.set(current.driverId, current)
      continue
    }

    // Resolve driver/team early — needed for pit AI and lap time
    const driver = driverMap.get(current.driverId)!
    const team = teamMap.get(driver.teamId)!

    // 2b'. Consistency mistake roll (issue #59). Per-lap chance rate(c) = 1.3e-5·(100 - c)²
    // (c=65 -> 1.6%, 75 -> 0.8%, 90 -> 0.13%/lap). On a mistake: 20% crash out (collision-damage DNF),
    // else a one-lap time loss of 2 + Exp(mean 3) s clamped to [2, 25].
    let mistakeTimeLoss = 0
    const consistency = driver.consistency
    if (Math.random() < 1.3e-5 * (100 - consistency) ** 2) {
      current = { ...current, mistakeCount: current.mistakeCount + 1 }
      if (Math.random() < 0.2) {
        current = {
          ...current,
          retired: true,
          retirementLap: state.currentLap,
          retirementReason: 'collision-damage',
        }
        updatedStates.set(current.driverId, current)
        continue
      }
      mistakeTimeLoss = Math.min(25, Math.max(2, 2 + sampleExponential(3, Math.random)))
      current = { ...current, worstMistakeLoss: Math.max(current.worstMistakeLoss, mistakeTimeLoss) }
    }

    // 2c. Re-solve strategy this lap (adapts to weather changes, actual wear, etc.)
    const assumptions = state.teamAssumptions[team.id]
    const newPlan = planStrategy(
      state.currentLap,
      state.totalLaps,
      current.currentTyre.condition,
      current.currentTyre.compound,
      current.currentTyre.maxLifeLaps,
      assumptions,
    )
    current = { ...current, targetPitLap: newPlan.targetPitLap, targetNextCompound: newPlan.targetNextCompound }

    // 2d. Decide whether to pit this lap based on the plan
    let pitDecision = decidePit(current, state.currentLap, state.totalLaps, state.weather)

    // God mode pit overrides
    const godActionsForDriver = (godModeActions ?? []).filter(a => a.driverId === current.driverId)
    const forcePit = [...godActionsForDriver].reverse().find(a => a.type === 'force-pit')
    const cancelPit = godActionsForDriver.find(a => a.type === 'cancel-pit')
    if (forcePit) {
      pitDecision = { shouldPit: true, targetCompound: forcePit.compound ?? pitDecision.targetCompound }
    } else if (cancelPit) {
      pitDecision = { shouldPit: false, targetCompound: pitDecision.targetCompound }
    }

    let pitPenalty = 0
    let pitted = false

    if (pitDecision.shouldPit) {
      pitted = true
      pitPenalty = 20 + Math.random() * 4
      const newMaxLifeLaps = computeTyreLife(
        pitDecision.targetCompound,
        driver.smoothness,
        state.totalLaps,
      )
      current = {
        ...current,
        currentTyre: {
          compound: pitDecision.targetCompound,
          condition: 100,
          maxLifeLaps: newMaxLifeLaps,
        },
        stintHistory: [...current.stintHistory, { compound: current.currentTyre.compound, laps: current.stintLap + 1 }],
        stintLap: 0,
        lastPitLap: state.currentLap,
        pitStops: current.pitStops + 1,
      }
    }

    // 2e. Find car ahead
    const carAheadState = sortedByPosition.find(
      (d) =>
        !d.retired &&
        d.driverId !== current.driverId &&
        (updatedStates.get(d.driverId)?.position ?? d.position) === current.position - 1,
    )

    let gapToCarAhead: number = Infinity
    let carAheadLapTime: number | null = null

    if (carAheadState) {
      gapToCarAhead = current.gap
      carAheadLapTime = lapTimesThisLap.get(carAheadState.driverId) ?? null
    }

    // 2e. Compute lap time — this race's car form shifts the car's pace for the whole race
    // (0 = neutral; the form delta adds straight to car pace for both the team's cars).
    const form = state.carForm[team.id] ?? 0
    const raceTeam = form === 0 ? team : { ...team, carPace: team.carPace + form }
    const lapResult = computeLapTime({
      driver,
      team: raceTeam,
      tyre: current.currentTyre,
      form: current.form,
      fuelLaps: current.fuelLaps,
      lap: state.currentLap,
      weather: state.weather,
      gapToCarAhead,
      carAheadLapTime,
      circuitFlatModifier: circuit.flatModifier,
      defenderDriver: carAheadState ? driverMap.get(carAheadState.driverId) : undefined,
    })

    const finalLapTime = lapResult.lapTime + pitPenalty + mistakeTimeLoss
    lapTimesThisLap.set(current.driverId, finalLapTime)

    // 2f. Overtake collision (issue #60): retire whoever the crash took out, reason 'collision-damage'.
    if (lapResult.crash?.happened && carAheadState) {
      if (lapResult.crash.defender) {
        const ahead = updatedStates.get(carAheadState.driverId)
        if (ahead && !ahead.retired) {
          updatedStates.set(carAheadState.driverId, { ...ahead, retired: true, retirementLap: state.currentLap, retirementReason: 'collision-damage' })
        }
      }
      if (lapResult.crash.attacker) {
        current = { ...current, retired: true, retirementLap: state.currentLap, retirementReason: 'collision-damage' }
        updatedStates.set(current.driverId, current)
        continue // attacker is out — skip the rest of this lap's processing
      }
    }

    // 2g. If overtook: swap positions with car ahead
    if (lapResult.overtook && carAheadState) {
      const aheadUpdated = updatedStates.get(carAheadState.driverId)!
      updatedStates.set(carAheadState.driverId, {
        ...aheadUpdated,
        position: current.position,
      })
      current = { ...current, position: aheadUpdated.position }
    }

    // 2h. Degrade tyre
    const newCondition = degradeTyre(current.currentTyre)
    current = {
      ...current,
      currentTyre: { ...current.currentTyre, condition: newCondition },
    }

    // 2i. Decrement fuelLaps
    current = { ...current, fuelLaps: Math.max(0, current.fuelLaps - 1) }

    // 2j. Accumulate totalTime
    current = { ...current, totalTime: current.totalTime + finalLapTime }

    // 2k. Increment stintLap (unless we just pitted, stintLap was set to 0 above)
    current = { ...current, stintLap: current.stintLap + 1 }

    // 2l. Append lapTime
    current = { ...current, lapTimes: [...current.lapTimes, finalLapTime] }

    // Pit lap belongs to the old stint (already counted via +1 in history).
    // Undo the increment so the new stint starts at 0; out-lap becomes lap 1 next tick.
    if (pitted) {
      current = { ...current, stintLap: 0 }
    }

    updatedStates.set(current.driverId, current)
  }

  // Step 3: Re-sort drivers by totalTime (retired go last, sorted by retirementLap desc)
  const allStates = Array.from(updatedStates.values())
  const activeDrivers = allStates.filter((d) => !d.retired).sort((a, b) => a.totalTime - b.totalTime)
  const retiredDrivers = allStates
    .filter((d) => d.retired)
    .sort((a, b) => (b.retirementLap ?? 0) - (a.retirementLap ?? 0))

  const finalOrder = [...activeDrivers, ...retiredDrivers]

  // Step 4: Re-assign positions 1..n
  const repositioned = finalOrder.map((d, index) => ({
    ...d,
    position: index + 1,
  }))

  // Step 5: Recompute gaps
  const withGaps = repositioned.map((d, index) => {
    if (index === 0 || d.retired) return { ...d, gap: 0 }
    const prev = repositioned[index - 1]
    const gap = d.retired ? 0 : Math.max(0, d.totalTime - prev.totalTime)
    return { ...d, gap }
  })

  // Step 6: Generate commentary
  const driverNames: Record<string, string> = {}
  for (const driver of drivers) {
    driverNames[driver.id] = driver.name
  }

  const prevStates = state.drivers
  const newCommentary = generateCommentary(
    state.currentLap,
    prevStates,
    withGaps,
    driverNames,
    state.totalLaps,
    prevMoisture,
    currentMoisture,
  )

  // Step 7: Return new state
  const nextLap = state.currentLap + 1
  const finished = nextLap > state.totalLaps

  return {
    ...state,
    currentLap: nextLap,
    drivers: withGaps,
    commentary: [...state.commentary, ...newCommentary],
    phase: finished ? 'finished' : 'racing',
  }
}
