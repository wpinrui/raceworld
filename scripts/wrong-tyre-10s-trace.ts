// Trace the overtake model lap-by-lap across pace/gap scenarios. Rule under test: a pass only COMPLETES
// from within ~1s at the start of the lap; a faster car drawing in from further back arrives behind first,
// then passes the next lap. Run: tsx scripts/wrong-tyre-10s-trace.ts
import type { Driver, Team, TyreState, WeatherPoint } from '@/lib/sim/types'
import { computeLapTime } from '@/lib/sim/engine'
import { DEFAULT_COMPOUND_DELTAS } from '@/lib/sim/tyres'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('ot-scenarios'); Math.random = () => rng()
const mk = (id: string): Driver => ({ id, name: id, teamId: 't', nationality: 'GB', gender: 'male', pace: 80, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 90, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030 })
const A = mk('A'), B = mk('B')
const dry: WeatherPoint[] = [{ lap: 1, moisture: 0 }]
const soft: TyreState = { compound: 'soft', condition: 100, maxLifeLaps: 999 }
const inter: TyreState = { compound: 'intermediate', condition: 100, maxLifeLaps: 999 }
const bTeam: Team = { id: 't', name: 'T', shortName: 'T', nationality: 'GB', color: '#888', carPace: 75 }
const base = { form: 5, fuelLaps: 0, lap: 1, weather: dry, compoundDeltas: DEFAULT_COMPOUND_DELTAS, circuitFlatModifier: 0 }

// A's setup controls the pace gap: an inter tyre on dry (~17.5s slower) or a slow car (carPace lower).
function trace(label: string, aTyre: TyreState, aCarPace: number, startGap: number) {
  const aTeam: Team = { ...bTeam, carPace: aCarPace }
  let gap = startGap
  const parts: string[] = []
  for (let lap = 1; lap <= 6; lap++) {
    const aLap = computeLapTime({ ...base, driver: A, team: aTeam, tyre: aTyre, gapToCarAhead: Infinity, carAheadLapTime: null }).lapTime
    const r = computeLapTime({ ...base, driver: B, team: bTeam, tyre: soft, gapToCarAhead: gap, carAheadLapTime: aLap, carAheadFreeAir: aLap, defenderDriver: A })
    if (r.overtook) { parts.push(`L${lap} PASS✅`); break }
    gap = gap + (r.lapTime - aLap)
    parts.push(`L${lap}→${gap.toFixed(2)}s`)
    if (gap < 0) { parts.push('(passed)'); break }
  }
  console.log(`${label.padEnd(34)} ${parts.join('  ')}`)
}

console.log('Expect: not within 1s at the start => no pass that lap (arrive ~0.3s first, pass next lap)\n')
trace('sitting duck (inters), 10s behind', inter, 75, 10)
trace('sitting duck (inters), 0.8s behind', inter, 75, 0.8)
trace('2s/lap faster, 2.0s behind', soft, 25, 2.0)
trace('2s/lap faster, 0.9s behind', soft, 25, 0.9)
trace('0.4s/lap faster, 0.5s behind', soft, 65, 0.5)
