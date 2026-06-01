import type { WeatherPoint } from './types'

export function generateWeatherCurve(totalLaps: number): WeatherPoint[] {
  // 67% chance dry, 33% chance rain
  if (Math.random() < 0.67) {
    return [
      { lap: 1, moisture: 0 },
      { lap: totalLaps, moisture: 0 },
    ]
  }

  // Rain scenario
  let initialMoisture: number
  if (Math.random() < 0.5) {
    // Start dry
    initialMoisture = 0
  } else {
    // Start wet
    initialMoisture = 0.1 + Math.random() * 0.7 // random 0.1 to 0.8
  }

  const points: WeatherPoint[] = []
  let moisture = initialMoisture

  for (let lap = 1; lap <= totalLaps; lap += 5) {
    points.push({ lap, moisture })
    const delta = -0.01 + Math.random() * 0.05 // -0.01 to 0.04
    moisture = Math.min(1, Math.max(0, moisture + delta))
  }

  // Ensure the last lap is covered if not already included
  const lastPoint = points[points.length - 1]
  if (lastPoint.lap < totalLaps) {
    points.push({ lap: totalLaps, moisture })
  }

  return points
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
