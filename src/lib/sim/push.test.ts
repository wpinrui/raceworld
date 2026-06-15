import { describe, it, expect } from 'vitest'
import { resolveIntensity, advancePreset, aiPushState, NORMAL } from './push'
import type { PushState } from './types'

describe('resolveIntensity', () => {
  it('maps the slider level directly and each preset to its push level', () => {
    expect(resolveIntensity({ kind: 'manual', level: -2 })).toBe(-2)
    expect(resolveIntensity({ kind: 'manual', level: 1 })).toBe(1)
    expect(resolveIntensity({ kind: 'preset', preset: 'push' })).toBe(1)
    expect(resolveIntensity({ kind: 'preset', preset: 'conserve' })).toBe(-1)
    expect(resolveIntensity({ kind: 'preset', preset: 'overtake' })).toBe(2)
  })
})

describe('advancePreset (presets auto-revert; the slider never does)', () => {
  const ctx = (over: Partial<{ temp: number; gapAhead: number; overtook: boolean }>) =>
    ({ temp: 0.5, gapAhead: 0.4, overtook: false, ...over })

  it('the slider is left untouched', () => {
    const s: PushState = { kind: 'manual', level: 2 }
    expect(advancePreset(s, ctx({ temp: 1.5 }))).toBe(s)
  })
  it('push reverts at the ceiling, holds below it', () => {
    expect(advancePreset({ kind: 'preset', preset: 'push' }, ctx({ temp: 1 }))).toEqual(NORMAL)
    expect(advancePreset({ kind: 'preset', preset: 'push' }, ctx({ temp: 0.9 })).kind).toBe('preset')
  })
  it('conserve reverts at the basement, holds above it', () => {
    expect(advancePreset({ kind: 'preset', preset: 'conserve' }, ctx({ temp: 0 }))).toEqual(NORMAL)
    expect(advancePreset({ kind: 'preset', preset: 'conserve' }, ctx({ temp: 0.1 })).kind).toBe('preset')
  })
  it('overtake reverts on a completed pass OR when the target slips out of dirty air', () => {
    expect(advancePreset({ kind: 'preset', preset: 'overtake' }, ctx({ overtook: true }))).toEqual(NORMAL)
    expect(advancePreset({ kind: 'preset', preset: 'overtake' }, ctx({ gapAhead: 1.5 }))).toEqual(NORMAL) // failed
    expect(advancePreset({ kind: 'preset', preset: 'overtake' }, ctx({ gapAhead: 0.5 })).kind).toBe('preset') // still attacking
  })
})

describe('aiPushState heuristic', () => {
  it('attacks a car right ahead while healthy and not overheating', () => {
    expect(aiPushState({ gapAhead: 0.5, condition: 80, temp: 0.5 })).toEqual({ kind: 'preset', preset: 'overtake' })
  })
  it('does not attack when overheating', () => {
    expect(aiPushState({ gapAhead: 0.5, condition: 80, temp: 1.2 })).toEqual({ kind: 'preset', preset: 'conserve' })
  })
  it('warms up cold tyres in clear air', () => {
    expect(aiPushState({ gapAhead: 5, condition: 80, temp: -0.1 })).toEqual({ kind: 'preset', preset: 'push' })
  })
  it('nurses worn tyres', () => {
    expect(aiPushState({ gapAhead: 5, condition: 15, temp: 0.5 })).toEqual({ kind: 'preset', preset: 'conserve' })
  })
  it('cruises otherwise', () => {
    expect(aiPushState({ gapAhead: 5, condition: 80, temp: 0.5 })).toEqual(NORMAL)
  })
})
