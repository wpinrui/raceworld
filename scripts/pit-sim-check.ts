// Headless sanity check for the imperfect-info pit strategy (run: npx tsx scripts/pit-sim-check.ts).
// Confirms races complete, pit stops happen, lap times stay finite, and the AI switches to wet tyres
// when it rains. Not a balance pass — that's tuned later from real playtests.
import { composeDefaultSeason, DEFAULT_START_YEAR } from '../src/lib/history/compose'
import { calendarForYear } from '../src/data/calendars'
import { rollForms, initRaceState, simulateLap } from '../src/lib/sim/race'
import { runQualifying } from '../src/lib/sim/qualifying'
import type { WeatherPoint, RaceState } from '../src/lib/sim/types'

const { drivers: allDrivers, teams } = composeDefaultSeason()
const drivers = allDrivers.filter((d) => d.teamId !== '')
const circuit = calendarForYear(DEFAULT_START_YEAR)[0]
const YEAR = DEFAULT_START_YEAR
const N = 8

function runRace(weatherOverride?: WeatherPoint[]): RaceState {
  const forms = rollForms(drivers)
  const { results, sessions } = runQualifying(drivers, teams, circuit, forms)
  let state = initRaceState(drivers, teams, circuit, results, sessions, forms, 0.35)
  if (weatherOverride) state = { ...state, weather: weatherOverride, weatherForecast: weatherOverride }
  let guard = 0
  while (state.phase !== 'finished' && guard++ < circuit.laps + 10) {
    state = simulateLap(state, drivers, teams, circuit, YEAR)
  }
  return state
}

// --- dry ---
let stops = 0, nan = 0, finished = 0
const stopDist: Record<number, number> = {}
for (let i = 0; i < N; i++) {
  const s = runRace()
  if (s.phase === 'finished') finished++
  for (const d of s.drivers) {
    stops += d.pitStops
    stopDist[d.pitStops] = (stopDist[d.pitStops] ?? 0) + 1
    if (!Number.isFinite(d.totalTime) || d.lapTimes.some((t) => !Number.isFinite(t))) nan++
  }
}
console.log(`circuit: ${circuit.name} (${circuit.laps} laps), ${drivers.length} cars, ${N} races`)
console.log(`DRY: ${finished}/${N} finished | avg stops/car ${(stops / (N * drivers.length)).toFixed(2)} | non-finite cars ${nan}`)
console.log(`     stop-count distribution: ${JSON.stringify(stopDist)}`)

// --- wet (sustained ~0.5 moisture; engine punishes slicks, AI should switch to inter/wet) ---
let wetRan = 0, wetCars = 0
for (let i = 0; i < N; i++) {
  const wet: WeatherPoint[] = [{ lap: 1, moisture: 0.5 }, { lap: circuit.laps, moisture: 0.5 }]
  const s = runRace(wet)
  for (const d of s.drivers) {
    wetCars++
    const ranWet = d.currentTyre.compound === 'intermediate' || d.currentTyre.compound === 'wet'
      || d.stintHistory.some((st) => st.compound === 'intermediate' || st.compound === 'wet')
    if (ranWet) wetRan++
  }
}
console.log(`WET: ${(100 * wetRan / wetCars).toFixed(0)}% of cars ran inter/wet at some point (expect ~100%)`)
