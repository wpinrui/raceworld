// Checks for era-dependent pit-lane loss + teammate double-stacking (issue #101).
// 1) curve values/shape for pitLaneLoss + doubleStackPenalty
// 2) a Monte-Carlo that two teammates double-stacking on the same lap costs the TRAILING one ~the
//    era double-stack penalty extra, and that it's era-dependent (bigger in 1996 than 2026).
// Run: tsx scripts/pit-loss-check.ts

import type { Driver, Team, Circuit, QualifyingResult } from '@/lib/sim/types'
import { initRaceState, simulateLap } from '@/lib/sim/race'
import { pitLaneLoss, doubleStackPenalty } from '@/lib/sim/pit-loss'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('pitloss'); Math.random = () => rng()
let pass = 0, fail = 0
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; process.stdout.write(`  PASS  ${label}\n`) }
  else { fail++; process.stdout.write(`  FAIL  ${label}${detail ? `  (${detail})` : ''}\n`) }
}

// ---- 1. curves -----------------------------------------------------------------------------------
process.stdout.write('pitLaneLoss curve:\n')
check('1996 ~30s', close(pitLaneLoss(1996), 30, 0.5), pitLaneLoss(1996).toFixed(1))
check('2009 ~24s', close(pitLaneLoss(2009), 24.2, 0.5), pitLaneLoss(2009).toFixed(1))
check('2026 ~22s', close(pitLaneLoss(2026), 22.4, 0.5), pitLaneLoss(2026).toFixed(1))
check('monotonic decreasing 1996>2009>2026', pitLaneLoss(1996) > pitLaneLoss(2009) && pitLaneLoss(2009) > pitLaneLoss(2026))
check('NaN year defends to modern', close(pitLaneLoss(NaN), pitLaneLoss(2026), 0.01))
process.stdout.write('doubleStackPenalty curve:\n')
check('1996 ~11s', close(doubleStackPenalty(1996), 11, 0.5), doubleStackPenalty(1996).toFixed(1))
check('2026 ~3s', close(doubleStackPenalty(2026), 3.4, 0.5), doubleStackPenalty(2026).toFixed(1))
check('monotonic decreasing', doubleStackPenalty(1996) > doubleStackPenalty(2026))

// ---- 2. double-stack Monte-Carlo -----------------------------------------------------------------
function driver(id: string): Driver {
  return {
    id, name: `Driver ${id}`, teamId: 'T', nationality: 'GB', gender: 'male',
    pace: 80, wetWeatherPace: 80, overtaking: 80, smoothness: 80, consistency: 100, // consistency 100 ~ no mistakes
    age: 27, peakPotential: 85, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}
const drivers = [driver('A'), driver('B')]
const teams: Team[] = [{ id: 'T', name: 'Team', shortName: 'TEA', nationality: 'GB', color: '#888', carPace: 60 }]
const circuit: Circuit = { id: 'c', name: 'Test GP', code: 'TST', location: '', country: 'GB', laps: 50, flatModifier: 0, sundayOfYear: 10 }
const qr: QualifyingResult[] = [
  { driverId: 'A', gridPosition: 1, bestTime: 80, q1Time: 80, q2Time: 80, q3Time: 80 },
  { driverId: 'B', gridPosition: 2, bestTime: 80, q1Time: 80, q2Time: 80, q3Time: 80 },
]

// Mean extra time the trailing teammate (B, started P2 -> processed second) loses when BOTH pit lap 1,
// vs the leader (A). Big track gap removes the car-ahead clamp so we isolate the pit penalty; both pit,
// so the base pit loss cancels and the remaining difference is the double-stack wait. `gap` is the
// on-track time gap (B set that far behind A) — the wait should be max(0, crewBusy - gap).
function measureStackExtra(year: number, gap = 0, runs = 500): number {
  const base = initRaceState(drivers, teams, circuit, qr, [], { A: 5, B: 5 }, year)
  // Large track gap -> no contested-overtake clamp. B sits `gap` seconds behind A in race time, so they
  // count as double-stacking with that gap between them.
  const state = { ...base, drivers: base.drivers.map((d) => ({ ...d, gap: 100, totalTime: d.driverId === 'B' ? gap : 0 })) }
  const force = [
    { type: 'force-pit' as const, driverId: 'A' },
    { type: 'force-pit' as const, driverId: 'B' },
  ]
  let sum = 0, n = 0
  for (let i = 0; i < runs; i++) {
    const next = simulateLap(state, drivers, teams, circuit, year, force)
    const a = next.drivers.find((d) => d.driverId === 'A')!
    const b = next.drivers.find((d) => d.driverId === 'B')!
    if (a.retired || b.retired || a.lapTimes.length === 0 || b.lapTimes.length === 0) continue
    sum += b.lapTimes[0] - a.lapTimes[0]; n++
  }
  return sum / n
}

process.stdout.write('double-stack Monte-Carlo (trailing teammate extra loss):\n')
const extra1996 = measureStackExtra(1996, 0)
const extra2026 = measureStackExtra(2026, 0)
const gap5 = measureStackExtra(1996, 5)   // expect ~11-5 = 6
const gap15 = measureStackExtra(1996, 15) // expect ~max(0, 11-15) = 0
check(`1996 nose-to-tail ~${doubleStackPenalty(1996).toFixed(1)}s`, close(extra1996, doubleStackPenalty(1996), 1.5), `measured ${extra1996.toFixed(2)}`)
check(`2026 nose-to-tail ~${doubleStackPenalty(2026).toFixed(1)}s`, close(extra2026, doubleStackPenalty(2026), 1.5), `measured ${extra2026.toFixed(2)}`)
check('5s gap eats into the wait (~6s)', close(gap5, 6, 1.5), `measured ${gap5.toFixed(2)}`)
check('15s gap clears the crew (~0s)', close(gap15, 0, 1.0), `measured ${gap15.toFixed(2)}`)
check('stacking hurts more in 1996 than 2026', extra1996 > extra2026 + 3, `${extra1996.toFixed(2)} vs ${extra2026.toFixed(2)}`)

process.stdout.write(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
