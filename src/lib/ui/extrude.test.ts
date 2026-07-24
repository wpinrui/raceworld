// #sim-2d — oblique extrusion. The bugs these pin were all VISIBLE ones that no amount of correct
// arithmetic elsewhere would have caught: a solid rendering as a hollow shell, a wall rendering as a
// second staggered copy of the roof, and every diagonal edge coming out as a staircase.

import { describe, it, expect } from 'vitest'
import {
  partsPath, quad, ringArea, sweptHull, sideFacesX, rakedStand, ribbon, posts,
  type Part, type Vec,
} from './extrude'

const P = (x: number, y: number): Vec => ({ x, y })
const RECT: Part[] = [{ dx: 0, dy: 0, w: 10, h: 6 }]

/** Every `M ... Z` subpath in a path string, as point rings. */
function rings(d: string): Vec[][] {
  return d.split('M ').filter(Boolean).map((sub) => {
    const body = sub.replace(/Z\s*$/, '').trim()
    // partsPath uses relative h/v; expand it so both emitters can be read the same way.
    if (/[hv]/.test(body)) {
      const n = body.match(/-?\d+(\.\d+)?/g)!.map(Number)
      const [x0, y0, w, h] = n
      return [P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + h), P(x0, y0 + h)]
    }
    return body.split(' L ').map((pt) => {
      const [x, y] = pt.trim().split(' ').map(Number)
      return P(x, y)
    })
  })
}

describe('winding', () => {
  // THE hollow-shell bug: under nonzero fill, overlapping subpaths of opposite winding cancel to a
  // hole, so the base got subtracted out of every building and the ground showed through it.
  it('winds quads the same way as the rects partsPath emits', () => {
    const rectRing = rings(partsPath(RECT))[0]
    const quadRing = rings(quad(P(0, 0), P(4, 0), P(6, 3), P(1, 3)))[0]
    expect(Math.sign(ringArea(rectRing))).toBe(Math.sign(ringArea(quadRing)))
  })

  it('normalises a quad given in either order to the same winding', () => {
    const a = rings(quad(P(0, 0), P(4, 0), P(6, 3), P(1, 3)))[0]
    const b = rings(quad(P(1, 3), P(6, 3), P(4, 0), P(0, 0)))[0]
    expect(Math.sign(ringArea(a))).toBe(Math.sign(ringArea(b)))
  })

  it('gives every subpath of a swept hull one consistent winding', () => {
    const all = rings(sweptHull(RECT, 5, 4)).map((r) => Math.sign(ringArea(r)))
    expect(new Set(all).size).toBe(1)
  })

  it('holds for a multi-part footprint and for every sweep direction', () => {
    const L: Part[] = [{ dx: 0, dy: -3, w: 12, h: 4 }, { dx: -4, dy: 2, w: 4, h: 6 }]
    for (const [ox, oy] of [[5, 4], [-5, 4], [5, -4], [-5, -4], [0, 6], [6, 0]]) {
      const signs = rings(sweptHull(L, ox, oy)).map((r) => Math.sign(ringArea(r)))
      expect(new Set(signs).size, `sweep ${ox},${oy}`).toBe(1)
    }
  })
})

describe('sweptHull', () => {
  it('reaches from the footprint to the offset copy, with no gap between', () => {
    const pts = rings(sweptHull(RECT, 8, 6)).flat()
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(-5, 6) // footprint's left edge
    expect(Math.max(...xs)).toBeCloseTo(13, 6) // offset copy's right edge
    expect(Math.min(...ys)).toBeCloseTo(-3, 6)
    expect(Math.max(...ys)).toBeCloseTo(9, 6)
  })

  it('emits the base, the top and exactly two connecting faces for one rect', () => {
    // A staircase smear would emit many more; a bare displaced copy would emit one.
    expect(rings(sweptHull(RECT, 8, 6))).toHaveLength(4)
  })

  it('has no staircase: every connecting face is a straight-sided quad', () => {
    for (const r of rings(sweptHull(RECT, 8, 6))) expect(r).toHaveLength(4)
  })

  it('degenerates to the plain footprint when there is no offset', () => {
    expect(sweptHull(RECT, 0, 0)).toBe(partsPath(RECT))
  })

  it('picks the faces that actually front the sweep', () => {
    // Sweeping down-right exposes the right and bottom edges, not the left or top.
    const pts = rings(sweptHull(RECT, 8, 6)).flat()
    expect(pts.some((p) => Math.abs(p.x - 13) < 1e-6)).toBe(true)
    const up = rings(sweptHull(RECT, -8, -6)).flat()
    expect(up.some((p) => Math.abs(p.x + 13) < 1e-6)).toBe(true)
  })
})

describe('sideFacesX', () => {
  it('returns one quad per part, on the edge facing the sweep', () => {
    expect(rings(sideFacesX(RECT, 8, 6))).toHaveLength(1)
    expect(rings(sideFacesX(RECT, 8, 6))[0]).toHaveLength(4)
  })

  it('is empty for a purely vertical sweep, which exposes no left/right face', () => {
    expect(sideFacesX(RECT, 0, 6)).toBe('')
  })

  it('skips an edge buried inside the union', () => {
    // Archetype 8 is a tower ON a podium: the inner rect's right edge is interior to the outer one,
    // so tinting a face there paints a sliver across the wall of a perfectly ordinary building.
    const towerOnPodium: Part[] = [
      { dx: 0, dy: 0, w: 20, h: 16 },
      { dx: 3.6, dy: -1.9, w: 8.4, h: 8 },
    ]
    expect(rings(sideFacesX(towerOnPodium, 6, 4))).toHaveLength(1)
  })

  it('still emits a face for a part that pokes out of the union', () => {
    const lShape: Part[] = [
      { dx: 0, dy: -3, w: 12, h: 4 },
      { dx: 8, dy: 2, w: 6, h: 6 }, // its right edge is outside the first rect
    ]
    expect(rings(sideFacesX(lShape, 6, 4))).toHaveLength(2)
  })
})

describe('ribbon', () => {
  const run = [P(0, 0), P(10, 0), P(20, 4)]

  it('closes a band between the top line and its offset base', () => {
    const r = rings(ribbon(run, 3, 2))
    expect(r).toHaveLength(1)
    // Every top point, then every base point back again.
    expect(r[0]).toHaveLength(run.length * 2)
    expect(r[0][0]).toEqual(P(0, 0))
    expect(r[0][run.length]).toEqual(P(23, 6)) // last point, offset
  })

  it('is empty for a degenerate run', () => {
    expect(ribbon([P(0, 0)], 3, 2)).toBe('')
  })

  it('walks the base back in reverse, so the band does not self-cross', () => {
    const r = rings(ribbon(run, 3, 2))[0]
    expect(r[r.length - 1]).toEqual(P(3, 2)) // first point, offset — i.e. reversed
  })
})

describe('posts', () => {
  const run = Array.from({ length: 9 }, (_, i) => P(i * 5, 0))

  it('emits one vertical per strided point, as subpaths of a single path', () => {
    const r = rings(posts(run, 2, 3, 2))
    expect(r).toHaveLength(5) // indices 0,2,4,6,8
    for (const seg of r) expect(seg).toHaveLength(2)
  })

  it('runs each post from the base line to the offset top', () => {
    const seg = rings(posts(run, 2, 3, 4))[0]
    expect(seg[0]).toEqual(P(0, 0))
    expect(seg[1]).toEqual(P(2, 3))
  })

  it('never divides by a zero stride', () => {
    expect(rings(posts(run, 2, 3, 0)).length).toBe(run.length)
  })
})

describe('rakedStand', () => {
  const O = P(6, 4.8)
  const FRONT_FRAC = 0.8

  it('anchors the DECK at the footprint, like a building anchors its roof', () => {
    // Anchoring the base instead leaves it sticking out behind the deck, which reads as a back wall
    // no building ever shows.
    const ring = rings(rakedStand(40, 12, true, O, FRONT_FRAC).deck)[0]
    const rear = ring.filter((p) => Math.abs(p.y + 6) < 1e-6) // front is +y, so rear is y = -h/2
    expect(rear).toHaveLength(2)
    expect(rear.map((p) => p.x).sort((a, b) => a - b)).toEqual([-20, 20])
  })

  it('shears the deck, pushing the lower front edge toward the base', () => {
    const ring = rings(rakedStand(40, 12, true, O, FRONT_FRAC).deck)[0]
    const spread = Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x))
    expect(spread).toBeCloseTo(40 + O.x * FRONT_FRAC, 6)
  })

  it('draws ONLY the faces pointing at the viewer', () => {
    // Base + deck + exactly two faces, never four: the far side of a solid is not in view.
    expect(rings(rakedStand(40, 12, true, O, FRONT_FRAC).hull)).toHaveLength(4)
    for (const o of [P(6, 4.8), P(-6, 4.8), P(6, -4.8), P(-6, -4.8)]) {
      expect(rings(rakedStand(40, 12, true, o, FRONT_FRAC).hull), `${o.x},${o.y}`).toHaveLength(4)
    }
  })

  it('picks the near face, not the far one, on both facings', () => {
    // Front is +y and the offset runs +y, so the FRONT face shows and the rear stays hidden.
    const far = rings(rakedStand(40, 12, true, P(0.001, 5), FRONT_FRAC).hull)
      .flat().filter((p) => p.y < -6.001)
    expect(far).toHaveLength(0)
  })

  it('honours which edge faces the track', () => {
    const a = rings(rakedStand(40, 12, true, O, FRONT_FRAC).deck)[0]
    const b = rings(rakedStand(40, 12, false, O, FRONT_FRAC).deck)[0]
    expect(a.map((p) => p.y)).not.toEqual(b.map((p) => p.y))
  })

  it('keeps the hull one consistently wound solid', () => {
    const signs = rings(rakedStand(40, 12, true, O, FRONT_FRAC).hull).map((r) => Math.sign(ringArea(r)))
    expect(new Set(signs).size).toBe(1)
  })

  it('roofs only the rear rows, not the whole deck', () => {
    const { roof, deck } = rakedStand(40, 12, true, O, FRONT_FRAC, 0.3)
    const area = (d: string) => Math.abs(ringArea(rings(d)[0])) / 2
    expect(area(roof)).toBeLessThan(area(deck) * 0.5)
    expect(area(roof)).toBeGreaterThan(0)
  })
})
