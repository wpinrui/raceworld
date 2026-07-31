import { describe, expect, it } from 'vitest'
import { QUALITY, atLeast, lodBucket, lodScale, rungFor, unionOf } from './lod'

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

describe('unionOf', () => {
  it('reaches every disc it was given, which is the only thing a cull disc may do', () => {
    const parts = [
      { cx: 0, cy: 0, r: 1 },
      { cx: 10, cy: 0, r: 1 },
      { cx: 0, cy: 6, r: 2 },
    ]
    const out = unionOf(parts)
    for (const p of parts) {
      expect(Math.hypot(p.cx - out.cx, p.cy - out.cy) + p.r).toBeLessThanOrEqual(out.r + 1e-9)
    }
  })

  it('gives a lone disc back at least as big as it was', () => {
    const out = unionOf([{ cx: 3, cy: 4, r: 2 }])
    expect(out.cx).toBeCloseTo(3, 6)
    expect(out.cy).toBeCloseTo(4, 6)
    expect(out.r).toBeGreaterThanOrEqual(2 - 1e-9)
  })
})

describe('lodScale', () => {
  it('collapses every scale in a bucket to one, which is what removes the hysteresis', () => {
    // The bug this exists for: decide a rung from the LIVE scale at the moment a bucket happens to
    // change, and the answer depends on where the zoom notches landed on the way there — different
    // going in from going out. Two scales in one bucket must be indistinguishable to the ladder.
    // Bucket b spans [2^((b-0.5)/2), 2^((b+0.5)/2)): pairs picked to sit inside one, not astride it.
    for (const [a, b] of [[2.5, 3.3], [1.2, 1.6], [10, 13]] as const) {
      expect(lodBucket(a)).toBe(lodBucket(b))
      expect(lodScale(a)).toBe(lodScale(b))
      expect(rungFor(12, lodScale(a))).toBe(rungFor(12, lodScale(b)))
    }
  })

  it('walks a rung at a time and never back, however the zoom got there', () => {
    const order = ['gone', 'far', 'mid', 'near']
    const rungs: string[] = []
    for (let p = 0.3; p < 40; p *= 1.18) rungs.push(rungFor(12, lodScale(p)))
    for (let i = 1; i < rungs.length; i++) {
      expect(order.indexOf(rungs[i])).toBeGreaterThanOrEqual(order.indexOf(rungs[i - 1]))
    }
    // And the same walk taken backwards visits the same rungs at the same scales.
    for (let p = 0.3; p < 40; p *= 1.18) {
      expect(rungFor(12, lodScale(p))).toBe(rungs.shift())
    }
  })

  it('stands for the bucket it came from, within half an octave', () => {
    for (const p of [0.7, 1.5, 3.5, 14, 38]) {
      expect(lodScale(p)).toBeGreaterThan(p / 1.42)
      expect(lodScale(p)).toBeLessThan(p * 1.42)
      expect(lodBucket(lodScale(p))).toBe(lodBucket(p))
    }
  })
})
