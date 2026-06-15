import { TRAFFIC } from './engine'
import type { PushState } from './types'

// Driver push controls (#sim-overhaul). The player drives their car with either a persistent 5-step SLIDER
// or a transient PRESET that auto-reverts to normal once its goal is met. AI cars pick a preset each lap via
// a cheap heuristic. Everything resolves to a numeric INTENSITY (-2..+2) the lap loop feeds the pace/temp/
// wear model (tyre-temp.ts). The PushState/SliderLevel/PushPreset types live in types.ts (used by race state).

export const NORMAL: PushState = { kind: 'manual', level: 0 }
// UI labels for the slider, indexed by level + 2.
export const SLIDER_LABELS = ['Back off', 'Ease off', 'Normal', 'Push', 'Max'] as const

// Resolve a push state to this lap's intensity. Presets map to a fixed push level while active.
export function resolveIntensity(push: PushState): number {
  if (push.kind === 'manual') return push.level
  switch (push.preset) {
    case 'push': return 1
    case 'conserve': return -1
    case 'overtake': return 2
  }
}

// Advance a preset: it auto-reverts to normal once its goal is reached. The slider never auto-reverts.
//   push     → until the tyres reach the ceiling of the window (temp >= 1)
//   conserve → until the tyres reach the basement (temp <= 0)
//   overtake → until the move lands (overtook) OR the target slips out of dirty air (attack failed)
export function advancePreset(push: PushState, ctx: { temp: number; gapAhead: number; overtook: boolean }): PushState {
  if (push.kind === 'manual') return push
  switch (push.preset) {
    case 'push': return ctx.temp >= 1 ? NORMAL : push
    case 'conserve': return ctx.temp <= 0 ? NORMAL : push
    case 'overtake': return ctx.overtook || ctx.gapAhead > TRAFFIC.DIRTY_RANGE ? NORMAL : push
  }
}

// AI heuristic: a cheap, deterministic per-lap pick from the four presets. Attack a car right ahead while the
// tyres are healthy and not overheating; warm up cold tyres; nurse worn or overheating tyres; else cruise.
export function aiPushState(ctx: { gapAhead: number; condition: number; temp: number }): PushState {
  if (ctx.gapAhead < TRAFFIC.DIRTY_RANGE && ctx.condition > 25 && ctx.temp <= 1) return { kind: 'preset', preset: 'overtake' }
  if (ctx.temp < 0) return { kind: 'preset', preset: 'push' }
  if (ctx.condition < 20 || ctx.temp > 1) return { kind: 'preset', preset: 'conserve' }
  return NORMAL
}
