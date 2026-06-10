// Trace the overtake model lap-by-lap. Rule under test:
//  - BLOW-PAST: so much faster than the gap you'd end up clearly ahead -> pass THIS lap, from any distance.
//  - DRAW-IN:  only fast enough to close to the car (not end up ahead) -> arrive behind, pass NEXT lap.
//  - CONTEST:  already within ~1s -> contested move (roll).
// Pace gap is driven directly (the car ahead's lap time = B's mean + gap), so we can test 10s, 5s, 2s.
// Run: tsx scripts/wrong-tyre-10s-trace.ts
import type { Driver, Team, TyreState, WeatherPoint } from '@/lib/sim/types'
import { computeLapTime } from '@/lib/sim/engine'
import { DEFAULT_COMPOUND_DELTAS } from '@/lib/sim/tyres'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('ot-scenarios'); Math.random = () => rng()
const mk = (id: string): Driver => ({ id, name: id, teamId: 't', nationality: 'GB', gender: 'male', pace: 80, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 90, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030 })
const A = mk('A'), B = mk('B')
const dry: WeatherPoint[] = [{ lap: 1, moisture: 0 }]
const soft: TyreState = { compound: 'soft', condition: 100, maxLifeLaps: 999 }
const team: Team = { id: 't', name: 'T', shortName: 'T', nationality: 'GB', color: '#888', carPace: 75 }
const base = { form: 5, fuelLaps: 0, lap: 1, weather: dry, compoundDeltas: DEFAULT_COMPOUND_DELTAS, circuitFlatModifier: 0 }

// B's mean clean-air lap, so we can place a car ahead exactly `paceGap` slower.
const bMean = (() => { let s = 0; for (let i = 0; i < 5000; i++) s += computeLapTime({ ...base, driver: B, team, tyre: soft, gapToCarAhead: Infinity, carAheadLapTime: null }).freeAir; return s / 5000 })()

// Car ahead is `paceGap` s/lap slower than B; B starts `startGap` behind. Walk the gap lap by lap.
function trace(label: string, paceGap: number, startGap: number) {
  const aheadTime = bMean + paceGap
  let gap = startGap
  const parts: string[] = []
  for (let lap = 1; lap <= 6; lap++) {
    const r = computeLapTime({ ...base, driver: B, team, tyre: soft, gapToCarAhead: gap, carAheadLapTime: aheadTime, carAheadFreeAir: aheadTime, defenderDriver: A })
    if (r.overtook) { parts.push(`L${lap} PASS✅`); break }
    gap = gap + (r.lapTime - aheadTime)
    parts.push(`L${lap}→${gap.toFixed(2)}s`)
    if (gap < 0) { parts.push('(passed)'); break }
  }
  console.log(`${label.padEnd(34)} ${parts.join('  ')}`)
}

console.log('Blow-past (end up clearly ahead) = pass THIS lap; only-closing = draw in, pass NEXT lap\n')
trace('10s/lap faster, 5s behind', 10, 5)    // blow-past -> PASS lap 1
trace('5s/lap faster, 5s behind', 5, 5)      // only closes -> draw in, pass lap 2
trace('2s/lap faster, 2s behind', 2, 2)      // only closes -> draw in, pass lap 2
trace('2s/lap faster, 0.8s behind', 2, 0.8)  // within 1s -> contest lap 1
trace('17.5/lap faster (wrong tyre), 10s', 17.5, 10) // blow-past -> PASS lap 1
trace('0.4s/lap faster, 0.5s behind', 0.4, 0.5)      // not enough -> train, no pass
