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

// A car behind is worth defending against when it's roughly matched-or-faster (a real fight) but not so much
// faster that holding it up is hopeless (you'd just cook your tyres delaying the inevitable). Pace edge is in
// s/lap, >0 meaning the chaser is faster.
const DEFEND_MIN = -0.1  // defend down to a chaser this much SLOWER (it may still be on a tow / in DRS range)
const DEFEND_GIVEUP = 0.8 // a chaser more than this much faster will get by regardless — yield, save the tyres

// AI heuristic: a cheap, deterministic per-lap pick. Attack a car right ahead; else DEFEND (push back at max)
// against a genuine threat right behind so an attacker doesn't get a free, unanswered pace boost; else warm up
// cold tyres; nurse worn or overheating tyres; else cruise. Defending and attacking are gated on tyre health
// (no point pushing already-overheating or worn-out tyres).
export function aiPushState(ctx: { gapAhead: number; gapBehind: number; chaserPaceEdge: number; condition: number; temp: number }): PushState {
  const healthy = ctx.condition > 25 && ctx.temp <= 1
  if (ctx.gapAhead < TRAFFIC.DIRTY_RANGE && healthy) return { kind: 'preset', preset: 'overtake' }
  if (ctx.gapBehind < TRAFFIC.DIRTY_RANGE && ctx.chaserPaceEdge > DEFEND_MIN && ctx.chaserPaceEdge < DEFEND_GIVEUP && healthy) {
    return { kind: 'manual', level: 2 } // defend at max to neutralise the attacker's push; AI re-picks each lap
  }
  if (ctx.temp < 0) return { kind: 'preset', preset: 'push' }
  if (ctx.condition < 20 || ctx.temp > 1) return { kind: 'preset', preset: 'conserve' }
  return NORMAL
}
