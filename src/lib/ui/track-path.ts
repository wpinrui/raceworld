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
