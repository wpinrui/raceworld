import type { WeatherPoint } from './types'

// --- Tunables (see gdd.md "Weather") -------------------------------------------------------------
// Share of races that see rain. ~17.5%: between "races with meaningful wet running" (~15%) and
// "races touched by any rain" (~20%).
const RAIN_CHANCE = 0.175
// Archetype mix when it does rain (cumulative thresholds).
const SHOWER_CUT = 0.45 // passing shower
const BUILDING_CUT = 0.70 // building rain
const DRYING_CUT = 0.92 // drying track  (remainder: sustained wet, rare)
// Forecast realism: the forecast is a separate, deliberately-imperfect curve. These govern the rarer
// binary misses; the bulk of the error is timing/intensity jitter applied to the real curve.
const PHANTOM_RAIN_CHANCE = 0.10 // of dry races: forecast cries rain that never lands
const UNFORESEEN_RAIN_CHANCE = 0.04 // of wet races: rain arrives with no forecast warning
// Forecast trust grows as a lap nears: displayed error = |forecast - reality| * (1 - e^(-lead/TAU)).
const FORECAST_LEAD_TAU = 8

const rand = (rng: () => number, a: number, b: number) => a + rng() * (b - a)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const WET = 0.02 // moisture below this counts as dry

// --- Curve helpers -------------------------------------------------------------------------------

// Clean a set of raw control points into a valid, lap-sorted curve that spans lap 1..totalLaps with
// no duplicate laps. Moisture is clamped to [0,1] and laps to [1,totalLaps].
function normalize(points: WeatherPoint[], totalLaps: number): WeatherPoint[] {
  const pts = points
    .map((p) => ({ lap: Math.round(Math.max(1, Math.min(totalLaps, p.lap))), moisture: clamp01(p.moisture) }))
    .sort((a, b) => a.lap - b.lap)
  if (pts.length === 0) return [{ lap: 1, moisture: 0 }, { lap: totalLaps, moisture: 0 }]
  if (pts[0].lap > 1) pts.unshift({ lap: 1, moisture: pts[0].moisture })
  if (pts[pts.length - 1].lap < totalLaps) pts.push({ lap: totalLaps, moisture: pts[pts.length - 1].moisture })
  const out: WeatherPoint[] = []
  for (const p of pts) {
    if (out.length && out[out.length - 1].lap === p.lap) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

// Small per-point wobble so two curves of the same archetype never read identically (the player can't
// memorise a fixed shape). Dry points stay dry.
function jitter(rng: () => number, points: WeatherPoint[], totalLaps: number): WeatherPoint[] {
  return normalize(
    points.map((p) => ({
      lap: p.lap + rand(rng, -1.5, 1.5),
      moisture: p.moisture < WET ? 0 : clamp01(p.moisture + rand(rng, -0.05, 0.05)),
    })),
    totalLaps,
  )
}

// --- Archetypes (raw control points; normalise()/jitter() finish them) ---------------------------

function passingShower(rng: () => number, L: number): WeatherPoint[] {
  const onset = rand(rng, 0.12, 0.55) * L
  const duration = rand(rng, 0.15, 0.38) * L
  const peak = rand(rng, 0.18, 0.5)
  const peakLap = onset + rand(rng, 2, 5)
  const fadeStart = Math.max(peakLap + 1, onset + duration - rand(rng, 3, 7))
  return [
    { lap: 1, moisture: 0 },
    { lap: onset, moisture: 0 },
    { lap: peakLap, moisture: peak },
    { lap: fadeStart, moisture: peak * rand(rng, 0.7, 1) },
    { lap: onset + duration, moisture: 0 },
    { lap: L, moisture: 0 },
  ]
}

function buildingRain(rng: () => number, L: number): WeatherPoint[] {
  const onset = rand(rng, 0.18, 0.5) * L
  const mid = onset + (L - onset) * rand(rng, 0.4, 0.6)
  const endIntensity = rand(rng, 0.4, 0.8)
  return [
    { lap: 1, moisture: 0 },
    { lap: onset, moisture: 0 },
    { lap: mid, moisture: endIntensity * rand(rng, 0.4, 0.65) },
    { lap: L, moisture: endIntensity },
  ]
}

function dryingTrack(rng: () => number, L: number): WeatherPoint[] {
  const start = rand(rng, 0.35, 0.65)
  const dryBy = rand(rng, 0.35, 0.8) * L
  return [
    { lap: 1, moisture: start },
    { lap: dryBy * rand(rng, 0.4, 0.7), moisture: start * rand(rng, 0.4, 0.7) },
    { lap: dryBy, moisture: 0 },
    { lap: L, moisture: 0 },
  ]
}

function sustainedWet(rng: () => number, L: number): WeatherPoint[] {
  const base = rand(rng, 0.4, 0.7)
  const pts: WeatherPoint[] = [{ lap: 1, moisture: base * rand(rng, 0.7, 1) }]
  for (let i = 1; i <= 4; i++) pts.push({ lap: (L * i) / 4, moisture: clamp01(base + rand(rng, -0.18, 0.18)) })
  return pts
}

// --- Public API ----------------------------------------------------------------------------------

// The true weather for a race. ~17.5% of races rain; when they do, one of four archetypes with
// randomised onset/intensity/duration plus a wobble, so no curve is memorisable.
export function generateWeatherCurve(totalLaps: number, rng: () => number = Math.random): WeatherPoint[] {
  if (rng() >= RAIN_CHANCE) return [{ lap: 1, moisture: 0 }, { lap: totalLaps, moisture: 0 }]
  const roll = rng()
  const pts =
    roll < SHOWER_CUT ? passingShower(rng, totalLaps)
    : roll < BUILDING_CUT ? buildingRain(rng, totalLaps)
    : roll < DRYING_CUT ? dryingTrack(rng, totalLaps)
    : sustainedWet(rng, totalLaps)
  return jitter(rng, normalize(pts, totalLaps), totalLaps)
}

// A believable-but-wrong reading of the real curve, fixed at race start. The live view blends it
// toward reality as each lap nears (see forecastMoistureAtLap), so the long-range forecast can be
// well off while the next few laps are trustworthy. Captures onset error (shift), end error (stretch)
// and intensity error (scale + offset), plus the rarer phantom/unforeseen binary misses.
export function generateForecastCurve(reality: WeatherPoint[], totalLaps: number, rng: () => number = Math.random): WeatherPoint[] {
  const isDryRace = reality.every((p) => p.moisture < 0.05)
  if (isDryRace) {
    if (rng() < PHANTOM_RAIN_CHANCE) return jitter(rng, normalize(passingShower(rng, totalLaps), totalLaps), totalLaps)
    return [{ lap: 1, moisture: 0 }, { lap: totalLaps, moisture: 0 }]
  }
  if (rng() < UNFORESEEN_RAIN_CHANCE) return [{ lap: 1, moisture: 0 }, { lap: totalLaps, moisture: 0 }]

  const wetLaps = reality.filter((p) => p.moisture > WET).map((p) => p.lap)
  const wetStart = wetLaps.length ? Math.min(...wetLaps) : 1
  const onsetShift = rand(rng, -11, 11) // start-lap error
  const stretch = rand(rng, 0.45, 1.75) // end-lap error (window longer/shorter than reality)
  const intensityScale = rand(rng, 0.45, 1.85) // how-hard error (kept above ~0.45 so a wet race still
  const offset = rand(rng, -0.16, 0.16) //        reads as wet — explicit unforeseen misses are separate)
  const warped = reality.map((p) => ({
    lap: wetStart + onsetShift + (p.lap - wetStart) * stretch,
    moisture: p.moisture < WET ? 0 : clamp01(p.moisture * intensityScale + offset),
  }))
  return normalize(warped, totalLaps)
}

export function getMoistureAtLap(weather: WeatherPoint[], lap: number): number {
  if (weather.length === 0) return 0
  if (lap <= weather[0].lap) return weather[0].moisture
  if (lap >= weather[weather.length - 1].lap) return weather[weather.length - 1].moisture
  for (let i = 0; i < weather.length - 1; i++) {
    const a = weather[i]
    const b = weather[i + 1]
    if (lap >= a.lap && lap <= b.lap) {
      const t = (lap - a.lap) / (b.lap - a.lap)
      return a.moisture + t * (b.moisture - a.moisture)
    }
  }
  return weather[weather.length - 1].moisture
}

// The forecast moisture for `targetLap` as seen from `currentLap`. Blends the (wrong) forecast curve
// toward reality by lead time: at the current lap it reads the truth, far ahead it reads the forecast.
// This is what the live graph draws for laps still to come.
export function forecastMoistureAtLap(
  reality: WeatherPoint[],
  forecast: WeatherPoint[],
  targetLap: number,
  currentLap: number,
): number {
  const real = getMoistureAtLap(reality, targetLap)
  const fc = getMoistureAtLap(forecast, targetLap)
  const lead = Math.max(0, targetLap - currentLap)
  const w = 1 - Math.exp(-lead / FORECAST_LEAD_TAU)
  return clamp01(real + (fc - real) * w)
}
