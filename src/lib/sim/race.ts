import type {
  Driver,
  Team,
  Circuit,
  RaceState,
  DriverRaceState,
  QualifyingResult,
  QualifyingSessionResult,
  GodModeAction,
  PushState,
  TyreState,
} from './types'
import { getMoistureAtLap } from './weather'
import { raceConditions } from './race-conditions'
import { computeTyreLife, wearTyre, recommendTyre, DIRTY_AIR_WEAR_MULT } from './tyres'
import { computeLapTime } from './engine'
import { applyCarForm, effectiveCarPace } from './car-rating'
import { TEMP, nextTyreTemp, pacePush, pushWearMult, coldPenalty, hotPenalty, overheatWearMult, tyreWearRatingMult } from './tyre-temp'
import { resolveIntensity, advancePreset, resolvePlayerPush, NORMAL } from './push'
import { decidePit, planStrategy, initTeamBelief, observeTyre, bucketCondition, type TeamBelief, type FieldCar } from './pit-ai'
import { pitLaneLoss, doubleStackPenalty } from './pit-loss'
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

// ---- simulateLap phases -------------------------------------------------------------------------
// The per-lap simulation's bookend phases, named and lifted out of simulateLap. The per-driver race
// loop (lap time, pit, overtake, attrition) stays inline: its sub-steps share heavily-mutated per-car
// state and a tight RNG-draw order that splitting would obscure. Only applyGodModeActions draws RNG
// here (the forced-retirement reason), and it runs at exactly the same point as before.

// Step 1: apply god-mode actions (tyre condition, forced retirement, form override) to the lap's
// working driver states.
function applyGodModeActions(driverStates: DriverRaceState[], godModeActions: GodModeAction[] | undefined, currentLap: number): DriverRaceState[] {
  if (!godModeActions || godModeActions.length === 0) return driverStates
  return driverStates.map((ds) => {
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
          retirementLap: currentLap,
          retirementReason: sampleTechnicalFailure(),
        }
      } else if (action.type === 'set-form' && action.value !== undefined) {
        updated = { ...updated, form: action.value }
      }
    }
    return updated
  })
}

// Update each team's tyre belief from BOTH its cars' (bucketed) condition — pooled, learned by running.
function updateTeamBeliefs(state: RaceState, driverMap: Map<string, Driver>): Record<string, TeamBelief> {
  const teamBeliefs: Record<string, TeamBelief> = { ...state.teamBeliefs }
  for (const ds of state.drivers) {
    if (ds.retired) continue
    const d = driverMap.get(ds.driverId)
    if (!d) continue
    teamBeliefs[d.teamId] = observeTyre(
      teamBeliefs[d.teamId],
      ds.currentTyre.compound,
      bucketCondition(ds.currentTyre.condition),
      ds.stintLap,
      d.smoothness,
      state.compoundDeltas[ds.currentTyre.compound],
    )
  }
  return teamBeliefs
}

// Steps 3-4: classify the field — running cars by elapsed time, retired cars last (latest retirement
// first) — and re-number positions 1..n.
function classifyByResult(states: DriverRaceState[]): DriverRaceState[] {
  const activeDrivers = states.filter((d) => !d.retired).sort((a, b) => a.totalTime - b.totalTime)
  const retiredDrivers = states
    .filter((d) => d.retired)
    .sort((a, b) => (b.retirementLap ?? 0) - (a.retirementLap ?? 0))
  return [...activeDrivers, ...retiredDrivers].map((d, index) => ({ ...d, position: index + 1 }))
}

// Step 5: recompute each car's gap to the car ahead (0 for the leader and for retirees).
function recomputeGaps(repositioned: DriverRaceState[]): DriverRaceState[] {
  return repositioned.map((d, index) => {
    if (index === 0 || d.retired) return { ...d, gap: 0 }
    const prev = repositioned[index - 1]
    const gap = d.retired ? 0 : Math.max(0, d.totalTime - prev.totalTime)
    return { ...d, gap }
  })
}

// Step 5b: lapped-runner accounting — whole laps behind the leader, from the time deficit ÷ the
// leader's average lap. The engine still runs every car in lockstep; this is the illusion of lapping,
// and at the flag it credits a lapped car totalLaps - lapsDown laps (see buildRaceResults).
function applyLappedRunners(withGaps: DriverRaceState[], currentLap: number): DriverRaceState[] {
  const leaderTotal = withGaps.find((d) => !d.retired)?.totalTime ?? 0
  const leaderAvgLap = leaderTotal / Math.max(1, currentLap)
  if (leaderAvgLap <= 0) return withGaps
  return withGaps.map((d) =>
    d.retired ? d : { ...d, lapsDown: Math.max(0, Math.floor((d.totalTime - leaderTotal) / leaderAvgLap)) },
  )
}

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
  const driverMap = new Map<string, Driver>(drivers.map((d) => [d.id, d]))
  const teamMap = new Map<string, Team>(teams.map((t) => [t.id, t]))
  const playerSet = new Set(playerControlledIds ?? [])

  // A cheap deterministic clean-air pace proxy (lap-time delta from base, lower = faster): car + this race's
  // form, plus driver pace. Deliberately OMITS fuel, tyre wear, and per-lap noise — it only has to be monotone
  // in RELATIVE pace to judge whether the car behind is a real threat. Folding fuel in would make defending
  // depend on lap number, and tyre age would make it jitter; neither belongs in a "is this a fair fight" check.
  const dryPaceProxy = (drv: Driver, tm: Team): number =>
    (75 - effectiveCarPace(applyCarForm(tm, state.carForm[tm.id] ?? 0), circuit.straightness)) / 25 -
    (drv.pace - 75) * 0.03

  // Deep-copy driver states
  let driverStates: DriverRaceState[] = state.drivers.map((d) => ({
    ...d,
    currentTyre: { ...d.currentTyre },
    lapTimes: [...d.lapTimes],
  }))

  // Step 1: Apply god mode actions
  driverStates = applyGodModeActions(driverStates, godModeActions, state.currentLap)

  // Sort by position order for processing
  const sortedByPosition = [...driverStates].sort((a, b) => a.position - b.position)

  const prevMoisture = getMoistureAtLap(state.weather, Math.max(1, state.currentLap - 1))
  const currentMoisture = getMoistureAtLap(state.weather, state.currentLap)

  // Per-lap technical-failure chance for this race — flat across cars, varying only by era (issue #61).
  const techDNFPerLap = perLapTechnicalDNF(year, state.totalLaps)
  // Era pit-lane loss + double-stack penalty (issue #101) — one source, shared with the planner below.
  const pitLoss = pitLaneLoss(year)
  const stackPenalty = doubleStackPenalty(year)

  // Track lap times this lap for gap logic
  const lapTimesThisLap = new Map<string, number>()
  const freeAirThisLap = new Map<string, number>() // each car's clean-air pace this lap, for the next car's pass gate

  // Update each team's tyre belief from BOTH its cars' (bucketed) condition, then snapshot the field
  // by track position (last lap's gaps) for undercut / clear-air.
  const teamBeliefs = updateTeamBeliefs(state, driverMap)
  const field: FieldCar[] = state.drivers.map((d) => ({
    driverId: d.driverId, position: d.position, totalTime: d.totalTime, condition: d.currentTyre.condition, retired: d.retired,
  }))
  const fieldByDriver = new Map(field.map((f) => [f.driverId, f]))

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
    // Push (#sim-overhaul / #push-auto): work out how hard this car runs this lap, weighing the car BEHIND so a
    // driver defends (pushes back) against a genuine threat instead of leaving an attacker a free pace boost.
    // Control mode: a non-player car is full AI ('auto'); a player car follows its own selection ('manual'),
    // hands off to the AI in Team Manager ('auto'), or auto-defends in Driver mode ('autoDefend').
    const tempIn = current.tyreTemp ?? TEMP.FRESH_TEMP
    let gapBehind = Infinity
    let chaserPaceEdge = 0 // how much faster (s/lap) the car right behind is; >0 = a real threat
    const carBehindState = sortedByPosition.find(
      (d) => !d.retired && d.driverId !== current.driverId &&
        (updatedStates.get(d.driverId)?.position ?? d.position) === current.position + 1,
    )
    if (carBehindState) {
      const chaser = driverMap.get(carBehindState.driverId)!
      const chaserTeam = teamMap.get(chaser.teamId)!
      // The car behind hasn't been stepped yet this lap and gaps aren't recomputed until lap-end, so the
      // snapshot's gap (this car → the one ahead, i.e. me) is the live interval behind.
      gapBehind = carBehindState.gap
      chaserPaceEdge = dryPaceProxy(driver, team) - dryPaceProxy(chaser, chaserTeam)
    }
    const pushCtx = { gapAhead: current.gap, gapBehind, chaserPaceEdge, condition: current.currentTyre.condition, temp: tempIn }
    const pushMode: 'auto' | 'autoDefend' | 'manual' = !playerSet.has(current.driverId)
      ? 'auto'
      : current.pushAuto ? 'auto' : current.autoDefend ? 'autoDefend' : 'manual'
    const { push, defending } = resolvePlayerPush(pushMode, current.push ?? NORMAL, pushCtx)
    const intensity = resolveIntensity(push)

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

    // 2c. Re-solve strategy this lap. The team plans on its PROJECTED condition (100 − believed wear
    // rate × laps on the tyre), not the coarse bucket reading — a smooth, stint-anchored guess of where
    // the tyre is, so it aims for ~the cliff buffer without the target lap receding. Buckets still feed
    // the rate (above); when the guess is off the real cliff catches it.
    const cBelief = teamBeliefs[team.id][current.currentTyre.compound]
    const bkt = bucketCondition(current.currentTyre.condition)
    const rateProj = 100 - cBelief.baseWearRate * (0.5 + driver.smoothness / 100) * current.stintLap
    // Clamp the rate-based guess to the bucket the pit wall actually reads — it can't believe the tyre
    // is fresher (or deader) than the visible bucket allows.
    const projectedCond = Math.max(0, Math.min(100, Math.max(bkt - 12.5, Math.min(bkt + 12.5, rateProj))))
    // A lapped runner takes the flag when the leader finishes, so it only races to totalLaps - lapsDown.
    // Plan its tyres to THAT distance (fewer laps to cover), never to a lap it has already passed.
    const effectiveLaps = Math.max(state.currentLap, state.totalLaps - current.lapsDown)
    const plan = planStrategy(
      state.currentLap,
      effectiveLaps,
      projectedCond,
      current.currentTyre.compound,
      driver.smoothness,
      teamBeliefs[team.id],
      state.weather,
      state.weatherForecast,
      pitLoss,
      !fastStrategy,
    )
    current = { ...current, targetPitLap: plan.targetPitLap, targetNextCompound: plan.targetNextCompound }

    // 2d. Decide whether to pit this lap — window + undercut / clear-air, forced at the real cliff.
    const selfField = fieldByDriver.get(current.driverId)!
    let pitDecision = decidePit(
      plan,
      current.currentTyre.condition,
      projectedCond,
      current.currentTyre.compound,
      currentMoisture,
      selfField,
      field,
      pitLoss,
    )

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
      // Double-stack (issue #101): if a teammate already pitted THIS lap (processed earlier = ahead on
      // track), the crew is still busy when this, the latter car, arrives. It only waits out the crew-
      // busy time the on-track gap hasn't already absorbed: max(0, stackPenalty - gap). Right behind ->
      // the full wait; a few seconds back -> little or none.
      let stackExtra = 0
      for (const [id, st] of updatedStates) {
        if (id === current.driverId || st.lastPitLap !== state.currentLap) continue
        if (driverMap.get(id)?.teamId !== driver.teamId) continue
        const myT = fieldByDriver.get(current.driverId)?.totalTime ?? 0
        const tmT = fieldByDriver.get(id)?.totalTime ?? 0
        stackExtra = Math.max(stackExtra, Math.max(0, stackPenalty - Math.abs(myT - tmT)))
      }
      // Era pit-lane loss + a small execution jitter (clean vs scruffy stop), plus any stacking wait.
      pitPenalty = pitLoss + (Math.random() * 2 - 1) * 1.5 + stackExtra
      const newMaxLifeLaps = computeTyreLife(
        state.tyreBaseLife[pitDecision.targetCompound],
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
        tyreTemp: TEMP.FRESH_TEMP, // fresh tyre fitted: starts cold-ish, wants warming
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

    // A car that PITS this lap dives into the pit lane and rejoins ~20s down the order — it's no longer an
    // obstacle ahead on track. Clamping the follower to its pit-inflated lap time (engine.ts "hold station")
    // would drag the follower down with it (a ~10s phantom lap to sit a few tenths behind a car that pitted).
    // So treat the follower as in clear air this lap; the gap recompute moves it up past the pitted car.
    const aheadPittedThisLap = carAheadState != null
      && updatedStates.get(carAheadState.driverId)?.lastPitLap === state.currentLap

    if (carAheadState && !aheadPittedThisLap) {
      gapToCarAhead = current.gap
      carAheadLapTime = lapTimesThisLap.get(carAheadState.driverId) ?? null
    }

    // 2e. Compute lap time — this race's car form shifts the car's pace for the whole race
    // (0 = neutral; the form delta adds straight to the pace ratings for both the team's cars).
    const form = state.carForm[team.id] ?? 0
    const raceTeam = applyCarForm(team, form)
    // Push + cold-tyre pace adjustment goes INTO the engine's clean-air pace (#sim-overhaul), so it flows
    // through dirty air and the overtake gate (pushing helps you pass; cold tyres make you easy to pass).
    const tyreWarming = team.tyreWarming ?? team.carPace
    const lapResult = computeLapTime({
      driver,
      team: raceTeam,
      tyre: current.currentTyre,
      form: current.form,
      fuelLaps: current.fuelLaps,
      lap: state.currentLap,
      weather: state.weather,
      compoundDeltas: state.compoundDeltas,
      gapToCarAhead,
      carAheadLapTime,
      carAheadFreeAir: carAheadState ? (freeAirThisLap.get(carAheadState.driverId) ?? null) : null,
      circuitFlatModifier: circuit.flatModifier,
      circuitStraightness: circuit.straightness,
      paceDelta: pacePush(intensity) + coldPenalty(tempIn) + hotPenalty(tempIn),
      defenderDriver: carAheadState ? driverMap.get(carAheadState.driverId) : undefined,
    })

    const finalLapTime = lapResult.lapTime + pitPenalty + mistakeTimeLoss
    lapTimesThisLap.set(current.driverId, finalLapTime)
    freeAirThisLap.set(current.driverId, lapResult.freeAir)

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

    // 2g. If overtook: swap positions with the car ahead, and the overtaken car loses time too (the fight
    // costs both). The defender penalty also drives the cascade — the next car back then sees it slower.
    if (lapResult.overtook && carAheadState) {
      const aheadUpdated = updatedStates.get(carAheadState.driverId)!
      const pen = lapResult.defenderPenalty ?? 0
      const aheadLaps = pen > 0 && aheadUpdated.lapTimes.length
        ? aheadUpdated.lapTimes.map((t, i) => (i === aheadUpdated.lapTimes.length - 1 ? t + pen : t))
        : aheadUpdated.lapTimes
      updatedStates.set(carAheadState.driverId, {
        ...aheadUpdated,
        position: current.position,
        totalTime: aheadUpdated.totalTime + pen,
        lapTimes: aheadLaps,
      })
      if (pen > 0) lapTimesThisLap.set(carAheadState.driverId, (lapTimesThisLap.get(carAheadState.driverId) ?? 0) + pen)
      current = { ...current, position: aheadUpdated.position }
    }

    // 2h. Degrade tyre — multipliers stack on the noisy base: dirty air (within ~1s) wears it faster, the
    // car's tyre-wear rating scales it, pushing wears more (backing off less), and running OVER the heat
    // window shreds it. Then advance the tyre temperature, and the push state (presets auto-revert), for next lap.
    const wearMult =
      (gapToCarAhead < 1.0 ? DIRTY_AIR_WEAR_MULT : 1) *
      tyreWearRatingMult(team.tyreWear ?? team.carPace) *
      pushWearMult(intensity) *
      overheatWearMult(tempIn)
    const newCondition = wearTyre(current.currentTyre, wearMult)
    const newTemp = nextTyreTemp(tempIn, intensity, tyreWarming)
    // Carry the push state to next lap by mode:
    //  manual     → advance the preset (it auto-reverts once its goal is met).
    //  auto       → store the AI's live pick, so a Team-Manager player sees what their car is doing. No revert.
    //  autoDefend → KEEP the selected intent (normal); the defensive push was transient and must not stick, so
    //               the toggle stays armed and the panel keeps showing Normal selected (#push-auto careful case).
    const nextPush: PushState =
      pushMode === 'autoDefend' ? (current.push ?? NORMAL)
      : pushMode === 'auto' ? push
      : advancePreset(push, { temp: newTemp, gapAhead: current.gap, overtook: lapResult.overtook })
    current = {
      ...current,
      currentTyre: { ...current.currentTyre, condition: newCondition },
      tyreTemp: newTemp,
      push: nextPush,
      defending,
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

  // Steps 3-4: classify the field (running by time, retired last) and re-number positions 1..n.
  const repositioned = classifyByResult(Array.from(updatedStates.values()))

  // Step 5: Recompute gaps to the car ahead.
  const withGaps = recomputeGaps(repositioned)

  // Step 5b: lapped-runner accounting.
  const withGapsAndLaps = applyLappedRunners(withGaps, state.currentLap)

  // Step 6: Generate commentary
  const driverNames: Record<string, string> = {}
  for (const driver of drivers) {
    driverNames[driver.id] = driver.name
  }

  const prevStates = state.drivers
  const newCommentary = generateCommentary(
    state.currentLap,
    prevStates,
    withGapsAndLaps,
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
    teamBeliefs,
    currentLap: nextLap,
    drivers: withGapsAndLaps,
    commentary: [...state.commentary, ...newCommentary],
    phase: finished ? 'finished' : 'racing',
  }
}
