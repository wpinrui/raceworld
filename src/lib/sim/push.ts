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

// The defensive push: max intensity, to neutralise an attacker's push so only real pace decides the pass.
export const DEFEND_PUSH: PushState = { kind: 'manual', level: 2 }

export interface PushContext { gapAhead: number; gapBehind: number; chaserPaceEdge: number; condition: number; temp: number }

// Healthy enough to push hard? No point cooking already-overheating or worn-out tyres to attack or defend.
const canPush = (ctx: PushContext) => ctx.condition > 25 && ctx.temp <= 1

// Should this car push to DEFEND the car right behind? A genuine, beatable threat within dirty air, tyres able.
export function shouldDefend(ctx: PushContext): boolean {
  return ctx.gapBehind < TRAFFIC.DIRTY_RANGE && ctx.chaserPaceEdge > DEFEND_MIN && ctx.chaserPaceEdge < DEFEND_GIVEUP && canPush(ctx)
}

// AI heuristic: a cheap, deterministic per-lap pick. Attack a car right ahead; else DEFEND (push back at max)
// against a genuine threat right behind so an attacker doesn't get a free, unanswered pace boost; else warm up
// cold tyres; nurse worn or overheating tyres; else cruise.
export function aiPushState(ctx: PushContext): PushState {
  if (ctx.gapAhead < TRAFFIC.DIRTY_RANGE && canPush(ctx)) return { kind: 'preset', preset: 'overtake' }
  if (shouldDefend(ctx)) return DEFEND_PUSH
  if (ctx.temp < 0) return { kind: 'preset', preset: 'push' }
  if (ctx.condition < 20 || ctx.temp > 1) return { kind: 'preset', preset: 'conserve' }
  return NORMAL
}

// Resolve the push the SIM applies to a player-controlled car this lap, plus whether it's a defensive push (for
// the UI badge). Three control modes:
//   'auto'       (Team Manager) — the AI drives push; the returned state is shown to the player as its live pick.
//   'autoDefend' (Driver mode)  — intent stays normal; push to DEFEND only when the pace check warrants it.
//   'manual'                    — honour the driver's own selection unchanged (caller applies preset auto-revert).
export function resolvePlayerPush(
  mode: 'auto' | 'autoDefend' | 'manual',
  selected: PushState,
  ctx: PushContext,
): { push: PushState; defending: boolean } {
  if (mode === 'auto') {
    const push = aiPushState(ctx)
    return { push, defending: push === DEFEND_PUSH }
  }
  if (mode === 'autoDefend') {
    // Baseline is always normal by construction — the toggle is only armable from Normal and the sim never
    // changes that intent — so `selected` is intentionally not consulted; we hold normal until a threat warrants.
    const defending = shouldDefend(ctx)
    return { push: defending ? DEFEND_PUSH : NORMAL, defending }
  }
  return { push: selected, defending: false }
}
