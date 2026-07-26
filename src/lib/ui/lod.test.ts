import { describe, expect, it } from 'vitest'
import { QUALITY, atLeast, lodBucket, mergeByPaint, rungFor } from './lod'
import type { DrawOp } from './scenery-draw'

describe('rungFor', () => {
  it('reads an object\'s own pixel size, so size and zoom are interchangeable', () => {
    // A 12m tree at 4px/m and a 48m stand at 1px/m cover the same pixels and get the same answer.
    expect(rungFor(12, 4)).toBe(rungFor(48, 1))
  })

  it('walks down the ladder as an object shrinks on screen', () => {
    const tree = (pxPerM: number) => rungFor(12, pxPerM)
    expect(tree(20)).toBe('near')
    expect(tree(1.5)).toBe('mid')
    expect(tree(0.5)).toBe('far')
    expect(tree(0.05)).toBe('gone')
  })

  it('gives a hut and a grandstand different answers at one camera', () => {
    // The whole point: one threshold could never say "simplify the hut, not the stand".
    const pxPerM = 1.2
    expect(rungFor(2.8, pxPerM)).toBe('far')
    expect(rungFor(40, pxPerM)).toBe('near')
  })

  it('slides the whole ladder with quality and nothing else', () => {
    // One camera, one tree, three rungs: 18px on screen, which low scales to 9.9 and high to 36.
    const pxPerM = 1.5
    expect(rungFor(12, pxPerM, QUALITY.low)).toBe('far')
    expect(rungFor(12, pxPerM, QUALITY.medium)).toBe('mid')
    expect(rungFor(12, pxPerM, QUALITY.high)).toBe('near')
  })

  it('never skips a rung as quality rises', () => {
    const seen = (['low', 'medium', 'high'] as const).map((q) => rungFor(9, 1.4, QUALITY[q]))
    const order = ['gone', 'far', 'mid', 'near']
    for (let i = 1; i < seen.length; i++) {
      expect(order.indexOf(seen[i])).toBeGreaterThanOrEqual(order.indexOf(seen[i - 1]))
    }
  })
})

describe('atLeast', () => {
  it('orders the ladder', () => {
    expect(atLeast('near', 'mid')).toBe(true)
    expect(atLeast('mid', 'mid')).toBe(true)
    expect(atLeast('far', 'mid')).toBe(false)
    expect(atLeast('gone', 'far')).toBe(false)
  })
})

describe('lodBucket', () => {
  it('holds still across a zoom notch, so the scene cache is not rebuilt per notch', () => {
    // Wheel notches are 1.18x; buckets are half-octaves, so a single notch usually stays put.
    let same = 0
    let pxPerM = 4
    for (let i = 0; i < 8; i++) {
      const next = pxPerM * 1.18
      if (lodBucket(next) === lodBucket(pxPerM)) same++
      pxPerM = next
    }
    expect(same).toBeGreaterThanOrEqual(3)
  })

  it('does move, so the ladder is not frozen', () => {
    expect(lodBucket(20)).toBeGreaterThan(lodBucket(2))
  })

  it('survives a degenerate camera', () => {
    expect(Number.isFinite(lodBucket(0))).toBe(true)
  })
})

describe('mergeByPaint', () => {
  const op = (d: string, fill: string, clip?: { cx: number; cy: number; r: number }): DrawOp => (
    { d, fill, clip }
  )

  it('collapses identical paints into one draw with many subpaths', () => {
    const out = mergeByPaint([
      op('M 0 0 L 1 1', '#0F0'),
      op('M 5 5 L 6 6', '#0F0'),
      op('M 9 9 L 8 8', '#0F0'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].d).toBe('M 0 0 L 1 1 M 5 5 L 6 6 M 9 9 L 8 8')
  })

  it('keeps different paints apart, in the order they arrived', () => {
    const out = mergeByPaint([op('M 0 0', '#0F0'), op('M 1 1', '#F00'), op('M 2 2', '#0F0')])
    expect(out.map((o) => o.fill)).toEqual(['#0F0', '#F00'])
    expect(out[0].d).toBe('M 0 0 M 2 2')
  })

  it('does not merge across a difference that would change the picture', () => {
    const wide: DrawOp = { d: 'M 0 0', stroke: '#FFF', width: 2 }
    const thin: DrawOp = { d: 'M 1 1', stroke: '#FFF', width: 1 }
    expect(mergeByPaint([wide, thin])).toHaveLength(2)
    const solid: DrawOp = { d: 'M 0 0', stroke: '#FFF', width: 1 }
    const dashed: DrawOp = { d: 'M 1 1', stroke: '#FFF', width: 1, dash: { on: 1, off: 1, shift: 0 } }
    expect(mergeByPaint([solid, dashed])).toHaveLength(2)
  })

  it('unions the clip discs it merged, so nothing merged is culled away', () => {
    const out = mergeByPaint([
      op('M 0 0', '#0F0', { cx: 0, cy: 0, r: 1 }),
      op('M 10 0', '#0F0', { cx: 10, cy: 0, r: 1 }),
    ])
    expect(out).toHaveLength(1)
    const clip = out[0].clip!
    expect(clip.cx).toBeCloseTo(5, 6)
    // Must reach both parts, or the merged draw disappears while part of it is on screen.
    expect(Math.hypot(0 - clip.cx, 0 - clip.cy) + 1).toBeLessThanOrEqual(clip.r + 1e-9)
    expect(Math.hypot(10 - clip.cx, 0 - clip.cy) + 1).toBeLessThanOrEqual(clip.r + 1e-9)
  })

  it('drops the clip entirely if any part had none, rather than inventing one', () => {
    const out = mergeByPaint([op('M 0 0', '#0F0', { cx: 0, cy: 0, r: 1 }), op('M 90 0', '#0F0')])
    expect(out).toHaveLength(1)
    expect(out[0].clip).toBeUndefined()
  })

  it('drops a gradient bbox rather than restretching it across the run', () => {
    const a: DrawOp = { d: 'M 0 0', fill: 'ref:tm-tree0', bbox: { x: 0, y: 0, w: 2, h: 2 } }
    const b: DrawOp = { d: 'M 9 9', fill: 'ref:tm-tree0', bbox: { x: 9, y: 9, w: 2, h: 2 } }
    expect(mergeByPaint([a, b])[0].bbox).toBeUndefined()
  })

  it('leaves a lone op exactly as it was', () => {
    const only = op('M 0 0', '#0F0', { cx: 0, cy: 0, r: 3 })
    expect(mergeByPaint([only])[0]).toBe(only)
  })

  it('has nothing to say about an empty scene', () => {
    expect(mergeByPaint([])).toEqual([])
  })
})
