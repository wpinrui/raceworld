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

/** Smooth open polyline: quadratic curves through midpoints, endpoints kept exactly. */
export function smoothOpenPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 3) return `M ${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L ')}`
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2
    const my = (pts[i].y + pts[i + 1].y) / 2
    d += ` Q ${fmt(pts[i].x)} ${fmt(pts[i].y)} ${fmt(mx)} ${fmt(my)}`
  }
  const last = pts[pts.length - 1]
  return `${d} L ${fmt(last.x)} ${fmt(last.y)}`
}

/** Build the closed path and S/F pose from an imported trace, smoothing every vertex with quadratic
 * curves through segment midpoints (raw GPS polylines read jagged under zoom). The path still starts
 * exactly at trace[0] — the S/F line — which sits on the straight, so its two tiny line joins vanish. */
export function buildTracePath(trace: TrackTrace): { d: string; start: TrackStart } {
  if (trace.length < 3) throw new Error('a track trace needs at least 3 points')
  const n = trace.length
  const p = (i: number) => ({ x: trace[i % n][0], y: trace[i % n][1] })
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const p0 = p(0)
  const m01 = mid(p0, p(1))
  let d = `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(m01.x)} ${fmt(m01.y)}`
  for (let i = 1; i < n; i++) {
    const m = mid(p(i), p(i + 1))
    d += ` Q ${fmt(p(i).x)} ${fmt(p(i).y)} ${fmt(m.x)} ${fmt(m.y)}`
  }
  d += ` L ${fmt(p0.x)} ${fmt(p0.y)} Z`
  const p1 = p(1)
  return { d, start: { x: p0.x, y: p0.y, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x) } }
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
  /** Painted lane edge lines, running through the tapers so the merge reads as a marked lane. */
  edges: string[]
  /** The pit wall separating the lane from the track. */
  wall: string
  /** Individual painted pit-box slots along the lane. */
  slots: Array<{ x: number; y: number; rot: number }>
  /** Hatched keep-clear wedges where the lane splits from / rejoins the track. */
  hatches: string[]
}

export const PIT_ENTRY_FRAC = 0.93 // lap fraction where the lane leaves the racing line
export const PIT_EXIT_FRAC = 0.07  // lap fraction (of the next lap) where it rejoins
const PIT_OFFSET = 16       // parallel offset in viewBox units
const PIT_TAPER = 0.18      // fraction of the lane's arc spent blending on/off the racing line

/** Build the pit lane for a trace. `entry`/`exit`/`offset` may be overridden per track if the default reads wrong. */
export function buildPitLane(
  trace: TrackTrace,
  {
    entry = PIT_ENTRY_FRAC, exit = PIT_EXIT_FRAC, offset = PIT_OFFSET, metresPerUnit = 2.2,
  }: { entry?: number; exit?: number; offset?: number; metresPerUnit?: number } = {},
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

  // Sample the slice [entry..1)+[0..exit] densely in travel order. The inward side follows the loop's
  // orientation (shoelace sign) — exact everywhere, unlike a centroid heuristic on non-convex circuits.
  const startS = entry * total
  const span = (1 - entry + exit) * total
  const STEPS = 40
  const area = trace.reduce((s, p, i) => {
    const q = trace[(i + 1) % n]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0)
  const inSign = area > 0 ? 1 : -1 // clockwise (y-down): interior normal = (-dir.y, dir.x)

  const pts: Vec[] = []
  const uu = (m: number) => m / metresPerUnit
  const stations: Array<{ p: Vec; normal: Vec; dir: Vec; ease: number }> = []
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS
    const s = startS + t * span
    const p = at(s)
    const dir = unit(sub(at(s + 2), at(s - 2)))
    const normal: Vec = { x: inSign * -dir.y, y: inSign * dir.x }
    // Taper the offset in and out so the lane blends onto the racing line at both ends.
    const taper = Math.min(1, Math.min(t, 1 - t) / PIT_TAPER)
    const ease = taper * taper * (3 - 2 * taper)
    pts.push(add(p, scale(normal, offset * ease)))
    stations.push({ p, normal, dir, ease })
  }

  const d = smoothOpenPath(pts)
  const box = pts[Math.round(STEPS / 2)]

  // Painted detail: edge lines along the whole marked lane (tapers included), the pit wall between
  // lane and track, ten pit-box slots on the lane's outer half, and hatched keep-clear wedges in the
  // mouths where the lane splits from / rejoins the track.
  const all = stations.map((st, k) => ({ ...st, ctr: pts[k], k }))
  const marked = all.filter((st) => st.ease > 0.15)
  const straight = all.filter((st) => st.ease > 0.999)
  const edgeHalf = uu(3.1)
  const edges = [
    smoothOpenPath(marked.map((st) => sub(st.ctr, scale(st.normal, edgeHalf)))),
    smoothOpenPath(marked.map((st) => add(st.ctr, scale(st.normal, edgeHalf)))),
  ]
  const wall = smoothOpenPath(all.filter((st) => st.ease > 0.85).map((st) => add(st.p, scale(st.normal, uu(9)))))

  const slots: PitLane['slots'] = []
  const SLOT_COUNT = 10
  for (let i = 0; i < SLOT_COUNT; i++) {
    const f = (i + 0.5) / SLOT_COUNT
    const st = straight[Math.min(straight.length - 1, Math.round(f * (straight.length - 1)))]
    const c = add(st.ctr, scale(st.normal, uu(1.6)))
    slots.push({ x: c.x, y: c.y, rot: Math.atan2(st.dir.y, st.dir.x) })
  }

  // Hatch wedges: the area between the lane's track-side edge and the track's own edge, over the
  // portion of each taper where a real gap has opened but the lane hasn't fully separated.
  const hatches: string[] = []
  for (const half of [all.filter((st) => st.k <= STEPS / 2), all.filter((st) => st.k > STEPS / 2)]) {
    const zone = half.filter((st) => st.ease > 0.55 && st.ease < 0.999)
    if (zone.length < 2) continue
    const laneEdge = zone.map((st) => sub(st.ctr, scale(st.normal, uu(3.5))))
    const trackEdge = zone.map((st) => add(st.p, scale(st.normal, uu(6.2)))).reverse()
    const ring = [...laneEdge, ...trackEdge]
    hatches.push(`M ${ring.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L ')} Z`)
  }

  return { d, box: { x: box.x, y: box.y }, edges, wall, slots, hatches }
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
