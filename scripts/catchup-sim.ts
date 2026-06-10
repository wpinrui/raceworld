// Measure: end-of-season gap between fastest and slowest car (avg of 10 seasons), as a function of the
// catch-up constant. Faithful to the EXISTING rollUpgrade (5% fail, max(0,Normal(3,2.224))*scale,
// cadence 3-6 races) with the tier penalty REMOVED and a single `+ deficit*CATCHUP` term added.
// deficit = pace points behind the current fastest car. Start grid = the 1.8s ladder (75..30).
// Run: tsx scripts/catchup-sim.ts
import { sampleNormal } from '@/lib/sim/rng-utils'
import { calendarForYear } from '@/data/calendars'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('catchup-sim')
const ROUNDS = calendarForYear(2026).length
const N = 10
const startLadder = Array.from({ length: N }, (_, i) => 75 - i * 5) // fastest 75, slowest 30 => 45 pts = 1.8s

const BASE_MEDIAN = 3, BASE_SIGMA = 1.5 / 0.6745
const round1 = (n: number) => Math.round(n * 10) / 10
const randomCycle = () => Math.floor(rng() * 4) + 3 // 3-6

// the existing roll, tier penalty stripped, catch-up added. returns the pace gain.
function rollGain(cycleLength: number, deficit: number, CATCHUP: number): number {
  if (rng() < 0.05) return 0 // 5% total failure (unchanged)
  const scale = Math.pow(1.05, cycleLength - 3)
  const raw = Math.max(0, sampleNormal(BASE_MEDIAN, BASE_SIGMA, rng)) * scale
  return round1(raw + deficit * CATCHUP)
}

function simSeason(CATCHUP: number): number {
  const pace = [...startLadder]
  const cyc = Array.from({ length: N }, () => randomCycle())
  const next = [...cyc] // first upgrade lands cycleLength races in
  for (let round = 1; round <= ROUNDS; round++) {
    for (let t = 0; t < N; t++) {
      if (round !== next[t]) continue
      const deficit = Math.max(...pace) - pace[t] // points behind the current leader
      const gain = rollGain(cyc[t], deficit, CATCHUP)
      if (gain > 0) pace[t] = round1(pace[t] + gain)
      const nc = randomCycle()
      cyc[t] = nc
      next[t] += nc
    }
  }
  return Math.max(...pace) - Math.min(...pace)
}

console.log(`season length ${ROUNDS} rounds, ${N} teams, start gap 45 pts = 1.80s; avg of 10 seasons\n`)
console.log('CATCHUP | end gap (pts) | end gap (s) | vs start 1.80s')
for (const CATCHUP of [0.1, 0.125, 0.15]) {
  let sum = 0
  for (let s = 0; s < 10; s++) sum += simSeason(CATCHUP)
  const pts = sum / 10
  const secs = pts / 25
  const tag = CATCHUP === 0 ? 'no catch-up (random walk)' : `${(1.8 - secs >= 0 ? '−' : '+')}${Math.abs(1.8 - secs).toFixed(2)}s`
  console.log(`  ${CATCHUP.toFixed(2)}  |     ${pts.toFixed(1).padStart(5)}     |    ${secs.toFixed(2)}s    | ${tag}`)
}
