// #sim-2d — oblique extrusion. The bugs these pin were all VISIBLE ones that no amount of correct
// arithmetic elsewhere would have caught: a solid rendering as a hollow shell, a wall rendering as a
// second staggered copy of the roof, and every diagonal edge coming out as a staircase.

import { describe, it, expect } from 'vitest'
import { buildingParts } from './scenery-shapes'
import {
  partsPath, quad, ringArea, ringPath, sweptRing, sweptHull, sideFacesX, rakedStand, ribbon,
  posts, mapPathPoints, obliqueRingFaces, wallWindows,
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

describe('mapPathPoints', () => {
  it('rewrites every coordinate pair, including both of a Q', () => {
    const out = mapPathPoints('M 1 2 Q 3 4 5 6 Z', (x, y) => ({ x: x + 10, y: y * 2 }))
    expect(out).toBe('M 11.00 4.00 Q 13.00 8.00 15.00 12.00 Z')
  })

  it('round-trips an identity transform', () => {
    const d = 'M 0 0 L 10 0 Q 12 4 10 8 Z'
    expect(mapPathPoints(d, (x, y) => ({ x, y }))).toBe('M 0.00 0.00 L 10.00 0.00 Q 12.00 4.00 10.00 8.00 Z')
  })

  it('handles the multi-subpath output the blob emitters produce', () => {
    const out = mapPathPoints('M 0 0 L 1 1 Z M 5 5 L 6 6 Z', (x, y) => ({ x: -x, y: -y }))
    expect(out.match(/Z/g)).toHaveLength(2)
    expect(out).toContain('-5.00 -5.00')
  })

  it('resolves a shorthand into an absolute line, since the transform is not axis-aligned', () => {
    // A horizontal run stops being horizontal once mapped through a rotation, so `h` cannot survive as
    // `h`. Leaving it unsupported meant any group carrying one could never be batched.
    expect(mapPathPoints('M 0 0 h 10 Z', (x, y) => ({ x, y }))).toBe('M 0.00 0.00 L 10.00 0.00 Z')
    expect(mapPathPoints('M 0 0 v 4 Z', (x, y) => ({ x, y }))).toBe('M 0.00 0.00 L 0.00 4.00 Z')
    // Relative accumulates from the cursor; absolute does not.
    expect(mapPathPoints('M 1 1 h 2 h 3', (x, y) => ({ x, y }))).toBe('M 1.00 1.00 L 3.00 1.00 L 6.00 1.00')
    expect(mapPathPoints('M 1 1 H 2 H 3', (x, y) => ({ x, y }))).toBe('M 1.00 1.00 L 2.00 1.00 L 3.00 1.00')
  })

  it('accepts a shorthand written without a space, which hand-authored paths do', () => {
    expect(mapPathPoints('M0 0h10v5Z', (x, y) => ({ x, y }))).toBe('M 0.00 0.00 L 10.00 0.00 L 10.00 5.00 Z')
  })

  it('returns the cursor to the subpath start on Z, so a following run measures from there', () => {
    expect(mapPathPoints('M 5 5 h 3 Z h 2', (x, y) => ({ x, y }))).toBe('M 5.00 5.00 L 8.00 5.00 Z L 7.00 5.00')
  })

  it('carries the shorthand through the transform like any other point', () => {
    // Offset by ten: the resolved endpoint has to move with everything else.
    expect(mapPathPoints('M 0 0 h 10', (x, y) => ({ x: x + 10, y: y + 10 }))).toBe('M 10.00 10.00 L 20.00 10.00')
  })

  it('still refuses a command it genuinely cannot transform', () => {
    expect(() => mapPathPoints('M 0 0 c 1 1 2 2 3 3', (x, y) => ({ x, y }))).toThrow(/unsupported/)
  })
})

describe('ringPath / sweptRing', () => {
  // A square, wound the OPPOSITE way to the `partsPath` convention, to prove normalisation.
  const sq: Vec[] = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }]
  // Concave: a square with a notch bitten out of its -y edge.
  const notched: Vec[] = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 6, y: 4 },
    { x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]

  it('normalises winding to the partsPath convention, so nonzero fill unions', () => {
    expect(ringArea(parseRing(ringPath(sq)))).toBeLessThanOrEqual(0)
    expect(ringArea(parseRing(ringPath([...sq].reverse())))).toBeLessThanOrEqual(0)
  })

  it('emits every subpath in that same winding, or the walls punch holes in the roof', () => {
    for (const ring of parseAll(sweptRing(notched, 6, 6))) {
      expect(ringArea(ring)).toBeLessThanOrEqual(0)
    }
  })

  it('degenerates to the flat ring when there is no offset', () => {
    expect(sweptRing(sq, 0, 0)).toBe(ringPath(sq))
    expect(sweptRing([{ x: 0, y: 0 }, { x: 1, y: 1 }], 3, 3)).toBe('')
  })

  it('skips back-facing edges — on a concave ring their quads escape through the wall', () => {
    // The notch's two side walls face opposite ways in x, so exactly one can face any sweep.
    const right = parseAll(sweptRing(notched, 6, 6)).length
    const left = parseAll(sweptRing(notched, -6, 6)).length
    expect(right).toBeGreaterThan(2) // roof + base + at least one face
    expect(left).toBeGreaterThan(2)
    // Every emitted face must genuinely face the sweep.
    const r = parseRing(ringPath(notched))
    for (let i = 0; i < r.length; i++) {
      const p = r[i]
      const q = r[(i + 1) % r.length]
      const faces = (q.y - p.y) * 6 - (q.x - p.x) * 6 > 0
      const has = sweptRing(notched, 6, 6).includes(`${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${q.x.toFixed(2)} ${q.y.toFixed(2)}`)
        || sweptRing(notched, 6, 6).includes(`${q.x.toFixed(2)} ${q.y.toFixed(2)} L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      if (!faces) continue
      expect(has, `edge ${i} faces the sweep but no quad was emitted`).toBe(true)
    }
  })

  it('spans from the top ring to the base ring', () => {
    const d = sweptRing(sq, 5, 7)
    const ys = parseAll(d).flat().map((p) => p.y)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(17, 6)
  })
})

/** Every subpath of a path built from absolute M/L/Z, as rings. */
function parseAll(d: string): Vec[][] {
  return d.split('M').filter((s) => s.trim()).map((s) => parseRing(`M${s}`))
}

function parseRing(d: string): Vec[] {
  const n = d.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number)
  const out: Vec[] = []
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] })
  return out
}

describe('obliqueRingFaces', () => {
  const sq: Vec[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]

  it('picks out the faces angled away from the sweep, and only those', () => {
    // Sweeping mostly down: the square's bottom edge is nearly square-on to it and its right edge is
    // nearly edge-on, so exactly one of the two visible faces is oblique.
    expect(parseAll(obliqueRingFaces(sq, 1, 9)).length).toBe(1)
    // A cut below even that face's angle leaves nothing oblique at all.
    expect(obliqueRingFaces(sq, 1, 9, 0.05)).toBe('')
  })

  it('splits a 45-degree sweep the same way every time, not on a floating-point coin toss', () => {
    expect(obliqueRingFaces(sq, 5, 5)).toBe('')
  })

  it('is a strict subset of the faces sweptRing draws, so the overlay never spills', () => {
    const hull = sweptRing(sq, 2, 7)
    for (const ring of parseAll(obliqueRingFaces(sq, 2, 7))) {
      const key = ring.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')
      expect(hull).toContain(key)
    }
  })

  it('emits nothing without a sweep', () => {
    expect(obliqueRingFaces(sq, 0, 0)).toBe('')
  })
})

describe('wallWindows', () => {
  // The bug this pins was visible, not arithmetic: windows from two parts of one footprint overlapped
  // in projection and unioned under `nonzero` into stepped chevrons and plus signs.
  it('never overlaps two windows, for any archetype at any sweep', () => {
    for (let type = 0; type < 10; type++) {
      const parts = buildingParts(type, 44, 32)
      for (const [ox, oy] of [[6, 6], [-6, 6], [6, -6], [-6, -6], [0, 7], [7, 0]]) {
        const quads = parseAll(wallWindows(parts, ox, oy, 5, 2))
        for (let i = 0; i < quads.length; i++) {
          for (let j = i + 1; j < quads.length; j++) {
            expect(overlaps(quads[i], quads[j]), `type ${type} sweep ${ox},${oy}: windows ${i}/${j} overlap`).toBe(false)
          }
        }
      }
    }
  })

  it('lays windows IN the wall plane, so every one is a translate of the same parallelogram', () => {
    const quads = parseAll(wallWindows([{ dx: 0, dy: 0, w: 40, h: 40 }], 8, 3, 5, 2))
    expect(quads.length).toBeGreaterThan(3)
    // Two edge directions only (one per visible face), never the map's axes by accident.
    const dirs = new Set(quads.map((q) => {
      const a = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x)
      return (Math.round((a * 180) / Math.PI) + 360) % 180
    }))
    expect(dirs.size).toBeLessThanOrEqual(2)
  })

  it('emits nothing when asked for no rows, no bay or no sweep', () => {
    const parts = [{ dx: 0, dy: 0, w: 40, h: 40 }]
    expect(wallWindows(parts, 8, 3, 5, 0)).toBe('')
    expect(wallWindows(parts, 8, 3, 0, 2)).toBe('')
    expect(wallWindows(parts, 0, 0, 5, 2)).toBe('')
  })
})

/** Convex overlap by separating axis, with a tolerance so a shared edge does not count. */
function overlaps(a: Vec[], b: Vec[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const nx = q.y - p.y
      const ny = -(q.x - p.x)
      const len = Math.hypot(nx, ny)
      if (len < 1e-9) continue
      const proj = (r: Vec[]) => r.map((v) => (v.x * nx + v.y * ny) / len)
      const pa = proj(a)
      const pb = proj(b)
      if (Math.min(...pa) >= Math.max(...pb) - 1e-6 || Math.min(...pb) >= Math.max(...pa) - 1e-6) return false
    }
  }
  return true
}
