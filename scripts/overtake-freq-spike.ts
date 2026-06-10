// Quantify the current overtaking rate: how many on-track passes happen per race, and how much the
// grid order churns by the finish (high churn => qualifying doesn't matter). Real F1 is roughly tens of
// passes per race and the front order is fairly sticky. Run: tsx scripts/overtake-freq-spike.ts [--races 60]
import type { Driver, Team, Circuit, RaceState } from '@/lib/sim/types'
import { initRaceState, simulateLap } from '@/lib/sim/race'
import { runQualifying } from '@/lib/sim/qualifying'
import { mulberry32 } from '@/lib/news/util'
import { calendarForYear } from '@/data/calendars'

const rng = mulberry32('overtake'); Math.random = () => rng()
const argv = process.argv.slice(2)
const iAt = argv.indexOf('--races'); const RACES = iAt >= 0 ? parseInt(argv[iAt + 1], 10) || 60 : 60
const YEAR = 2026
const circuit: Circuit = calendarForYear(YEAR).find((c) => c.id === 'australia') ?? calendarForYear(YEAR)[0]

// Realistic field: faster teams carry faster drivers (correlated, like real F1), high consistency to keep
// crashes out of the count, so a clear pecking order exists and we can see whether qualifying holds.
const teams: Team[] = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, shortName: `T${i}`, nationality: 'GB', color: '#888', carPace: 75 - i * 5 }))
const drivers: Driver[] = teams.flatMap((t, i) => [0, 1].map((j) => ({
  id: `d${i}_${j}`, name: `D${i}-${j}`, teamId: t.id, nationality: 'GB', gender: 'male' as const,
  pace: Math.max(60, 90 - i * 2 - j * 2), wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 88,
  age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030,
})))
const forms: Record<string, number> = {}; for (const d of drivers) forms[d.id] = 5

const isDry = (s: RaceState) => s.weather.every((p) => p.moisture < 0.02)

// On-track passes between two orderings, EXCLUDING any pair where a car pitted around now (its pit-cycle
// drop isn't an overtake). Retirements drop out via the prev∩curr common filter.
function onTrackPasses(prev: string[], curr: string[], excluded: Set<string>): number {
  const ci = new Map(curr.map((id, i) => [id, i]))
  const common = prev.filter((id) => ci.has(id))
  let n = 0
  for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) {
    if (ci.get(common[i])! > ci.get(common[j])! && !excluded.has(common[i]) && !excluded.has(common[j])) n++
  }
  return n
}

let totalOt = 0, totalChurn = 0, totalFrontChurn = 0, totalLaps = 0
for (let r = 0; r < RACES; r++) {
  const { results: qr, sessions } = runQualifying(drivers, teams, circuit, forms)
  let state = initRaceState(drivers, teams, circuit, qr, sessions, forms, YEAR)
  let g = 0; while (!isDry(state) && g++ < 30) state = initRaceState(drivers, teams, circuit, qr, sessions, forms, YEAR)
  const grid = new Map(qr.map((q) => [q.driverId, q.gridPosition]))
  state = { ...state, phase: 'racing' }
  let prev: string[] | null = null, lap = 0
  while (state.phase === 'racing' && lap++ < circuit.laps + 10) {
    state = simulateLap(state, drivers, teams, circuit, YEAR)
    const active = state.drivers.filter((d) => !d.retired)
    const order = [...active].sort((a, b) => a.position - b.position).map((d) => d.driverId)
    const justPitted = new Set(active.filter((d) => d.lastPitLap > 0 && state.currentLap - d.lastPitLap <= 1).map((d) => d.driverId))
    if (prev) totalOt += onTrackPasses(prev, order, justPitted)
    prev = order
  }
  totalLaps += state.currentLap
  // grid->finish churn: mean |gridPos - finishPos|, all cars and (separately) the front-6 of the grid
  // where qualifying should matter most.
  const finished = [...state.drivers].filter((d) => !d.retired).sort((a, b) => a.position - b.position)
  let churn = 0, frontChurn = 0, frontN = 0
  finished.forEach((d, idx) => {
    const g = grid.get(d.driverId) ?? idx + 1
    churn += Math.abs(g - (idx + 1))
    if (g <= 6) { frontChurn += Math.abs(g - (idx + 1)); frontN++ }
  })
  totalChurn += churn / Math.max(1, finished.length)
  totalFrontChurn += frontChurn / Math.max(1, frontN)
}

console.log(`${RACES} races on ${circuit.name} (${circuit.laps} laps), 20 cars, consistency 88\n`)
console.log(`on-track passes / race:        ${(totalOt / RACES).toFixed(1)}`)
console.log(`passes / car / race:           ${(totalOt / RACES / 20).toFixed(1)}`)
console.log(`mean |grid - finish| (all):    ${(totalChurn / RACES).toFixed(2)} places  (0 = grid holds)`)
console.log(`mean |grid - finish| (front 6):${(totalFrontChurn / RACES).toFixed(2)} places  (qualifying matters most here)`)
console.log(`avg laps completed:            ${(totalLaps / RACES).toFixed(0)}`)
