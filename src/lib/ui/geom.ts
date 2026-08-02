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

/** The 2D camera: a pan in stage pixels, a scale, and a bearing. Applied as one transform on the world
 *  layer and as one `setTransform` on the canvas, so both renderers read the same four numbers. Here
 *  rather than with the renderer, because the camera is geometry: the preview probes and anything that
 *  scripts a shot need it without pulling a drawing surface in. */
export interface Camera { x: number; y: number; z: number; rot: number }

/** The authored viewBox, padded. The frame every world coordinate is expressed against. */
export interface ViewBox { x: number; y: number; w: number; h: number }

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

/** The closest point ON a polyline, which is generally interior to a segment rather than a vertex.
 *  Nearest-VERTEX is not a usable substitute: the densified trace carries one long segment across
 *  the start/finish line, where the nearest vertex can be three times further away than the true
 *  closest point and sit on a different part of the circuit entirely. */
export function closestPointOnPolyline(p: Vec, pts: Vec[], closed = true): Vec {
  let best = Infinity
  let out = pts[0]
  const last = closed ? pts.length : pts.length - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const l2 = vx * vx + vy * vy
    let t = l2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const qx = a.x + t * vx
    const qy = a.y + t * vy
    const d = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy)
    if (d < best) {
      best = d
      out = { x: qx, y: qy }
    }
  }
  return out
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

// Numeric cell keys. These indexes are queried thousands of times per scenery build, and string
// keys plus a per-query Set were costing more than the exact geometry they were meant to make
// affordable. Coordinates are viewBox units, comfortably inside +/-32768.
const KEY_BIAS = 32768
const key = (cx: number, cy: number) => (cx + KEY_BIAS) * 65536 + (cy + KEY_BIAS)

/** Grid-bucketed polyline, for repeated exact distance queries against the same track centreline.
 *  A linear scan per candidate was the dominant cost of the scenery build; there are thousands of
 *  candidates and only one centreline, so it pays to index it once. */
export function makePolylineIndex(pts: Vec[], cell: number, closed = true) {
  const buckets = new Map<number, number[]>()
  const put = (cx: number, cy: number, i: number) => {
    const k = key(cx, cy)
    const b = buckets.get(k)
    if (b) b.push(i)
    else buckets.set(k, [i])
  }
  const last = closed ? pts.length : pts.length - 1
  let minCx = Infinity
  let maxCx = -Infinity
  let minCy = Infinity
  let maxCy = -Infinity
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
    if (x0 < minCx) minCx = x0
    if (x1 > maxCx) maxCx = x1
    if (y0 < minCy) minCy = y0
    if (y1 > maxCy) maxCy = y1
  }

  // Visit marks instead of a per-query Set: dist() runs thousands of times per build and the
  // allocation dominated the measured cost.
  const stamp = new Int32Array(last)
  let gen = 0

  /** Exact distance from p to the polyline, giving up at `max` and returning it.
   *
   *  The cap is worth having because the ring expansion costs O(k^2) cell lookups for a query k
   *  rings from the polyline: asking "how far is the circuit?" from the middle of an infield is
   *  hundreds of times dearer than asking it from the trackside. A caller that only cares whether a
   *  point is within some band — the elevation field, which grades the ground over a fixed corridor
   *  and leaves everything past it alone — passes that band and pays a fixed handful of lookups for
   *  every point outside it, which is most of the world. Uncapped by default, so a caller that wants
   *  the true distance still gets it. */
  const dist = (p: Vec, max = Infinity): number => {
    // A non-finite query makes every ring bound NaN, so no break condition can ever fire and the
    // expansion spins forever — a silent browser hang on the render path rather than an error.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return Infinity
    const px = Math.floor(p.x / cell)
    const py = Math.floor(p.y / cell)
    // Seeded at the cap rather than at infinity: the break condition below then measures rings
    // against it from the first step, and nothing further away can displace it.
    let best = max
    gen++

    const scan = (cx: number, cy: number) => {
      const b = buckets.get(key(cx, cy))
      if (!b) return
      for (const i of b) {
        if (stamp[i] === gen) continue
        stamp[i] = gen
        const d = distPointToSegment(p, pts[i], pts[(i + 1) % pts.length])
        if (d < best) best = d
      }
    }

    // Start at the first ring that can actually reach the indexed area. A query far outside it
    // (most of the world is far from the pit lane) would otherwise walk every empty ring in between.
    const k0 = Math.max(
      0,
      Math.abs(px - Math.min(Math.max(px, minCx), maxCx)),
      Math.abs(py - Math.min(Math.max(py, minCy), maxCy)),
    )
    // Expand in Chebyshev rings. Any segment stored in ring k sits at least (k-1)*cell away from a
    // point inside the centre cell, so once that bound exceeds the best distance found we can stop.
    for (let k = Math.max(0, k0 - 1); ; k++) {
      if (k > 0 && (k - 1) * cell > best) break
      if (k === 0) scan(px, py)
      else {
        // The ring perimeter only — walking the filled square makes each step O(k^2).
        for (let cx = px - k; cx <= px + k; cx++) {
          scan(cx, py - k)
          scan(cx, py + k)
        }
        for (let cy = py - k + 1; cy <= py + k - 1; cy++) {
          scan(px - k, cy)
          scan(px + k, cy)
        }
      }
      // Once the ring encloses every occupied cell, every segment has been tested.
      if (px - k <= minCx && px + k >= maxCx && py - k <= minCy && py + k >= maxCy) break
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
  const buckets = new Map<number, number[]>()
  const all: Occupant[] = []
  // Visit marks, grown in step with `all`, so a query never allocates.
  let stamp = new Int32Array(64)
  let gen = 0

  const add = (o: Occupant) => {
    const id = all.length
    all.push(o)
    if (id >= stamp.length) {
      const next = new Int32Array(stamp.length * 2)
      next.set(stamp)
      stamp = next
    }
    const x = o.kind === 'obb' ? o.obb.x : o.x
    const y = o.kind === 'obb' ? o.obb.y : o.y
    const r = o.kind === 'obb' ? obbRadius(o.obb) : o.r
    const x0 = Math.floor((x - r) / cell)
    const x1 = Math.floor((x + r) / cell)
    const y0 = Math.floor((y - r) / cell)
    const y1 = Math.floor((y + r) / cell)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy)
        const b = buckets.get(k)
        if (b) b.push(id)
        else buckets.set(k, [id])
      }
    }
  }

  /** Walk every distinct occupant whose cell range meets the query disc, stopping at the first hit. */
  const anyNear = (x: number, y: number, r: number, hit: (o: Occupant) => boolean): boolean => {
    const x0 = Math.floor((x - r) / cell)
    const x1 = Math.floor((x + r) / cell)
    const y0 = Math.floor((y - r) / cell)
    const y1 = Math.floor((y + r) / cell)
    gen++
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = buckets.get(key(cx, cy))
        if (!b) continue
        for (const id of b) {
          if (stamp[id] === gen) continue
          stamp[id] = gen
          if (hit(all[id])) return true
        }
      }
    }
    return false
  }

  return {
    addObb: (obb: Obb) => add({ kind: 'obb', obb }),
    addDisc: (x: number, y: number, r: number) => add({ kind: 'disc', x, y, r }),
    /** True when this footprint would touch anything already claimed, within `pad` clearance. */
    hitsObb(obb: Obb, pad = 0): boolean {
      return anyNear(obb.x, obb.y, obbRadius(obb) + pad, (o) => (
        o.kind === 'obb'
          ? obbOverlap(obb, o.obb, pad)
          : distPointToObb({ x: o.x, y: o.y }, obb) < o.r + pad
      ))
    },
    /** True when this disc would touch anything already claimed, within `pad` clearance. */
    hitsDisc(x: number, y: number, r: number, pad = 0): boolean {
      return anyNear(x, y, r + pad, (o) => (
        o.kind === 'obb'
          ? distPointToObb({ x, y }, o.obb) < r + pad
          : Math.hypot(o.x - x, o.y - y) < o.r + r + pad
      ))
    },
    get count() { return all.length },
  }
}
