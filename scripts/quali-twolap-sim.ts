// Validates the SHIPPED qualifying model: 2 laps, lap 1 = lap 2's generation + 0.3 (track rubbers in),
// best-of-2, each lap using the new combo noise (symmetric baseline + occasional compromised lap).
// Reports teammate H2H (favourite wins / season) by pace gap. Run: tsx scripts/quali-twolap-sim.ts
import { mulberry32 } from '@/lib/news/util'
const rng = mulberry32('quali-twolap')
const RACES = 24, SEASONS = 4000, CONS = 80, LAP1 = 0.35
const PACE_W = 0.03, FORM_W = 0.02
function bm() { const u1 = Math.max(1e-10, rng()); const u2 = rng(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) }
const rollForm = () => Math.min(10, Math.max(0, 5 + 1.8 * bm()))
// mirrors qualifyingNoise() in qualifying.ts; `baseFactor` is the tunable baseline-width knob (shipped 0.75)
function qNoise(con: number, baseFactor: number): number {
  const r = 1.2 - 0.01 * con
  return (rng() * 2 - 1) * baseFactor * r + (rng() < 0.25 * r ? 0.5 + rng() * 0.5 : 0)
}
function sessionBest(pace: number, baseFactor: number): number {
  const driverMod = -((pace - 75) * PACE_W + (rollForm() - 5) * FORM_W)
  const lap1 = driverMod + qNoise(CONS, baseFactor) + LAP1
  const lap2 = driverMod + qNoise(CONS, baseFactor)
  return Math.min(lap1, lap2)
}
function fav(gap: number, baseFactor: number): number {
  let wins = 0
  for (let s = 0; s < SEASONS; s++) for (let r = 0; r < RACES; r++) if (sessionBest(80 + gap / 2, baseFactor) <= sessionBest(80 - gap / 2, baseFactor)) wins++
  return wins / SEASONS
}
const FACTORS = [0.6, 0.75, 0.9, 1.05]
console.log(`2 laps, lap1=+${LAP1}, best-of-2. Sweeping baseline-width knob (shipped 0.75). consistency ${CONS}, ${SEASONS} seasons\n`)
console.log('pace gap |' + FACTORS.map((b) => `  ${b}${b === 0.6 ? '(now)' : '     '}`.padStart(12)).join(''))
for (const gap of [2, 4, 6, 8, 10, 20]) {
  let line = `  ${String(gap).padStart(2)} pts |`
  for (const b of FACTORS) { const f = Math.round(fav(gap, b)); line += `${f}-${RACES - f}`.padStart(12) }
  console.log(line)
}
console.log('\ngap 2 ~ Norris/Piastri, gap 10-11 ~ Russell/Antonelli, gap 20 ~ Verstappen/Hadjar')
