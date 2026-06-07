// Monte-Carlo sanity check for the weather model (run: npx tsx scripts/weather-check.ts).
// Verifies rain frequency, phantom/unforeseen forecast misses, and the forecast error-vs-lead curve.
import { generateWeatherCurve, generateForecastCurve, getMoistureAtLap, forecastMoistureAtLap } from '../src/lib/sim/weather'

const N = 40000
const LAPS = 57
const WET = 0.05

let rainy = 0
let phantom = 0 // dry race, forecast shows rain
let unforeseen = 0 // wet race, forecast shows no rain
let dryRaces = 0

// Forecast error bucketed by lead time (laps ahead), measured only on rainy races (the interesting case).
const buckets: Record<string, { sum: number; n: number }> = {
  '1-2': { sum: 0, n: 0 }, '3-5': { sum: 0, n: 0 }, '6-10': { sum: 0, n: 0 }, '11-20': { sum: 0, n: 0 }, '21+': { sum: 0, n: 0 },
}
const bucketOf = (lead: number) => (lead <= 2 ? '1-2' : lead <= 5 ? '3-5' : lead <= 10 ? '6-10' : lead <= 20 ? '11-20' : '21+')

let peakSum = 0 // mean peak moisture on rainy races

for (let i = 0; i < N; i++) {
  const reality = generateWeatherCurve(LAPS)
  const forecast = generateForecastCurve(reality, LAPS)
  const realWet = reality.some((p) => p.moisture >= WET)
  const fcWet = forecast.some((p) => p.moisture >= WET)

  if (realWet) {
    rainy++
    if (!fcWet) unforeseen++
    let peak = 0
    for (let lap = 1; lap <= LAPS; lap++) peak = Math.max(peak, getMoistureAtLap(reality, lap))
    peakSum += peak
    // error vs lead, restricted to laps where the weather matters (reality or forecast is wet there) —
    // dry-on-dry laps have ~0 error and would just dilute the average.
    for (let now = 1; now <= LAPS; now += 2) {
      for (let t = now + 1; t <= LAPS; t += 2) {
        const real = getMoistureAtLap(reality, t)
        const fc = forecastMoistureAtLap(reality, forecast, t, now)
        if (Math.max(real, fc) < WET && getMoistureAtLap(forecast, t) < WET) continue
        const b = buckets[bucketOf(t - now)]
        b.sum += Math.abs(fc - real) * 100; b.n++
      }
    }
  } else {
    dryRaces++
    if (fcWet) phantom++
  }
}

console.log(`races: ${N}, laps/race: ${LAPS}`)
console.log(`rain frequency: ${(100 * rainy / N).toFixed(1)}%   (target ~17.5%)`)
console.log(`mean peak moisture on rainy races: ${(100 * peakSum / rainy).toFixed(0)}/100`)
console.log(`phantom rain: ${(100 * phantom / dryRaces).toFixed(1)}% of dry races   (target ~10%)`)
console.log(`unforeseen rain: ${(100 * unforeseen / rainy).toFixed(1)}% of wet races   (target ~4%)`)
console.log('forecast |error| by lead time (out of 100):')
for (const k of ['1-2', '3-5', '6-10', '11-20', '21+']) {
  const b = buckets[k]
  console.log(`  lead ${k.padEnd(6)} ${b.n ? (b.sum / b.n).toFixed(1) : '-'}`)
}
