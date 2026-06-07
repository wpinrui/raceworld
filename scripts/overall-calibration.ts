// Re-run the OVERALL_WEIGHTS calibration (originally PR #81) after the wet-effect change (issue #102),
// then apply the wet/dry split (PR #100). Method, mirroring #81:
//   - car equalised (all carPace 75), per-race form neutralised (5), races forced DRY,
//   - one attribute spread across the field at a time (others at 75),
//   - each attribute's weight is proportional to its marginal effect on points/race (regression slope).
// Pace measured in the dry is the combined "speed" budget; it is then split into pace/wet by weather
// exposure, with the wet rating now counting DOUBLE per point: wet share = 2E[m]/(1+E[m]).
//
// ROUND-BASED + STREAMING: each round runs `--round` races per attribute, then prints the FULL current
// weight estimate, so a complete (refining) answer is available after round 1 and you can stop any time.
// Run: tsx scripts/overall-calibration.ts [--round 8] [--rounds 15]

import type { Driver, Team, Circuit, RaceState } from '@/lib/sim/types'
import { initRaceState, simulateLap } from '@/lib/sim/race'
import { buildRaceResults } from '@/lib/sim/race-results'
import { runQualifying } from '@/lib/sim/qualifying'
import { generateWeatherCurve, getMoistureAtLap } from '@/lib/sim/weather'
import { calendarForYear } from '@/data/calendars'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('overall-cal'); Math.random = () => rng()
const argv = process.argv.slice(2)
const argN = (flag: string, def: number) => { const i = argv.indexOf(flag); return i >= 0 ? parseInt(argv[i + 1], 10) || def : def }
const ROUND = argN('--round', 8)   // races per attribute per round
const ROUNDS = argN('--rounds', 15)
const YEAR = 2026
const N_DRIVERS = 20

const cal = calendarForYear(YEAR)
const circuit: Circuit = cal.find((c) => c.id === 'australia') ?? cal[0]
type Attr = 'pace' | 'consistency' | 'overtaking' | 'smoothness'
const ATTRS: Attr[] = ['pace', 'consistency', 'overtaking', 'smoothness']

const teams: Team[] = Array.from({ length: N_DRIVERS / 2 }, (_, i) => ({
  id: `t${i}`, name: `Team ${i}`, shortName: `T${i}`, nationality: 'GB', color: '#888', carPace: 75, // equalised
}))
const forms: Record<string, number> = {}
for (let i = 0; i < N_DRIVERS; i++) forms[`d${i}`] = 5 // neutralised
const values = Array.from({ length: N_DRIVERS }, (_, i) => 50 + (i * 50) / (N_DRIVERS - 1)) // spread 50..100

function makeDriver(i: number, attr: Attr, value: number): Driver {
  const s: Record<string, number> = { pace: 75, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 75 }
  s[attr] = value
  return {
    id: `d${i}`, name: `Driver ${i}`, teamId: `t${Math.floor(i / 2)}`, nationality: 'GB', gender: 'male',
    pace: s.pace, wetWeatherPace: s.wetWeatherPace, overtaking: s.overtaking, smoothness: s.smoothness,
    consistency: s.consistency, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0,
    contractExpiresAfterSeason: 2030,
  }
}
const driversFor: Record<Attr, Driver[]> = {
  pace: values.map((v, i) => makeDriver(i, 'pace', v)),
  consistency: values.map((v, i) => makeDriver(i, 'consistency', v)),
  overtaking: values.map((v, i) => makeDriver(i, 'overtaking', v)),
  smoothness: values.map((v, i) => makeDriver(i, 'smoothness', v)),
}
const totals: Record<Attr, number[]> = {
  pace: new Array(N_DRIVERS).fill(0), consistency: new Array(N_DRIVERS).fill(0),
  overtaking: new Array(N_DRIVERS).fill(0), smoothness: new Array(N_DRIVERS).fill(0),
}

const isDry = (s: RaceState) => s.weather.every((p) => p.moisture < 0.02)
function runRace(drivers: Driver[]): Map<string, number> {
  const { results: qr, sessions } = runQualifying(drivers, teams, circuit, forms)
  let state = initRaceState(drivers, teams, circuit, qr, sessions, forms, YEAR)
  let guard = 0
  while (!isDry(state) && guard++ < 30) state = initRaceState(drivers, teams, circuit, qr, sessions, forms, YEAR)
  state = { ...state, phase: 'racing' }
  let lap = 0
  while (state.phase === 'racing' && lap++ < circuit.laps + 10) state = simulateLap(state, drivers, teams, circuit, YEAR)
  return new Map(buildRaceResults(state, drivers, teams, YEAR).map((r) => [r.driverId, r.points]))
}
function slope(attr: Attr, races: number): number {
  const ppr = totals[attr].map((t) => t / races)
  const mx = values.reduce((a, b) => a + b, 0) / N_DRIVERS
  const my = ppr.reduce((a, b) => a + b, 0) / N_DRIVERS
  let cov = 0, varx = 0
  for (let i = 0; i < N_DRIVERS; i++) { cov += (values[i] - mx) * (ppr[i] - my); varx += (values[i] - mx) ** 2 }
  return cov / varx
}

process.stderr.write('computing E[m] (weather exposure)...\n')
let mSum = 0, mLaps = 0
for (const c of cal) for (let k = 0; k < 2000; k++) {
  const curve = generateWeatherCurve(c.laps)
  for (let l = 1; l <= c.laps; l++) { mSum += getMoistureAtLap(curve, l); mLaps++ }
}
const Em = mSum / mLaps
const wetFrac = (2 * Em) / (1 + Em) // wet counts double per point now (#102)
process.stderr.write(`E[m]=${Em.toFixed(4)}  wet split fraction 2E[m]/(1+E[m]) = ${wetFrac.toFixed(4)}\n`)
process.stderr.write(`Calibrating on ${circuit.name} (${circuit.laps} laps): ${ROUND} races/attr/round, ${ROUNDS} rounds. Ctrl-C any time after a round.\n`)

const r3 = (x: number) => Math.round(x * 1000) / 1000
let racesDone = 0
for (let round = 1; round <= ROUNDS; round++) {
  for (const a of ATTRS) {
    for (let r = 0; r < ROUND; r++) { const pts = runRace(driversFor[a]); for (let i = 0; i < N_DRIVERS; i++) totals[a][i] += pts.get(`d${i}`) ?? 0; process.stderr.write('.') }
    process.stderr.write(` ${a}`)
  }
  racesDone += ROUND
  const sp = Math.max(0, slope('pace', racesDone)), co = Math.max(0, slope('consistency', racesDone))
  const ov = Math.max(0, slope('overtaking', racesDone)), sm = Math.max(0, slope('smoothness', racesDone))
  const tot = sp + co + ov + sm, speedShare = sp / tot
  const paceW = speedShare * (1 - wetFrac), wetW = speedShare * wetFrac
  process.stderr.write(`\n[round ${round}, ${racesDone} races/attr] slopes pace=${sp.toFixed(3)} cons=${co.toFixed(3)} over=${ov.toFixed(3)} smooth=${sm.toFixed(3)}\n`)
  process.stdout.write(`weights @${racesDone}: pace ${r3(paceW)}  consistency ${r3(co / tot)}  overtaking ${r3(ov / tot)}  smoothness ${r3(sm / tot)}  wet ${r3(wetW)}\n`)
}
