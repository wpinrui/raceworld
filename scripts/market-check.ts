// Sanity check for the two-phase driver market (run: npx tsx scripts/market-check.ts).
import { renewalChance, runDraft, type DraftSeat } from '../src/lib/sim/driver-market'
import type { Driver, Team } from '../src/lib/sim/types'

let fail = 0
const ok = (label: string, cond: boolean, detail = '') => { console.log(`${cond ? 'OK ' : 'XX '}${label}${detail ? `  (${detail})` : ''}`); if (!cond) fail++ }

// 1) Renewal curve: 0.75 to 15, decaying to 0 by 30.
ok('renewal 0pt = 0.75', renewalChance(0) === 0.75)
ok('renewal 15pt = 0.75', renewalChance(15) === 0.75)
ok('renewal 22.5pt ~ 0.375', Math.abs(renewalChance(22.5) - 0.375) < 1e-9, renewalChance(22.5).toFixed(3))
ok('renewal 30pt = 0', renewalChance(30) === 0)
ok('renewal 40pt = 0', renewalChance(40) === 0)

// 2) Geometric normalization: probabilities sum to 1 for a finite pool (checked via a 1-seat draft).
const mkDriver = (i: number, age = 27): Driver => ({
  id: `d${i}`, name: `Driver ${i}`, teamId: '', nationality: 'GB', gender: 'male',
  pace: 90 - i, wetWeatherPace: 80, overtaking: 80, smoothness: 80, age, peakPotential: 90, primeEnd: 32,
  narrativeModifier: 0, contractExpiresAfterSeason: 2025, seasonsSinceF1Seat: 0,
})
const teams: Team[] = []
const seats: DraftSeat[] = Array.from({ length: 7 }, (_, i) => ({ teamId: `s${i}`, teamName: `Seat ${i}`, teamColor: '#888' }))
const pool = Array.from({ length: 10 }, (_, i) => mkDriver(i)) // already best-first

const oneSeat = runDraft({ seats: [seats[0]], pool, teams, currentYear: 2026, rng: Math.random })
const sumPct = oneSeat[0].odds.reduce((s, o) => s + o.pct, 0) // top-10 = whole pool here
ok('geometric odds sum ~100%', Math.abs(sumPct - 100) < 0.2, `${sumPct.toFixed(1)}%`)
ok('favourite odd ~50%', Math.abs(oneSeat[0].odds[0].pct - 50) < 1.5, `${oneSeat[0].odds[0].pct}%`)

// 3) Monte Carlo: P(rank r -> seat r) for the "chalk" outcomes. The favourite takes the top seat ~50%;
// deeper chalk placements sit in a gentle moderate band (the board doesn't always clear in rank order,
// so the true marginal is ~0.24-0.26, not the idealised survival-path figure). Properties, not exact:
const M = 40000
const chalk = new Array(7).fill(0)
const yearsByChalk: number[][] = Array.from({ length: 7 }, () => [])
for (let m = 0; m < M; m++) {
  const picks = runDraft({ seats, pool, teams, currentYear: 2026, rng: Math.random })
  picks.forEach((p, seatRank) => {
    const driverRank = Number(p.driverId.slice(1))
    if (driverRank === seatRank) { chalk[seatRank]++; yearsByChalk[seatRank].push(p.years) }
  })
}
const pct = (n: number) => (n / M)
ok('P(best driver -> best seat) ~0.50', Math.abs(pct(chalk[0]) - 0.50) < 0.03, pct(chalk[0]).toFixed(2))
ok('deeper chalk stays moderate, no collapse', pct(chalk[2]) > 0.18 && pct(chalk[6]) > 0.18, `3rd=${pct(chalk[2]).toFixed(2)} 7th=${pct(chalk[6]).toFixed(2)}`)
ok('favourite-to-top is the most expected outcome', pct(chalk[0]) > pct(chalk[2]) && pct(chalk[0]) > pct(chalk[6]))

// 4) Contract skew: across ALL picks, 1-2yr should dominate, 3-4 rare.
const hist = [0, 0, 0, 0, 0]
let total = 0
for (let m = 0; m < 5000; m++) {
  for (const p of runDraft({ seats, pool, teams, currentYear: 2026, rng: Math.random })) { hist[p.years]++; total++ }
}
const share = (y: number) => ((hist[y] / total) * 100).toFixed(0)
console.log(`contract years: 1=${share(1)}%  2=${share(2)}%  3=${share(3)}%  4=${share(4)}%`)
ok('1-2yr deals dominate (>70%)', (hist[1] + hist[2]) / total > 0.7)
ok('4yr deals rare (<8%)', hist[4] / total < 0.08)

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`)
process.exit(fail === 0 ? 0 : 1)
