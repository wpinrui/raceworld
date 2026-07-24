import type { Circuit, Driver, DriverRaceState, GodModeAction, RaceState, Team, TyreCompound } from './types'
import { freeAirPace, TRAFFIC } from './engine'
import { getMoistureAtLap } from './weather'
import { computeTyreLife, wearTyre, DIRTY_AIR_WEAR_MULT } from './tyres'
import { applyCarForm } from './car-rating'
import { TEMP, nextTyreTemp, pacePush, pushWearMult, coldPenalty, hotPenalty, overheatWearMult, tyreWearRatingMult } from './tyre-temp'
import { resolveIntensity, advancePreset, resolvePlayerPush, NORMAL, aiPushState, DEFEND_PUSH } from './push'
import { decidePit, planStrategy, observeTyre, bucketCondition, type FieldCar } from './pit-ai'
import { pitLaneLoss, doubleStackPenalty } from './pit-loss'
import { perSliceProb, sampleExponential } from './rng-utils'
import { perLapTechnicalDNF, sampleTechnicalFailure } from './reliability'

// The LIVE race engine (#live-engine): a played race is a world stepped in fixed increments of race
// time. Each car's primary state is a continuous lap position; speed comes from the SAME clean-air
// pace model as the whole-lap engine (freeAirPace), with per-lap noise drawn at each car's own line
// crossing. Traffic, passes, pits, mistakes and retirements happen where the car physically is — the
// 2D map and the timing tower read this one state, so the picture, the tower and your commands share
// a single "now". Simulated races keep the whole-lap engine (race.ts); scripts/sector-parity.ts's
// live mode measures that both engines remain the same sport statistically.

export const LIVE_DT = 0.5 // race-seconds per step: fine enough for sub-second command response

// Pit choreography: the era pit loss decomposes into lane transit (visible driving) and the
// stationary hold; the stationary part absorbs the loss remainder plus the execution jitter.
const LANE_IN_TIME = 5
const LANE_OUT_TIME = 5
// Blue flags (#live-engine, new balance — lapping is physical now): a car a lap down concedes
// without a contest; the lapper loses a moment in traffic, the backmarker loses more getting out
// of the way.
const LAPPER_COST = 0.3
const BACKMARKER_COST = 0.5
// One-off time losses (pass penalties, mistakes, blue flags) drain as a visible slowdown: the car
// gives up at most this fraction of each step until the debt is paid.
const ABSORB_DRAIN = 0.6
// A completed pass places the attacker this many seconds clear of the defender.
const PASS_CLEARANCE = 0.35
// Lights-to-line rollout: every car covers its grid box + this much launch time before the S/F line,
// so the whole field gets the grid/launch visuals (pole included) and crossings stay in grid order.
const ROLLOUT = 1.5

interface PitState {
  phase: 'called' | 'lane-in' | 'box' | 'lane-out'
  compound: TyreCompound
  timer: number      // seconds remaining in the current phase
  boxTime: number    // stationary duration, fixed when the stop begins
  forced: boolean    // player/god call — survives a later AI replan
}

export interface LiveCar {
  ds: DriverRaceState
  driver: Driver
  team: Team          // with this race's car form applied
  /** Continuous race position: laps completed + time-fraction of the current lap. Negative before
   * the car reaches the line at the start (its grid deficit, in lap-time terms). */
  pos: number
  launchTotal: number // seconds from lights to this car's line crossing (grid seed + rollout)
  lapStartClock: number
  lapNoise: number
  harryGap: number    // this lap's hold-station distance (jittered per lap, like the lap engine)
  cleanT: number      // this step's clean-air lap time (recomputed every step)
  absorb: number      // outstanding one-off time debt, drained as visible slowdown
  pit: PitState | null
  pitPathFrac: number // 0..1 along the pit lane while in it (the map renders this)
  intensity: number
  defending: boolean
  finished: boolean
}

export interface LiveEvent {
  type: 'overtake' | 'pit-in' | 'pit-out' | 'retirement' | 'mistake' | 'finish'
  lap: number
  driverId: string
  otherId?: string    // overtake: the car passed
  compound?: TyreCompound
}

export interface LiveConfig {
  pitEntryFrac?: number // lap TIME fraction where the pit lane leaves the track (track geometry may refine)
  pitExitFrac?: number
}

const DEFAULT_ENTRY = 0.93
const DEFAULT_EXIT = 0.07

export class LiveRace {
  clock = 0
  cars: LiveCar[] = []
  events: LiveEvent[] = []
  phase: 'racing' | 'finished' = 'racing'
  private state: RaceState // weather, beliefs, compound deltas, carForm — the race-scoped context
  private readonly circuit: Circuit
  private readonly year: number
  private readonly playerSet: Set<string>
  private readonly pitLoss: number
  private readonly stackPenalty: number
  private readonly techDNFPerLap: number
  private readonly entryFrac: number
  private readonly exitFrac: number
  private leaderFinished = false
  private readonly holds = new Set<string>() // standing pit-wall HOLDs: the AI never boxes these cars

  constructor(
    raceState: RaceState,
    drivers: Driver[],
    teams: Team[],
    circuit: Circuit,
    year: number,
    playerControlledIds: string[] = [],
    config: LiveConfig = {},
  ) {
    this.state = raceState
    this.circuit = circuit
    this.year = year
    this.playerSet = new Set(playerControlledIds)
    this.pitLoss = pitLaneLoss(year)
    this.stackPenalty = doubleStackPenalty(year)
    this.techDNFPerLap = perLapTechnicalDNF(year, raceState.totalLaps)
    this.entryFrac = config.pitEntryFrac ?? DEFAULT_ENTRY
    this.exitFrac = config.pitExitFrac ?? DEFAULT_EXIT

    const driverMap = new Map(drivers.map((d) => [d.id, d]))
    const teamMap = new Map(teams.map((t) => [t.id, t]))
    for (const ds of raceState.drivers) {
      const driver = driverMap.get(ds.driverId)!
      const baseTeam = teamMap.get(driver.teamId)!
      const team = applyCarForm(baseTeam, raceState.carForm[baseTeam.id] ?? 0)
      const car: LiveCar = {
        ds: { ...ds, currentTyre: { ...ds.currentTyre }, lapTimes: [...ds.lapTimes] },
        driver,
        team,
        pos: 0, // grid deficit set below, once the first clean pace is known
        launchTotal: ds.totalTime + ROLLOUT,
        lapStartClock: 0,
        lapNoise: Math.random() * (1.2 - 0.01 * driver.consistency),
        harryGap: TRAFFIC.HOLD_GAP + (Math.random() - 0.5) * 0.3,
        cleanT: 100,
        absorb: 0,
        pit: null,
        pitPathFrac: 0,
        intensity: 0,
        defending: false,
        finished: false,
      }
      car.cleanT = this.cleanPace(car)
      // Grid deficit in lap terms: the car crosses the line its slot spacing after pole (plus the
      // shared rollout), so crossings happen in grid order and the map gets its launch visuals.
      car.pos = -car.launchTotal / car.cleanT
      this.cars.push(car)
    }
  }

  // ── Pace ─────────────────────────────────────────────────────────────────────────────────────────

  /** The car's clean-air lap time right now: the shared lap model with this lap's held noise. */
  private cleanPace(car: LiveCar): number {
    const tempIn = car.ds.tyreTemp ?? TEMP.FRESH_TEMP
    return freeAirPace({
      driver: car.driver,
      team: car.team,
      tyre: car.ds.currentTyre,
      form: car.ds.form,
      fuelLaps: car.ds.fuelLaps,
      lap: Math.max(1, Math.floor(car.pos) + 1),
      weather: this.state.weather,
      compoundDeltas: this.state.compoundDeltas,
      gapToCarAhead: Infinity,
      carAheadLapTime: null,
      circuitFlatModifier: this.circuit.flatModifier,
      circuitStraightness: this.circuit.straightness,
      paceDelta: pacePush(car.intensity) + coldPenalty(tempIn) + hotPenalty(tempIn),
      noiseOverride: car.lapNoise,
    })
  }

  // ── Stepping ─────────────────────────────────────────────────────────────────────────────────────

  /** Advance the world by `dt` race-seconds (call with LIVE_DT; the client accumulates wall time). */
  step(dt: number = LIVE_DT): void {
    if (this.phase !== 'racing') return
    this.clock += dt

    const running = this.cars.filter((c) => !c.ds.retired && !c.finished)
    // Road order, front to back: by continuous position. Traffic is spatial, so lapped cars are
    // genuine obstacles — the blue-flag rule below keeps them from racing the leaders.
    const byRoad = [...running].sort((a, b) => b.pos - a.pos)
    // Keep the canonical positions current every step (the pit AI's field snapshots read them).
    byRoad.forEach((c, i) => { c.ds.position = i + 1 })

    // Pass 1: everyone's clean pace this step (the contest gate reads the car ahead's).
    for (const car of byRoad) {
      car.intensity = this.resolvePush(car)
      car.cleanT = this.cleanPace(car)
    }

    // Pass 2: movement, traffic, contests, attrition — front to back.
    for (let i = 0; i < byRoad.length; i++) {
      const car = byRoad[i]
      if (car.ds.retired) continue // may have been crashed into earlier this step

      // Attrition rolls scale to this step's lap fraction.
      const frac = dt / car.cleanT
      if (Math.random() < perSliceProb(this.techDNFPerLap, frac)) {
        this.retire(car, sampleTechnicalFailure())
        continue
      }
      const mistakeRate = 1.3e-5 * (100 - car.driver.consistency) ** 2
      if (Math.random() < perSliceProb(mistakeRate, frac)) {
        car.ds.mistakeCount += 1
        if (Math.random() < 0.2) {
          this.retire(car, 'collision-damage')
          continue
        }
        const loss = Math.min(25, Math.max(2, 2 + sampleExponential(3, Math.random)))
        car.ds.worstMistakeLoss = Math.max(car.ds.worstMistakeLoss, loss)
        car.absorb += loss
        this.events.push({ type: 'mistake', lap: this.lapOf(car), driverId: car.ds.driverId })
      }

      if (car.pit && car.pit.phase !== 'called') {
        this.stepPitLane(car, dt)
        continue
      }

      // The debt drain: a car with outstanding one-off losses gives up part of this step.
      const drain = Math.min(car.absorb, dt * ABSORB_DRAIN)
      car.absorb -= drain
      const effDt = dt - drain

      const ahead = i > 0 ? byRoad[i - 1] : null
      const aheadOnRoad = ahead && !ahead.ds.retired && !(ahead.pit && ahead.pit.phase !== 'called') ? ahead : null
      let stepLapTime = car.cleanT

      // Traffic only once the car is past the launch (dirty air on the grid run would be noise).
      if (aheadOnRoad && car.pos > 0.02) {
        const gapSec = (aheadOnRoad.pos - car.pos) * car.cleanT
        const lapsAheadOfThem = Math.floor(car.pos) - Math.floor(aheadOnRoad.pos)
        if (lapsAheadOfThem >= 1) {
          // Blue flags: the car ahead on the road is a lap (or more) down — it concedes.
          if (gapSec < TRAFFIC.STRIKE_RANGE) {
            car.absorb += LAPPER_COST
            aheadOnRoad.absorb += BACKMARKER_COST
            car.pos = aheadOnRoad.pos + PASS_CLEARANCE / car.cleanT
          }
        } else if (gapSec < TRAFFIC.DIRTY_RANGE) {
          const dirty = TRAFFIC.MAX_DIRTY * (1 - gapSec / TRAFFIC.DIRTY_RANGE)
          const tow = TRAFFIC.SLIPSTREAM * (0.3 + 0.7 * (this.circuit.straightness ?? 0.5))
          stepLapTime = car.cleanT + dirty - tow

          const paceEdge = aheadOnRoad.cleanT - car.cleanT
          if (gapSec <= TRAFFIC.STRIKE_RANGE && paceEdge > 0) {
            // Crash roll, then the contested pass — per-step rescale of the same per-lap chances.
            const f = (c: number) => 0.000002 * (100 - c) ** 2
            const fa = f(car.driver.consistency)
            const fd = f(aheadOnRoad.driver.consistency)
            if (Math.random() < perSliceProb(fa + fd - fa * fd, frac)) {
              const r = Math.random()
              if (r >= 1 / 3) this.retire(aheadOnRoad, 'collision-damage')
              if (r < 2 / 3) { this.retire(car, 'collision-damage'); continue }
            } else {
              const s = this.circuit.straightness ?? 0.5
              const sens = TRAFFIC.OVERTAKE_SENS_MIN * (TRAFFIC.OVERTAKE_SENS_MAX / TRAFFIC.OVERTAKE_SENS_MIN) ** s
              const probLap = Math.min(TRAFFIC.MAX_CONTEST, paceEdge * sens * (car.driver.overtaking / 75))
              const blowPast = paceEdge > TRAFFIC.PASS_MARGIN
              if (blowPast || Math.random() < perSliceProb(probLap, frac)) {
                car.absorb += TRAFFIC.ATTACKER_PENALTY
                aheadOnRoad.absorb += TRAFFIC.DEFENDER_PENALTY
                car.pos = aheadOnRoad.pos + PASS_CLEARANCE / car.cleanT
                this.events.push({ type: 'overtake', lap: this.lapOf(car), driverId: car.ds.driverId, otherId: aheadOnRoad.ds.driverId })
                this.advanceWear(car, gapSec, frac)
                this.crossings(car)
                continue
              }
            }
          }
        }
      }

      // Advance, then hold station: never through the car ahead (same-lap battles only).
      let next = car.pos + effDt / stepLapTime
      if (aheadOnRoad && Math.floor(car.pos) === Math.floor(aheadOnRoad.pos)) {
        const holdPos = aheadOnRoad.pos - car.harryGap / car.cleanT
        if (next > holdPos && car.pos <= holdPos + 1e-9) next = Math.max(car.pos, holdPos)
      }
      car.pos = next

      this.advanceWear(car, aheadOnRoad ? (aheadOnRoad.pos - car.pos) * car.cleanT : Infinity, frac)
      this.crossings(car)
    }

    // A pit call reaching the entry point turns in (checked after movement so the frac is current).
    for (const car of running) {
      if (car.pit?.phase === 'called' && !car.ds.retired && !car.finished && car.pos > 0) {
        const f = car.pos - Math.floor(car.pos)
        if (f >= this.entryFrac) this.enterPitLane(car)
      }
    }
  }

  // ── Wear, temperature, fuel ──────────────────────────────────────────────────────────────────────

  private advanceWear(car: LiveCar, gapSec: number, frac: number): void {
    const tempIn = car.ds.tyreTemp ?? TEMP.FRESH_TEMP
    const wearMult =
      (gapSec < 1.0 ? DIRTY_AIR_WEAR_MULT : 1) *
      tyreWearRatingMult(car.team.tyreWear ?? car.team.carPace) *
      pushWearMult(car.intensity) *
      overheatWearMult(tempIn)
    car.ds.currentTyre.condition = wearTyre(car.ds.currentTyre, wearMult, frac)
    car.ds.tyreTemp = nextTyreTemp(tempIn, car.intensity, car.team.tyreWarming ?? car.team.carPace, frac)
    car.ds.fuelLaps = Math.max(0, car.ds.fuelLaps - frac)
  }

  // ── Push ─────────────────────────────────────────────────────────────────────────────────────────

  /** Player cars resolve every step (instant response); AI picked its push at its line crossing. */
  private resolvePush(car: LiveCar): number {
    if (!this.playerSet.has(car.ds.driverId)) return resolveIntensity(car.ds.push ?? NORMAL)
    const mode = car.ds.pushAuto ? 'auto' : car.ds.autoDefend ? 'autoDefend' : 'manual'
    const { push, defending } = resolvePlayerPush(mode, car.ds.push ?? NORMAL, this.pushCtx(car))
    car.defending = defending
    car.ds.defending = defending
    if (mode === 'auto') car.ds.push = push
    return resolveIntensity(push)
  }

  private pushCtx(car: LiveCar) {
    const byRoad = this.cars.filter((c) => !c.ds.retired && !c.finished).sort((a, b) => b.pos - a.pos)
    const i = byRoad.indexOf(car)
    const gapAhead = i > 0 ? (byRoad[i - 1].pos - car.pos) * car.cleanT : Infinity
    const gapBehind = i >= 0 && i < byRoad.length - 1 ? (car.pos - byRoad[i + 1].pos) * car.cleanT : Infinity
    const chaserPaceEdge = i >= 0 && i < byRoad.length - 1 ? car.cleanT - byRoad[i + 1].cleanT : 0
    return { gapAhead, gapBehind, chaserPaceEdge, condition: car.ds.currentTyre.condition, temp: car.ds.tyreTemp ?? TEMP.FRESH_TEMP }
  }

  // ── Lap crossings: bookkeeping + per-lap brains, at each car's own moment ────────────────────────

  private lapOf(car: LiveCar): number {
    return Math.max(1, Math.floor(car.pos) + 1)
  }

  // A step can cross at most one line (dt is far below any lap time), so this checks a single boundary.
  private crossings(car: LiveCar): void {
    if (this.needsFirstCrossing(car)) {
      if (car.pos >= 0) {
        // The start line: this car's race clock begins (its grid seed is already in totalTime).
        car.lapStartClock = this.clock
      }
      return
    }
    if (car.pos < car.ds.lapTimes.length + 1) return

    // Lap complete.
    const lapTime = this.clock - car.lapStartClock
    car.ds.lapTimes.push(lapTime)
    car.ds.totalTime += lapTime
    car.lapStartClock = this.clock
    car.ds.stintLap += 1
    car.ds.lapsDown = this.lapsDownOf(car)

    // Finish: after the leader takes the flag, every car finishes at its next crossing.
    if (car.ds.lapTimes.length >= this.state.totalLaps) this.leaderFinished = true
    if (this.leaderFinished) {
      car.finished = true
      this.events.push({ type: 'finish', lap: this.state.totalLaps, driverId: car.ds.driverId })
      if (this.cars.every((c) => c.ds.retired || c.finished)) this.phase = 'finished'
      return
    }

    // Per-lap brains, same cadence as the whole-lap engine, at this car's own line.
    car.lapNoise = Math.random() * (1.2 - 0.01 * car.driver.consistency)
    car.harryGap = TRAFFIC.HOLD_GAP + (Math.random() - 0.5) * 0.3
    if (!this.playerSet.has(car.ds.driverId)) {
      car.ds.push = aiPushState(this.pushCtx(car))
      car.ds.defending = car.ds.push === DEFEND_PUSH
    } else {
      car.ds.push = advancePreset(car.ds.push ?? NORMAL, {
        temp: car.ds.tyreTemp ?? TEMP.FRESH_TEMP,
        gapAhead: this.pushCtx(car).gapAhead,
        overtook: false,
      })
    }
    this.observeTyres(car)
    this.planAndDecidePit(car)
  }

  private needsFirstCrossing(car: LiveCar): boolean {
    return car.ds.lapTimes.length === 0 && car.lapStartClock === 0
  }

  private lapsDownOf(car: LiveCar): number {
    const leaderPos = Math.max(...this.cars.filter((c) => !c.ds.retired).map((c) => c.pos))
    return Math.max(0, Math.floor(leaderPos - car.pos))
  }

  private observeTyres(car: LiveCar): void {
    const teamId = car.driver.teamId
    this.state = {
      ...this.state,
      teamBeliefs: {
        ...this.state.teamBeliefs,
        [teamId]: observeTyre(
          this.state.teamBeliefs[teamId],
          car.ds.currentTyre.compound,
          bucketCondition(car.ds.currentTyre.condition),
          car.ds.stintLap,
          car.driver.smoothness,
          this.state.compoundDeltas[car.ds.currentTyre.compound],
        ),
      },
    }
  }

  private planAndDecidePit(car: LiveCar): void {
    const lap = this.lapOf(car)
    const beliefs = this.state.teamBeliefs[car.driver.teamId]
    const cBelief = beliefs[car.ds.currentTyre.compound]
    const bkt = bucketCondition(car.ds.currentTyre.condition)
    const rateProj = 100 - cBelief.baseWearRate * (0.5 + car.driver.smoothness / 100) * car.ds.stintLap
    const projectedCond = Math.max(0, Math.min(100, Math.max(bkt - 12.5, Math.min(bkt + 12.5, rateProj))))
    const effectiveLaps = Math.max(lap, this.state.totalLaps - car.ds.lapsDown)
    const plan = planStrategy(
      lap, effectiveLaps, projectedCond, car.ds.currentTyre.compound, car.driver.smoothness,
      beliefs, this.state.weather, this.state.weatherForecast, this.pitLoss, true,
    )
    car.ds.targetPitLap = plan.targetPitLap
    car.ds.targetNextCompound = plan.targetNextCompound

    if (car.pit?.forced) return // a player/god call stands regardless of the AI's opinion
    if (this.holds.has(car.ds.driverId)) { car.pit = null; return } // pit wall says stay out
    const moisture = getMoistureAtLap(this.state.weather, lap)
    const field: FieldCar[] = this.cars.map((c) => ({
      driverId: c.ds.driverId, position: c.ds.position, totalTime: c.ds.totalTime,
      condition: c.ds.currentTyre.condition, retired: c.ds.retired,
    }))
    const self = field.find((f) => f.driverId === car.ds.driverId)!
    const decision = decidePit(
      plan, car.ds.currentTyre.condition, projectedCond, car.ds.currentTyre.compound,
      moisture, self, field, this.pitLoss,
    )
    car.pit = decision.shouldPit ? { phase: 'called', compound: decision.targetCompound, timer: 0, boxTime: 0, forced: false } : null
  }

  // ── Pit lane ─────────────────────────────────────────────────────────────────────────────────────

  private enterPitLane(car: LiveCar): void {
    const stationary = Math.max(2, this.pitLoss - LANE_IN_TIME - LANE_OUT_TIME) + (Math.random() * 2 - 1) * 1.5
    car.pit = { ...car.pit!, phase: 'lane-in', timer: LANE_IN_TIME, boxTime: stationary }
    car.pitPathFrac = 0
    this.events.push({ type: 'pit-in', lap: this.lapOf(car), driverId: car.ds.driverId, compound: car.pit.compound })
  }

  private stepPitLane(car: LiveCar, dt: number): void {
    const pit = car.pit!
    pit.timer -= dt
    if (pit.phase === 'lane-in') {
      car.pitPathFrac = Math.min(0.5, 0.5 * (1 - Math.max(0, pit.timer) / LANE_IN_TIME))
      if (pit.timer <= 0) {
        // Double-stack: the box is busy while the teammate sits in it — queue the remainder.
        const teammateInBox = this.cars.find(
          (c) => c !== car && !c.ds.retired && c.driver.teamId === car.driver.teamId && c.pit?.phase === 'box',
        )
        const wait = teammateInBox ? Math.min(this.stackPenalty, Math.max(0, teammateInBox.pit!.timer)) : 0
        pit.phase = 'box'
        pit.timer = pit.boxTime + wait
        // The stop is the lap boundary for bookkeeping: the box sits on the start/finish line.
        const lapTime = this.clock - car.lapStartClock + pit.timer
        car.ds.lapTimes.push(lapTime)
        car.ds.totalTime += lapTime
        car.lapStartClock = this.clock + pit.timer
        car.ds.stintHistory = [...car.ds.stintHistory, { compound: car.ds.currentTyre.compound, laps: car.ds.stintLap + 1 }]
        car.ds.lastPitLap = car.ds.lapTimes.length
        car.ds.pitStops += 1
        car.ds.stintLap = 0
      }
      return
    }
    if (pit.phase === 'box') {
      car.pitPathFrac = 0.5
      if (pit.timer <= 0) {
        const newLife = computeTyreLife(this.state.tyreBaseLife[pit.compound], car.driver.smoothness, this.state.totalLaps)
        car.ds.currentTyre = { compound: pit.compound, condition: 100, maxLifeLaps: newLife }
        car.ds.tyreTemp = TEMP.FRESH_TEMP
        pit.phase = 'lane-out'
        pit.timer = LANE_OUT_TIME
      }
      return
    }
    // lane-out
    car.pitPathFrac = Math.min(1, 0.5 + 0.5 * (1 - Math.max(0, pit.timer) / LANE_OUT_TIME))
    if (pit.timer <= 0) {
      car.pos = car.ds.lapTimes.length + this.exitFrac
      car.pit = null
      car.pitPathFrac = 0
      // The flag can fall while a car is in the lane: it finishes as it rejoins.
      if (this.leaderFinished || car.ds.lapTimes.length >= this.state.totalLaps) {
        car.finished = true
        this.leaderFinished = this.leaderFinished || car.ds.lapTimes.length >= this.state.totalLaps
        this.events.push({ type: 'finish', lap: this.state.totalLaps, driverId: car.ds.driverId })
        if (this.cars.every((c) => c.ds.retired || c.finished)) this.phase = 'finished'
        return
      }
      this.events.push({ type: 'pit-out', lap: this.lapOf(car), driverId: car.ds.driverId })
      // Fresh lap brains for the out-lap started at the box.
      car.lapNoise = Math.random() * (1.2 - 0.01 * car.driver.consistency)
      this.observeTyres(car)
    }
  }

  // ── Commands & god mode ──────────────────────────────────────────────────────────────────────────

  /** Pit this lap (player/pit-wall call). If the car has passed the entry, it boxes next time round. */
  commandPit(driverId: string, compound: TyreCompound): void {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (!car || car.ds.retired || car.finished) return
    if (car.pit && car.pit.phase !== 'called') return // already in the lane
    car.pit = { phase: 'called', compound, timer: 0, boxTime: 0, forced: true }
  }

  /** Cancel a pending pit call (only before the car turns in). */
  commandStay(driverId: string): void {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (car?.pit?.phase === 'called') car.pit = null
  }

  /** Standing HOLD: the AI never calls this car in; pending unforced calls are dropped. */
  setHold(driverId: string, on: boolean): void {
    if (on) this.holds.add(driverId)
    else this.holds.delete(driverId)
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (on && car?.pit?.phase === 'called') car.pit = null
  }

  /** Back to AI strategy: drop a forced call that hasn't reached the lane, release any hold. */
  clearPitOverrides(driverId: string): void {
    this.holds.delete(driverId)
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (car?.pit?.phase === 'called') car.pit = null
  }

  /** Player push controls write straight onto the live car (the engine reads them next step). */
  setPushFields(driverId: string, patch: Partial<Pick<DriverRaceState, 'push' | 'pushAuto' | 'autoDefend'>>): void {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (!car || car.ds.retired) return
    Object.assign(car.ds, patch)
  }

  /** The leader's fraction through its current lap — drives the classic header's lap bar. */
  leaderLapFrac(): number {
    const running = this.cars.filter((c) => !c.ds.retired && !c.finished)
    if (running.length === 0) return 0
    const leader = running.reduce((a, b) => (a.pos >= b.pos ? a : b))
    return Math.max(0, leader.pos - Math.floor(leader.pos))
  }

  applyGodActions(actions: GodModeAction[]): void {
    for (const a of actions) {
      const car = this.cars.find((c) => c.ds.driverId === a.driverId)
      if (!car || car.ds.retired) continue
      if (a.type === 'set-tyre-condition' && a.value !== undefined) car.ds.currentTyre.condition = a.value
      else if (a.type === 'set-form' && a.value !== undefined) car.ds.form = a.value
      else if (a.type === 'force-retire') this.retire(car, sampleTechnicalFailure())
      else if (a.type === 'force-pit') this.commandPit(a.driverId, a.compound ?? car.ds.targetNextCompound)
      else if (a.type === 'cancel-pit') this.commandStay(a.driverId)
    }
  }

  private retire(car: LiveCar, reason: DriverRaceState['retirementReason']): void {
    car.ds.retired = true
    car.ds.retirementLap = this.lapOf(car)
    car.ds.retirementReason = reason
    car.pit = null
    this.events.push({ type: 'retirement', lap: this.lapOf(car), driverId: car.ds.driverId })
    if (this.cars.every((c) => c.ds.retired || c.finished)) this.phase = 'finished'
  }

  /** Drain queued events (the client maps them to commentary). */
  drainEvents(): LiveEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  // ── Projection: the RaceState the UI reads ───────────────────────────────────────────────────────

  /** Live classification: running cars by continuous position, retirees last (latest first). */
  snapshot(): RaceState {
    const running = this.cars.filter((c) => !c.ds.retired).sort((a, b) => b.pos - a.pos)
    const retired = this.cars.filter((c) => c.ds.retired).sort((a, b) => (b.ds.retirementLap ?? 0) - (a.ds.retirementLap ?? 0))
    const ordered = [...running, ...retired]
    const drivers: DriverRaceState[] = ordered.map((car, i) => {
      const aheadCar = i > 0 && !car.ds.retired ? ordered[i - 1] : null
      const gap = aheadCar ? Math.max(0, (aheadCar.pos - car.pos) * car.cleanT) : 0
      return { ...car.ds, position: i + 1, gap: car.ds.retired ? 0 : gap, lapsDown: car.ds.retired ? car.ds.lapsDown : this.lapsDownOf(car) }
    })
    const leader = running[0]
    return {
      ...this.state,
      currentLap: leader ? Math.min(this.state.totalLaps, Math.max(1, Math.floor(leader.pos) + 1)) : this.state.totalLaps,
      drivers,
      phase: this.phase === 'finished' ? 'finished' : 'racing',
    }
  }

  /** Track sample for the 2D map: continuous prog, pit-lane routing, grid hold before the start. */
  sample(driverId: string): { prog: number; pit?: boolean; pitPathFrac?: number; gridSlot?: number; launch?: number } | null {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (!car) return null
    if (car.ds.retired) return null
    if (car.pos < 0) {
      const deficit = -car.pos * car.cleanT
      return { prog: 0, gridSlot: car.ds.position, launch: Math.max(0, Math.min(1, 1 - deficit / car.launchTotal)) }
    }
    if (car.pit && car.pit.phase !== 'called') {
      return { prog: car.pitPathFrac, pit: true, pitPathFrac: car.pitPathFrac }
    }
    return { prog: car.pos - Math.floor(car.pos) }
  }
}

// Headless runner for probes and "skip to end": steps the world in bulk, no client involved.
export function runLiveRaceToEnd(
  raceState: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  playerControlledIds: string[] = [],
  config: LiveConfig = {},
): RaceState {
  const live = new LiveRace(raceState, drivers, teams, circuit, year, playerControlledIds, config)
  const maxSteps = ((raceState.totalLaps + 5) * 200) / LIVE_DT
  let guard = 0
  while (live.phase === 'racing' && guard++ < maxSteps) live.step(LIVE_DT)
  return live.snapshot()
}
