import type { RaceWeather } from '@/lib/sim/types'
import { chance, pick, fill } from './util'

// Copy-assembly helpers carved out of engine.ts: paragraph joining, possessives, the weather headline
// bucket, and the gated "texture" line. No NewsContext dependency.

// Join composed paragraphs, dropping any that collapsed to empty.
export function paras(...parts: string[]): string {
  return parts.filter(Boolean).join('\n\n')
}

// Possessive form. Names ending in s (Mercedes, Williams, Haas, Racing Bulls) take a bare
// apostrophe; everything else takes 's.
export function poss(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

// Headline weather modifier bucket (weather race-report news): a drying day reads as "drying",
// otherwise the descriptor escalates with how wet the track got at its peak.
export function wxHeadlineBucket(wx: RaceWeather): 'damp' | 'wet' | 'heavy' | 'drying' {
  if (wx.shape === 'drying') return 'drying'
  if (wx.peakMoisture >= 0.70) return 'heavy'
  if (wx.peakMoisture >= 0.35) return 'wet'
  return 'damp'
}

// Invented, unfalsifiable colour. The rule: a texture line may NEVER reference a tracked
// quantity (position, points, gap, lap, another driver's result). It is either sentiment that
// matches the known outcome or fully orthogonal to anything we model, so it cannot contradict
// the standings / driver / classification views. Gated so it stays texture, not boilerplate.
const TEXTURE_PCT = 66
export function texture(seed: string, pool: string[], slots: Record<string, string | number>, pct: number = TEXTURE_PCT): string {
  if (pool.length === 0 || !chance(`${seed}|tex`, pct)) return ''
  return fill(pick(pool, `${seed}|tex`), slots)
}
