// Probe the overtake model. Two questions:
//  - per-lap pass CHANCE within range (is a faster car ever walled to zero? is a 2s car a near-certainty?)
//  - lap-by-lap behaviour (does a much-faster car blow by this lap; does a closer car draw in first?)
// Pace gap is driven directly (car ahead's lap time = B's mean + gap). Run: tsx scripts/wrong-tyre-10s-trace.ts
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

const bMean = (() => { let s = 0; for (let i = 0; i < 5000; i++) s += computeLapTime({ ...base, driver: B, team, tyre: soft, gapToCarAhead: Infinity, carAheadLapTime: null }).freeAir; return s / 5000 })()
const lap = (paceGap: number, gap: number) => computeLapTime({ ...base, driver: B, team, tyre: soft, gapToCarAhead: gap, carAheadLapTime: bMean + paceGap, carAheadFreeAir: bMean + paceGap, defenderDriver: A })

// Per-lap pass chance at a fixed (paceGap, gap), and the implied laps to clear.
function chance(label: string, paceGap: number, gap: number, N = 30000) {
  let pass = 0
  for (let i = 0; i < N; i++) if (lap(paceGap, gap).overtook) pass++
  const p = pass / N
  const within = (k: number) => `${((1 - (1 - p) ** k) * 100).toFixed(0)}%`
  console.log(`${label.padEnd(30)} ${(p * 100).toFixed(1).padStart(5)}% / lap   (clears within 5 laps ${within(5)}, 15 laps ${within(15)})`)
}

// Lap-by-lap gap walk (does it pass this lap, or draw in first?).
function walk(label: string, paceGap: number, startGap: number) {
  let gap = startGap
  const parts: string[] = []
  for (let l = 1; l <= 6; l++) {
    const r = lap(paceGap, gap)
    if (r.overtook) { parts.push(`L${l} PASS✅`); break }
    gap = gap + (r.lapTime - (bMean + paceGap))
    parts.push(`L${l}→${gap.toFixed(2)}s`)
  }
  console.log(`${label.padEnd(30)} ${parts.join('  ')}`)
}

console.log('PER-LAP PASS CHANCE within range (faster car, harrying behind):\n')
chance('0.4s faster, harrying', 0.4, 0.3)
chance('1.0s faster, harrying', 1.0, 0.3)
chance('2.0s faster, harrying', 2.0, 0.3)
chance('0.4s faster, sat at 0.5s', 0.4, 0.5)

console.log('\nLAP-BY-LAP (blow-past should be RARE — only the genuinely huge mismatch):\n')
walk('10s faster, 5s behind', 10, 5)        // blow-past -> pass lap 1
walk('5s faster, 5s behind', 5, 5)          // draws in, then through
walk('2s faster, 2s behind', 2, 2)          // draws in, then harries/contests
walk('2s faster, 0.8s behind', 2, 0.8)      // within 1s -> contests (NOT instant)
walk('17.5 faster (wrong tyre), 10s', 17.5, 10) // blow-past -> pass lap 1
