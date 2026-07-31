import { describe, expect, it } from 'vitest'
import { smoothClosed } from '@/lib/ui/scenery-shapes'
import { pointInRing, ringsToPolys, samplePathRings } from './paths3d'

describe('samplePathRings', () => {
  it('samples lines and rects, resolving the relative shorthands partsPath emits', () => {
    const rings = samplePathRings('M 0 0 h 10 v 5 h -10 Z')
    expect(rings).toHaveLength(1)
    expect(rings[0]).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])
  })

  it('subdivides quadratics and lands exactly on their endpoints', () => {
    const [ring] = samplePathRings('M 0 0 Q 5 10 10 0 Z', 4)
    expect(ring).toHaveLength(5)
    expect(ring[2]).toEqual({ x: 5, y: 5 })
    expect(ring[4]).toEqual({ x: 10, y: 0 })
  })

  it('drops the duplicated closing point a smoothClosed blob ends on', () => {
    const d = smoothClosed([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
    const [ring] = samplePathRings(d)
    const a = ring[0]
    const b = ring[ring.length - 1]
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(1e-6)
  })

  it('splits subpaths into rings, as a band of nested loops arrives', () => {
    expect(samplePathRings('M 0 0 L 9 0 L 9 9 Z M 20 0 L 29 0 L 29 9 Z')).toHaveLength(2)
  })

  it('refuses commands outside the vocabulary the 2D emits', () => {
    expect(() => samplePathRings('M 0 0 C 1 1 2 2 3 3 Z')).toThrow(/unsupported/)
  })
})

describe('pointInRing', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  it('tells inside from outside', () => {
    expect(pointInRing({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInRing({ x: 15, y: 5 }, square)).toBe(false)
  })
})

describe('ringsToPolys', () => {
  const box = (x: number, y: number, s: number) =>
    [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]

  it('keeps disjoint rings as separate fills', () => {
    const polys = ringsToPolys([box(0, 0, 10), box(20, 0, 10)])
    expect(polys).toHaveLength(2)
    expect(polys.every((p) => p.holes.length === 0)).toBe(true)
  })

  it('makes an odd-depth ring a hole in its innermost even parent, as even-odd fills do', () => {
    const polys = ringsToPolys([box(0, 0, 30), box(10, 10, 10)])
    expect(polys).toHaveLength(1)
    expect(polys[0].holes).toHaveLength(1)
  })

  it('fills a ring nested two deep again: the island in the lake', () => {
    const polys = ringsToPolys([box(0, 0, 30), box(5, 5, 20), box(10, 10, 10)])
    expect(polys).toHaveLength(2)
    const outer = polys.find((p) => p.contour.length && p.contour[0].x === 0)!
    expect(outer.holes).toHaveLength(1)
  })
})
