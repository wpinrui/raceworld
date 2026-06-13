import type { Driver, Team, Circuit, RaceState, GodModeAction, TyreCompound, TyreState } from './types'
import { simulateLap } from './race'
import { computeTyreLife, tyreStepsOutOfWindow } from './tyres'
import { getMoistureAtLap } from './weather'
import { getPoints } from './points'

const ALL_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']

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

// The compounds that suit the track at a given moisture — those in their window (no slicks in the wet, no
// wets in the dry). Falls back to within-one-step if a transitional moisture leaves nothing perfectly in
// window, so there's always at least one option.
export function suitableCompounds(moisture: number): TyreCompound[] {
  const inWindow = ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) === 0)
  return inWindow.length ? inWindow : ALL_COMPOUNDS.filter((c) => tyreStepsOutOfWindow(c, moisture) <= 1)
}

// The decisions worth forecasting at a given moisture. Pre-race: which grid tyre to start on. In-race: box
// now for a suitable compound, or hold (stay out). Intermediates/wets appear once it's actually wet.
export function buildCandidates(moisture: number, mode: 'pre-race' | 'racing'): ForecastCandidate[] {
  const compounds = suitableCompounds(moisture)
  if (mode === 'pre-race') return compounds.map((c) => ({ kind: 'start', compound: c }) as ForecastCandidate)
  return [...compounds.map((c) => ({ kind: 'pit', compound: c }) as ForecastCandidate), { kind: 'hold' }]
}

// Stable key for a candidate, for accumulating its samples.
export const candKey = (c: ForecastCandidate): string => (c.kind === 'pit' || c.kind === 'start' ? `${c.kind}:${c.compound}` : c.kind)

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

export interface GatherOpts {
  target: number // runs per option to collect
  burstMs?: number // how long to run between yields (default 80ms)
  budgetMs?: number // optional wall-clock cap; OMIT for a full sample (the auto-advance path)
  shouldAbort?: () => boolean
  onProgress?: (acc: Record<string, ForecastSample[]>) => void
  // Early-stop: checked after each burst with the samples so far. Return true to finish before `target` once
  // the answer is already decisive (e.g. staying out is clearly best) — saves a full sample on obvious laps.
  shouldStop?: (acc: Record<string, ForecastSample[]>) => boolean
}

// Gather forecast samples for ONE car across the given options. Runs are spread round-robin via a cursor
// that PERSISTS across bursts, so every option gets even coverage even when a single run is slower than a
// burst — otherwise the first option would hog the whole budget (the bug that left every other option at 0).
// Yields between bursts so the UI paints / Stop fires. Stops at `target` per option, at `budgetMs` if given,
// or when shouldAbort trips.
export async function gatherForecast(
  seed: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  playerDriverId: string,
  candidates: ForecastCandidate[],
  opts: GatherOpts,
): Promise<{ acc: Record<string, ForecastSample[]>; timedOut: boolean }> {
  const burstMs = opts.burstMs ?? 80
  const acc: Record<string, ForecastSample[]> = Object.fromEntries(candidates.map((c) => [candKey(c), []]))
  opts.onProgress?.(acc)
  const allFull = () => candidates.every((c) => acc[candKey(c)].length >= opts.target)
  const startedAt = performance.now()
  let rr = 0
  let done = false
  let timedOut = false
  while (!done && !timedOut) {
    if (opts.shouldAbort?.()) break
    const burstStart = performance.now()
    do {
      const c = candidates[rr % candidates.length]
      rr++
      const k = candKey(c)
      if (acc[k].length < opts.target) acc[k].push(forecastSingleRun(seed, drivers, teams, circuit, seed.year, playerDriverId, c))
    } while (performance.now() - burstStart < burstMs && !allFull())
    opts.onProgress?.(acc)
    await new Promise((r) => setTimeout(r, 0))
    done = allFull()
    timedOut = opts.budgetMs !== undefined && performance.now() - startedAt >= opts.budgetMs
    if (!done && opts.shouldStop?.(acc)) break // decisive already — don't burn the rest of the sample
  }
  return { acc, timedOut: timedOut && !done }
}

export interface PitRecommendation {
  driverId: string
  compound: TyreCompound
}

const PIT_MARGIN = 0.5 // box only if pitting now beats staying out by at least this many places — never on a wash
// Early-stop heuristic (auto-mode only): once each option has a PROBE_MIN-run probe, bail to "don't pit" if
// staying out is clearly ahead (the common case — saves a full sample). This is ASYMMETRIC ON PURPOSE: a
// PIT recommendation is NEVER taken on a partial sample — it always rides the full forecast, so the auto-mode
// call can't diverge from a manual Simulate. (A wrong no-pit skip just costs one more lap; a wrong pit ruins
// the race — exactly what was happening when an early pit-confirm fired on 24 noisy runs.)
const PROBE_MIN = 12
const NO_PIT_MARGIN = 1.5

// Zero-sim guard (deliberately conservative): a tyre that suits the conditions and is still this healthy is
// never worth boxing in this model — the AI doesn't even consider a stop until ~22% condition, so 70% leaves
// a 3x margin. Anything below this, or a tyre wrong for the weather (e.g. slicks in the rain), still gets the
// full Monte-Carlo. Raise it for an even more cautious skip.
const HEALTHY_SKIP_CONDITION = 70

// Whether boxing a car is even worth simulating now. False only when the tyre is in its weather window AND
// comfortably healthy — the obvious no-stop case the auto-mode skips outright (no sims). A wrong-for-weather
// tyre always returns true, so a rain change immediately re-arms the forecast.
export function shouldEvaluatePit(tyre: TyreState, moisture: number): boolean {
  return !(tyreStepsOutOfWindow(tyre.compound, moisture) === 0 && tyre.condition >= HEALTHY_SKIP_CONDITION)
}

// Race Engineer Mode watchdog: does the forecast say any of these player cars should box NOW? For each car,
// gather samples per option (up to `target`, but short-circuited early when the call is already decisive),
// then box only if the best pit option clearly beats staying out (by PIT_MARGIN). Returns the first such car
// (and compound), or null. Async with yields + progress; `shouldAbort` cancels mid-run.
export async function recommendsPit(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  playerDriverIds: string[],
  opts: { target: number; shouldAbort?: () => boolean; onProgress?: (driverId: string, runs: number, target: number) => void },
): Promise<PitRecommendation | null> {
  const moisture = getMoistureAtLap(state.weather, state.currentLap)
  const cands = buildCandidates(moisture, 'racing')
  const fieldSize = state.drivers.length
  const hold = cands.find((c) => c.kind === 'hold')
  const pits = cands.filter((c) => c.kind === 'pit')
  for (const id of playerDriverIds) {
    if (opts.shouldAbort?.()) return null
    const ds = state.drivers.find((d) => d.driverId === id)
    if (!ds || ds.retired) continue
    if (!shouldEvaluatePit(ds.currentTyre, moisture)) continue // healthy & right tyre — obviously no stop, no sims
    const expOf = (acc: Record<string, ForecastSample[]>, c: ForecastCandidate) => summarizeForecast(acc[candKey(c)] ?? [], fieldSize, state.year).expectedFinish
    const { acc } = await gatherForecast(state, drivers, teams, circuit, id, cands, {
      target: opts.target,
      shouldAbort: opts.shouldAbort,
      onProgress: (a) => opts.onProgress?.(id, Math.min(...cands.map((c) => a[candKey(c)].length)), opts.target),
      shouldStop: (a) => {
        const minRuns = Math.min(...cands.map((c) => a[candKey(c)].length))
        if (minRuns < PROBE_MIN) return false
        const holdE = hold ? expOf(a, hold) : Infinity
        const pitE = Math.min(...pits.map((c) => expOf(a, c)))
        return holdE <= pitE - NO_PIT_MARGIN // staying out clearly best — obvious skip; pits ALWAYS go full-sample
      },
    })
    if (opts.shouldAbort?.()) return null
    const holdExp = hold ? expOf(acc, hold) : Infinity
    const bestPit = pits
      .map((c) => ({ c, exp: expOf(acc, c), runs: (acc[candKey(c)] ?? []).length }))
      .filter((x) => x.runs > 0)
      .sort((a, b) => a.exp - b.exp)[0]
    if (bestPit && bestPit.exp <= holdExp - PIT_MARGIN) return { driverId: id, compound: bestPit.c.compound }
  }
  return null
}
