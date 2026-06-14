import type { Driver, Team, Circuit, RaceState, TyreCompound } from './types'
import { computeLapTime, TRAFFIC } from './engine'
import { degradeTyre } from './tyres'
import { pitLaneLoss } from './pit-loss'
import { planStrategy, truthBelief } from './pit-ai'
import { getMoistureAtLap } from './weather'
import { buildCandidates, shouldEvaluatePit, type ForecastCandidate } from './strategy-forecast'

// Deterministic race projector. Instead of sampling many noisy full races (Monte-Carlo), we project ONE
// noiseless race to the flag and read the result. It's exact because we already know what every car will do:
//   - pace comes from computeLapTime with the noise forced to 0 (the engine's exact lap-time model),
//   - each rival pits at its OWN planned lap (targetPitLap → targetNextCompound, already on the state),
//   - traffic uses the engine's own dirty-air / overtake numbers, with the per-lap random pass roll replaced
//     by an accumulator: a faster car clears the one ahead once its summed pass chance reaches 1 (the
//     expected wait), and is held in dirty air until then.
// No noise, no DNFs, no crashes, no mistakes — so one pass IS the answer (no averaging), overtaking is never
// penalised, and the manual table and auto-mode read the SAME number, linked by construction.

const { DIRTY_RANGE, MAX_DIRTY, SLIPSTREAM, STRIKE_RANGE, PASS_MARGIN, OVERTAKE_SENS, MAX_CONTEST, ATTACKER_PENALTY, DEFENDER_PENALTY, HOLD_GAP } = TRAFFIC

interface ProjStop { lap: number; compound: TyreCompound }

interface ProjCar {
  driverId: string
  driver: Driver
  team: Team // carForm already baked in
  totalTime: number
  compound: TyreCompound
  condition: number
  maxLifeLaps: number
  fuelLaps: number
  form: number
  stops: ProjStop[] // future stops, ascending by lap
  passProgress: number
  heldLaps: number // laps spent stuck behind a car it couldn't pass (player interpretability)
}

// Expected (deterministic) life of a fresh set — the mean computeTyreLife with the per-set luck dropped.
function expectedMaxLife(state: RaceState, circuit: Circuit, compound: TyreCompound, smoothness: number): number {
  return Math.max(1, Math.round(state.tyreBaseLife[compound] * circuit.laps * (0.5 + smoothness / 100)))
}

function freeAirLap(state: RaceState, circuit: Circuit, c: ProjCar, lap: number): number {
  return computeLapTime({
    driver: c.driver,
    team: c.team,
    tyre: { compound: c.compound, condition: c.condition, maxLifeLaps: c.maxLifeLaps },
    form: c.form,
    fuelLaps: c.fuelLaps,
    lap,
    weather: state.weather,
    compoundDeltas: state.compoundDeltas,
    gapToCarAhead: Infinity,
    carAheadLapTime: null,
    circuitFlatModifier: circuit.flatModifier,
    noiseOverride: 0,
  }).lapTime
}

// Project the race to the flag and return the finishing order (fastest cumulative time first). `playerStops`
// overrides the player's schedule; `playerHasPitted` means the player already boxed "now" (pit loss + fresh
// tyre applied before the run — the immediate track-position drop of a pit-now option).
function projectRace(
  state: RaceState,
  driverMap: Map<string, Driver>,
  teamMap: Map<string, Team>,
  circuit: Circuit,
  year: number,
  playerId: string,
  playerStops: ProjStop[],
  playerFreshCompound: TyreCompound | null,
): { order: { driverId: string; totalTime: number }[]; playerHeldLaps: number } {
  const pitLoss = pitLaneLoss(year)
  const cars: ProjCar[] = []
  for (const ds of state.drivers) {
    if (ds.retired) continue // already out — fixed at the back, not projected
    const driver = driverMap.get(ds.driverId)
    const team = teamMap.get(driver?.teamId ?? '')
    if (!driver || !team) continue
    const raceTeam: Team = { ...team, carPace: team.carPace + (state.carForm[team.id] ?? 0) }
    const isPlayer = ds.driverId === playerId
    let compound = ds.currentTyre.compound
    let condition = ds.currentTyre.condition
    let maxLifeLaps = ds.currentTyre.maxLifeLaps
    let totalTime = ds.totalTime
    if (isPlayer && playerFreshCompound) {
      // pit-now: box this instant — pit-lane loss + a fresh set, dropping into traffic.
      totalTime += pitLoss
      compound = playerFreshCompound
      condition = 100
      maxLifeLaps = expectedMaxLife(state, circuit, playerFreshCompound, driver.smoothness)
    }
    const stops = isPlayer
      ? [...playerStops]
      : ds.targetPitLap != null && ds.targetPitLap > state.currentLap
        ? [{ lap: ds.targetPitLap, compound: ds.targetNextCompound }]
        : []
    cars.push({ driverId: ds.driverId, driver, team: raceTeam, totalTime, compound, condition, maxLifeLaps, fuelLaps: ds.fuelLaps, form: ds.form, stops, passProgress: 0, heldLaps: 0 })
  }

  for (let lap = state.currentLap + 1; lap <= state.totalLaps; lap++) {
    cars.sort((a, b) => a.totalTime - b.totalTime) // track order (leader first)
    const pre = cars.map((c) => c.totalTime)
    const free = cars.map((c) => freeAirLap(state, circuit, c, lap))
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]
      if (i === 0) {
        car.totalTime = pre[i] + free[i]
        car.passProgress = 0
      } else {
        const ahead = cars[i - 1] // already advanced this lap
        const naive = pre[i] + free[i]
        if (naive <= ahead.totalTime + HOLD_GAP) {
          // Catching or ahead of the car in front → contest it.
          const gap = Math.max(0, pre[i] - pre[i - 1])
          const tow = gap < DIRTY_RANGE ? SLIPSTREAM : 0
          const paceEdge = free[i - 1] - free[i] + tow // >0 means this car is faster (times: lower = faster)
          const blowPast = paceEdge > 0 && naive < ahead.totalTime - PASS_MARGIN
          const prob = paceEdge > 0 && gap <= STRIKE_RANGE ? Math.min(MAX_CONTEST, paceEdge * OVERTAKE_SENS * (car.driver.overtaking / 75)) : 0
          car.passProgress += prob
          if (blowPast || car.passProgress >= 1) {
            car.passProgress = 0
            ahead.totalTime += DEFENDER_PENALTY
            car.totalTime = Math.min(naive + ATTACKER_PENALTY, ahead.totalTime - 0.05) // ends just ahead
          } else {
            const dirty = gap < DIRTY_RANGE ? MAX_DIRTY * (1 - gap / DIRTY_RANGE) : 0
            car.totalTime = Math.max(ahead.totalTime + HOLD_GAP, naive + dirty) // held in dirty air
            car.heldLaps++
          }
        } else {
          car.passProgress = 0
          car.totalTime = naive // clear air
        }
      }
      // Tyre wear (deterministic preview), fuel burn, then a planned stop at the end of this lap.
      car.condition = degradeTyre({ compound: car.compound, condition: car.condition, maxLifeLaps: car.maxLifeLaps })
      car.fuelLaps = Math.max(0, car.fuelLaps - 1)
      if (car.stops.length && car.stops[0].lap === lap) {
        const stop = car.stops.shift()!
        car.totalTime += pitLoss
        car.compound = stop.compound
        car.condition = 100
        car.maxLifeLaps = expectedMaxLife(state, circuit, stop.compound, car.driver.smoothness)
      }
    }
  }

  cars.sort((a, b) => a.totalTime - b.totalTime)
  const player = cars.find((c) => c.driverId === playerId)
  return { order: cars.map((c) => ({ driverId: c.driverId, totalTime: c.totalTime })), playerHeldLaps: player?.heldLaps ?? 0 }
}

export interface PitOption {
  candidate: ForecastCandidate
  finishPosition: number
  finishTime: number
  deltaVsBaseline: number // seconds vs the baseline option (stay out, in-race; the best start, pre-race)
  heldLaps: number // laps the projection has the player stuck in traffic
}

export interface PitRecommendation {
  driverId: string
  compound: TyreCompound
}

// The player's OWN strategy is taken as god-mode optimal: planStrategy on the race's true deltas/life gives
// the stops AFTER the first stint, for a tyre fitted now at the given condition.
function optimalStops(state: RaceState, circuit: Circuit, year: number, driver: Driver, startCompound: TyreCompound, startCondition: number): ProjStop[] {
  // Full planner (2-stop aware): the player's own plan must be optimal or "stay out" is mis-rated in a
  // genuine 2-stop race. It's only a handful of calls per evaluation, not per-car-per-lap.
  const plan = planStrategy(
    state.currentLap, state.totalLaps, startCondition, startCompound, driver.smoothness,
    truthBelief(state.compoundDeltas, state.tyreBaseLife, state.totalLaps),
    state.weather, state.weatherForecast, pitLaneLoss(year),
  )
  return plan.stints.slice(1).map((s) => ({ lap: s.fromLap, compound: s.compound }))
}

// Evaluate every in-race pit option for the player deterministically: predicted finishing place + time vs
// staying out. Sorted best (lowest place) first. Instant — one projection per option, no sampling, no DNFs.
export function evaluatePitOptions(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  playerId: string,
): PitOption[] {
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const ds = state.drivers.find((d) => d.driverId === playerId)
  const driver = driverMap.get(playerId)
  if (!ds || !driver) return []
  const candidates = buildCandidates(getMoistureAtLap(state.weather, state.currentLap), 'racing')

  const results: PitOption[] = candidates.map((candidate) => {
    const isPit = candidate.kind === 'pit'
    // pit-now: optimal plan for the fresh compound fitted now; stay: optimal plan from the current tyre.
    const stops = isPit
      ? optimalStops(state, circuit, year, driver, candidate.compound, 100)
      : optimalStops(state, circuit, year, driver, ds.currentTyre.compound, ds.currentTyre.condition)
    const { order, playerHeldLaps } = projectRace(state, driverMap, teamMap, circuit, year, playerId, stops, isPit ? candidate.compound : null)
    const idx = order.findIndex((o) => o.driverId === playerId)
    return { candidate, finishPosition: idx + 1, finishTime: order[idx]?.totalTime ?? Infinity, deltaVsBaseline: 0, heldLaps: playerHeldLaps }
  })

  const stayTime = results.find((r) => r.candidate.kind === 'hold')?.finishTime ?? results[0]?.finishTime ?? 0
  for (const r of results) r.deltaVsBaseline = r.finishTime - stayTime
  return results.sort((a, b) => a.finishPosition - b.finishPosition || a.finishTime - b.finishTime)
}

// Pre-race: which STARTING tyre. Project the full race with the player starting on each suitable compound.
export function evaluateStartOptions(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  playerId: string,
): PitOption[] {
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const ds = state.drivers.find((d) => d.driverId === playerId)
  const driver = driverMap.get(playerId)
  if (!ds || !driver) return []
  const candidates = buildCandidates(getMoistureAtLap(state.weather, state.currentLap), 'pre-race')

  const results: PitOption[] = candidates.map((candidate) => {
    const compound = candidate.kind === 'start' ? candidate.compound : ds.currentTyre.compound
    // Start fresh on this compound (no pit-lane loss — it's the grid), then run the optimal plan.
    const maxLifeLaps = expectedMaxLife(state, circuit, compound, driver.smoothness)
    const startState: RaceState = { ...state, drivers: state.drivers.map((d) => (d.driverId === playerId ? { ...d, currentTyre: { compound, condition: 100, maxLifeLaps } } : d)) }
    const stops = optimalStops(state, circuit, year, driver, compound, 100)
    const { order, playerHeldLaps } = projectRace(startState, driverMap, teamMap, circuit, year, playerId, stops, null)
    const idx = order.findIndex((o) => o.driverId === playerId)
    return { candidate, finishPosition: idx + 1, finishTime: order[idx]?.totalTime ?? Infinity, deltaVsBaseline: 0, heldLaps: playerHeldLaps }
  })

  const best = Math.min(...results.map((r) => r.finishTime))
  for (const r of results) r.deltaVsBaseline = r.finishTime - best
  return results.sort((a, b) => a.finishPosition - b.finishPosition || a.finishTime - b.finishTime)
}

const PIT_GAIN_S = 2 // also box a position-neutral option only if it's clearly faster (rare)

// Auto-mode: should any player car box NOW? Box only when pitting this lap improves the car's predicted
// finishing place over staying out (or is clearly faster at the same place). Deterministic and instant, so it
// can't diverge from the manual table — they read the SAME projection.
export function recommendPitNow(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  playerDriverIds: string[],
): PitRecommendation | null {
  const moisture = getMoistureAtLap(state.weather, state.currentLap)
  for (const id of playerDriverIds) {
    const ds = state.drivers.find((d) => d.driverId === id)
    if (!ds || ds.retired) continue
    if (!shouldEvaluatePit(ds.currentTyre, moisture)) continue // healthy & right tyre — obviously no stop, skip the projection
    const opts = evaluatePitOptions(state, drivers, teams, circuit, year, id)
    const stay = opts.find((o) => o.candidate.kind === 'hold')
    const bestPit = opts.find((o) => o.candidate.kind === 'pit') // sorted best-first
    if (!stay || !bestPit || bestPit.candidate.kind !== 'pit') continue
    if (bestPit.finishPosition < stay.finishPosition || bestPit.deltaVsBaseline <= -PIT_GAIN_S) {
      return { driverId: id, compound: bestPit.candidate.compound }
    }
  }
  return null
}
