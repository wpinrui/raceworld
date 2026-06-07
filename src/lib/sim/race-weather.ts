import type { RaceState, Driver, RaceWeather } from './types'
import { getMoistureAtLap } from './weather'

// Moisture at/above this counts as a wet track: the intermediate crossover, matching the dry-tyre
// out-of-window step in tyres.ts. Below it the track races effectively dry.
const WET_MOISTURE = 0.10
// A race counts as "wet" only once a handful of laps run above the wet threshold; a one or two lap
// damp patch is not a wet race.
const RAINED_MIN_LAPS = 4
// Minimum laps a driver must run in a condition before their pace there is meaningful, filtering out
// in/out laps and tiny samples from the relative wet-master measure.
const MIN_PACE_LAPS = 3

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Summarise a finished race's weather for the newsroom: did it rain, how hard, what shape the day
// took, whether a dry day had been threatened with rain that never came, and (when wet) who handled
// the conditions best. "Mastered" is RELATIVE: each finisher's pace versus the per-lap field median
// in the wet, compared against the same gap in the dry, so the biggest dry->wet step-up wins (the
// driver who climbed the field as the rain fell, not merely the fastest car). Falls back to the best
// outright wet pace when the race ran wet end-to-end with too few dry laps to compare against.
export function summarizeRaceWeather(rs: RaceState, drivers: Driver[]): RaceWeather {
  const L = rs.totalLaps
  const moist: number[] = []
  for (let lap = 1; lap <= L; lap++) moist.push(getMoistureAtLap(rs.weather, lap))
  const peakMoisture = moist.reduce((m, x) => Math.max(m, x), 0)
  const wetLapCount = moist.filter((m) => m >= WET_MOISTURE).length
  const rained = wetLapCount >= RAINED_MIN_LAPS

  // Did a dry day have rain wrongly forecast? Read the raw fallible forecast curve (fixed at the
  // start), not the blended live view, so this is the genuine "phantom rain" miss.
  let fcPeak = 0
  for (let lap = 1; lap <= L; lap++) fcPeak = Math.max(fcPeak, getMoistureAtLap(rs.weatherForecast, lap))
  const forecastThreatenedRain = !rained && fcPeak >= WET_MOISTURE

  if (!rained) {
    return { rained: false, peakMoisture, wetLapCount, shape: 'dry', forecastThreatenedRain, wetMasterId: null, wetMasterName: null }
  }

  // Day shape from the moisture at the start vs the end (a fifth of the race at each end).
  const span = Math.max(1, Math.floor(L * 0.2))
  const earlyPeak = Math.max(...moist.slice(0, span))
  const latePeak = Math.max(...moist.slice(L - span))
  let shape: RaceWeather['shape']
  if (earlyPeak >= WET_MOISTURE && latePeak < 0.08) shape = 'drying'
  else if (latePeak >= WET_MOISTURE && earlyPeak < 0.08) shape = 'building'
  else if (wetLapCount >= L * 0.6) shape = 'sustained'
  else shape = 'shower'

  // Per-lap field median across every car that set a time that lap (DNFs counted up to retirement).
  const medians: number[] = []
  for (let i = 0; i < L; i++) {
    const times = rs.drivers.map((d) => d.lapTimes[i]).filter((t): t is number => typeof t === 'number')
    medians.push(times.length ? median(times) : NaN)
  }

  const nameOf = new Map(drivers.map((d) => [d.id, d.name]))
  let bestRel: { id: string; stepUp: number } | null = null   // dry->wet step-up (relative; preferred)
  let bestWet: { id: string; wetRel: number } | null = null   // outright wet pace (end-to-end fallback)
  for (const ds of rs.drivers) {
    if (ds.retired) continue // "mastered the wet" implies seeing the flag
    let wetSum = 0, wetN = 0, drySum = 0, dryN = 0
    for (let i = 0; i < ds.lapTimes.length; i++) {
      const med = medians[i]
      if (!Number.isFinite(med)) continue
      const rel = ds.lapTimes[i] - med
      if (moist[i] >= WET_MOISTURE) { wetSum += rel; wetN++ } else { drySum += rel; dryN++ }
    }
    if (wetN < MIN_PACE_LAPS) continue
    const wetRel = wetSum / wetN
    if (!bestWet || wetRel < bestWet.wetRel) bestWet = { id: ds.driverId, wetRel }
    if (dryN >= MIN_PACE_LAPS) {
      const stepUp = drySum / dryN - wetRel
      if (!bestRel || stepUp > bestRel.stepUp) bestRel = { id: ds.driverId, stepUp }
    }
  }
  const masterId = bestRel?.id ?? bestWet?.id ?? null
  return {
    rained: true, peakMoisture, wetLapCount, shape, forecastThreatenedRain: false,
    wetMasterId: masterId, wetMasterName: masterId ? nameOf.get(masterId) ?? null : null,
  }
}
