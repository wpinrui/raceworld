// Measure the EFFECTIVE WET FRACTION of the live weather model, to re-derive the pace vs
// wetWeatherPace split in overall() (OVERALL_WEIGHTS). The lap-time blend is
// effectiveStat = (1 - moisture)*pace + moisture*wetWeatherPace, so the weight that lands on
// wetWeatherPace on any lap is exactly that lap's moisture. Integrated over a season, the share of
// the driver-skill speed impact carried by wetWeatherPace is the LAP-WEIGHTED MEAN MOISTURE.
//
// That fraction depends only on the weather model (generateWeatherCurve) + the calendar lap counts,
// not on race outcomes, so we Monte-Carlo the curves directly at real lap counts. Run:
//   tsx scripts/wet-fraction-measure.ts [--iter N]

import { generateWeatherCurve, getMoistureAtLap } from '@/lib/sim/weather'
import { calendarForYear } from '@/data/calendars'
import { mulberry32 } from '@/lib/news/util'

const argv = process.argv.slice(2)
const iterArg = argv.indexOf('--iter')
const ITER = iterArg >= 0 ? parseInt(argv[iterArg + 1], 10) || 5000 : 5000

const rng = mulberry32('wetfrac'); Math.random = () => rng()
const cal = calendarForYear(2026)

let sumMoist = 0, sumLaps = 0
let totalRaces = 0, rainedAny = 0, wetRaces = 0
let wetSumMoist = 0, wetSumLaps = 0

for (const c of cal) {
  const L = c.laps
  for (let k = 0; k < ITER; k++) {
    const curve = generateWeatherCurve(L)
    let raceMoist = 0, wetLaps = 0, peak = 0
    for (let lap = 1; lap <= L; lap++) {
      const m = getMoistureAtLap(curve, lap)
      raceMoist += m
      if (m >= 0.10) wetLaps++
      if (m > peak) peak = m
    }
    sumMoist += raceMoist
    sumLaps += L
    totalRaces++
    if (peak > 0.02) rainedAny++
    if (wetLaps >= 4) { wetRaces++; wetSumMoist += raceMoist; wetSumLaps += L }
  }
}

const f = sumMoist / sumLaps                       // effective wet fraction (lap-weighted mean moisture)
const rawRainRate = rainedAny / totalRaces         // any moisture at all (should track the 17.5% knob)
const wetRaceRate = wetRaces / totalRaces          // races with >= 4 wet laps (the "rained" threshold)
const meanMoistInWet = wetSumLaps ? wetSumMoist / wetSumLaps : 0

// Re-split the empirically-calibrated speed impact (pace + wet = 0.43) by the measured fraction,
// keeping consistency/overtaking/smoothness unchanged so the overall still sums to 1.
const S = 0.4 + 0.03
const newWetExact = S * f
const newPaceExact = S * (1 - f)
const r3 = (x: number) => Math.round(x * 1000) / 1000
const r2 = (x: number) => Math.round(x * 100) / 100

console.log(`races sampled:            ${totalRaces.toLocaleString()} (${ITER}/circuit x ${cal.length} circuits)`)
console.log(`raw rain rate (any wet):  ${(rawRainRate * 100).toFixed(1)}%   (model knob = 17.5%)`)
console.log(`wet-race rate (>=4 laps): ${(wetRaceRate * 100).toFixed(1)}%`)
console.log(`mean moisture | wet race: ${meanMoistInWet.toFixed(3)}`)
console.log('')
console.log(`EFFECTIVE WET FRACTION f = ${f.toFixed(4)}   (vs current assumption 0.075)`)
console.log('')
console.log(`speed impact S = pace+wet = ${S}`)
console.log(`  wetWeatherPace = S*f       = ${newWetExact.toFixed(4)}  -> ~${r3(newWetExact)} (2dp ${r2(newWetExact)})`)
console.log(`  pace           = S*(1-f)   = ${newPaceExact.toFixed(4)}  -> ~${r3(newPaceExact)} (2dp ${r2(newPaceExact)})`)
console.log('')
console.log('proposed OVERALL_WEIGHTS (sum must = 1):')
const pace3 = r3(newPaceExact), wet3 = r3(newWetExact)
console.log(`  pace ${pace3}, consistency 0.26, overtaking 0.1, wetWeatherPace ${wet3}, smoothness 0.21  (sum ${(pace3 + 0.26 + 0.1 + wet3 + 0.21).toFixed(3)})`)
