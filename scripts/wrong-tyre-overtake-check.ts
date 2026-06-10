// Extreme case: car AHEAD on intermediates on a DRY track (wrong tyres), car BEHIND on slicks, equal in
// every other way. How big is the pace gap, and what's the per-lap chance the slick car gets by? Runs the
// real computeLapTime contest many times. Run: tsx scripts/wrong-tyre-overtake-check.ts
import type { Driver, Team, TyreState, WeatherPoint } from '@/lib/sim/types'
import { computeLapTime } from '@/lib/sim/engine'
import { DEFAULT_COMPOUND_DELTAS } from '@/lib/sim/tyres'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('wrong-tyre'); Math.random = () => rng()
const team: Team = { id: 't', name: 'T', shortName: 'T', nationality: 'GB', color: '#888', carPace: 75 }
const mk = (id: string): Driver => ({ id, name: id, teamId: 't', nationality: 'GB', gender: 'male', pace: 80, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 90, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030 })
const A = mk('AHEAD'), B = mk('BEHIND')
const dry: WeatherPoint[] = [{ lap: 1, moisture: 0 }]
const soft: TyreState = { compound: 'soft', condition: 100, maxLifeLaps: 999 }
const inter: TyreState = { compound: 'intermediate', condition: 100, maxLifeLaps: 999 }
const base = { form: 5, fuelLaps: 0, lap: 1, weather: dry, compoundDeltas: DEFAULT_COMPOUND_DELTAS, circuitFlatModifier: 0 }

// free-air pace of each (no traffic)
const freeAir = (driver: Driver, tyre: TyreState) =>
  computeLapTime({ ...base, driver, team, tyre, gapToCarAhead: Infinity, carAheadLapTime: null }).freeAir
const meanFree = (driver: Driver, tyre: TyreState) => { let s = 0; for (let i = 0; i < 5000; i++) s += freeAir(driver, tyre); return s / 5000 }
const aFree = meanFree(A, inter)   // car ahead on inters in the dry
const bFree = meanFree(B, soft)    // car behind on slicks

console.log(`car AHEAD  (intermediates, dry): ${aFree.toFixed(2)} s/lap`)
console.log(`car BEHIND (slicks):             ${bFree.toFixed(2)} s/lap`)
console.log(`pace edge to the slick car:      ${(aFree - bFree).toFixed(2)} s/lap\n`)

// B contesting A on the gearbox (gap 0.4s). carAheadLapTime/FreeAir = A's (slow) clean-air pace.
let pass = 0, crash = 0
const N = 20000
for (let i = 0; i < N; i++) {
  const r = computeLapTime({ ...base, driver: B, team, tyre: soft, gapToCarAhead: 0.4, carAheadLapTime: aFree, carAheadFreeAir: aFree, defenderDriver: A })
  if (r.overtook) pass++
  if (r.crash?.happened) crash++
}
const p = pass / N
console.log(`per-lap pass chance (on the gearbox): ${(p * 100).toFixed(1)}%`)
console.log(`per-lap crash chance:                 ${(crash / N * 100).toFixed(2)}%`)
console.log(`expected laps stuck once alongside:   ${(1 / p).toFixed(2)}`)
console.log(`through within 3 laps:                ${((1 - (1 - p) ** 3) * 100).toFixed(1)}%`)
