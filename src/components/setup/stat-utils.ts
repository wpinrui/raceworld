import { overall } from '@/lib/sim/progression'

export const STAT_KEYS = ['pace', 'consistency', 'wetWeatherPace', 'overtaking', 'smoothness'] as const
export type StatKey = (typeof STAT_KEYS)[number]

export const STAT_LABELS: Record<StatKey, string> = {
  pace: 'Pace',
  consistency: 'Consistency',
  wetWeatherPace: 'Wet',
  overtaking: 'Overtaking',
  smoothness: 'Smoothness',
}

const COLOR_LOW = 60
const COLOR_HIGH = 90
const HUE_RED = 0
const HUE_GREEN = 122

export function statColor(value: number): string {
  const clamped = Math.max(0, Math.min(100, value))
  if (clamped <= COLOR_LOW) return `hsl(${HUE_RED}, 90%, 62%)`
  if (clamped >= COLOR_HIGH) return `hsl(${HUE_GREEN}, 72%, 52%)`
  const t = (clamped - COLOR_LOW) / (COLOR_HIGH - COLOR_LOW)
  return `hsl(${Math.round(t * HUE_GREEN)}, 85%, 58%)`
}

export function computeOverall(d: { pace: number; smoothness: number; overtaking: number; wetWeatherPace: number; consistency?: number }): number {
  return Math.round(overall(d))
}
