// Track outline geometry (#sim-overhaul phase 6). A circuit layout is authored as an ordered list of
// corner points in race direction; this builds a closed SVG path with quadratically rounded corners.
// The path STARTS at the midpoint of the edge from the last point back to the first — author the list so
// that edge is the pit straight, and progress 0 along the path = the start/finish line.

export interface TrackPoint {
  x: number
  y: number
  /** Corner rounding radius in viewBox units. Small = hairpin-tight, large = fast sweep. Default 12. */
  r?: number
}

export interface TrackStart {
  x: number
  y: number
  /** Direction of travel at the S/F line, radians (atan2 convention, y down). */
  angle: number
}

/** A dense projected polyline (from a real GPS trace, see scripts/track-import.ts). Point 0 = the S/F line. */
export type TrackTrace = [number, number][]

/** Build the closed path and S/F pose from an imported trace. Dense points render smooth with round joins. */
export function buildTracePath(trace: TrackTrace): { d: string; start: TrackStart } {
  if (trace.length < 3) throw new Error('a track trace needs at least 3 points')
  const d = `M ${trace.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`
  const [x0, y0] = trace[0]
  const [x1, y1] = trace[1]
  return { d, start: { x: x0, y: y0, angle: Math.atan2(y1 - y0, x1 - x0) } }
}

// ── Procedural pit lane ─────────────────────────────────────────────────────────────────────────────
// A pit lane departs the racing line just before the final corner, runs parallel to the pit straight on
// the INSIDE, and rejoins just after turn 1. Traces are normalised (progress 0 = the S/F line, clockwise),
// so this is constructible from the trace alone: slice the polyline around progress 0, offset it along the
// inward normal (toward the centroid), and taper both ends back onto the racing line.

export interface PitLane {
  d: string
  /** The pit box (stationary hold point), at the lane's midpoint. */
  box: { x: number; y: number }
}

const PIT_ENTRY_FRAC = 0.93 // lap fraction where the lane leaves the racing line
const PIT_EXIT_FRAC = 0.07  // lap fraction (of the next lap) where it rejoins
const PIT_OFFSET = 16       // parallel offset in viewBox units
const PIT_TAPER = 0.18      // fraction of the lane's arc spent blending on/off the racing line

/** Build the pit lane for a trace. `entry`/`exit`/`offset` may be overridden per track if the default reads wrong. */
export function buildPitLane(
  trace: TrackTrace,
  { entry = PIT_ENTRY_FRAC, exit = PIT_EXIT_FRAC, offset = PIT_OFFSET }: { entry?: number; exit?: number; offset?: number } = {},
): PitLane {
  const n = trace.length
  const pt = (i: number): Vec => ({ x: trace[i % n][0], y: trace[i % n][1] })
  // Cumulative arc length at each vertex (closing edge included at index n).
  const cum: number[] = [0]
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + len(sub(pt(i), pt(i - 1))))
  const total = cum[n]

  // A point at arc position s (wrapping), linearly interpolated on its segment.
  const at = (s: number): Vec => {
    const w = ((s % total) + total) % total
    let i = 1
    while (i <= n && cum[i] < w) i++
    const a = pt(i - 1)
    const b = pt(i)
    const seg = cum[i] - cum[i - 1] || 1
    const f = (w - cum[i - 1]) / seg
    return add(a, scale(sub(b, a), f))
  }

  // Sample the slice [entry..1)+[0..exit] densely in travel order.
  const startS = entry * total
  const span = (1 - entry + exit) * total
  const STEPS = 40
  const centroid = scale(trace.reduce((acc, [x, y]) => add(acc, { x, y }), { x: 0, y: 0 }), 1 / n)

  const pts: Vec[] = []
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS
    const s = startS + t * span
    const p = at(s)
    const dir = unit(sub(at(s + 2), at(s - 2)))
    let normal: Vec = { x: dir.y, y: -dir.x }
    if ((centroid.x - p.x) * normal.x + (centroid.y - p.y) * normal.y < 0) normal = scale(normal, -1)
    // Taper the offset in and out so the lane blends onto the racing line at both ends.
    const taper = Math.min(1, Math.min(t, 1 - t) / PIT_TAPER)
    const ease = taper * taper * (3 - 2 * taper)
    pts.push(add(p, scale(normal, offset * ease)))
  }

  const d = `M ${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L ')}`
  const box = pts[Math.round(STEPS / 2)]
  return { d, box: { x: box.x, y: box.y } }
}

const DEFAULT_RADIUS = 12

type Vec = { x: number; y: number }
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const len = (v: Vec) => Math.hypot(v.x, v.y)
const scale = (v: Vec, s: number): Vec => ({ x: v.x * s, y: v.y * s })
const unit = (v: Vec): Vec => scale(v, 1 / (len(v) || 1))
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

/** Build the closed rounded path and the S/F start pose from an authored corner list. */
export function buildTrackPath(points: TrackPoint[]): { d: string; start: TrackStart } {
  if (points.length < 3) throw new Error('a track needs at least 3 corners')
  const n = points.length
  const last = points[n - 1]
  const first = points[0]
  const start: Vec = { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 }
  const dir = unit(sub(first, last))

  let d = `M ${fmt(start.x)} ${fmt(start.y)}`
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const prev = points[(i + n - 1) % n]
    const next = points[(i + 1) % n]
    const inEdge = sub(p, prev)
    const outEdge = sub(next, p)
    // Clamp the radius so adjacent corners can't overlap their roundings.
    const r = Math.min(p.r ?? DEFAULT_RADIUS, len(inEdge) / 2, len(outEdge) / 2)
    const entry = add({ x: p.x, y: p.y }, scale(unit(inEdge), -r))
    const exit = add({ x: p.x, y: p.y }, scale(unit(outEdge), r))
    d += ` L ${fmt(entry.x)} ${fmt(entry.y)} Q ${fmt(p.x)} ${fmt(p.y)} ${fmt(exit.x)} ${fmt(exit.y)}`
  }
  d += ' Z'

  return { d, start: { x: start.x, y: start.y, angle: Math.atan2(dir.y, dir.x) } }
}
