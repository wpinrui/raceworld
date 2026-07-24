// Shared 2D spatial primitives for the race map's procedural world (#sim-2d).
// Before this, every clearance test was hand-rolled per prop type: nearest-VERTEX scans that skipped
// samples (so props could be planted on the track between two tested points), circumscribed-circle
// overlap (wildly wrong for a 95x17 m grandstand), and axis-aligned box tests applied to ROTATED
// rectangles. These are the exact versions, plus a uniform-grid broadphase so precision costs less
// than the approximations did.
// All units are viewBox units — callers convert metres through their own u().

export type Vec = { x: number; y: number }

/** An oriented (rotated) rectangle: centre, overall size, rotation in radians. */
export interface Obb { x: number; y: number; w: number; h: number; rot: number }

/** Exact distance from a point to a segment, clamped to the segment's ends. */
export function distPointToSegment(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

/** Exact distance from a point to a polyline. `closed` wraps the last vertex back to the first. */
export function distToPolyline(p: Vec, pts: Vec[], closed = true): number {
  let best = Infinity
  const last = closed ? pts.length : pts.length - 1
  for (let i = 0; i < last; i++) {
    const d = distPointToSegment(p, pts[i], pts[(i + 1) % pts.length])
    if (d < best) best = d
  }
  return best
}

/** The four world-space corners, in local order (-,-) (+,-) (+,+) (-,+). */
export function obbCorners(r: Obb): Vec[] {
  const c = Math.cos(r.rot)
  const s = Math.sin(r.rot)
  const hw = r.w / 2
  const hh = r.h / 2
  const out: Vec[] = []
  for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    out.push({ x: r.x + lx * c - ly * s, y: r.y + lx * s + ly * c })
  }
  return out
}

/** Bounding radius of an Obb — the half-diagonal. Used only for grid bucketing, never for overlap. */
export function obbRadius(r: Obb): number {
  return Math.hypot(r.w, r.h) / 2
}

/** Distance from a point to a rotated rectangle; 0 when the point is inside. */
export function distPointToObb(p: Vec, r: Obb): number {
  // Rotate the point into the rect's local frame, then it's a plain axis-aligned test.
  const c = Math.cos(-r.rot)
  const s = Math.sin(-r.rot)
  const dx = p.x - r.x
  const dy = p.y - r.y
  const lx = dx * c - dy * s
  const ly = dx * s + dy * c
  const ox = Math.abs(lx) - r.w / 2
  const oy = Math.abs(ly) - r.h / 2
  if (ox <= 0 && oy <= 0) return 0
  return Math.hypot(ox > 0 ? ox : 0, oy > 0 ? oy : 0)
}

/** Separating-axis test between two rotated rectangles. `pad` is extra clearance required between
 *  them: they count as overlapping unless some axis separates them by more than `pad`. */
export function obbOverlap(a: Obb, b: Obb, pad = 0): boolean {
  const ca = obbCorners(a)
  const cb = obbCorners(b)
  // A rectangle's edge normals are just its two axes, so four candidate axes total.
  for (const [p, q] of [[ca, cb], [cb, ca]] as const) {
    for (let i = 0; i < 2; i++) {
      const ax = p[i + 1].x - p[i].x
      const ay = p[i + 1].y - p[i].y
      const len = Math.hypot(ax, ay) || 1
      const nx = -ay / len
      const ny = ax / len
      let minP = Infinity
      let maxP = -Infinity
      let minQ = Infinity
      let maxQ = -Infinity
      for (const v of p) {
        const d = v.x * nx + v.y * ny
        if (d < minP) minP = d
        if (d > maxP) maxP = d
      }
      for (const v of q) {
        const d = v.x * nx + v.y * ny
        if (d < minQ) minQ = d
        if (d > maxQ) maxQ = d
      }
      if (maxP + pad < minQ || maxQ + pad < minP) return false
    }
  }
  return true
}

/** Even-odd ray cast. `ring` is an implicitly closed polygon. */
export function pointInRing(p: Vec, ring: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

const key = (cx: number, cy: number) => `${cx},${cy}`

/** Grid-bucketed polyline, for repeated exact distance queries against the same track centreline.
 *  A linear scan per candidate was the dominant cost of the scenery build; there are thousands of
 *  candidates and only one centreline, so it pays to index it once. */
export function makePolylineIndex(pts: Vec[], cell: number, closed = true) {
  const buckets = new Map<string, number[]>()
  const put = (cx: number, cy: number, i: number) => {
    const k = key(cx, cy)
    const b = buckets.get(k)
    if (b) b.push(i)
    else buckets.set(k, [i])
  }
  const last = closed ? pts.length : pts.length - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    // Bucket by the segment's bounding box: cheap, and a segment spanning many cells is rare here
    // because the trace is densified to a few units per step.
    const x0 = Math.floor(Math.min(a.x, b.x) / cell)
    const x1 = Math.floor(Math.max(a.x, b.x) / cell)
    const y0 = Math.floor(Math.min(a.y, b.y) / cell)
    const y1 = Math.floor(Math.max(a.y, b.y) / cell)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) put(cx, cy, i)
  }

  /** Exact distance from p to the polyline. */
  const dist = (p: Vec): number => {
    const px = Math.floor(p.x / cell)
    const py = Math.floor(p.y / cell)
    let best = Infinity
    const seen = new Set<number>()
    // Expand in Chebyshev rings. Any segment stored in ring k sits at least (k-1)*cell away from a
    // point inside the centre cell, so once that bound exceeds the best distance found we can stop.
    for (let k = 0; ; k++) {
      if (k > 0 && (k - 1) * cell > best) break
      let any = false
      for (let cx = px - k; cx <= px + k; cx++) {
        for (let cy = py - k; cy <= py + k; cy++) {
          // Ring only: skip the interior, already visited on an earlier pass.
          if (k > 0 && Math.abs(cx - px) !== k && Math.abs(cy - py) !== k) continue
          const b = buckets.get(key(cx, cy))
          if (!b) continue
          any = true
          for (const i of b) {
            if (seen.has(i)) continue
            seen.add(i)
            const d = distPointToSegment(p, pts[i], pts[(i + 1) % pts.length])
            if (d < best) best = d
          }
        }
      }
      // Guard against an unbounded walk when the point is far outside the indexed area.
      if (!any && best === Infinity && k > 512) break
    }
    return best
  }

  return { dist }
}

/** Anything that occupies ground: a rotated footprint, or a disc (tree canopy, mast, post). */
type Occupant = { kind: 'obb'; obb: Obb } | { kind: 'disc'; x: number; y: number; r: number }

/** Occupancy registry with a uniform-grid broadphase. Every generator claims what it places and
 *  tests against everything already claimed, so overlap rules are one shared invariant rather than
 *  a different ad-hoc test per prop type. */
export function makeOccupancy(cell: number) {
  const buckets = new Map<string, Occupant[]>()
  const all: Occupant[] = []

  const cellsFor = (x: number, y: number, r: number) => {
    const x0 = Math.floor((x - r) / cell)
    const x1 = Math.floor((x + r) / cell)
    const y0 = Math.floor((y - r) / cell)
    const y1 = Math.floor((y + r) / cell)
    return { x0, x1, y0, y1 }
  }

  const add = (o: Occupant) => {
    all.push(o)
    const [x, y, r] = o.kind === 'obb'
      ? [o.obb.x, o.obb.y, obbRadius(o.obb)]
      : [o.x, o.y, o.r]
    const { x0, x1, y0, y1 } = cellsFor(x, y, r)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy)
        const b = buckets.get(k)
        if (b) b.push(o)
        else buckets.set(k, [o])
      }
    }
  }

  const near = (x: number, y: number, r: number): Occupant[] => {
    const { x0, x1, y0, y1 } = cellsFor(x, y, r)
    const out = new Set<Occupant>()
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = buckets.get(key(cx, cy))
        if (b) for (const o of b) out.add(o)
      }
    }
    return [...out]
  }

  return {
    addObb: (obb: Obb) => add({ kind: 'obb', obb }),
    addDisc: (x: number, y: number, r: number) => add({ kind: 'disc', x, y, r }),
    /** True when this footprint would touch anything already claimed, within `pad` clearance. */
    hitsObb(obb: Obb, pad = 0): boolean {
      for (const o of near(obb.x, obb.y, obbRadius(obb) + pad)) {
        if (o.kind === 'obb') {
          if (obbOverlap(obb, o.obb, pad)) return true
        } else if (distPointToObb({ x: o.x, y: o.y }, obb) < o.r + pad) return true
      }
      return false
    },
    /** True when this disc would touch anything already claimed, within `pad` clearance. */
    hitsDisc(x: number, y: number, r: number, pad = 0): boolean {
      for (const o of near(x, y, r + pad)) {
        if (o.kind === 'obb') {
          if (distPointToObb({ x, y }, o.obb) < r + pad) return true
        } else if (Math.hypot(o.x - x, o.y - y) < o.r + r + pad) return true
      }
      return false
    },
    get count() { return all.length },
  }
}

export type Occupancy = ReturnType<typeof makeOccupancy>
