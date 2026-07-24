import type {
  Driver,
  Team,
  Circuit,
  RaceState,
  DriverRaceState,
  GodModeAction,
  PushState,
} from './types'
import { getMoistureAtLap } from './weather'
import { computeTyreLife, wearTyre, DIRTY_AIR_WEAR_MULT } from './tyres'
import { computeLapTime } from './engine'
import { applyCarForm, effectiveCarPace } from './car-rating'
import { TEMP, nextTyreTemp, pacePush, pushWearMult, coldPenalty, hotPenalty, overheatWearMult, tyreWearRatingMult } from './tyre-temp'
import { resolveIntensity, advancePreset, resolvePlayerPush, NORMAL } from './push'
import { decidePit, planStrategy, observeTyre, bucketCondition, type TeamBelief, type FieldCar } from './pit-ai'
import { pitLaneLoss, doubleStackPenalty } from './pit-loss'
import { generateCommentary } from './commentary'
import { perSliceProb, sampleExponential } from './rng-utils'
import { perLapTechnicalDNF, sampleTechnicalFailure } from './reliability'

// The shared race-tick core (#sector-engine). simulateSlice advances every car by one SLICE of a lap:
// a whole lap (spec = LAP_SLICE, the headless/simulated path — bit-compatible with the historical
// simulateLap) or one of N sub-lap sectors (the played-race path, so the board, gaps and player
// commands are at most a sector stale). The per-lap-only phases are gated by the spec's booleans;
// every quantity that scales with slice length is written `spec.frac === 1 ? <original> : <scaled>`
// so the frac=1 path keeps the exact expressions AND Math.random() draw order the characterization
// snapshot in race.test.ts locks.

export interface SliceSpec {
  /** Fraction of a lap this slice covers: 1 = whole lap (bit-compatible path), 1/8 = one sector. */
  frac: number
  /** Team tyre-belief update runs on the lap's first slice. */
  lapStart: boolean
  /** lapTimes append, stint bookkeeping, lap counter, lapped-runner accounting, finish check. */
  lapEnd: boolean
  /** Strategy replan + pit decision + pit execution (and god-mode pit overrides). */
  pitSlice: boolean
}

export const LAP_SLICE: SliceSpec = { frac: 1, lapStart: true, lapEnd: true, pitSlice: true }

// ---- slice phases ---------------------------------------------------------------------------------
// The tick's bookend phases, named and lifted out of the core. The per-driver race loop (lap time,
// pit, overtake, attrition) stays inline: its sub-steps share heavily-mutated per-car state and a
// tight RNG-draw order that splitting would obscure. Only applyGodModeActions draws RNG here (the
// forced-retirement reason), and it runs at exactly the same point as before.

// Step 1: apply god-mode actions (tyre condition, forced retirement, form override) to the slice's
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

export function simulateSlice(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  spec: SliceSpec,
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

  // Update each team's tyre belief from BOTH its cars' (bucketed) condition — on the lap's first
  // slice only — then snapshot the field by track position (last slice's gaps) for undercut / clear-air.
  const teamBeliefs = spec.lapStart ? updateTeamBeliefs(state, driverMap) : { ...state.teamBeliefs }
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

    // 2a. Technical failure (issue #61) — era-scaled per-lap chance (rescaled to the slice), a specific
    // failure type.
    if (!current.retired && Math.random() < perSliceProb(techDNFPerLap, spec.frac)) {
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
    // (c=65 -> 1.6%, 75 -> 0.8%, 90 -> 0.13%/lap), rescaled to the slice — the loss magnitude stays
    // per-event (frequency carries the scaling). On a mistake: 20% crash out (collision-damage DNF),
    // else a one-off time loss of 2 + Exp(mean 3) s clamped to [2, 25].
    let mistakeTimeLoss = 0
    const consistency = driver.consistency
    if (Math.random() < perSliceProb(1.3e-5 * (100 - consistency) ** 2, spec.frac)) {
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

    let pitPenalty = 0
    let pitted = false

    if (spec.pitSlice) {
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
          // tyreTemp is reset to FRESH_TEMP in the end-of-lap temp step (which keys off `pitted`) — don't also
          // set it here, so the two sites can't drift apart (the bug this replaced came from a stale double-write).
          stintHistory: [...current.stintHistory, { compound: current.currentTyre.compound, laps: current.stintLap + 1 }],
          stintLap: 0,
          lastPitLap: state.currentLap,
          pitStops: current.pitStops + 1,
        }
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
      frac: spec.frac,
    })

    // Atomic penalties (pit, mistake) land whole in the slice they happen. Sector mode floors the
    // emitted time — the hold-station arithmetic can go non-positive on slice scale (frac=1 untouched).
    const finalLapTime = spec.frac === 1
      ? lapResult.lapTime + pitPenalty + mistakeTimeLoss
      : Math.max(0.001, lapResult.lapTime + pitPenalty + mistakeTimeLoss)
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
    const newCondition = wearTyre(current.currentTyre, wearMult, spec.frac)
    // A fresh set comes out of the pits cold (slightly below the window); it warms on the out-lap. Otherwise
    // `tempIn` (captured before the stop) would evolve the OLD tyre's heat onto the new set and never reset.
    const newTemp = pitted ? TEMP.FRESH_TEMP : nextTyreTemp(tempIn, intensity, tyreWarming, spec.frac)
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

    // 2i. Decrement fuelLaps (fractionally mid-lap; fuelMod is already continuous in fuelLaps)
    current = { ...current, fuelLaps: Math.max(0, current.fuelLaps - spec.frac) }

    // 2j. Accumulate totalTime
    current = { ...current, totalTime: current.totalTime + finalLapTime }

    if (spec.lapEnd) {
      // 2k. Increment stintLap (unless we just pitted, stintLap was set to 0 above)
      current = { ...current, stintLap: current.stintLap + 1 }

      // 2l. Append lapTime
      current = { ...current, lapTimes: [...current.lapTimes, finalLapTime] }

      // Pit lap belongs to the old stint (already counted via +1 in history).
      // Undo the increment so the new stint starts at 0; out-lap becomes lap 1 next tick.
      if (pitted) {
        current = { ...current, stintLap: 0 }
      }
    }

    updatedStates.set(current.driverId, current)
  }

  // Steps 3-4: classify the field (running by time, retired last) and re-number positions 1..n.
  const repositioned = classifyByResult(Array.from(updatedStates.values()))

  // Step 5: Recompute gaps to the car ahead.
  const withGaps = recomputeGaps(repositioned)

  // Step 5b: lapped-runner accounting (whole-lap semantics — lap boundaries only).
  const withGapsAndLaps = spec.lapEnd ? applyLappedRunners(withGaps, state.currentLap) : withGaps

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
  const nextLap = spec.lapEnd ? state.currentLap + 1 : state.currentLap
  const finished = spec.lapEnd && nextLap > state.totalLaps

  return {
    ...state,
    teamBeliefs,
    currentLap: nextLap,
    drivers: withGapsAndLaps,
    commentary: [...state.commentary, ...newCommentary],
    phase: finished ? 'finished' : 'racing',
  }
}
