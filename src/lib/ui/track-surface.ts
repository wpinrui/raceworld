// What the tarmac remembers (#sim-2d increment C). A circuit drawn as a clean grey ribbon reads as a
// diagram of a track; a circuit with a worn line polished into it, and dark streaks scrubbed into the
// braking zones, reads as somewhere cars have actually been.
//
// None of this is new information. The racing line is solved per circuit already, and the speed profile
// already knows where the hardest braking of the lap is -- both were computed, used, and thrown away.
// This turns them into ink.
//
// Every stripe here is cut into ARCS, each carrying its own cull disc. A full-lap stroke as one op is an
// op the canvas must set up and paint whenever any part of the lap is on screen, which at racing zoom is
// the whole stripe for the sake of the tenth of it in shot.

import type { Bounds, DrawOp } from './scenery-draw'
import type { Vec } from './geom'
import { hexToRgb, rgbToHex } from '@/lib/color'

/** Blend `over` onto `base` by `t`, and paint the RESULT opaquely.
 *
 *  Every stripe here is laid down as an opaque pre-blended colour rather than a translucent one, because
 *  a full-lap stripe has to be cut into arcs to be cullable, and translucent arcs double-paint wherever
 *  their end caps meet. That is a visible dark disc at every join -- 32 of them round a lap, measured on
 *  a preview at racing zoom, and every one of them reads as a mark on the road. Opaque paint over the
 *  same colour is idempotent, so the joins vanish.
 *
 *  The cost is that the stripes now depend on knowing what is underneath, which is why the tarmac colour
 *  is an input rather than an assumption. */
function blend(base: string, over: string, t: number): string {
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
const RUBBER = '#101216'
/** Scrubbed rubber off a locked or near-locked wheel: harder, darker and much narrower than laid rubber. */
const SKID = '#0C0E11'

/** Arcs per lap for a full-lap stripe. Two jobs: a cull disc every ~45m on a Grand Prix circuit, so a
 *  corner in shot does not drag half the lap in with it, and fine enough steps that the strength can
 *  VARY from arc to arc without banding. Since the stripes are painted opaquely, a change in strength
 *  can only happen at an arc boundary, so the arcs are what set how smooth the variation can be. */
const ARCS = 128

/** Peak strength of the laid line, before the variation below scales it. */
const RUBBER_ALPHA = 0.45

/** How many times the line's strength breathes from nothing up to half strength and back, per lap.
 *
 *  A stripe laid at one constant opacity round a circuit reads as painted on, because that is what an
 *  even coat looks like. Real rubber goes down in patches. A sine is the cheapest way to get that and the
 *  only one that cannot band, being smooth by construction: sampled per arc it never steps by more than
 *  a fraction of a grey level. Range is deliberately [0, RUBBER_ALPHA / 2], so the heaviest patch is half
 *  as strong as the old flat stripe and the lightest is bare road. */
const RUBBER_CYCLES = 3

/** Strength of the laid line at a lap fraction, as a blend weight. */
function rubberWeight(frac: number): number {
  return (RUBBER_ALPHA / 2) * (0.5 + 0.5 * Math.sin(2 * Math.PI * RUBBER_CYCLES * frac))
}

/** Where a braking zone starts, as a fraction of the braking limit. Below this it is a lift, not a
 *  stamp on the pedal, and a mark drawn for every lift would put streaks round the entire lap. */
const BRAKE_THRESHOLD = 0.45

/** Curvature, relative to the lap's own tightest corner, at which the line has been polished enough to
 *  earn the second darker pass. */
const APEX_THRESHOLD = 0.4

export interface Surface {
  /** metres to viewBox units. */
  u: (m: number) => number
  /** The solved racing line's stations, in order and closed. */
  line: readonly Vec[]
  /** Signed geometric curvature per profile station (lapDynamics). */
  curvature: Float64Array
  /** Normalised longitudinal acceleration per profile station; negative is braking. */
  long: Float64Array
  /** Front track width in metres, for spacing the two tyre streaks. */
  trackM: number
  /** The road these marks are worn into, so they can be pre-blended against it. */
  tarmac: string
  /** The CENTRELINE, sampled densely. Only the tarmac edge needs it, and it needs it dense: the road is
   *  drawn from a smooth spline, so a polyline that cuts its corners leaves an edge of visibly uneven
   *  thickness. At ~3m spacing the error in the tightest corner is under 4cm against a 20cm rim. */
  centre?: readonly Vec[]
  /** The ground the ribbon is laid on, and the colour a shadow on it is filled with. Per biome, so it
   *  cannot be assumed the way the tarmac nearly can. */
  ground?: string
  shadow?: string
  /** Half-width in metres out to the OUTER edge of the white line, and the width of the line itself. The
   *  asphalt apron is measured off the line, so both are needed. */
  ribbonHalfM?: number
  lineWidthM?: number
  /** Half-width in metres of the racing surface: what the grain is spread across, and the limit every
   *  stripe hung off the racing line is held inside. */
  tarmacHalfM?: number
  /** The racing line's own offset from the centreline per station, from buildRacingLine. Without it
   *  nothing can be held on the road, so stripes are drawn unclamped. */
  lateral?: Float64Array
  /** Zoomed out, the whole lap is in shot at once and every stripe's softening layers land on screen
   *  together -- 616 ops instead of the ~19 a racing shot pulls in. At that zoom the stripe is about a
   *  pixel wide and a soft edge cannot be seen anyway, so the layers collapse to one. Softening scales
   *  DOWN with the LOD tier rather than being drawn at full strength and shrunk. */
  detail?: 'full' | 'low'
}

/** Nested strokes a stripe is built from, widest and faintest first.
 *
 *  Real rubber has no edge, it thins out, and a hard-edged stroke is the tell that it was drawn rather
 *  than laid. Blur is not available here (this renderer has no filters, by three regressions' worth of
 *  hard experience) and a gradient across a stroke that curves would need one gradient per arc, which is
 *  the per-frame gradient rebuild this branch has already paid for once. Nested opaque strokes are what
 *  is left, and they are what every soft shadow on this map is made of too.
 *
 *  Each layer is also LONGER than the one above it, so the same nesting softens the ends of a mark as
 *  well as its sides: one family of strokes, both edges soft. */
const SOFT_LAYERS = 4

/** Extra width per softening layer, in metres, added outside the core. */
const SOFT_SPREAD = 0.75

/** Strength of layer `k` of `layers`, as a fraction of the stripe's full strength. Layer 0 is the
 *  outermost and faintest; the last is the core. */
const layerStrength = (k: number, layers: number) => (k + 1) / layers

/** Hold a stripe ON the tarmac. `lateral` says how far the racing line itself sits from the centreline at
 *  each station, positive to the RIGHT; a positive offset moves LEFT along the station normal, so the
 *  stripe's own distance right of centre is `lateral - offset`. That is what has to stay inside the road.
 *
 *  Without this, anything hung off the racing line escapes at corner ENTRY, where the line is already at
 *  its 4m limit: the marbles sat 4m further out again, which is 2m past the edge of the asphalt. */
function onTrack(want: number, halfWidth: number, keep?: Keep): (i: number) => number {
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

/** What it takes to keep a stripe on the road: the line's own offsets, and the tarmac's half-width. */
interface Keep {
  lateral: Float64Array
  halfU: number
}

const keepOf = (s: Surface): Keep | undefined => (s.lateral && s.tarmacHalfM
  ? { lateral: s.lateral, halfU: s.u(s.tarmacHalfM) }
  : undefined)

/** One layer of one run: `k` counts inward, so higher is narrower, shorter and stronger. */
function softStroke(
  pts: readonly Vec[], idx: number[], offset: number, core: number, spread: number, colour: string,
  cap: 'round' | 'butt', pad: number, k: number, taper: boolean, layers: number, keep?: Keep,
): DrawOp | null {
  const width = core + spread * (layers - 1 - k)
  // Trim a fifth of the run per layer, so a mark steps up in strength toward its middle rather than
  // starting on a hard edge. A run too short to trim is drawn full length: better an edge than nothing.
  const trim = taper ? Math.min(Math.floor(idx.length * 0.2) * k, Math.floor((idx.length - 2) / 2)) : 0
  const cut = trim > 0 ? idx.slice(trim, idx.length - trim) : idx
  if (cut.length < 2) return null
  const { d, clip } = stripe(pts, cut, onTrack(offset, width / 2, keep))
  return { d, stroke: colour, width, cap, clip: { ...clip, r: clip.r + width / 2 + pad } }
}

/** Read a per-station array at a station of a DIFFERENT resolution. The racing line is solved at up to
 *  1200 stations and the profile at 256, so nothing may assume the two line up. */
function atFrac(arr: Float64Array, frac: number): number {
  const n = arr.length
  const x = (((frac % 1) + 1) % 1) * n
  const i = Math.floor(x)
  const f = x - i
  return arr[i % n] * (1 - f) + arr[(i + 1) % n] * f
}

/** Unit normal to the LEFT of travel at station i of a closed polyline. */
function normalAt(pts: readonly Vec[], i: number): Vec {
  const n = pts.length
  const a = pts[(i - 1 + n) % n]
  const b = pts[(i + 1) % n]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dy / len, y: -dx / len }
}

/** A polyline through the given stations, plus the disc that contains it. `offsetAt` displaces each
 *  station along its own normal, which is how the tyre streaks are placed either side of the line and how
 *  every stripe is kept on the road. */
function stripe(pts: readonly Vec[], idx: number[], offsetAt: (i: number) => number): { d: string; clip: Bounds } {
  const n = pts.length
  const out: Vec[] = idx.map((i) => {
    const p = pts[i % n]
    const offset = offsetAt(i % n)
    if (offset === 0) return p
    const nrm = normalAt(pts, i % n)
    return { x: p.x + nrm.x * offset, y: p.y + nrm.y * offset }
  })
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of out) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return {
    d: `M ${out.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`,
    // Half the diagonal contains every station; the caller pads it for the stroke's own width.
    clip: { cx, cy, r: Math.hypot(maxX - minX, maxY - minY) / 2 },
  }
}

/** Cut the whole lap into `count` arcs, each with the lap fraction at its middle so it can be painted at
 *  the strength belonging to that part of the lap. Adjacent arcs SHARE a station so the joins have no
 *  gap: a one-pixel break in a stripe this dark is more visible than the stripe. */
function arcs(pts: readonly Vec[], count: number): Array<{ idx: number[]; frac: number }> {
  const n = pts.length
  const per = Math.max(2, Math.ceil(n / count))
  const out: Array<{ idx: number[]; frac: number }> = []
  for (let start = 0; start < n; start += per) {
    const idx: number[] = []
    for (let i = start; i <= Math.min(start + per, n); i++) idx.push(i % n)
    if (idx.length > 1) out.push({ idx, frac: ((start + per / 2) % n) / n })
  }
  return out
}

/** Contiguous runs of stations the predicate accepts, wrapping the lap seam, each padded by `pad`
 *  stations so a mark starts and ends a little outside the strict condition. */
function runs(n: number, keep: (frac: number) => boolean, pad: number): number[][] {
  const hit = Array.from({ length: n }, (_, i) => keep(i / n))
  if (hit.every((h) => h) || hit.every((h) => !h)) return hit[0] ? [arcsAll(n)] : []
  // Start where a run BEGINS, so no run is split across the seam.
  let start = 0
  while (!(hit[start] && !hit[(start - 1 + n) % n])) start++
  const out: number[][] = []
  let cur: number[] | null = null
  for (let k = 0; k <= n; k++) {
    const i = (start + k) % n
    if (k < n && hit[i]) {
      if (!cur) cur = []
      cur.push(i)
    } else if (cur) {
      // Pad both ends along the lap.
      const head = Array.from({ length: pad }, (_, j) => (cur![0] - pad + j + n) % n)
      const tail = Array.from({ length: pad }, (_, j) => (cur![cur!.length - 1] + 1 + j) % n)
      out.push([...head, ...cur, ...tail])
      cur = null
    }
  }
  return out
}

const arcsAll = (n: number): number[] => Array.from({ length: n + 1 }, (_, i) => i % n)

/** Mean spacing between a polyline's stations, in metres. */
function spacingOf(pts: readonly Vec[], u: (m: number) => number): number {
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  // `u` converts metres to units, so one unit is 1 / u(1) metres.
  return (total / pts.length) / u(1)
}

/** The polished line the whole field drives: one wide soft pass round the lap, and a second narrower one
 *  through the corners, where a lap's worth of cars all put their tyres in the same place. */
export function rubberOps(s: Surface): DrawOp[] {
  const { u, line } = s
  const pad = u(1.6)
  const core = u(2.2)
  const apexCore = u(1.0)
  const spread = u(SOFT_SPREAD)
  const layers = s.detail === 'low' ? 1 : SOFT_LAYERS
  const keep = keepOf(s)
  const lap = arcs(line, ARCS)
  // Peak curvature sets the scale, so a street circuit of hairpins and a power track of long sweeps each
  // get marked where THEY are worked hardest, rather than one absolute threshold suiting neither.
  let peak = 0
  for (let i = 0; i < s.curvature.length; i++) peak = Math.max(peak, Math.abs(s.curvature[i]))
  const apexRuns = peak > 0
    ? runs(line.length, (f) => Math.abs(atFrac(s.curvature, f)) > peak * APEX_THRESHOLD, 3)
    : []

  const ops: DrawOp[] = []
  // LAYER-MAJOR, not arc-major. Every arc's outermost faint layer has to be down before ANY arc's core
  // goes on, or an arc's wide pale layer paints over its neighbour's dark core and every join shows a
  // light notch -- the same mistake as the join discs, in the other direction.
  for (let k = 0; k < layers; k++) {
    // The base stripe closes on itself, so every end cap of every arc abuts another arc and none is ever
    // a free end. Round caps are therefore free of nubs here, and the run is not tapered.
    for (const { idx, frac } of lap) {
      const colour = blend(s.tarmac, RUBBER, rubberWeight(frac) * layerStrength(k, layers))
      const op = softStroke(line, idx, 0, core, spread, colour, 'round', pad, k, false, layers, keep)
      if (op) ops.push(op)
    }
  }
  for (let k = 0; k < layers; k++) {
    for (const idx of apexRuns) {
      // Laid over whatever the base stripe is doing HERE, so the apex core always reads as the same
      // amount darker than its surroundings rather than as the same absolute grey.
      const under = blend(s.tarmac, RUBBER, rubberWeight(midFrac(idx, line.length)))
      const op = softStroke(
        line, idx, 0, apexCore, spread * 0.6, blend(under, RUBBER, 0.4 * layerStrength(k, layers)),
        'round', pad, k, true, layers, keep,
      )
      if (op) ops.push(op)
    }
  }
  return ops
}

/** Lap fraction at the middle of a run of stations, wrapping. */
function midFrac(idx: number[], n: number): number {
  const first = idx[0]
  const span = idx.length
  return (((first + span / 2) % n) + n) % n / n
}

/** Two dark streaks into every real braking zone, spaced at the front track, because a car brakes in a
 *  straight line on two front tyres and leaves two marks doing it. */
export function skidOps(s: Surface): DrawOp[] {
  const { u, line } = s
  const width = u(0.42)
  const half = u(s.trackM / 2)
  const pad = u(1.0)
  const layers = s.detail === 'low' ? 1 : SOFT_LAYERS
  const brakeRuns = runs(line.length, (f) => atFrac(s.long, f) < -BRAKE_THRESHOLD, 2)
  const ops: DrawOp[] = []
  for (let k = 0; k < layers; k++) {
    for (const idx of brakeRuns) {
      // Blended over the laid rubber rather than the bare road, because a car brakes ON the racing line
      // and these marks are always scrubbed into it.
      const laid = blend(s.tarmac, RUBBER, rubberWeight(midFrac(idx, line.length)))
      const colour = blend(laid, SKID, 0.62 * layerStrength(k, layers))
      for (const side of [-half, half]) {
        const op = softStroke(line, idx, side, width, u(0.16), colour, 'butt', pad, k, true, layers, keepOf(s))
        if (op) ops.push(op)
      }
    }
  }
  return ops
}

/** Marbles: shed rubber and dust flung off the line, collecting where nobody drives, which through a
 *  corner is the OUTSIDE.
 *
 *  Seen from directly above they are not pellets. They are a paler, dirtier, edgeless strip of tarmac, and
 *  drawing them as dashes was simply the wrong shape: a dash pattern along a stroke lays regular bars
 *  ACROSS the band, which reads as road marking. So this is a soft low-contrast band whose strength
 *  wanders along the corner, which is what a swept-up drift of debris actually looks like.
 *
 *  Warmer and less blue than the tarmac, because dust is not rubber. */
const MARBLE = '#6E6A62'

/** Curvature, against the lap's tightest corner, above which a corner throws marbles at all. Lower than
 *  the apex threshold: a corner does not have to be a hairpin to sweep its own rubber off the line. */
const MARBLE_THRESHOLD = 0.22

/** Peak strength. Deliberately small: this is dirt on a road, and the moment it is bold enough to notice
 *  as a band it reads as something painted there. */
const MARBLE_ALPHA = 0.17

/** Centre of the band and its core width, in metres off the racing line. Starts outside the laid line's
 *  own outermost softening layer, or the two opaque stripes would erase each other's soft edges. */
const MARBLE_OFF_M = 4.0
const MARBLE_CORE_M = 1.8
const MARBLE_SPREAD_M = 0.45

/** Stations per patch: how far a drift of marbles carries before its density changes. */
const MARBLE_PATCH = 8

/** How thick the drift is at a lap fraction. TWO incommensurate frequencies, so the patchiness never
 *  repeats over a lap and so it cannot read as a period; not random, because the same circuit has to look
 *  the same every time it is drawn. */
function marbleWeight(frac: number): number {
  const a = Math.sin(2 * Math.PI * 7 * frac + 0.7)
  const b = Math.sin(2 * Math.PI * 11.3 * frac + 2.1)
  return Math.max(0, 0.5 + 0.5 * (a * 0.6 + b * 0.4))
}

/** Split a run into shorter patches, adjacent patches sharing a station so there is no gap. */
function chunk(idx: number[], size: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < idx.length - 1; i += size) {
    const part = idx.slice(i, Math.min(i + size + 1, idx.length))
    if (part.length > 1) out.push(part)
  }
  return out
}

export function marbleOps(s: Surface): DrawOp[] {
  const { u, line } = s
  let peak = 0
  for (let i = 0; i < s.curvature.length; i++) peak = Math.max(peak, Math.abs(s.curvature[i]))
  if (peak === 0) return []
  const layers = s.detail === 'low' ? 1 : SOFT_LAYERS
  const pad = u(1.0)
  const core = u(MARBLE_CORE_M)
  const spread = u(MARBLE_SPREAD_M)
  // Every patch of every corner, gathered before anything is drawn, so the layers can go down
  // layer-major: patches differ in strength, so a wide pale layer landing on a neighbour's core would
  // scrub it out.
  const patches: Array<{ idx: number[]; side: number; frac: number }> = []
  for (const run of runs(line.length, (f) => Math.abs(atFrac(s.curvature, f)) > peak * MARBLE_THRESHOLD, 2)) {
    // Which way this corner bends decides which side is the outside: turning right, the outside is the
    // car's left, which is the direction the stations' normals already point.
    const side = Math.sign(atFrac(s.curvature, midFrac(run, line.length))) || 1
    for (const part of chunk(run, MARBLE_PATCH)) {
      patches.push({ idx: part, side, frac: midFrac(part, line.length) })
    }
  }
  const ops: DrawOp[] = []
  for (let k = 0; k < layers; k++) {
    for (const p of patches) {
      const t = MARBLE_ALPHA * marbleWeight(p.frac) * layerStrength(k, layers)
      if (t < 0.005) continue
      const op = softStroke(
        line, p.idx, p.side * u(MARBLE_OFF_M), core, spread, blend(s.tarmac, MARBLE, t),
        'round', pad, k, false, layers, keepOf(s),
      )
      if (op) ops.push(op)
    }
  }
  return ops
}

/** How far the asphalt continues past the white line, as a MULTIPLE of the line's own width. A circuit
 *  does not stop being a road at the paint: there is always apron out there, and without it the white line
 *  reads as the edge of the world with grass immediately beyond. */
const APRON_LINES = 2

/** The drop from asphalt into the verge, plus the shadow the slab throws onto it.
 *
 *  A ribbon with no edge reads as a line drawn INTO the ground. A ribbon with a dark lip and a soft
 *  shadow beyond it reads as a slab laid ON the ground, and that one cue does more for the map's sense of
 *  depth than anything else at this scale. Drawn UNDER the road, as strokes wider than it, so the road
 *  itself covers all but the rim.
 *
 *  This is the one stripe that runs the whole lap and cannot be confined to corners, so it is the
 *  increment's frame-budget risk and the reason it is cut into the same arcs as everything else rather
 *  than being four full-lap strokes. */
export function edgeOps(s: Surface): DrawOp[] {
  const { u, centre, ground, shadow, ribbonHalfM, lineWidthM } = s
  if (!centre || centre.length < 3 || !ground || !shadow || !ribbonHalfM || !lineWidthM) return []
  const layers = s.detail === 'low' ? 1 : SOFT_LAYERS
  // The asphalt's true outer edge: past the white line by twice the line's own width.
  const apronHalf = u(ribbonHalfM + APRON_LINES * lineWidthM)
  const pad = u(0.5)
  const lap = arcs(centre, ARCS)
  const ops: DrawOp[] = []
  // Widest and faintest first, exactly as the stripes above, and layer-major for the same reason.
  for (let k = 0; k < layers; k++) {
    const f = layerStrength(k, layers)
    // Thin crisp lip at the asphalt, reaching out to a wide faint edge. The strength ramp is SQUARED, not
    // linear: the shadow spans ~20 grey levels, so a linear ramp leaves the outermost layer 8 levels below
    // open grass and the shadow acquires a hard outer boundary of its own -- measured. Squared puts the
    // faintest layer within about a level of the grass, where it belongs.
    const width = 2 * apronHalf + 2 * (u(0.18) + u(1.55) * (1 - f))
    // The darkest the falloff ever gets IS the tarmac colour. It used to blend on toward the shadow tint
    // as well, which put a one-pixel near-blue line between the asphalt and the grass -- the darkest thing
    // in the shot, at the exact place the eye is looking for an edge, and jarring. The falloff is a fade
    // from road to ground and nothing else.
    const colour = blend(ground, s.tarmac, f * f)
    for (const { idx } of lap) {
      const { d, clip } = stripe(centre, idx, () => 0)
      ops.push({ d, stroke: colour, width, cap: 'round', clip: { ...clip, r: clip.r + width / 2 + pad } })
    }
  }
  // The apron itself, over the falloff and under the white line, so what the falloff falls away FROM is
  // asphalt rather than paint.
  for (const { idx } of lap) {
    const { d, clip } = stripe(centre, idx, () => 0)
    ops.push({
      d, stroke: s.tarmac, width: 2 * apronHalf, cap: 'round',
      clip: { ...clip, r: clip.r + apronHalf + pad },
    })
  }
  return ops
}

/** Surface grain: the same patchy treatment as the marbles, spread over the WHOLE road rather than one
 *  band outside the corners. Tarmac is not one flat grey -- it is laid in strips, wears unevenly, and is
 *  patched, and a ribbon of constant colour is the single biggest tell that a circuit was drawn rather
 *  than paved. This is what breaks that up.
 *
 *  Deliberately at the edge of perception: about three grey levels either way. Every patch is either a
 *  little paler and dustier or a little darker and more rubbered-in, so the variance runs both ways
 *  rather than only lightening the road.
 *
 *  Bands run ALONG the road, because that is the direction tarmac is laid and worn in, and they do not
 *  overlap: opaque paint cannot blend, so touching bands would trade a soft join for a hard one. At three
 *  levels of contrast the boundaries read as streaking, which is what a resurfaced circuit looks like. */
const GRAIN_BANDS = 3

/** Peak grain strength, as a blend weight. */
const GRAIN_ALPHA = 0.075

/** Metres of road per patch. Short enough to read as mottling from a car, long enough not to cost an op
 *  every few metres of a five-kilometre lap. */
const GRAIN_PATCH_M = 45

/** Signed grain at a lap fraction for a given band, in -1..1. Three incommensurate frequencies per band,
 *  offset per band so no two bands share a pattern, and stable for a given circuit. */
function grainWeight(frac: number, band: number): number {
  const p = band * 1.7
  return (
    Math.sin(2 * Math.PI * 5.3 * frac + p) * 0.45
    + Math.sin(2 * Math.PI * 9.7 * frac + p * 2.3) * 0.33
    + Math.sin(2 * Math.PI * 17.1 * frac + p * 0.6) * 0.22
  )
}

export function grainOps(s: Surface): DrawOp[] {
  const { u, centre, tarmacHalfM } = s
  // Skipped entirely at zoom-out: it is three grey levels on a road a pixel or two wide, and it would put
  // several hundred ops on screen at once for nothing.
  if (!centre || centre.length < 3 || !tarmacHalfM || s.detail === 'low') return []
  const bandW = (2 * tarmacHalfM) / GRAIN_BANDS
  // Stations per patch, measured off the centreline's OWN spacing rather than assumed: it is sampled for
  // the tarmac edge's benefit, not this one's, and that sampling is free to change.
  const spacing = spacingOf(centre, u)
  const perPatch = Math.max(2, Math.round(GRAIN_PATCH_M / Math.max(1e-6, spacing)))
  const whole = Array.from({ length: centre.length + 1 }, (_, i) => i % centre.length)
  const pad = u(0.5)
  const ops: DrawOp[] = []
  for (let band = 0; band < GRAIN_BANDS; band++) {
    // Band centres, spread across the tarmac from one edge to the other.
    const off = u(-tarmacHalfM + bandW * (band + 0.5))
    // A hair narrower than the spacing, so bands touch rather than overlap.
    const width = u(bandW * 0.96)
    for (const idx of chunk(whole, perPatch)) {
      const w = grainWeight(midFrac(idx, centre.length), band)
      const t = Math.abs(w) * GRAIN_ALPHA
      if (t < 0.004) continue
      const { d, clip } = stripe(centre, idx, () => off)
      ops.push({
        d,
        stroke: blend(s.tarmac, w > 0 ? MARBLE : RUBBER, t),
        width,
        cap: 'butt',
        clip: { ...clip, r: clip.r + width / 2 + pad },
      })
    }
  }
  return ops
}

/** Everything worn into the tarmac, in the order it was laid down: the road's own grain first, then the
 *  line, then what it threw off, then the marks braking scrubbed into it. Drawn OVER the road surface;
 *  `edgeOps` goes under it. */
export function surfaceOps(s: Surface): DrawOp[] {
  return [...grainOps(s), ...rubberOps(s), ...marbleOps(s), ...skidOps(s)]
}
