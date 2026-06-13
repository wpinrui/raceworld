import type { Driver, Team, Circuit, RaceState, GodModeAction, TyreCompound } from './types'
import { simulateLap } from './race'
import { computeTyreLife } from './tyres'
import { getPoints } from './points'

// Race Engineer talent: Monte-Carlo strategy advice. From the current (paused) race state, run the real
// engine to the flag many times under each candidate pit decision and read where the player's car ends up.
// The simulation stays FAITHFUL — every run resamples the engine's true luck (overtakes, DNFs, traffic, and
// the unknown quality of the next set the car would fit). The risk preference lives only in how the results
// are ranked (see summarizeForecast's bad-day figure), never by skewing the rolls — so the odds shown stay
// calibrated to the race actually being run.

// A candidate decision for the player's car. The in-race options (auto/hold/pit) are applied on the first
// forecast lap only; from there the AI (decidePit) runs the rest, so each reads as "do this now, then let
// the engineer run the rest". The pre-race option (start) fits a fresh set on the grid and lets the AI run
// the whole race — answering "which starting tyre gives the best race".
export type ForecastCandidate =
  | { kind: 'auto' }
  | { kind: 'hold' }
  | { kind: 'pit'; compound: TyreCompound }
  | { kind: 'start'; compound: TyreCompound }

export interface ForecastSample {
  position: number // classified position in the final state (only trusted when !retired)
  retired: boolean
}

export interface ForecastStats {
  runs: number
  expectedFinish: number // mean outcome; a DNF counts as one place worse than last
  badDayFinish: number // mean of the worst 25% of outcomes (CVaR) — the "assume the rolls go against me" figure
  pWin: number
  pPodium: number
  pPoints: number
  dnfRate: number
}

export function candidateActions(candidate: ForecastCandidate, playerDriverId: string): GodModeAction[] | undefined {
  switch (candidate.kind) {
    case 'auto':
    case 'start':
      return undefined // no per-lap override — the AI strategy decides (start fits its tyre in the seed state)
    case 'hold':
      return [{ type: 'cancel-pit', driverId: playerDriverId }]
    case 'pit':
      return [{ type: 'force-pit', driverId: playerDriverId, compound: candidate.compound }]
  }
}

// For a 'start' candidate, fit the player a fresh set of the chosen grid tyre before the race runs — the
// same maths setStartingTyre uses. computeTyreLife rolls this set's good/duff luck, so each run samples a
// different starting life, exactly the uncertainty a grid-tyre choice carries.
function applyStartTyre(start: RaceState, drivers: Driver[], circuit: Circuit, playerDriverId: string, compound: TyreCompound): RaceState {
  const drv = drivers.find((d) => d.id === playerDriverId)
  if (!drv) return start
  const maxLifeLaps = computeTyreLife(start.tyreBaseLife[compound], drv.smoothness, circuit.laps)
  return {
    ...start,
    drivers: start.drivers.map((ds) =>
      ds.driverId === playerDriverId ? { ...ds, currentTyre: { compound, condition: 100, maxLifeLaps } } : ds,
    ),
  }
}

// One independent forecast run. simulateLap is non-mutating and returns fresh state, so `start` is safe to
// reuse as the seed for every run; the difference between runs is only the live RNG each one draws.
export function forecastSingleRun(
  start: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  playerDriverId: string,
  candidate: ForecastCandidate,
): ForecastSample {
  let s = candidate.kind === 'start' ? applyStartTyre(start, drivers, circuit, playerDriverId, candidate.compound) : start
  let firstLap = true
  // A race can't run longer than its own distance; this only guards against a pathological non-terminating
  // loop (e.g. a future phase that never leaves 'racing').
  let safety = start.totalLaps - start.currentLap + 2
  while (s.phase === 'racing' && safety-- > 0) {
    s = simulateLap(s, drivers, teams, circuit, year, firstLap ? candidateActions(candidate, playerDriverId) : undefined)
    firstLap = false
  }
  const ds = s.drivers.find((d) => d.driverId === playerDriverId)
  return { position: ds?.position ?? start.drivers.length, retired: ds?.retired ?? true }
}

// Fold a set of samples into the headline stats. A DNF is the worst possible outcome — one place worse than
// last — so it weighs on both the expected finish and the bad-day (worst-quartile) figure rather than being
// quietly dropped. Probabilities (win/podium/points) only ever count classified, non-retired runs.
export function summarizeForecast(samples: ForecastSample[], fieldSize: number, year: number): ForecastStats {
  const runs = samples.length
  if (runs === 0) return { runs: 0, expectedFinish: 0, badDayFinish: 0, pWin: 0, pPodium: 0, pPoints: 0, dnfRate: 0 }

  const score = (s: ForecastSample) => (s.retired ? fieldSize + 1 : s.position)
  const scoresWorstFirst = samples.map(score).sort((a, b) => b - a)
  const worstCount = Math.max(1, Math.ceil(runs * 0.25))
  const badDayFinish = scoresWorstFirst.slice(0, worstCount).reduce((a, b) => a + b, 0) / worstCount
  const expectedFinish = scoresWorstFirst.reduce((a, b) => a + b, 0) / runs

  let wins = 0,
    podiums = 0,
    points = 0,
    dnfs = 0
  for (const s of samples) {
    if (s.retired) {
      dnfs++
      continue
    }
    if (s.position === 1) wins++
    if (s.position <= 3) podiums++
    if (getPoints(s.position, year) > 0) points++
  }
  return {
    runs,
    expectedFinish,
    badDayFinish,
    pWin: wins / runs,
    pPodium: podiums / runs,
    pPoints: points / runs,
    dnfRate: dnfs / runs,
  }
}
