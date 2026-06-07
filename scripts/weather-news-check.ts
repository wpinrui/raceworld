// Deterministic checks for the weather race-report summary (summarizeRaceWeather).
//
// Verifies: rained detection, day-shape classification, phantom-rain (forecast threatened, stayed
// dry), the RELATIVE wet-master pick (fastest in the wet vs the field, NOT merely fastest overall),
// and the end-to-end wet fallback. Run: tsx scripts/weather-news-check.ts
//
// This is a unit-style harness, not a Monte-Carlo sim — the cases are hand-built so the expected
// master/shape is known exactly.

import type { RaceState, DriverRaceState, Driver, WeatherPoint } from '@/lib/sim/types'
import { summarizeRaceWeather } from '@/lib/sim/race-weather'

let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; process.stdout.write(`  PASS  ${label}\n`) }
  else { fail++; process.stdout.write(`  FAIL  ${label}${detail ? `  (${detail})` : ''}\n`) }
}

// Build a minimal RaceState. `lapTimesById` maps driverId -> per-lap times (length = totalLaps).
function makeState(opts: {
  laps: number
  weather: WeatherPoint[]
  forecast?: WeatherPoint[]
  lapTimesById: Record<string, number[]>
  retired?: string[]
}): { rs: RaceState; drivers: Driver[] } {
  const ids = Object.keys(opts.lapTimesById)
  const drs: DriverRaceState[] = ids.map((id) => ({
    driverId: id, lapTimes: opts.lapTimesById[id], retired: (opts.retired ?? []).includes(id),
  }) as DriverRaceState)
  const drivers: Driver[] = ids.map((id) => ({ id, name: `Driver ${id}` }) as Driver)
  const rs = {
    totalLaps: opts.laps,
    weather: opts.weather,
    weatherForecast: opts.forecast ?? opts.weather,
    drivers: drs,
  } as RaceState
  return { rs, drivers }
}

const rep = (n: number, v: number) => Array.from({ length: n }, () => v)

// ---- 1. Dry race: no rain, no phantom -----------------------------------------------------------
{
  const { rs, drivers } = makeState({
    laps: 12,
    weather: [{ lap: 1, moisture: 0 }, { lap: 12, moisture: 0 }],
    lapTimesById: { A: rep(12, 100), B: rep(12, 101) },
  })
  const w = summarizeRaceWeather(rs, drivers)
  process.stdout.write('Dry race:\n')
  check('rained = false', w.rained === false)
  check("shape = 'dry'", w.shape === 'dry', w.shape)
  check('no wet master', w.wetMasterId === null)
  check('forecastThreatenedRain = false', w.forecastThreatenedRain === false)
}

// ---- 2. Phantom rain: dry race, forecast cried rain ---------------------------------------------
{
  const { rs, drivers } = makeState({
    laps: 12,
    weather: [{ lap: 1, moisture: 0 }, { lap: 12, moisture: 0 }],
    forecast: [{ lap: 1, moisture: 0 }, { lap: 5, moisture: 0 }, { lap: 7, moisture: 0.4 }, { lap: 9, moisture: 0 }, { lap: 12, moisture: 0 }],
    lapTimesById: { A: rep(12, 100), B: rep(12, 101) },
  })
  const w = summarizeRaceWeather(rs, drivers)
  process.stdout.write('Phantom-rain dry race:\n')
  check('rained = false', w.rained === false)
  check('forecastThreatenedRain = true', w.forecastThreatenedRain === true)
}

// ---- 3. Day shapes -------------------------------------------------------------------------------
{
  // shower: dry, wet middle, dry again
  const shower = makeState({
    laps: 20,
    weather: [{ lap: 1, moisture: 0 }, { lap: 7, moisture: 0 }, { lap: 9, moisture: 0.4 }, { lap: 13, moisture: 0.4 }, { lap: 15, moisture: 0 }, { lap: 20, moisture: 0 }],
    lapTimesById: { A: rep(20, 100), B: rep(20, 101) },
  })
  check("shape = 'shower'", summarizeRaceWeather(shower.rs, shower.drivers).shape === 'shower', summarizeRaceWeather(shower.rs, shower.drivers).shape)

  // building: dry start -> wet finish
  const building = makeState({
    laps: 20,
    weather: [{ lap: 1, moisture: 0 }, { lap: 10, moisture: 0 }, { lap: 20, moisture: 0.5 }],
    lapTimesById: { A: rep(20, 100), B: rep(20, 101) },
  })
  check("shape = 'building'", summarizeRaceWeather(building.rs, building.drivers).shape === 'building', summarizeRaceWeather(building.rs, building.drivers).shape)

  // drying: wet start -> dry finish
  const drying = makeState({
    laps: 20,
    weather: [{ lap: 1, moisture: 0.5 }, { lap: 10, moisture: 0 }, { lap: 20, moisture: 0 }],
    lapTimesById: { A: rep(20, 100), B: rep(20, 101) },
  })
  check("shape = 'drying'", summarizeRaceWeather(drying.rs, drying.drivers).shape === 'drying', summarizeRaceWeather(drying.rs, drying.drivers).shape)

  // sustained: wet throughout
  const sustained = makeState({
    laps: 20,
    weather: [{ lap: 1, moisture: 0.5 }, { lap: 20, moisture: 0.5 }],
    lapTimesById: { A: rep(20, 100), B: rep(20, 101) },
  })
  check("shape = 'sustained'", summarizeRaceWeather(sustained.rs, sustained.drivers).shape === 'sustained', summarizeRaceWeather(sustained.rs, sustained.drivers).shape)
}

// ---- 4. RELATIVE wet master: fastest in the wet, not fastest overall ----------------------------
{
  // 12 laps: 1-6 dry, 7-12 wet. C is fastest in the DRY; A is fastest in the WET. The relative
  // measure must pick A (biggest dry->wet step-up), not C.
  const dry = (v: number) => rep(6, v)
  const wet = (v: number) => rep(6, v)
  const { rs, drivers } = makeState({
    laps: 12,
    weather: [{ lap: 1, moisture: 0 }, { lap: 6, moisture: 0 }, { lap: 7, moisture: 0.4 }, { lap: 12, moisture: 0.4 }],
    lapTimesById: {
      A: [...dry(100), ...wet(110)],
      B: [...dry(100), ...wet(112)],
      C: [...dry(98), ...wet(112)],
    },
  })
  const w = summarizeRaceWeather(rs, drivers)
  process.stdout.write('Relative wet master (A fast in wet, C fast in dry):\n')
  check('peakMoisture ~ 0.4', Math.abs(w.peakMoisture - 0.4) < 1e-6, String(w.peakMoisture))
  check('wetLapCount = 6', w.wetLapCount === 6, String(w.wetLapCount))
  check('master = A (relative)', w.wetMasterId === 'A', `got ${w.wetMasterId}`)
}

// ---- 5. End-to-end wet fallback: no dry laps -> best outright wet pace ---------------------------
{
  const { rs, drivers } = makeState({
    laps: 12,
    weather: [{ lap: 1, moisture: 0.5 }, { lap: 12, moisture: 0.5 }],
    lapTimesById: { A: rep(12, 108), B: rep(12, 110), C: rep(12, 110) },
  })
  const w = summarizeRaceWeather(rs, drivers)
  process.stdout.write('Wet-throughout fallback:\n')
  check('master = A (best wet pace)', w.wetMasterId === 'A', `got ${w.wetMasterId}`)
}

// ---- 6. Retired driver is never the master ------------------------------------------------------
{
  // A would be the relative master but retired; B should be picked instead.
  const dry = (v: number) => rep(6, v)
  const { rs, drivers } = makeState({
    laps: 12,
    weather: [{ lap: 1, moisture: 0 }, { lap: 6, moisture: 0 }, { lap: 7, moisture: 0.4 }, { lap: 12, moisture: 0.4 }],
    lapTimesById: {
      A: [...dry(100), ...rep(6, 105)], // fastest in wet, but DNF
      B: [...dry(100), ...rep(6, 110)],
      C: [...dry(100), ...rep(6, 112)],
    },
    retired: ['A'],
  })
  const w = summarizeRaceWeather(rs, drivers)
  process.stdout.write('Retired driver excluded:\n')
  check('master != A (retired)', w.wetMasterId !== 'A', `got ${w.wetMasterId}`)
  check('master is a finisher', w.wetMasterId === 'B' || w.wetMasterId === 'C', `got ${w.wetMasterId}`)
}

process.stdout.write(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
