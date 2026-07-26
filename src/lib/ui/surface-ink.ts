// How anything is worn INTO tarmac (#sim-2d increment C), shared by the circuit and the pit lane.
//
// The two surfaces tell different stories -- a lap has a racing line and marbles, a pit lane has a
// transit lane and stained boxes -- but they are painted with exactly the same ink, and it is a
// peculiar ink with three properties worth stating once rather than rediscovering per module:
//
//  - It is OPAQUE and pre-blended. A stripe has to be cut into arcs to be cullable, and translucent
//    arcs double-paint where their caps meet: a visible dark disc at every join. Opaque paint over the
//    same colour is idempotent, so the joins vanish -- at the cost of having to know what is underneath.
//  - It is SOFT by nesting, not by blur. This renderer has no filters (three performance regressions
//    say so) and a gradient along a curve would need one gradient per arc. So a soft-edged mark is
//    several opaque strokes, widest and faintest first.
//  - It is LAYER-MAJOR. Every mark's outermost pale layer must be down before any mark's core, or a
//    neighbour's wide pale layer scrubs out the core beside it and every join shows a light notch.
//    Callers own that loop, because only they know what "every mark" means.

import { discOfPts, type Bounds, type DrawOp } from './scenery-draw'
import type { Vec } from './geom'
import { hexToRgb, rgbToHex } from '@/lib/color'

/** Blend `over` onto `base` by `t`, and paint the RESULT opaquely. See the note above on why. */
export function blend(base: string, over: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(base)
  const [r2, g2, b2] = hexToRgb(over)
  const m = (a: number, b: number) => Math.round(a + (b - a) * t)
  return rgbToHex(m(r1, r2), m(g1, g2), m(b1, b2))
}

/** Laid rubber is not black paint: it is the same tarmac with melted tyre polished into it, so it goes
 *  darker and a shade cooler than the road around it rather than becoming a new colour.
 *
 *  Near-black at a low alpha, NOT a mid grey at a high one. Tarmac is #33383E, so a mid-grey rubber can
 *  only ever be about 16 of 255 from the road however hard it is laid on, and the line disappears --
 *  measured, the first attempt darkened the tarmac by 5. The alpha is what should be doing the work. */
export const RUBBER = '#101216'
/** Scrubbed rubber off a locked or near-locked wheel: harder, darker and much narrower than laid rubber. */
export const SKID = '#0C0E11'
/** Dust, shed rubber and swept-up debris. Warmer and less blue than the tarmac, because dust is not
 *  rubber; it is what lightens a surface where the cars are not. */
export const MARBLE = '#6E6A62'

/** Nested strokes a soft mark is built from, widest and faintest first. Each layer is also LONGER than
 *  the one above it where the caller asks for a taper, so one family of strokes softens both the sides
 *  and the ends of a mark. */
export const SOFT_LAYERS = 4

/** Extra width per softening layer, in metres, added outside the core. */
export const SOFT_SPREAD = 0.75

/** Strength of layer `k` of `layers`, as a fraction of the mark's full strength. Layer 0 is the
 *  outermost and faintest; the last is the core. */
export const layerStrength = (k: number, layers: number) => (k + 1) / layers

/** What it takes to keep a stripe on the road: how far the polyline it hangs off sits from the road's
 *  centre at each station, and the road's own half-width. */
export interface Keep {
  /** Per-station distance from the centreline, positive to the RIGHT of travel. */
  lateral: Float64Array
  /** Half-width of the surface, in units. */
  halfU: number
}

/** Hold a stripe ON the road. `lateral` says how far the polyline itself sits from the centreline at
 *  each station, positive to the RIGHT; a positive offset moves LEFT along the station normal, so the
 *  stripe's own distance right of centre is `lateral - offset`. That is what has to stay inside.
 *
 *  Without this, anything hung off the racing line escapes at corner ENTRY, where the line is already at
 *  its 4m limit: the marbles sat 4m further out again, which is 2m past the edge of the asphalt. */
export function onTrack(want: number, halfWidth: number, keep?: Keep): (i: number) => number {
  if (!keep) return () => want
  const limit = Math.max(0, keep.halfU - halfWidth)
  const { lateral } = keep
  return (i) => {
    const l = lateral[i % lateral.length]
    if (l - want > limit) return l - limit
    if (l - want < -limit) return l + limit
    return want
  }
}

/** One mark, as the nesting sees it. Widths are in viewBox units; the caller has already converted. */
export interface Soft {
  /** Lateral displacement from the polyline, along each station's own normal (positive LEFT). */
  offset?: number
  /** Width of the innermost, strongest layer. */
  core: number
  /** How much wider each layer outside the core is. */
  spread: number
  colour: string
  cap?: 'round' | 'butt'
  /** Extra padding on the clip disc, beyond the stroke's own half-width. */
  pad?: number
  /** Shorten each layer as well as narrowing it, so the mark's ENDS soften too. Wrong for a run that
   *  closes on itself or abuts a neighbour: there is no free end there to soften. */
  taper?: boolean
  keep?: Keep
}

/** One layer of one run: `k` counts inward, so higher is narrower, shorter and stronger. */
export function softStroke(
  pts: readonly Vec[], idx: number[], k: number, layers: number, s: Soft,
): DrawOp | null {
  const width = s.core + s.spread * (layers - 1 - k)
  // Trim a fifth of the run per layer, so a mark steps up in strength toward its middle rather than
  // starting on a hard edge. A run too short to trim is drawn full length: better an edge than nothing.
  const trim = s.taper ? Math.min(Math.floor(idx.length * 0.2) * k, Math.floor((idx.length - 2) / 2)) : 0
  const cut = trim > 0 ? idx.slice(trim, idx.length - trim) : idx
  if (cut.length < 2) return null
  const pad = s.pad ?? 0
  const { d, clip } = stripe(pts, cut, onTrack(s.offset ?? 0, width / 2, s.keep))
  return { d, stroke: s.colour, width, cap: s.cap ?? 'round', clip: { ...clip, r: clip.r + width / 2 + pad } }
}

/** Every station of a polyline, in order: what a run that uses all of itself passes as its index list. */
export const allStations = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** Many runs of the same mark painted as ONE op.
 *
 *  A stroke can carry any number of subpaths, so a row of identical marks -- ten pit boxes' worth of
 *  grime, all the same colour and width at a given layer -- is one path rather than ten. The ink is
 *  identical; what goes away is nine setup-and-stroke calls per layer on every frame the row is in
 *  shot. The cull disc becomes the whole row's, which is the right granularity for something that is
 *  only ever looked at as a row. */
export function softStrokeAll(
  runs: readonly (readonly Vec[])[], k: number, layers: number, s: Soft,
): DrawOp | null {
  const parts = runs
    .map((pts) => softStroke(pts, allStations(pts.length), k, layers, s))
    .filter((op): op is DrawOp => op !== null)
  if (parts.length === 0) return null
  const clip = unionOf(parts.map((p) => p.clip!))
  return { ...parts[0], d: parts.map((p) => p.d).join(' '), clip }
}

/** The disc containing every disc given: their extremes' bounding box, centred and half-diagonalled.
 *  Conservative, which is the only thing a cull disc is allowed to be. */
export function unionOf(discs: readonly Bounds[]): Bounds {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of discs) {
    if (b.cx - b.r < x0) x0 = b.cx - b.r
    if (b.cy - b.r < y0) y0 = b.cy - b.r
    if (b.cx + b.r > x1) x1 = b.cx + b.r
    if (b.cy + b.r > y1) y1 = b.cy + b.r
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 }
}

/** Unit normal to the LEFT of travel at station i of a polyline. A closed run wraps, so it has no seam;
 *  an OPEN one clamps, because wrapping at an open end takes the chord from the far end of the road back
 *  to the near one and points the normal somewhere else entirely. */
export function normalAt(pts: readonly Vec[], i: number, closed = true): Vec {
  const n = pts.length
  const at = (j: number) => (closed ? pts[(j + n) % n] : pts[Math.max(0, Math.min(n - 1, j))])
  const a = at(i - 1)
  const b = at(i + 1)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dy / len, y: -dx / len }
}

/** Signed distance from each station to its own centre of curvature, along that station's LEFT normal:
 *  positive through a left-hand corner, negative through a right-hand one, Infinity on a straight.
 *
 *  What it is for: offsetting a polyline further than this folds it back through itself, and anything
 *  stroked along the result turns inside out at the apex. Nothing worn INTO the road offsets far enough
 *  to care -- the widest is a grain band at 4m -- but the tarmac's own rim sits nearly 8m off the
 *  centreline, which is more than the inside of a hairpin has. Measured over the 37 layouts: 30 of them
 *  carry at least one station tighter than that, Monaco 42 of them. */
export function curveLimits(pts: readonly Vec[], closed = true): Float64Array {
  const n = pts.length
  const at = (j: number) => (closed ? pts[(j + n) % n] : pts[Math.max(0, Math.min(n - 1, j))])
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = at(i - 1)
    const b = at(i)
    const c = at(i + 1)
    // Twice the signed area of abc. Negative turning LEFT, which is the side normalAt points to.
    const cross = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    if (cross === 0) {
      out[i] = Infinity
      continue
    }
    const r = (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y)
      * Math.hypot(a.x - c.x, a.y - c.y)) / (2 * Math.abs(cross))
    out[i] = cross < 0 ? r : -r
  }
  return out
}

/** Hold an offset short of folding the polyline it hangs off, at `safe` of the local radius. On the
 *  OUTSIDE of a corner the offset and the centre of curvature are on opposite sides, there is nothing to
 *  fold, and the offset passes through untouched. Inside, the run is pinched toward the corner's centre
 *  instead of turning inside out -- which is what the wide stroke this replaced did there anyway. */
export function noFold(want: number, limits: Float64Array, safe: number): (i: number) => number {
  const sign = Math.sign(want)
  return (i) => {
    const lim = limits[i % limits.length]
    if (want === 0 || !Number.isFinite(lim) || sign !== Math.sign(lim)) return want
    const cap = Math.abs(lim) * safe
    return Math.abs(want) <= cap ? want : sign * cap
  }
}

/** A polyline running parallel to another, `offset` units to its LEFT. */
export function offsetPolyline(pts: readonly Vec[], offset: number, closed = true): Vec[] {
  return pts.map((p, i) => {
    const nrm = normalAt(pts, i, closed)
    return { x: p.x + nrm.x * offset, y: p.y + nrm.y * offset }
  })
}

/** A polyline through the given stations, plus the disc that contains it. `offsetAt` displaces each
 *  station along its own normal, which is how paired streaks are placed either side of a line and how
 *  every stripe is kept on the road. */
export function stripe(
  pts: readonly Vec[], idx: number[], offsetAt: (i: number) => number,
): { d: string; clip: Bounds } {
  const n = pts.length
  const out: Vec[] = idx.map((i) => {
    const p = pts[i % n]
    const offset = offsetAt(i % n)
    if (offset === 0) return p
    const nrm = normalAt(pts, i % n)
    return { x: p.x + nrm.x * offset, y: p.y + nrm.y * offset }
  })
  return { d: `M ${polyPoints(out)}`, clip: discOfPts(out) }
}

/** A closed polygon through the given points, plus the disc that contains it. Bands ACROSS a road are
 *  built this way rather than as strokes: a stroke has one width, and a road that tapers does not. */
export function patch(pts: readonly Vec[]): { d: string; clip: Bounds } {
  return { d: `M ${polyPoints(pts)} Z`, clip: discOfPts(pts) }
}

const polyPoints = (pts: readonly Vec[]) => pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')

/** Split a run of stations into shorter patches, adjacent patches SHARING a station so there is no
 *  gap: a one-pixel break in a stripe this dark is more visible than the stripe. */
export function chunk(idx: number[], size: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < idx.length - 1; i += size) {
    const part = idx.slice(i, Math.min(i + size + 1, idx.length))
    if (part.length > 1) out.push(part)
  }
  return out
}

/** Fraction along the polyline at the middle of a run of stations, wrapping. */
export function midFrac(idx: number[], n: number): number {
  const first = idx[0]
  const span = idx.length
  return (((first + span / 2) % n) + n) % n / n
}

/** Mean spacing between a polyline's stations, in metres. Measured rather than assumed: a polyline is
 *  sampled for whichever effect first needed it, and that sampling is free to change. */
export function spacingOf(pts: readonly Vec[], u: (m: number) => number, closed = true): number {
  let total = 0
  const last = closed ? pts.length : pts.length - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  // `u` converts metres to units, so one unit is 1 / u(1) metres.
  return (total / last) / u(1)
}

/** How far the asphalt continues past the white line, as a MULTIPLE of the line's own width. A road
 *  does not stop being a road at the paint: there is always apron out there, and without it the white
 *  line reads as the edge of the world with grass immediately beyond. */
export const APRON_LINES = 2

/** The lip at the asphalt's own edge, and how far the fade past it reaches, in metres. */
const EDGE_LIP_M = 0.18
const EDGE_REACH_M = 1.55

/** One layer of the drop from asphalt into the verge: how far past the asphalt's edge it reaches, and
 *  the colour it is painted.
 *
 *  A ribbon with no edge reads as a line drawn INTO the ground. A ribbon with a dark lip and a soft
 *  shadow beyond it reads as a slab laid ON the ground, and that one cue does more for the map's sense
 *  of depth than anything else at this scale.
 *
 *  The strength ramp is SQUARED, not linear: the fade spans ~20 grey levels, so a linear ramp leaves
 *  the outermost layer 8 levels below open grass and the edge acquires a hard outer boundary of its own
 *  -- measured. Squared puts the faintest layer within about a level of the grass, where it belongs.
 *  The darkest it ever gets IS the tarmac colour: blending on toward a shadow tint as well put a
 *  one-pixel near-blue line between asphalt and grass, the darkest thing in the shot at the exact place
 *  the eye looks for an edge. */
export function edgeLayer(
  k: number, layers: number, ground: string, tarmac: string,
): { reachM: number; colour: string } {
  const f = layerStrength(k, layers)
  return { reachM: EDGE_LIP_M + EDGE_REACH_M * (1 - f), colour: blend(ground, tarmac, f * f) }
}

/** Signed surface variation at a fraction along a road, for a given band, in -1..1.
 *
 *  Tarmac is not one flat grey -- it is laid in strips, wears unevenly and is patched, and a ribbon of
 *  constant colour is the single biggest tell that a road was drawn rather than paved. Three
 *  incommensurate frequencies per band, offset per band so no two bands share a pattern, so the
 *  mottling never repeats over a road's length and cannot read as a period. Not random: the same
 *  circuit has to look the same every time it is drawn. */
export function grainWeight(frac: number, band: number): number {
  const p = band * 1.7
  return (
    Math.sin(2 * Math.PI * 5.3 * frac + p) * 0.45
    + Math.sin(2 * Math.PI * 9.7 * frac + p * 2.3) * 0.33
    + Math.sin(2 * Math.PI * 17.1 * frac + p * 0.6) * 0.22
  )
}
