// Fake per-lap race engine for the track preview (#sim-overhaul phase 6 step A). Mimics the real sim's
// shape — one whole lap per tick, per-car lap times with noise, one scheduled pit stop each, a scripted
// retirement — and exposes a per-frame sampler that interpolates each car's on-track position between
// ticks, routing pitting cars through the pit lane (entry → box hold → exit). Construction is
// deterministic (safe for the server render); randomness only enters inside tick(), which is client-only.

import type { CommentaryEntry, DriverRaceState, TyreCompound } from '@/lib/sim/types'
import type { TrackSample } from '@/components/race/RaceTrackMap'
import { MOCK_DRIVERS, MOCK_GRID, MOCK_TOTAL_LAPS } from './mock'

const PIT_LOSS = 21
const PIT_ENTRY = 0.93 // lap fraction where the pit lane leaves the racing line
const PIT_EXIT = 0.07  // lap fraction where it rejoins on the following lap
const BASE_LAP = 78

const COMPOUND_CYCLE: TyreCompound[] = ['medium', 'soft', 'hard']

interface EngineCar {
  id: string
  name: string
  grid: number
  baseLap: number
  cum: number[]       // cum[k] = race time after completing lap k; cum[0] = the standing-start offset
  lapTimes: number[]  // lapTimes[k] = duration of lap k+1
  pitLap: number
  retireLap: number | null
  startCompound: TyreCompound
  scanIdx: number     // interpolation cache: last cum index at or below the playback clock
}

export interface FakeEngine {
  readonly laps: number
  readonly totalLaps: number
  readonly finished: boolean
  tick(): void
  states(): DriverRaceState[]
  commentary(): CommentaryEntry[]
  /** Position of a car at `frac` (0..1) of the way through the current tick interval. */
  sampleAt(id: string, frac: number): TrackSample
  /** Duration of the leader's most recent lap in seconds (the real-time length of one tick at 1x). */
  leaderLapSeconds(): number
}

export function createEngine(): FakeEngine {
  const cars: EngineCar[] = MOCK_DRIVERS.map((d, i) => {
    const grid = MOCK_GRID[d.id]
    return {
      id: d.id,
      name: d.name,
      grid,
      // Pace loosely follows the grid with deterministic decorrelation so overtakes happen.
      baseLap: BASE_LAP + (grid - 1) * 0.05 + (((i * 13) % 7) - 3) / 22,
      cum: [grid * 0.35],
      lapTimes: [],
      pitLap: 18 + ((i * 7) % 15),
      retireLap: d.id === 'car-19' ? 18 : null,
      startCompound: COMPOUND_CYCLE[grid % 3],
      scanIdx: 0,
    }
  })
  const byId = new Map(cars.map((c) => [c.id, c]))

  let laps = 0
  const log: CommentaryEntry[] = []
  let statesCache: DriverRaceState[] = []

  const alive = (c: EngineCar, atLap: number) => c.retireLap === null || atLap <= c.retireLap

  const buildStates = () => {
    const running = cars.filter((c) => alive(c, laps))
    const leaderTime = running.length ? Math.min(...running.map((c) => c.cum[Math.min(laps, c.cum.length - 1)])) : 0
    const order = [...cars].sort((a, b) => {
      const aOut = !alive(a, laps), bOut = !alive(b, laps)
      if (aOut !== bOut) return aOut ? 1 : -1
      return a.cum[Math.min(laps, a.cum.length - 1)] - b.cum[Math.min(laps, b.cum.length - 1)]
    })
    statesCache = order.map((c, idx) => {
      const retired = !alive(c, laps)
      const lapsDone = Math.min(laps, c.cum.length - 1)
      const total = c.cum[lapsDone]
      const pitted = laps >= c.pitLap && !retired
      const stintLap = pitted ? laps - c.pitLap : laps
      const prevTotal = idx > 0 ? order[idx - 1].cum[Math.min(laps, order[idx - 1].cum.length - 1)] : total
      const compound = pitted ? 'hard' as const : c.startCompound
      return {
        driverId: c.id,
        position: idx + 1,
        totalTime: total,
        lapTimes: c.lapTimes.slice(0, lapsDone),
        currentTyre: { compound, condition: Math.max(8, Math.round(100 - stintLap * 2.4)), maxLifeLaps: 40 },
        tyreTemp: 0.35 + ((idx * 7) % 9) / 12,
        push: c.id === 'car-6' ? { kind: 'preset' as const, preset: 'overtake' as const } : undefined,
        autoDefend: c.id === 'car-7' ? true : undefined,
        stintLap,
        fuelLaps: MOCK_TOTAL_LAPS - laps,
        form: 5,
        retired,
        retirementLap: retired ? c.retireLap : null,
        retirementReason: retired ? 'engine' as const : null,
        mistakeCount: 0,
        worstMistakeLoss: 0,
        lastPitLap: pitted ? c.pitLap : 0,
        pitStops: pitted ? 1 : 0,
        stintHistory: pitted ? [{ compound: c.startCompound, laps: c.pitLap }] : [],
        targetPitLap: pitted || retired ? null : c.pitLap,
        targetNextCompound: 'hard' as const,
        gap: idx === 0 || retired ? 0 : Math.max(0, total - prevTotal),
        lapsDown: retired ? 0 : Math.max(0, Math.floor((total - leaderTime) / c.baseLap)),
        dsq: false,
      }
    })
  }
  buildStates()

  const posOf = (id: string) => statesCache.find((s) => s.driverId === id)?.position ?? 0

  const tick = () => {
    if (laps >= MOCK_TOTAL_LAPS) return
    laps++
    if (laps === 1) log.push({ lap: 1, type: 'info', text: 'Lights out, the field streams through Sainte Devote' })
    for (const c of cars) {
      if (!alive(c, laps)) continue
      const stintLap = laps > c.pitLap ? laps - c.pitLap : laps
      let t = c.baseLap + (Math.random() - 0.5) * 0.6 + stintLap * 0.02
      if (laps === 1) t += 2.2 + c.grid * 0.12
      if (Math.random() < 0.02) t += 1.5 + Math.random() * 1.5
      if (laps === c.pitLap) {
        t += PIT_LOSS
        log.push({ lap: laps, type: 'pit', text: `${c.name} pits from P${posOf(c.id)} for hards` })
      }
      if (laps === c.retireLap) log.push({ lap: laps, type: 'retirement', text: `${c.name} retires, engine failure` })
      c.lapTimes.push(t)
      c.cum.push(c.cum[c.cum.length - 1] + t)
    }
    buildStates()
  }

  const leaderCumAt = (lap: number) => {
    const running = cars.filter((c) => alive(c, lap))
    return Math.min(...running.map((c) => c.cum[Math.min(lap, c.cum.length - 1)]))
  }

  const sampleAt = (id: string, frac: number): TrackSample => {
    const c = byId.get(id)
    if (!c) return null
    if (laps === 0) return { prog: 0, gridSlot: c.grid } // formed up on the starting grid
    // Playback clock: the leader covers exactly one lap per tick interval; everyone else follows their
    // own cumulative times against the same clock.
    const S = leaderCumAt(laps - 1) + Math.min(1, Math.max(0, frac)) * (leaderCumAt(laps) - leaderCumAt(laps - 1))
    if (c.retireLap !== null && S >= c.cum[Math.min(c.retireLap, c.cum.length - 1)]) return null
    // Find the lap in progress at S.
    let k = Math.min(c.scanIdx, c.cum.length - 1)
    while (k > 0 && c.cum[k] > S) k--
    while (k + 1 < c.cum.length && c.cum[k + 1] <= S) k++
    c.scanIdx = k
    if (k >= c.lapTimes.length) return { prog: 0 } // fully caught up (leader at a boundary)
    const lapNo = k + 1
    const lapT = c.lapTimes[k]
    const isPit = lapNo === c.pitLap
    const run = lapT - (isPit ? PIT_LOSS : 0)
    const tau = S - c.cum[k]
    if (isPit) {
      const tEntry = PIT_ENTRY * run
      if (tau < tEntry) return { prog: tau / run }
      // Pit phase: 35% of the window crawling to the box, 30% stationary, 35% crawling out — the long
      // drive shares make the pit-lane speed limit visible next to racing speed.
      const w = Math.min(1, (tau - tEntry) / (lapT - tEntry))
      const prog = w < 0.35 ? (w / 0.35) * 0.5 : w < 0.65 ? 0.5 : 0.5 + ((w - 0.65) / 0.35) * 0.5
      return { prog, pit: true }
    }
    // The lap after a stop starts from the pit exit, not the S/F line.
    const from = lapNo === c.pitLap + 1 ? PIT_EXIT : 0
    return { prog: from + (1 - from) * Math.min(0.999, tau / run) }
  }

  return {
    get laps() { return laps },
    totalLaps: MOCK_TOTAL_LAPS,
    get finished() { return laps >= MOCK_TOTAL_LAPS },
    tick,
    states: () => statesCache,
    commentary: () => [...log],
    sampleAt,
    leaderLapSeconds: () => (laps === 0 ? BASE_LAP : leaderCumAt(laps) - leaderCumAt(laps - 1)),
  }
}
