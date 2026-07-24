// The measuring frame every scenery generator works against (#sim-2d): arc-length parameterisation
// of the drawn centreline, outward normals, a corner detector, and the exact clearance tests.
// Split out of track-scenery.ts so that file stays about WHAT gets placed rather than how distance
// to the circuit is computed, and to keep both under the 500-line cap.

import { makePolylineIndex, obbCorners, type Obb, type Vec } from './geom'
import { densifyTrace, type PitLane, type TrackTrace } from './track-path'
import type { TrackFrame } from './scenery-props'

/** Spacing of the corner-detection samples, in viewBox units. */
export const STEP = 4

export interface SceneryFrame {
  /** The densified centreline — the geometry the ribbon is actually stroked along. */
  centreline: Vec[]
  /** Point at arc position s (wrapping). */
  at: (s: number) => Vec
  total: number
  samples: Array<{ p: Vec; t: Vec; nOut: Vec }>
  /** Turn angle at each sample; the corner detector thresholds this. */
  theta: number[]
  /** +1/-1: multiplies the left normal to point away from the circuit's interior. */
  outSign: number
  /** Exact distance from a point to the centreline. */
  trackDist: (p: Vec) => number
  /** Exact distance from a point to the pit lane's box row. */
  pitDist: (p: Vec) => number
  /** Does this footprint keep `clearM` metres between its whole outline and the centreline? */
  obbClearsTrack: (o: Obb, clearM: number, stepM?: number) => boolean
  /** Axis-aligned bounds of the circuit, for cheap far-field rejection. */
  bounds: { x0: number; y0: number; x1: number; y1: number }
  /** The prop builders' view of the track. */
  frame: TrackFrame
}

export function makeSceneryFrame(
  rawTrace: TrackTrace, pit: PitLane, metresPerUnit: number,
): SceneryFrame {
  // Work on the SMOOTHED geometry the ribbon is drawn with — offsets from the raw polyline (kerbs
  // especially) drift off the ribbon's edge in corners.
  const trace = densifyTrace(rawTrace)
  const u = (m: number) => m / metresPerUnit
  const n = trace.length
  const pt = (i: number): Vec => ({ x: trace[i % n][0], y: trace[i % n][1] })
  const cum: number[] = [0]
  for (let i = 1; i <= n; i++) {
    cum.push(cum[i - 1] + Math.hypot(pt(i).x - pt(i - 1).x, pt(i).y - pt(i - 1).y))
  }
  const total = cum[n]
  const at = (s: number): Vec => {
    const w = ((s % total) + total) % total
    let i = 1
    while (i <= n && cum[i] < w) i++
    const a = pt(i - 1)
    const b = pt(i)
    const f = (w - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }

  // The interior side follows the loop's ORIENTATION (shoelace sign), which is exact at every point —
  // a centroid heuristic flips on non-convex circuits where sections fold back near each other.
  const area = trace.reduce((s, p, i) => {
    const q = trace[(i + 1) % n]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0)
  const outSign = area > 0 ? -1 : 1 // clockwise (y-down): interior = (-t.y, t.x), outward negates it

  const samples: Array<{ p: Vec; t: Vec; nOut: Vec }> = []
  for (let s = 0; s < total; s += STEP) {
    const a = at(s - 3)
    const b = at(s + 3)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    samples.push({ p: at(s), t, nOut: { x: outSign * -t.y, y: outSign * t.x } })
  }
  const S = samples.length
  const theta = samples.map((_, i) => {
    const a = samples[(i - 3 + S) % S].t
    const b = samples[(i + 3) % S].t
    let th = Math.abs(Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x))
    if (th > Math.PI) th = 2 * Math.PI - th
    return th
  })

  // Exact distance to the drawn centreline. The old version scanned every SECOND sample of a 4-unit
  // sampling and took the nearest VERTEX, so the smallest value it could return near the track was
  // 4 units — above ~2.6 metres/unit that exceeds the clearance trees are asked for, and they were
  // planted on the racing line. Indexing the polyline makes the exact test cheaper than the broken
  // approximation was.
  const centreline = trace.map(([x, y]) => ({ x, y }))
  const trackIndex = makePolylineIndex(centreline, u(40))
  const trackDist = (p: Vec): number => trackIndex.dist(p)

  // The pit complex is a ~250 m ribbon of garages, boxes and tapers, but scenery used to get only
  // its MIDPOINT and exclude a circle around it. A 120 m radius does not cover +/-125 m of arc, so
  // props were generated on the ends of the pit building. Measure to the lane itself.
  const pitPath = pit.slotStations.length >= 2
    ? pit.slotStations.map((st) => ({ x: st.x, y: st.y }))
    : [pit.box, pit.box]
  const pitIndex = makePolylineIndex(pitPath, u(40), false)

  const obbClearsTrack = (o: Obb, clearM: number, stepM = 6): boolean => {
    const need = u(clearM)
    const dc = trackDist({ x: o.x, y: o.y })
    const rad = Math.hypot(o.w, o.h) / 2
    if (dc - rad >= need) return true // every point of the footprint is within `rad` of the centre
    if (dc < need) return false // the centre alone is already too close
    const cs = obbCorners(o)
    for (let i = 0; i < 4; i++) {
      const a = cs[i]
      const b = cs[(i + 1) % 4]
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / u(stepM)))
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        if (trackDist({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) < need) return false
      }
    }
    return true
  }

  const bounds = centreline.reduce(
    (b, p) => ({
      x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y),
      x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  )

  const tangentAt = (s: number): Vec => {
    const q0 = at(s - 2)
    const q1 = at(s + 2)
    const len = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1
    return { x: (q1.x - q0.x) / len, y: (q1.y - q0.y) / len }
  }

  return {
    centreline,
    at,
    total,
    samples,
    theta,
    outSign,
    trackDist,
    pitDist: (p) => pitIndex.dist(p),
    obbClearsTrack,
    bounds,
    frame: {
      at,
      total,
      u,
      tangentAt,
      normalAt: (s) => {
        const t = tangentAt(s)
        return { x: outSign * -t.y, y: outSign * t.x }
      },
    },
  }
}
