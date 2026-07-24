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

/** Resample a trace densely along the SAME quad-midpoint curves buildTracePath renders, so geometry
 * offset from it (kerbs, pit-lane edges) hugs the drawn ribbon. Offsetting from the raw polyline
 * mismatches in corners: smoothing pulls the ribbon inside the polyline by (p[i-1]-2p[i]+p[i+1])/8.
 * Point 0 stays trace[0] = the S/F line. */
export function densifyTrace(trace: TrackTrace, perSeg = 6): TrackTrace {
  const n = trace.length
  if (n < 3) return trace
  const p = (i: number) => trace[i % n]
  const mid = (i: number, j: number): [number, number] =>
    [(p(i)[0] + p(j)[0]) / 2, (p(i)[1] + p(j)[1]) / 2]
  const out: TrackTrace = [[p(0)[0], p(0)[1]], mid(0, 1)]
  for (let i = 1; i < n; i++) {
    const a = mid(i - 1, i)
    const c = p(i)
    const b = mid(i, i + 1)
    for (let k = 1; k <= perSeg; k++) {
      const t = k / perSeg
      const s = 1 - t
      out.push([
        s * s * a[0] + 2 * s * t * c[0] + t * t * b[0],
        s * s * a[1] + 2 * s * t * c[1] + t * t * b[1],
      ])
    }
  }
  return out // the closing wrap (mid(n-1,0) back to p0) matches the path's final L segment
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
  /** Which lateral sign (in the renderer's frame: +lat = left of travel rotated +90 deg) points
   * at the GARAGES. Constant for the whole lane — deriving it per-frame from the direction to a
   * distant box flips with the lane's curvature in the tapers. */
  latSign: number
  /** Drawn centreline of the FAST LANE ribbon (the through lane, at -2.8m in the lane frame).
   * `d` remains the routing path; the working lane is drawn by the renderer only along the box
   * zone, so the complex is narrow everywhere else. */
  fastD: string
  /** The straight portion's stations (lane centre + inward normal + direction): the renderer
   * builds one pit box per team from these, spaced and interpolated to the grid's size. */
  slotStations: Array<{ x: number; y: number; nx: number; ny: number; rot: number }>
  /** Hatched keep-clear wedges where the lane splits from / rejoins the track. */
}

/** Drawn track cross-section, in metres: white casing overall, dark asphalt inside it.
 *  Owned here because the renderer, the scenery clearance rules and their probes must all agree —
 *  the test oracles measure "is this on the track?" against it. */
export const TRACK_WIDTH_M = 13.3
export const TARMAC_WIDTH_M = 12

export const PIT_ENTRY_FRAC = 0.93 // lap fraction where the lane leaves the racing line
export const PIT_EXIT_FRAC = 0.07  // lap fraction (of the next lap) where it rejoins
const PIT_OFFSET = 16       // parallel offset in viewBox units
const PIT_TAPER = 0.10      // fraction of the lane's arc spent blending on/off the racing line

/** Build the pit lane for a trace. `entry`/`exit`/`offset` may be overridden per track if the default reads wrong. */
export function buildPitLane(
  rawTrace: TrackTrace,
  {
    entry = PIT_ENTRY_FRAC, exit = PIT_EXIT_FRAC, offset = PIT_OFFSET, metresPerUnit = 2.2, straighten = true, side = 'inside',
  }: { entry?: number; exit?: number; offset?: number; metresPerUnit?: number; straighten?: boolean; side?: 'inside' | 'outside' } = {},
): PitLane {
  // Offset from the smoothed geometry the ribbon is drawn with, so the tapers land on its edge.
  const trace = densifyTrace(rawTrace)
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
  const STEPS = 80
  const area = trace.reduce((s, p, i) => {
    const q = trace[(i + 1) % n]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0)
  // side='outside' (authored per track, e.g. Montreal) mirrors the whole complex across the
  // track: every lane-frame offset keys off this one sign.
  const inSign = (area > 0 ? 1 : -1) * (side === 'outside' ? -1 : 1)

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

  // STRAIGHTEN the working section: the lane is offset from the (wavy) GPS trace, and every wiggle
  // propagated into the lane, stripe and box row. Project all full-offset stations onto the chord
  // between the first and last of them; the tapers still curve from the real track onto its ends.
  // The working section is STRAIGHT and PARALLEL TO THE PIT STRAIGHT: anchored at the span's
  // midpoint (= the S/F line), offset inward, aligned with the track's direction there. BOTH
  // tapers keep the lane's ORIGINAL shape — a smoothstep offset peel from the raw track over
  // 18% of the arc — blended onto the straight's line only as they arrive. straighten=false
  // (authored per track) keeps the raw offset geometry — Monaco's pit straight is not straight.
  if (straighten) {
    const midK = Math.round(STEPS / 2)
    const mid = stations[midK]
    const dir = mid.dir
    const normal: Vec = { x: inSign * -dir.y, y: inSign * dir.x }
    const base = add(mid.p, scale(normal, offset))
    const i0 = Math.max(1, Math.round(0.18 * STEPS))
    const i1 = STEPS - i0
    const xOf = (q: Vec) => (q.x - base.x) * dir.x + (q.y - base.y) * dir.y
    const x0 = xOf(stations[i0].p)
    const x1 = xOf(stations[i1].p)
    for (let k = i0; k <= i1; k++) {
      const t = (k - i0) / Math.max(1, i1 - i0)
      pts[k] = add(base, scale(dir, x0 + (x1 - x0) * t))
      stations[k] = { p: sub(pts[k], scale(normal, offset)), normal, dir, ease: 1 }
    }
    // The taper blends the real offset track onto the straight's line. Its target used to be the
    // raw point's own projection, which is NOT monotone along `dir`: where the track curves back
    // relative to the straight's direction (sampled once at the span midpoint) the projection
    // DECREASES, and the lane ran backwards at the junction — a fold of up to 17 m against the
    // direction of travel on 8 of the 37 circuits, which scripts/pit-geometry-check.ts reported.
    // Clamping the longitudinal coordinate so it can never pass the straight's own endpoint keeps
    // the lane monotone through both junctions.
    const taper = (k: number, e: number, cap: number, entry: boolean): number => {
      const raw = add(stations[k].p, scale(stations[k].normal, offset * e))
      const x = entry ? Math.min(xOf(raw), cap) : Math.max(xOf(raw), cap)
      const f = add(base, scale(dir, x))
      pts[k] = { x: raw.x + (f.x - raw.x) * e, y: raw.y + (f.y - raw.y) * e }
      stations[k].ease = Math.min(0.998, e)
      return x
    }
    // Walk the entry taper BACKWARDS from the straight so each point's cap is its neighbour toward
    // the working section; forwards for the exit. Either way x advances with travel.
    // Monotone is necessary but not sufficient: where the track runs almost parallel to the
    // straight, consecutive taper points barely advance along `dir`, so the small lateral residue
    // still being blended out dominates the step and the join reads as a kink. Requiring at least
    // half the straight's own point spacing keeps the longitudinal component in charge.
    const minStep = Math.abs(x1 - x0) / Math.max(1, i1 - i0) * 0.5
    let cap = x0
    for (let k = i0 - 1; k >= 1; k--) {
      const u3 = k / i0
      cap = taper(k, u3 * u3 * (3 - 2 * u3), cap - minStep, true)
    }
    cap = x1
    for (let k = i1 + 1; k < STEPS; k++) {
      const r = (STEPS - k) / (STEPS - i1)
      cap = taper(k, r * r * (3 - 2 * r), cap + minStep, false)
    }
    pts[0] = stations[0].p
    stations[0].ease = 0
    pts[STEPS] = stations[STEPS].p
    stations[STEPS].ease = 0
  }

  const d = smoothOpenPath(pts)
  const box = pts[Math.round(STEPS / 2)]

  // Painted detail: edge lines along the whole marked lane (tapers included), the pit wall between
  // lane and track, ten pit-box slots on the lane's outer half, and hatched keep-clear wedges in the
  // mouths where the lane splits from / rejoins the track.
  const all = stations.map((st, k) => ({ ...st, ctr: pts[k], k }))
  const straight = all.filter((st) => st.ease > 0.999)
  // The fast-lane / working-lane separator sits between the transit line and the box aprons
  // (clear of the box markings); the fast lane's other boundary is a plain white line track-side.
  // Cross-section (lateral metres from the lane path, + = garage): fast lane −4.3..−1.3 (3.0m wide,
  // transit runs its centre at −2.8; the sprite is ~2.95m with wings), stripe at −1.3 (drawn by the
  // renderer, only along the box zone), working apron −1.0..+4.75.
  // The boundary lines are the stroke of the UNIONED tarmac: the renderer draws casing-then-asphalt
  // for track and lane alike, and there is no extra paint out here.
  const laneNormalAt = (k: number): Vec => {
    const a = pts[Math.max(0, k - 1)]
    const b = pts[Math.min(STEPS, k + 1)]
    const dd = unit(sub(b, a))
    return { x: inSign * -dd.y, y: inSign * dd.x }
  }
  const laneOffset = (k: number, lat: number): Vec => add(pts[k], scale(laneNormalAt(k), lat))
  const fastD = smoothOpenPath(Array.from({ length: STEPS + 1 }, (_, k) => laneOffset(k, -uu(2.8))))

  const slotStations: PitLane['slotStations'] = straight.map((st) => ({
    x: st.ctr.x, y: st.ctr.y, nx: st.normal.x, ny: st.normal.y, rot: Math.atan2(st.dir.y, st.dir.x),
  }))

  return { d, box: { x: box.x, y: box.y }, latSign: inSign, fastD, slotStations }
}

const DEFAULT_RADIUS = 12

type Vec = { x: number; y: number }
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const len = (v: Vec) => Math.hypot(v.x, v.y)
const scale = (v: Vec, s: number): Vec => ({ x: v.x * s, y: v.y * s })
const unit = (v: Vec): Vec => scale(v, 1 / (len(v) || 1))
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })

const fmt = (n: number) => (Math.round(n * 100) / 100).toString()

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
