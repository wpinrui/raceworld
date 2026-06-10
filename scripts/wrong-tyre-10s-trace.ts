// Car A on intermediates (dry, ~117.5 s/lap) is 10s AHEAD of car B on slicks (~100 s/lap). Trace the gap
// each lap to see how the closing clamp behaves. Run: tsx scripts/wrong-tyre-10s-trace.ts
import type { Driver, Team, TyreState, WeatherPoint } from '@/lib/sim/types'
import { computeLapTime } from '@/lib/sim/engine'
import { DEFAULT_COMPOUND_DELTAS } from '@/lib/sim/tyres'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('wrong-tyre-10s'); Math.random = () => rng()
const team: Team = { id: 't', name: 'T', shortName: 'T', nationality: 'GB', color: '#888', carPace: 75 }
const mk = (id: string): Driver => ({ id, name: id, teamId: 't', nationality: 'GB', gender: 'male', pace: 80, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 90, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030 })
const A = mk('A'), B = mk('B')
const dry: WeatherPoint[] = [{ lap: 1, moisture: 0 }]
const soft: TyreState = { compound: 'soft', condition: 100, maxLifeLaps: 999 }
const inter: TyreState = { compound: 'intermediate', condition: 100, maxLifeLaps: 999 }
const base = { form: 5, fuelLaps: 0, lap: 1, weather: dry, compoundDeltas: DEFAULT_COMPOUND_DELTAS, circuitFlatModifier: 0 }

function trace(label: string) {
  let gap = 10
  console.log(`\n${label}: B starts 10.00s behind`)
  for (let lap = 1; lap <= 8; lap++) {
    const aLap = computeLapTime({ ...base, driver: A, team, tyre: inter, gapToCarAhead: Infinity, carAheadLapTime: null }).lapTime
    const r = computeLapTime({ ...base, driver: B, team, tyre: soft, gapToCarAhead: gap, carAheadLapTime: aLap, carAheadFreeAir: aLap, defenderDriver: A })
    if (r.overtook) { console.log(`  lap ${lap}: gap ${gap.toFixed(2)}s → PASS ✅`); return }
    gap = gap + (r.lapTime - aLap)
    console.log(`  lap ${lap}: gap → ${gap.toFixed(2)}s${gap < 0 ? '  (ahead — would pass)' : ''}`)
    if (gap < 0) return
  }
}
trace('run 1'); trace('run 2'); trace('run 3')
