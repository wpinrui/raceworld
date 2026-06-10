// Verify qualifying sector times sum to their lap time (and 30/40/30 split is roughly held). Run once.
import type { Driver, Team, Circuit } from '@/lib/sim/types'
import { runQualifying } from '@/lib/sim/qualifying'
import { calendarForYear } from '@/data/calendars'
import { mulberry32 } from '@/lib/news/util'

const rng = mulberry32('sectors'); Math.random = () => rng()
const circuit: Circuit = calendarForYear(2026).find((c) => c.id === 'australia')!
const teams: Team[] = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, shortName: `T${i}`, nationality: 'GB', color: '#888', carPace: 75 - i * 5 }))
const drivers: Driver[] = teams.flatMap((t, i) => [0, 1].map((j) => ({
  id: `d${i}_${j}`, name: `D${i}${j}`, teamId: t.id, nationality: 'GB', gender: 'male' as const,
  pace: 78 + j * 2, wetWeatherPace: 75, overtaking: 75, smoothness: 75, consistency: 80,
  age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030,
})))
const forms: Record<string, number> = {}; for (const d of drivers) forms[d.id] = 5

const { sessions } = runQualifying(drivers, teams, circuit, forms)
let maxErr = 0, n = 0, fracSum = [0, 0, 0]
for (const s of sessions) for (const l of s.results) {
  for (const [time, sec] of [[l.lap1, l.lap1Sectors], [l.lap2, l.lap2Sectors]] as Array<[number, [number, number, number]]>) {
    const sum = sec[0] + sec[1] + sec[2]
    maxErr = Math.max(maxErr, Math.abs(sum - time))
    fracSum[0] += sec[0] / time; fracSum[1] += sec[1] / time; fracSum[2] += sec[2] / time
    n++
  }
}
console.log(`laps checked: ${n}`)
console.log(`max |S1+S2+S3 - lap|: ${maxErr.toExponential(2)} s  (should be ~0)`)
console.log(`mean sector fractions: ${fracSum.map((f) => (f / n).toFixed(3)).join(' / ')}  (target 0.30 / 0.40 / 0.30)`)
const ex = sessions[0].results[0]
console.log(`example lap2 ${ex.lap2?.toFixed(3)}s = ${ex.lap2Sectors?.map((x) => x.toFixed(3)).join(' + ')}`)
