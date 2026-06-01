import type { WeatherPoint } from './types'

export function generateWeatherCurve(totalLaps: number): WeatherPoint[] {
  // M1: always dry
  return [
    { lap: 1, moisture: 0 },
    { lap: totalLaps, moisture: 0 },
  ]
}

export function getMoistureAtLap(weather: WeatherPoint[], lap: number): number {
  if (weather.length === 0) return 0

  // Before first point
  if (lap <= weather[0].lap) return weather[0].moisture

  // After last point
  if (lap >= weather[weather.length - 1].lap) return weather[weather.length - 1].moisture

  // Find surrounding points and interpolate
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
