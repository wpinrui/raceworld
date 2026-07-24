// #sim-2d — spatial primitives behind every scenery clearance rule. The cases below are the exact
// failures the old hand-rolled tests had: rotation-blind box checks, circumscribed-circle overlap,
// and nearest-VERTEX distance that skipped the gap between samples.

import { describe, it, expect } from 'vitest'
import {
  distPointToSegment, distToPolyline, obbCorners, obbRadius, distPointToObb, obbOverlap,
  pointInRing, makePolylineIndex, makeOccupancy, closestPointOnPolyline, type Obb,
} from './geom'

const P = (x: number, y: number) => ({ x, y })

describe('distPointToSegment', () => {
  it('projects onto the interior of a segment', () => {
    expect(distPointToSegment(P(5, 3), P(0, 0), P(10, 0))).toBeCloseTo(3, 9)
  })

  it('clamps past either end rather than using the infinite line', () => {
    // The infinite line through these points is y=0, so an unclamped projection would say 3.
    expect(distPointToSegment(P(14, 3), P(0, 0), P(10, 0))).toBeCloseTo(5, 9)
    expect(distPointToSegment(P(-4, 3), P(0, 0), P(10, 0))).toBeCloseTo(5, 9)
  })

  it('handles a degenerate zero-length segment', () => {
    expect(distPointToSegment(P(3, 4), P(0, 0), P(0, 0))).toBeCloseTo(5, 9)
  })
})

describe('distToPolyline', () => {
  // A point midway between two vertices is the case that broke the old nearest-vertex scan: it
  // measured the distance to the VERTICES (5) instead of to the segment between them (0).
  const line = [P(0, 0), P(10, 0), P(20, 0)]

  it('measures to the nearest segment, not the nearest vertex', () => {
    expect(distToPolyline(P(5, 0), line, false)).toBeCloseTo(0, 9)
    expect(distToPolyline(P(15, 2), line, false)).toBeCloseTo(2, 9)
  })

  it('closes the ring when asked', () => {
    const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)]
    // The closing edge runs from (0,10) back to (0,0); a point beside its midpoint is 2 away.
    expect(distToPolyline(P(2, 5), square, true)).toBeCloseTo(2, 9)
    // Open, that edge does not exist, so the nearest is the top or bottom edge at 5.
    expect(distToPolyline(P(2, 5), square, false)).toBeCloseTo(5, 9)
  })
})

describe('obbCorners / obbRadius', () => {
  it('returns the axis-aligned corners when unrotated', () => {
    expect(obbCorners({ x: 0, y: 0, w: 4, h: 2, rot: 0 })).toEqual([
      P(-2, -1), P(2, -1), P(2, 1), P(-2, 1),
    ])
  })

  it('rotates a quarter turn correctly', () => {
    const c = obbCorners({ x: 0, y: 0, w: 4, h: 2, rot: Math.PI / 2 })
    expect(c[0].x).toBeCloseTo(1, 9)
    expect(c[0].y).toBeCloseTo(-2, 9)
  })

  it('reports the half-diagonal', () => {
    expect(obbRadius({ x: 0, y: 0, w: 6, h: 8, rot: 1.2 })).toBeCloseTo(5, 9)
  })
})

describe('distPointToObb', () => {
  const box: Obb = { x: 0, y: 0, w: 10, h: 4, rot: 0 }

  it('is zero inside', () => {
    expect(distPointToObb(P(3, 1), box)).toBe(0)
  })

  it('measures perpendicular to an edge', () => {
    expect(distPointToObb(P(0, 5), box)).toBeCloseTo(3, 9)
  })

  it('measures to a corner diagonally', () => {
    expect(distPointToObb(P(8, 5), box)).toBeCloseTo(Math.hypot(3, 3), 9)
  })

  it('follows the rectangle when it rotates', () => {
    // Rotated 90deg the long axis is vertical, so a point above is now only 1 unit clear.
    const turned: Obb = { x: 0, y: 0, w: 10, h: 4, rot: Math.PI / 2 }
    expect(distPointToObb(P(0, 6), turned)).toBeCloseTo(1, 9)
    expect(distPointToObb(P(6, 0), turned)).toBeCloseTo(4, 9)
  })
})

describe('obbOverlap', () => {
  const a: Obb = { x: 0, y: 0, w: 10, h: 10, rot: 0 }

  it('detects a plain overlap and a plain miss', () => {
    expect(obbOverlap(a, { x: 5, y: 5, w: 10, h: 10, rot: 0 })).toBe(true)
    expect(obbOverlap(a, { x: 30, y: 0, w: 10, h: 10, rot: 0 })).toBe(false)
  })

  it('separates boxes that a circumscribed-circle test would reject', () => {
    // This is bug F: a 90x14 stand has a half-diagonal of ~45, so a circle test rejects anything
    // within 45 units even directly off its narrow side, where the true clearance is ~13.
    const stand: Obb = { x: 0, y: 0, w: 90, h: 14, rot: 0 }
    const shed: Obb = { x: 0, y: 20, w: 16, h: 12, rot: 0 }
    expect(Math.hypot(stand.w, stand.h) / 2).toBeGreaterThan(20) // a circle test would collide
    expect(obbOverlap(stand, shed)).toBe(false) // the true footprints are 7 apart
  })

  it('catches a rotated overlap an axis-aligned test would miss', () => {
    // This is bug A: the old tree test compared |dx| and |dy| against the UNROTATED half-extents.
    const stand: Obb = { x: 0, y: 0, w: 90, h: 14, rot: Math.PI / 4 }
    const probe: Obb = { x: 25, y: 25, w: 2, h: 2, rot: 0 }
    expect(Math.abs(probe.y - stand.y) > stand.h / 2).toBe(true) // the old test cleared it
    expect(obbOverlap(stand, probe)).toBe(true) // it is squarely on the stand
  })

  it('honours the clearance pad', () => {
    const near: Obb = { x: 14, y: 0, w: 10, h: 10, rot: 0 }
    expect(obbOverlap(a, near)).toBe(false) // 4 units apart
    expect(obbOverlap(a, near, 6)).toBe(true) // but not 6 units clear
  })
})

describe('pointInRing', () => {
  const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)]

  it('separates inside from outside', () => {
    expect(pointInRing(P(5, 5), square)).toBe(true)
    expect(pointInRing(P(15, 5), square)).toBe(false)
    expect(pointInRing(P(5, -1), square)).toBe(false)
  })

  it('handles a concave ring', () => {
    const u = [P(0, 0), P(10, 0), P(10, 10), P(7, 10), P(7, 3), P(3, 3), P(3, 10), P(0, 10)]
    expect(pointInRing(P(5, 1), u)).toBe(true)
    expect(pointInRing(P(5, 7), u)).toBe(false) // in the notch
  })
})

describe('makePolylineIndex', () => {
  // A long straight run: the index must agree with the brute-force answer everywhere, including
  // points far outside the indexed area and points sitting exactly on the line.
  const pts = Array.from({ length: 60 }, (_, i) => P(i * 8, 0))

  it('matches brute force at sampled points, including between vertices', () => {
    const idx = makePolylineIndex(pts, 16, false)
    for (const p of [P(0, 0), P(4, 0), P(4, 3), P(100, 25), P(-50, 5), P(479, 1), P(200, 400)]) {
      expect(idx.dist(p)).toBeCloseTo(distToPolyline(p, pts, false), 6)
    }
  })

  it('returns zero on the line between two vertices', () => {
    // The old sampled scan could not return less than half the sample spacing here — the root of
    // trees being planted on the racing line.
    const idx = makePolylineIndex(pts, 16, false)
    expect(idx.dist(P(4, 0))).toBeCloseTo(0, 9)
  })

  it('matches brute force on a closed ring', () => {
    const ring = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2
      return P(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50)
    })
    const idx = makePolylineIndex(ring, 20, true)
    for (const p of [P(100, 100), P(150, 100), P(100, 20), P(0, 0), P(300, 300)]) {
      expect(idx.dist(p)).toBeCloseTo(distToPolyline(p, ring, true), 6)
    }
  })
})

describe('makeOccupancy', () => {
  it('rejects a disc overlapping a claimed footprint', () => {
    const occ = makeOccupancy(20)
    // Footprint spans y in [-5, 5], so a centre at y=8 is 3 clear of the edge.
    occ.addObb({ x: 0, y: 0, w: 40, h: 10, rot: 0 })
    expect(occ.hitsDisc(0, 0, 1)).toBe(true) // dead centre
    expect(occ.hitsDisc(0, 8, 4)).toBe(true) // a 4-radius canopy overhangs the edge
    expect(occ.hitsDisc(0, 8, 1)).toBe(false) // a 1-radius one does not
    expect(occ.hitsDisc(0, 20, 1)).toBe(false)
  })

  it('accounts for the canopy radius, not just the centre', () => {
    // Bug B: the old test compared the tree's CENTRE against a fixed margin, then drew a canopy of
    // up to 6.8 m on top of whatever it had cleared.
    const occ = makeOccupancy(20)
    occ.addObb({ x: 0, y: 0, w: 40, h: 10, rot: 0 })
    expect(occ.hitsDisc(0, 9, 0.5)).toBe(false)
    expect(occ.hitsDisc(0, 9, 5)).toBe(true)
  })

  it('respects rotation when testing a disc', () => {
    const occ = makeOccupancy(20)
    occ.addObb({ x: 0, y: 0, w: 60, h: 10, rot: Math.PI / 2 })
    expect(occ.hitsDisc(0, 20, 1)).toBe(true) // now the long axis
    expect(occ.hitsDisc(20, 0, 1)).toBe(false)
  })

  it('rejects overlapping footprints and separates disjoint ones', () => {
    const occ = makeOccupancy(20)
    occ.addObb({ x: 0, y: 0, w: 20, h: 20, rot: 0 })
    expect(occ.hitsObb({ x: 10, y: 0, w: 20, h: 20, rot: 0 })).toBe(true)
    expect(occ.hitsObb({ x: 40, y: 0, w: 20, h: 20, rot: 0 })).toBe(false)
  })

  it('keeps discs apart from each other', () => {
    const occ = makeOccupancy(10)
    occ.addDisc(0, 0, 5)
    expect(occ.hitsDisc(6, 0, 2)).toBe(true)
    expect(occ.hitsDisc(9, 0, 2)).toBe(false)
  })

  it('finds neighbours across grid cell boundaries', () => {
    // A naive single-cell lookup misses anything claimed just over the boundary.
    const occ = makeOccupancy(10)
    occ.addDisc(9.5, 9.5, 2)
    expect(occ.hitsDisc(10.5, 10.5, 2)).toBe(true)
  })

  it('counts what it holds', () => {
    const occ = makeOccupancy(10)
    occ.addDisc(0, 0, 1)
    occ.addObb({ x: 50, y: 50, w: 4, h: 4, rot: 0 })
    expect(occ.count).toBe(2)
  })
})

describe('closestPointOnPolyline', () => {
  it('lands inside a long segment, not on its endpoints', () => {
    // The densified track carries one long segment across the start/finish line; a nearest-VERTEX
    // search there returns a point on a different part of the circuit.
    const long = [P(0, 0), P(200, 0), P(200, 200)]
    const q = closestPointOnPolyline(P(100, 30), long, false)
    expect(q.x).toBeCloseTo(100, 9)
    expect(q.y).toBeCloseTo(0, 9)
  })

  it('agrees with distToPolyline', () => {
    const ring = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)]
    for (const p of [P(50, 20), P(-10, 50), P(130, 130), P(50, 50)]) {
      const q = closestPointOnPolyline(p, ring)
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(distToPolyline(p, ring), 6)
    }
  })
})
