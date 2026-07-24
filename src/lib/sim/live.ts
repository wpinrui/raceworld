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

// Pit choreography: the era pit LOSS is relative to staying out, so the true lane time is the track
// section's race-pace time PLUS the loss — decomposing the loss alone made cars sprint the lane at
// race speed (and under-charged every stop by the section time). The stationary hold is short and
// real; the transit absorbs the rest at limiter-like pace.
const BOX_TIME_BASE = 2.5
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
// A pass is a MOVE, not a teleport: once the roll succeeds the attacker drives through over this much
// race time — alongside, past, clear — with the penalties landing as the move completes. The relative
// speed follows a bell curve (zero at both ends): the attacker eases out, surges through mid-move and
// tucks in ahead at matched pace, so neither endpoint reads as a lunge.
const PASS_DURATION = 5
// Lights-to-line rollout: every car covers its grid box + this much launch time before the S/F line,
// so the whole field gets the grid/launch visuals (pole included) and crossings stay in grid order.
const ROLLOUT = 1.5

interface PitState {
  phase: 'called' | 'lane-in' | 'box' | 'lane-out'
  compound: TyreCompound
  timer: number      // seconds remaining in the current phase
  boxTime: number    // stationary duration, fixed when the stop begins
  transitHalf: number // lane transit per side (entry→box, box→exit), fixed when the car turns in
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
  /** The car's position AT REST on its grid box. The launch fraction is measured against this,
   * not against launchTotal/cleanT — cleanT is recomputed every step, so that ratio drifts and
   * the parked field creeps off its boxes (per-car, so the grid visibly compresses). */
  gridPos0: number
  lapStartClock: number
  lapNoise: number
  harryGap: number    // this lap's hold-station distance (jittered per lap, like the lap engine)
  harryPhase: number  // phase of this car's harry breathing — a pinned gap frozen to the millisecond reads dead
  cleanT: number      // this step's clean-air lap time (recomputed every step)
  absorb: number      // outstanding one-off time debt, drained as visible slowdown
  /** The rate (laps/sec) this car ACTUALLY moved last step — holds, dirty air, slides and drains
   * included. Samples extrapolate with this, so a car held in a train doesn't overshoot its true
   * motion and snap back every step (the followed-car-smooth / neighbours-jitter artefact). */
  lastRate: number
  /** Presentation pursuit (#no-teleport invariant): the SHOWN journey coordinate only ever moves
   * forward, chasing the engine truth with a bounded, low-passed velocity. Truth ahead → the sprite
   * presses on (capped ~1.6× race pace); truth behind → it eases off and waits. Sample-side only. */
  shownJ: number
  shownVel: number
  lastTruthJ: number
  lastSampleWall: number
  /** The pit lane spliced into the journey line: [start, end] in journey units. Set when the car
   * turns in; kept until the SHOWN car has cleared it, so trailing presentation still uses the lane. */
  pitJ: { start: number; end: number } | null
  /** An overtake in progress: sliding through on `targetId`, `remaining` race-seconds to completion.
   * `closure` is the relative closing rate (pos units/sec), FIXED at initiation — recomputing it
   * against the moving goal made the rate decay every step and the extrapolation snap backwards to
   * chase it (the visible jerks). `cost` distinguishes a racing pass from a blue-flag wave-past. */
  passing: { targetId: string; remaining: number; closure: number; cost: 'pass' | 'blueflag' } | null
  pit: PitState | null
  pitPathFrac: number // 0..1 along the pit lane while in it (the map renders this)
  intensity: number
  defending: boolean
  finished: boolean
  finishOrder: number // classification rank locked at the flag (0 = not finished yet)
  wearFrozen: boolean // god mode: tyre condition stops wearing; clears itself at the next fresh set
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
  private entryFrac: number
  private exitFrac: number
  private leaderFinished = false
  private finishCount = 0
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
        gridPos0: 0, // set with pos, below
        lapStartClock: 0,
        lapNoise: Math.random() * (1.2 - 0.01 * driver.consistency),
        harryGap: TRAFFIC.HOLD_GAP + (Math.random() - 0.5) * 0.3,
        harryPhase: Math.random() * Math.PI * 2,
        cleanT: 100,
        absorb: 0,
        lastRate: 0,
        shownJ: Number.NEGATIVE_INFINITY,
        shownVel: 0,
        lastTruthJ: 0,
        lastSampleWall: 0,
        pitJ: null,
        passing: null,
        pit: null,
        pitPathFrac: 0,
        intensity: 0,
        defending: false,
        finished: false,
        finishOrder: 0,
        wearFrozen: false,
      }
      car.cleanT = this.cleanPace(car)
      car.lastRate = 1 / car.cleanT
      // Grid deficit in lap terms: the car crosses the line its slot spacing after pole (plus the
      // shared rollout), so crossings happen in grid order and the map gets its launch visuals.
      car.pos = -car.launchTotal / car.cleanT
      car.gridPos0 = car.pos
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
      const posBefore = car.pos

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
          // Blue flags: the car ahead on the road is a lap (or more) down — it waves the lapper by.
          if (gapSec < TRAFFIC.STRIKE_RANGE && !car.passing) {
            car.passing = { targetId: aheadOnRoad.ds.driverId, remaining: PASS_DURATION, closure: this.closureRate(car, aheadOnRoad), cost: 'blueflag' }
          }
        } else if (gapSec < TRAFFIC.DIRTY_RANGE) {
          const dirty = TRAFFIC.MAX_DIRTY * (1 - gapSec / TRAFFIC.DIRTY_RANGE)
          const tow = TRAFFIC.SLIPSTREAM * (0.3 + 0.7 * (this.circuit.straightness ?? 0.5))
          stepLapTime = car.cleanT + dirty - tow

          const paceEdge = aheadOnRoad.cleanT - car.cleanT
          if (gapSec <= TRAFFIC.STRIKE_RANGE && paceEdge > 0 && !car.passing) {
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
                car.passing = { targetId: aheadOnRoad.ds.driverId, remaining: PASS_DURATION, closure: this.closureRate(car, aheadOnRoad), cost: 'pass' }
              }
            }
          }
        }
      }

      // An overtake in progress: slide through on the target — alongside, past, clear — finishing
      // PASS_CLEARANCE ahead when the move's time is up. The map's battle separation renders the
      // side-by-side phase. Costs land at completion; the target vanishing (pit/retire) cancels.
      if (car.passing) {
        const target = this.cars.find((c) => c.ds.driverId === car.passing!.targetId)
        if (!target || target.ds.retired || target.finished || (target.pit && target.pit.phase !== 'called')) {
          car.passing = null
        } else {
          car.passing.remaining -= dt
          const goal = target.pos + PASS_CLEARANCE / car.cleanT
          if (car.passing.remaining <= 0) {
            car.pos = Math.max(car.pos + effDt / stepLapTime, goal)
            if (car.passing.cost === 'pass') {
              car.absorb += TRAFFIC.ATTACKER_PENALTY
              target.absorb += TRAFFIC.DEFENDER_PENALTY
              this.events.push({ type: 'overtake', lap: this.lapOf(car), driverId: car.ds.driverId, otherId: target.ds.driverId })
            } else {
              car.absorb += LAPPER_COST
              target.absorb += BACKMARKER_COST
            }
            car.passing = null
          } else {
            // Eased slide: closure (the MEAN closing rate locked at initiation) shaped by the
            // smoothstep derivative 6u(1−u) — zero relative speed at both ends, 1.5× mean at the
            // middle, integrating back to the full gap. Evaluated at the step midpoint.
            const uMid = Math.min(1, Math.max(0, 1 - (car.passing.remaining - dt / 2) / PASS_DURATION))
            const bell = 6 * uMid * (1 - uMid)
            car.pos += (target.lastRate + car.passing.closure * bell) * dt
          }
          this.advanceWear(car, (target.pos - car.pos) * car.cleanT, frac)
          car.lastRate = (car.pos - posBefore) / dt
          this.crossings(car)
          continue
        }
      }

      // Advance, then hold station: never through the car ahead. Gated on proximity, NOT on sharing a
      // lap number — a lap-number gate dissolved the constraint the moment the car ahead crossed the
      // line, letting followers surge through and snap back (a teleport at the line, every lap).
      let next = car.pos + effDt / stepLapTime
      if (aheadOnRoad && aheadOnRoad.pos - car.pos < 0.9) {
        // The harry distance BREATHES (slow per-car oscillation): a stuck car pinned at a constant
        // offset showed a gap frozen to the millisecond on the tower — dead-looking next to the
        // living gaps around it. ~±0.1s over ~7s, floored so it never touches the car ahead.
        const breathe = Math.max(0.08, car.harryGap + 0.1 * Math.sin(this.clock * 0.9 + car.harryPhase))
        const holdPos = aheadOnRoad.pos - breathe / car.cleanT
        // Cap at the harry distance; a car already INSIDE it (just passed, side-by-side) follows at
        // the car ahead's realised pace instead of freezing dead until the gap reopens.
        if (next > holdPos) next = Math.min(next, Math.max(holdPos, car.pos + aheadOnRoad.lastRate * effDt))
      }
      car.pos = next
      car.lastRate = (car.pos - posBefore) / dt

      this.advanceWear(car, aheadOnRoad ? (aheadOnRoad.pos - car.pos) * car.cleanT : Infinity, frac)
      this.crossings(car)
    }

    // Finished cars keep ROLLING — a car that stopped dead on the line stacked the whole field into
    // a pile-up at the flag. Their classification is locked by finishOrder; the sprites just cruise.
    for (const car of this.cars) {
      if (car.finished && !car.ds.retired) {
        car.pos += dt / car.cleanT
        car.lastRate = 1 / car.cleanT
      }
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
    // God-mode freeze pins the condition; temperature and fuel keep living.
    if (!car.wearFrozen) car.ds.currentTyre.condition = wearTyre(car.ds.currentTyre, wearMult, frac)
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
      car.finishOrder = ++this.finishCount
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
    // Clamp to the race distance: post-flag cruising must not inflate the deficit of cars still running.
    const leaderPos = Math.min(this.state.totalLaps, Math.max(...this.cars.filter((c) => !c.ds.retired).map((c) => c.pos)))
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
    // The AI's undercut/clear-air windows compare race times ACROSS cars — per-car crossing-stamped
    // totalTime is incoherent for that here. Feed it pseudo-times built from the live position chain
    // (leader at 0, everyone else at their real deficit in seconds), which is what it thinks it has.
    const byRoad = [...this.cars].filter((c) => !c.ds.retired).sort((a, b) => b.pos - a.pos)
    const liveTime = new Map<string, number>()
    byRoad.forEach((c) => liveTime.set(c.ds.driverId, (byRoad[0].pos - c.pos) * c.cleanT))
    const field: FieldCar[] = this.cars.map((c) => ({
      driverId: c.ds.driverId, position: c.ds.position, totalTime: liveTime.get(c.ds.driverId) ?? c.ds.totalTime,
      condition: c.ds.currentTyre.condition, retired: c.ds.retired,
    }))
    const self = field.find((f) => f.driverId === car.ds.driverId)!
    const decision = decidePit(
      plan, car.ds.currentTyre.condition, projectedCond, car.ds.currentTyre.compound,
      moisture, self, field, this.pitLoss,
    )
    car.pit = decision.shouldPit ? { phase: 'called', compound: decision.targetCompound, timer: 0, boxTime: 0, transitHalf: 0, forced: false } : null
  }

  // ── Pit lane ─────────────────────────────────────────────────────────────────────────────────────

  private enterPitLane(car: LiveCar): void {
    // Total lane time = the time this track section would take at race pace + the era pit loss.
    // The stationary hold is short and real; the transit carries the rest at limiter-like pace.
    const trackEquiv = (((1 - this.entryFrac + this.exitFrac) % 1) + 1) % 1 * car.cleanT
    const stationary = Math.max(1.5, BOX_TIME_BASE + (Math.random() * 2 - 1) * 1.5)
    const transit = Math.max(6, trackEquiv + this.pitLoss - stationary)
    car.pit = { ...car.pit!, phase: 'lane-in', timer: transit / 2, boxTime: stationary, transitHalf: transit / 2 }
    const span = (((1 - this.entryFrac + this.exitFrac) % 1) + 1) % 1
    car.pitJ = { start: car.pos, end: car.pos + span }
    car.pitPathFrac = 0
    this.events.push({ type: 'pit-in', lap: this.lapOf(car), driverId: car.ds.driverId, compound: car.pit.compound })
  }

  private stepPitLane(car: LiveCar, dt: number): void {
    const pit = car.pit!
    pit.timer -= dt
    if (pit.phase === 'lane-in') {
      car.pitPathFrac = this.laneFrac(pit)
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
        car.wearFrozen = false // a fresh set wears normally — the god-mode freeze does not carry over
        pit.phase = 'lane-out'
        pit.timer = pit.transitHalf
      }
      return
    }
    // lane-out
    car.pitPathFrac = this.laneFrac(pit)
    if (pit.timer <= 0) {
      car.pos = car.ds.lapTimes.length + this.exitFrac
      car.lastRate = 1 / car.cleanT // rejoin at race pace — the exit jump must not enter the rate
      car.pit = null
      car.pitPathFrac = 0
      // The flag can fall while a car is in the lane: it finishes as it rejoins.
      if (this.leaderFinished || car.ds.lapTimes.length >= this.state.totalLaps) {
        car.finished = true
        car.finishOrder = ++this.finishCount
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
    car.pit = { phase: 'called', compound, timer: 0, boxTime: 0, transitHalf: 0, forced: true }
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

  /** The fixed relative closing rate for a pass: cover the current gap plus the clearance over the
   * move's duration, in the target's frame. */
  private closureRate(car: LiveCar, target: LiveCar): number {
    return Math.max(0, (target.pos + PASS_CLEARANCE / car.cleanT - car.pos) / PASS_DURATION)
  }

  /** God mode: pin / release a car's tyre wear (auto-released when it takes a fresh set). */
  setWearFrozen(driverId: string, on: boolean): void {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (car) car.wearFrozen = on
  }

  isWearFrozen(driverId: string): boolean {
    return this.cars.find((c) => c.ds.driverId === driverId)?.wearFrozen ?? false
  }

  /** Player push controls write straight onto the live car (the engine reads them next step). */
  setPushFields(driverId: string, patch: Partial<Pick<DriverRaceState, 'push' | 'pushAuto' | 'autoDefend'>>): void {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (!car || car.ds.retired) return
    Object.assign(car.ds, patch)
  }

  /** The map's speed profile knows where the drawn pit entry/exit REALLY sit in lap-time terms —
   * without this the engine turned cars in at 0.93 of lap TIME while the lane is drawn at 0.93 of
   * DISTANCE, teleporting the sprite to the lane mouth on every stop. */
  setPitWindow(entryTimeFrac: number, exitTimeFrac: number): void {
    if (Number.isFinite(entryTimeFrac) && entryTimeFrac > 0.5 && entryTimeFrac < 1) this.entryFrac = entryTimeFrac
    if (Number.isFinite(exitTimeFrac) && exitTimeFrac > 0 && exitTimeFrac < 0.5) this.exitFrac = exitTimeFrac
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

  /** Live classification: finishers by the order they took the flag, running cars by continuous
   * position, retirees last (latest first). Post-flag cruising must not reshuffle the result. */
  snapshot(): RaceState {
    const finished = this.cars.filter((c) => c.finished && !c.ds.retired).sort((a, b) => a.finishOrder - b.finishOrder)
    const running = this.cars.filter((c) => !c.ds.retired && !c.finished).sort((a, b) => b.pos - a.pos)
    const retired = this.cars.filter((c) => c.ds.retired).sort((a, b) => (b.ds.retirementLap ?? 0) - (a.ds.retirementLap ?? 0))
    const ordered = [...finished, ...running, ...retired]
    const drivers: DriverRaceState[] = ordered.map((car, i) => {
      const aheadCar = i > 0 && !car.ds.retired ? ordered[i - 1] : null
      const gap = aheadCar ? Math.max(0, (aheadCar.pos - car.pos) * car.cleanT) : 0
      return {
        ...car.ds,
        position: i + 1,
        gap: car.ds.retired || car.finished ? 0 : gap,
        lapsDown: car.ds.retired || car.finished ? car.ds.lapsDown : this.lapsDownOf(car),
      }
    })
    const leader = running[0]
    return {
      ...this.state,
      currentLap: leader ? Math.min(this.state.totalLaps, Math.max(1, Math.floor(leader.pos) + 1)) : this.state.totalLaps,
      drivers,
      phase: this.phase === 'finished' ? 'finished' : 'racing',
    }
  }

  /** Track sample for the 2D map: continuous prog, pit-lane routing, grid hold before the start.
   * `extraSec` is the race time the client has accumulated since the last engine step — the engine
   * quantises the world to LIVE_DT, and without this sub-step extrapolation the sprites jump twice a
   * second and the corner/straight speed mapping turns to mush. Visual-only; the next step corrects. */
  /** Lane progress [0..1] for a pit phase: DECELERATING into the box and accelerating out — a
   * linear ramp stopped dead at the box, and the no-backwards pursuit then overshot it and parked
   * the shown car metres past its own crew. Zero-speed arrival keeps the pursuit glued. */
  private laneFrac(pit: PitState, extraSec = 0): number {
    const t = Math.max(0, pit.timer - extraSec)
    if (pit.phase === 'lane-in') {
      // Constant lane speed, then a FIRM brake zone into the box (zero speed at the marks) — a
      // full-transit ease read as a car unable to brake.
      const B = 0.82
      const tau = 1 - Math.min(1, t / pit.transitHalf)
      const v0 = 0.5 / (B + (1 - B) / 2)
      if (tau <= B) return v0 * tau
      const d = tau - B
      return v0 * B + v0 * (d - (d * d) / (2 * (1 - B)))
    }
    if (pit.phase === 'box') return 0.5
    // Sharp launch off the marks, then constant lane speed to the merge.
    const A = 0.18
    const tau = 1 - Math.min(1, t / pit.transitHalf)
    const v1 = 0.5 / (1 - A / 2)
    if (tau <= A) return 0.5 + v1 * ((tau * tau) / (2 * A))
    return 0.5 + v1 * (A / 2 + (tau - A))
  }

  /** The car's TRUE journey coordinate right now: continuous lap position with the pit lane spliced
   * in as its own segment (frac of the lane maps linearly onto [pitJ.start, pitJ.end], which by
   * construction equals the post-exit position — entering and leaving the lane is seamless). */
  private truthJourney(car: LiveCar, extraSec: number): number {
    if (car.pit && car.pit.phase !== 'called' && car.pitJ) {
      return car.pitJ.start + this.laneFrac(car.pit, extraSec) * (car.pitJ.end - car.pitJ.start)
    }
    const rate = Math.max(0, Math.min(car.lastRate, 3 / car.cleanT))
    return car.pos + extraSec * rate
  }

  /** Track sample for the 2D map. With `mult` (the client's speed multiplier) the returned position
   * is the PURSUIT of truth — the no-teleport invariant: shown positions never jump and never move
   * backwards; corrections render as smooth rubber-banding. Headless callers omit `mult` and read
   * raw truth. */
  sample(driverId: string, extraSec = 0, mult?: number): { prog: number; pit?: boolean; pitPhase?: 'in' | 'box' | 'out'; stopFrac?: number; pitCalled?: boolean; pitNewCompound?: TyreCompound; gridSlot?: number; launch?: number } | null {
    const car = this.cars.find((c) => c.ds.driverId === driverId)
    if (!car) return null
    if (car.ds.retired) return null

    const truthJ = this.truthJourney(car, extraSec)
    let J = truthJ
    if (mult != null) {
      const now = performance.now()
      const dtWall = Math.min(0.1, Math.max(0, (now - car.lastSampleWall) / 1000))
      car.lastSampleWall = now
      const dt = dtWall * mult
      if (!Number.isFinite(car.shownJ) || Math.abs(truthJ - car.shownJ) > 0.3) {
        // First frame, or a genuine reset (race restart): snap once, then the invariant holds.
        car.shownJ = truthJ
        car.shownVel = Math.max(0, car.lastRate)
      } else if (dt > 0) {
        const err = truthJ - car.shownJ
        const truthVel = Math.max(0, (truthJ - car.lastTruthJ) / dt)
        // Chase the moving truth: its own velocity plus an error-closing term. The horizon SCALES
        // with the truth's speed — ~10s at racing speed (corrections stay imperceptible), tightening
        // to ~1s as the truth nears stationary (braking onto pit marks must be firm, or the shown
        // car crawls its last metre and parks short). Never backwards; catch-up capped barely above
        // race pace. Low-passed so velocity changes are accelerations.
        const tau = 1 + 9 * Math.min(1, (truthVel * car.cleanT) / 0.5)
        const vTarget = Math.max(0, Math.min(truthVel + err / tau, Math.max(1.12 / car.cleanT, truthVel)))
        car.shownVel += (vTarget - car.shownVel) * Math.min(1, dt / 0.25)
        car.shownJ += car.shownVel * dt
        if (err >= 0 && car.shownJ > truthJ) car.shownJ = truthJ // close without overshooting
      }
      car.lastTruthJ = truthJ
      J = car.shownJ
    }

    // Resolve the journey coordinate to a track sample.
    if (car.pitJ) {
      if (J >= car.pitJ.start && J <= car.pitJ.end) {
        const pit = car.pit
        const pitPhase = pit && pit.phase !== 'called' ? (pit.phase === 'lane-in' ? 'in' as const : pit.phase === 'box' ? 'box' as const : 'out' as const) : 'out' as const
        const stopFrac = pit && pit.phase === 'box' && pit.boxTime > 0 ? Math.max(0, Math.min(1, 1 - pit.timer / pit.boxTime)) : undefined
        return { prog: (J - car.pitJ.start) / Math.max(1e-9, car.pitJ.end - car.pitJ.start), pit: true, pitPhase, stopFrac, pitNewCompound: pit?.compound }
      }
      // Both truth and the shown car are clear of the lane — retire the splice.
      if (J > car.pitJ.end && !(car.pit && car.pit.phase !== 'called')) car.pitJ = null
    }
    if (J < 0) {
      // Fraction of the grid-to-line run covered, measured against the car's OWN resting
      // position: exactly 0 while parked (whatever cleanT does), exactly 1 at the line.
      const frac = car.gridPos0 < 0 ? 1 - J / car.gridPos0 : 1
      return { prog: 0, gridSlot: car.ds.position, launch: Math.max(0, Math.min(1, frac)) }
    }
    return { prog: Math.min(0.9999, J - Math.floor(J)), pitCalled: car.pit?.phase === 'called' || undefined }
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
