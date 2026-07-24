import type { CommentaryEntry, Driver, DriverRaceState, GodModeAction, RaceState, TyreCompound } from './types'
import { observeTyre, bucketCondition, type TeamBelief, type FieldCar } from './pit-ai'
import { sampleTechnicalFailure } from './reliability'
import { generateCommentary } from './commentary'
import { computeTyreLife } from './tyres'

// The slice tick’s bookend phases (#sector-engine), lifted out of simulateSlice — see slice.ts.
// ---- slice phases ---------------------------------------------------------------------------------
// The tick's bookend phases, named and lifted out of the core. The per-driver race loop (lap time,
// pit, overtake, attrition) stays inline: its sub-steps share heavily-mutated per-car state and a
// tight RNG-draw order that splitting would obscure. Only applyGodModeActions draws RNG here (the
// forced-retirement reason), and it runs at exactly the same point as before.

// Step 1: apply god-mode actions (tyre condition, forced retirement, form override) to the slice's
// working driver states.
export function applyGodModeActions(driverStates: DriverRaceState[], godModeActions: GodModeAction[] | undefined, currentLap: number): DriverRaceState[] {
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
export function updateTeamBeliefs(state: RaceState, driverMap: Map<string, Driver>): Record<string, TeamBelief> {
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
export function classifyByResult(states: DriverRaceState[]): DriverRaceState[] {
  const activeDrivers = states.filter((d) => !d.retired).sort((a, b) => a.totalTime - b.totalTime)
  const retiredDrivers = states
    .filter((d) => d.retired)
    .sort((a, b) => (b.retirementLap ?? 0) - (a.retirementLap ?? 0))
  return [...activeDrivers, ...retiredDrivers].map((d, index) => ({ ...d, position: index + 1 }))
}

// Step 5: recompute each car's gap to the car ahead (0 for the leader and for retirees).
export function recomputeGaps(repositioned: DriverRaceState[]): DriverRaceState[] {
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
export function applyLappedRunners(withGaps: DriverRaceState[], currentLap: number): DriverRaceState[] {
  const leaderTotal = withGaps.find((d) => !d.retired)?.totalTime ?? 0
  const leaderAvgLap = leaderTotal / Math.max(1, currentLap)
  if (leaderAvgLap <= 0) return withGaps
  return withGaps.map((d) =>
    d.retired ? d : { ...d, lapsDown: Math.max(0, Math.floor((d.totalTime - leaderTotal) / leaderAvgLap)) },
  )
}


// Pit execution: the double-stack wait, the era pit-lane loss + execution jitter, and the fresh set.
// RNG draw order matters (the jitter draw, then computeTyreLife's set-modifier draws) — it must match
// the historical inline block exactly, which the race.test.ts snapshot locks.
export function executePitStop(
  current: DriverRaceState,
  compound: TyreCompound,
  state: RaceState,
  driver: Driver,
  driverMap: Map<string, Driver>,
  updatedStates: Map<string, DriverRaceState>,
  fieldByDriver: Map<string, FieldCar>,
  pitLoss: number,
  stackPenalty: number,
): { next: DriverRaceState; pitPenalty: number } {
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
  const pitPenalty = pitLoss + (Math.random() * 2 - 1) * 1.5 + stackExtra
  const newMaxLifeLaps = computeTyreLife(state.tyreBaseLife[compound], driver.smoothness, state.totalLaps)
  return {
    pitPenalty,
    next: {
      ...current,
      currentTyre: { compound, condition: 100, maxLifeLaps: newMaxLifeLaps },
      // tyreTemp is reset to FRESH_TEMP in the end-of-lap temp step (which keys off `pitted`) — don't also
      // set it here, so the two sites can't drift apart (the bug this replaced came from a stale double-write).
      stintHistory: [...current.stintHistory, { compound: current.currentTyre.compound, laps: current.stintLap + 1 }],
      stintLap: 0,
      lastPitLap: state.currentLap,
      pitStops: current.pitStops + 1,
    },
  }
}

// Step 6: per-slice commentary — diff the slice-start states against the classified result.
export function sliceCommentary(
  state: RaceState,
  newStates: DriverRaceState[],
  drivers: Driver[],
  prevMoisture: number,
  currentMoisture: number,
  spec: { frac: number; lapEnd: boolean },
): CommentaryEntry[] {
  const driverNames: Record<string, string> = {}
  for (const driver of drivers) driverNames[driver.id] = driver.name
  return generateCommentary(
    state.currentLap, state.drivers, newStates, driverNames, state.totalLaps,
    prevMoisture, currentMoisture, { frac: spec.frac, lapComplete: spec.lapEnd },
  )
}
