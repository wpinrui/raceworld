import { describe, expect, it } from 'vitest'
import { APRON_LINES, SOFT_LAYERS, curveLimits, edgeLayer, noFold } from './surface-ink'
import { edgeOps } from './track-surface'
import type { Vec } from './geom'

/** A circle is the one centreline whose every offset is known in closed form: a point `o` to the LEFT of
 *  travel sits at exactly `R - o` or `R + o` from the middle, depending on which way it is going round. */
function circle(r: number, n = 512): Vec[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    return { x: r * Math.cos(t), y: r * Math.sin(t) }
  })
}

const RIBBON_HALF_M = 6.65
const LINE_M = 0.65
const APRON_HALF = RIBBON_HALF_M + APRON_LINES * LINE_M

const surface = (centre: Vec[], detail: 'full' | 'low' = 'full') => ({
  u: (m: number) => m,
  line: centre,
  curvature: new Float64Array(1),
  long: new Float64Array(1),
  trackM: 1.6,
  tarmac: '#33383E',
  centre,
  ground: '#3E5A34',
  shadow: '#1A2418',
  ribbonHalfM: RIBBON_HALF_M,
  lineWidthM: LINE_M,
  tarmacHalfM: 6,
  detail,
})

/** Every point of every subpath, as its distance from the origin the test circle is centred on. */
function radii(d: string): number[] {
  const out: number[] = []
  for (const part of d.split('M').slice(1)) {
    const nums = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    for (let i = 0; i + 1 < nums.length; i += 2) out.push(Math.hypot(nums[i], nums[i + 1]))
  }
  return out
}

const subpaths = (d: string) => d.split('M').length - 1

describe('curveLimits', () => {
  it('is infinite on a straight', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }))
    // Open at the ends, so only the interior stations are actually straight.
    const lim = curveLimits(line, false)
    for (let i = 2; i < 18; i++) expect(lim[i]).toBe(Infinity)
  })

  it('is the corner radius, signed by which side the centre of curvature is on', () => {
    const lim = curveLimits(circle(40))
    for (const l of lim) {
      // This circle's normals point outward, so its centre is on the negative side throughout.
      expect(l).toBeLessThan(0)
      expect(Math.abs(l)).toBeCloseTo(40, 1)
    }
    // Reversing the traverse puts the centre on the other side, and nothing else changes.
    const back = curveLimits([...circle(40)].reverse())
    for (const l of back) expect(l).toBeGreaterThan(0)
  })
})

describe('noFold', () => {
  const lim = curveLimits(circle(10)) // centre on the negative side, radius 10

  it('passes an offset on the outside of the corner through untouched', () => {
    const at = noFold(9.3, lim, 0.8)
    expect(at(0)).toBe(9.3)
  })

  it('pinches an offset that would fold the run back through itself', () => {
    const at = noFold(-9.3, lim, 0.8)
    expect(at(0)).toBeCloseTo(-8, 6) // 0.8 of the radius
  })

  it('leaves an inside offset alone while it still fits', () => {
    const at = noFold(-4, lim, 0.8)
    expect(at(0)).toBe(-4)
  })
})

describe('edgeOps', () => {
  const centre = circle(60) // wide enough that nothing is ever pinched
  const ops = edgeOps(surface(centre))

  it('reaches exactly as far out as the falloff it replaced', () => {
    // The picture's outer boundary is what a player sees. The rims moved the INNER edge, not this.
    const outer = Math.max(...ops.map((op) => Math.max(...radii(op.d)) - 60 + (op.width ?? 0) / 2))
    // Loose to a rounding step: path coordinates are written to two decimal places.
    expect(outer).toBeCloseTo(APRON_HALF + edgeLayer(0, SOFT_LAYERS, '#3E5A34', '#33383E').reachM, 1)
  })

  it('lays a band on both sides of the road in one op', () => {
    for (const op of ops) expect(subpaths(op.d)).toBe(2)
    for (const op of ops) {
      const rs = radii(op.d).map((r) => r - 60)
      expect(Math.min(...rs)).toBeLessThan(0) // the inside of the circle
      expect(Math.max(...rs)).toBeGreaterThan(0)
    }
  })

  it('overlaps consecutive bands rather than butting them, so no seam shows ground', () => {
    // Band k's outer edge must sit at or beyond band k+1's inner edge, all the way in to the road.
    const bands = ops
      .map((op) => {
        const off = Math.abs(Math.max(...radii(op.d)) - 60)
        return { inner: off - (op.width ?? 0) / 2, outer: off + (op.width ?? 0) / 2 }
      })
      .sort((a, b) => b.outer - a.outer)
    const seen = [bands[0]]
    for (const b of bands) if (b.outer < seen[seen.length - 1].outer - 1e-6) seen.push(b)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].outer).toBeGreaterThan(seen[i - 1].inner)
    }
    // And the innermost reaches under the road's own casing.
    expect(seen[seen.length - 1].inner).toBeLessThan(RIBBON_HALF_M)
  })

  it('paints a fraction of the width the spanning strokes did', () => {
    // What the change is for. The old edge stroked the whole road, five times over, for the rim.
    const laid = new Set(ops.map((op) => `${op.stroke}|${op.width}`))
    const perStation = [...laid].reduce((sum, key) => sum + 2 * Number(key.split('|')[1]), 0)
    const spanning = Array.from({ length: SOFT_LAYERS }, (_, k) => (
      2 * (APRON_HALF + edgeLayer(k, SOFT_LAYERS, '#3E5A34', '#33383E').reachM)
    )).reduce((a, b) => a + b, 2 * APRON_HALF)
    expect(perStation).toBeLessThan(spanning / 7)
  })

  it('keeps the op count flat, both sides riding in the same stroke', () => {
    // A rim per side would have doubled this, and op setup is main-thread work on every camera frame.
    // 512 stations cut into 128 arcs is one op per arc per band, and a band per softening layer plus
    // the apron -- exactly what the spanning strokes cost.
    expect(ops.length).toBe(128 * (SOFT_LAYERS + 1))
    // And no band spans the road any more, which is the whole of what the change is.
    for (const op of ops) expect(op.width).toBeLessThan(RIBBON_HALF_M)
  })

  it('collapses to one falloff band plus the apron at zoom-out', () => {
    const low = edgeOps(surface(centre, 'low'))
    expect(new Set(low.map((op) => op.stroke)).size).toBe(2)
    expect(low.length).toBe(128 * 2)
  })

  it('pinches its rims instead of turning them inside out in a hairpin', () => {
    // A corner tighter than the rim's own offset. Without the clamp the offset run crosses itself and
    // the band bulges out the far side; with it, nothing reaches past the corner's centre.
    const tight = edgeOps(surface(circle(8)))
    for (const op of tight) {
      for (const r of radii(op.d)) expect(r).toBeGreaterThanOrEqual(0)
    }
    const inner = Math.min(...tight.flatMap((op) => radii(op.d)))
    expect(inner).toBeCloseTo(8 - 0.8 * 8, 1)
  })

  it('draws nothing without the centreline it measures off', () => {
    expect(edgeOps({ ...surface(centre), centre: undefined })).toEqual([])
  })
})
