// Calibrate the PROPORTIONAL catch-up rate. Catch-up now accrues per race of development:
// gain += deficit * RATE * cycleLength, so total season catch-up is cycle-NEUTRAL (a 3-race cycle
// delivers twice as often at half the per-upgrade catch-up). This removes the old flat-catch-up flaw where
// short cycles banked strictly more catch-up and were always better for a slow car.
// Faithful to rollUpgrade otherwise (5% fail, max(0,Normal(3,2.224))*1.05^(cyc-3) base, cadence 3-6).
// Exp 1: sweep RATE, report the end-of-season fastest↔slowest gap (target ~1.15s, matching the old 0.125).
// Exp 2: at the chosen RATE, force the slowest team to a FIXED cycle and report its end pace — flat/rising
//        across 3→6 means short is no longer dominant.
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

// the existing roll, tier penalty stripped. `prop` toggles PROPORTIONAL catch-up (deficit*K*cycle) vs the
// old FLAT catch-up (deficit*K). returns the pace gain.
function rollGain(cycleLength: number, deficit: number, K: number, prop: boolean): number {
  if (rng() < 0.05) return 0 // 5% total failure (unchanged)
  const scale = Math.pow(1.05, cycleLength - 3)
  const raw = Math.max(0, sampleNormal(BASE_MEDIAN, BASE_SIGMA, rng)) * scale
  const catchUp = prop ? deficit * K * cycleLength : deficit * K
  return round1(raw + catchUp)
}

// Run one season. fixedCycle (optional) pins the slowest team (index N-1) to one cadence for Exp 2.
function simSeason(K: number, prop: boolean, fixedCycle?: number): { gap: number; slowPace: number } {
  const pace = [...startLadder]
  const cyc = Array.from({ length: N }, () => randomCycle())
  if (fixedCycle) cyc[N - 1] = fixedCycle
  const next = [...cyc] // first upgrade lands cycleLength races in
  for (let round = 1; round <= ROUNDS; round++) {
    for (let t = 0; t < N; t++) {
      if (round !== next[t]) continue
      const deficit = Math.max(...pace) - pace[t] // points behind the current leader
      const gain = rollGain(cyc[t], deficit, K, prop)
      if (gain > 0) pace[t] = round1(pace[t] + gain)
      const nc = fixedCycle && t === N - 1 ? fixedCycle : randomCycle()
      cyc[t] = nc
      next[t] += nc
    }
  }
  return { gap: Math.max(...pace) - Math.min(...pace), slowPace: pace[N - 1] }
}

const avg = (f: () => number, runs = 200) => {
  let s = 0
  for (let i = 0; i < runs; i++) s += f()
  return s / runs
}

console.log(`season ${ROUNDS} rounds, ${N} teams, start gap 45 pts = 1.80s; avg of 400 seasons\n`)
console.log('Exp 1 — proportional RATE sweep (random cycles): end-of-season fastest↔slowest gap')
console.log('RATE    | =per-upg @cyc4.5 | end gap (pts) | end gap (s) | vs start 1.80s')
let best = { RATE: 0.03, diff: Infinity }
for (const RATE of [0.024, 0.027, 0.03, 0.033, 0.036]) {
  const pts = avg(() => simSeason(RATE, true).gap, 400)
  const secs = pts / 25
  if (Math.abs(secs - 1.15) < best.diff) best = { RATE, diff: Math.abs(secs - 1.15) }
  console.log(`  ${RATE.toFixed(3)} |      ${(RATE * 4.5).toFixed(3)}      |     ${pts.toFixed(1).padStart(5)}     |    ${secs.toFixed(2)}s    | ${secs <= 1.8 ? '−' : '+'}${Math.abs(1.8 - secs).toFixed(2)}s`)
}

const RATE = best.RATE
console.log(`\nExp 2 — dominance check: slowest team's end pace by FIXED cadence (avg 400)`)
console.log('Lower spread across 3→6 = cadence matters less. Compare OLD flat (0.125) vs NEW proportional.')
console.log('cycle | flat 0.125 | proportional ' + RATE.toFixed(3))
for (const c of [3, 4, 5, 6]) {
  const flat = avg(() => simSeason(0.125, false, c).slowPace, 400)
  const prop = avg(() => simSeason(RATE, true, c).slowPace, 400)
  console.log(`  ${c}   |    ${flat.toFixed(1).padStart(4)}    |     ${prop.toFixed(1).padStart(4)}`)
}
