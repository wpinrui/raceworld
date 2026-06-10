// Integration check: run the REAL runQualifying() (not a local model) and measure teammate H2H, to
// prove the noiseOverride wiring fires end-to-end. Probe team has the fastest car so both its drivers
// reach Q3 and their grid order is their Q3 best-of-2. Expect ~14-10 (gap2), ~20-4 (gap10), 24-0 (gap20).
// Run: tsx scripts/quali-engine-check.ts
import type { Driver, Team, Circuit } from '@/lib/sim/types'
import { runQualifying } from '@/lib/sim/qualifying'
import { calendarForYear } from '@/data/calendars'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('quali-engine'); Math.random = () => rng()
const RACES = 24, SEASONS = 1500, CONS = 80
const cal = calendarForYear(2026)
const circuit: Circuit = cal.find((c) => c.id === 'australia') ?? cal[0]
function bm() { const u1 = Math.max(1e-10, rng()); const u2 = rng(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) }
const rollForm = () => Math.min(10, Math.max(0, 5 + 1.8 * bm()))
function mk(id: string, teamId: string, pace: number, consistency: number): Driver {
  return { id, name: id, teamId, nationality: 'GB', gender: 'male', pace, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030, confidence: 5 }
}
function favWins(gap: number): number {
  const teams: Team[] = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, shortName: `T${i}`, nationality: 'GB', color: '#888', carPace: 75 - i * 5 }))
  const drivers: Driver[] = [mk('FAV', 't0', 80 + gap / 2, CONS), mk('UND', 't0', 80 - gap / 2, CONS)]
  for (let i = 1; i < 10; i++) { drivers.push(mk(`a${i}`, `t${i}`, 72, 75), mk(`b${i}`, `t${i}`, 70, 75)) }
  let ahead = 0
  for (let s = 0; s < SEASONS; s++) {
    const forms: Record<string, number> = {}
    for (const d of drivers) forms[d.id] = rollForm()
    const { results } = runQualifying(drivers, teams, circuit, forms)
    const fav = results.find((r) => r.driverId === 'FAV')!.gridPosition
    const und = results.find((r) => r.driverId === 'UND')!.gridPosition
    if (fav < und) ahead++
  }
  return (ahead / SEASONS) * RACES
}
console.log(`REAL runQualifying() teammate H2H (fav-of-${RACES}), consistency ${CONS}, ${SEASONS} qualis/gap\n`)
for (const gap of [2, 4, 6, 8, 10, 20]) {
  const f = Math.round(favWins(gap))
  console.log(`  gap ${String(gap).padStart(2)} -> ${f}-${RACES - f}`)
}
console.log('\nexpect ~14-10 / 16-8 / 18-6 / 19-5 / 20-4 / 24-0 if noiseOverride fires end-to-end.')
