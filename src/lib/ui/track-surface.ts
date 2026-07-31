// What the tarmac remembers (#sim-2d increment C). A circuit drawn as a clean grey ribbon reads as a
// diagram of a track; a circuit with a worn line polished into it, and dark streaks scrubbed into the
// braking zones, reads as somewhere cars have actually been.
//
// None of this is new information. The racing line is solved per circuit already, and the speed profile
// already knows where the hardest braking of the lap is -- both were computed, used, and thrown away.
// This turns them into ink.
//
// The ink itself -- opaque pre-blended colour, softness by nesting, layer-major order -- lives in
// [surface-ink.ts](./surface-ink.ts) and is shared with the pit lane. What is here is what only a LAP
// has: a racing line, apexes, braking zones and the marbles a corner throws off.
//
// Every stripe here is cut into ARCS, and the reason is the PICTURE rather than the cost: the marks are
// painted opaquely, so a mark's strength can only change where one arc ends and the next begins. The arc
// count is what sets how smoothly a laid line can breathe around a lap.

import type { DrawOp } from './scenery-draw'
import type { Vec } from './geom'
import {
  APRON_LINES, MARBLE, RUBBER, SKID, SOFT_LAYERS, SOFT_SPREAD, blend, chunk, curveLimits, edgeLayer,
  grainWeight, layerStrength, midFrac, noFold, softStroke, spacingOf, stripe, type Keep,
} from './surface-ink'

/** Arcs per lap for a full-lap stripe: fine enough steps that the strength can VARY from arc to arc
 *  without banding. */
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
}

const keepOf = (s: Surface): Keep | undefined => (s.lateral && s.tarmacHalfM
  ? { lateral: s.lateral, halfU: s.u(s.tarmacHalfM) }
  : undefined)

/** Read a per-station array at a station of a DIFFERENT resolution. The racing line is solved at up to
 *  1200 stations and the profile at 256, so nothing may assume the two line up. */
function atFrac(arr: Float64Array, frac: number): number {
  const n = arr.length
  const x = (((frac % 1) + 1) % 1) * n
  const i = Math.floor(x)
  const f = x - i
  return arr[i % n] * (1 - f) + arr[(i + 1) % n] * f
}

/** Cut the whole lap into `count` arcs, each with the lap fraction at its middle so it can be painted at
 *  the strength belonging to that part of the lap. Adjacent arcs SHARE a station so the joins have no
 *  gap: a one-pixel break in a stripe this dark is more visible than the stripe.
 *
 *  `open` for a run that does not close: the pit lane starts on the circuit and ends on it again rather
 *  than looping, and wrapping its last arc back to its first draws a stroke straight across the map. */
function arcs(
  pts: readonly Vec[], count: number, open = false,
): Array<{ idx: number[]; frac: number }> {
  const n = pts.length
  const per = Math.max(2, Math.ceil(n / count))
  const out: Array<{ idx: number[]; frac: number }> = []
  const last = open ? n - 1 : n
  for (let start = 0; start < last; start += per) {
    const idx: number[] = []
    for (let i = start; i <= Math.min(start + per, last); i++) idx.push(open ? i : i % n)
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

/** The polished line the whole field drives: one wide soft pass round the lap, and a second narrower one
 *  through the corners, where a lap's worth of cars all put their tyres in the same place. */
export function rubberOps(s: Surface): DrawOp[] {
  const { u, line } = s
  const core = u(2.2)
  const apexCore = u(1.0)
  const spread = u(SOFT_SPREAD)
  const layers = SOFT_LAYERS
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
      const op = softStroke(line, idx, k, layers, { core, spread, colour, keep })
      if (op) ops.push(op)
    }
  }
  for (let k = 0; k < layers; k++) {
    for (const idx of apexRuns) {
      // Laid over whatever the base stripe is doing HERE, so the apex core always reads as the same
      // amount darker than its surroundings rather than as the same absolute grey.
      const under = blend(s.tarmac, RUBBER, rubberWeight(midFrac(idx, line.length)))
      const op = softStroke(line, idx, k, layers, {
        core: apexCore,
        spread: spread * 0.6,
        colour: blend(under, RUBBER, 0.4 * layerStrength(k, layers)),
        taper: true,
        keep,
      })
      if (op) ops.push(op)
    }
  }
  return ops
}

/** Two dark streaks into every real braking zone, spaced at the front track, because a car brakes in a
 *  straight line on two front tyres and leaves two marks doing it. */
export function skidOps(s: Surface): DrawOp[] {
  const { u, line } = s
  const width = u(0.42)
  const half = u(s.trackM / 2)
  const layers = SOFT_LAYERS
  const brakeRuns = runs(line.length, (f) => atFrac(s.long, f) < -BRAKE_THRESHOLD, 2)
  const ops: DrawOp[] = []
  for (let k = 0; k < layers; k++) {
    for (const idx of brakeRuns) {
      // Blended over the laid rubber rather than the bare road, because a car brakes ON the racing line
      // and these marks are always scrubbed into it.
      const laid = blend(s.tarmac, RUBBER, rubberWeight(midFrac(idx, line.length)))
      const colour = blend(laid, SKID, 0.62 * layerStrength(k, layers))
      for (const side of [-half, half]) {
        const op = softStroke(line, idx, k, layers, {
          offset: side, core: width, spread: u(0.16), colour, cap: 'butt', taper: true, keep: keepOf(s),
        })
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
 *  wanders along the corner, which is what a swept-up drift of debris actually looks like. */

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

export function marbleOps(s: Surface): DrawOp[] {
  const { u, line } = s
  let peak = 0
  for (let i = 0; i < s.curvature.length; i++) peak = Math.max(peak, Math.abs(s.curvature[i]))
  if (peak === 0) return []
  const layers = SOFT_LAYERS
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
      const op = softStroke(line, p.idx, k, layers, {
        offset: p.side * u(MARBLE_OFF_M),
        core,
        spread,
        colour: blend(s.tarmac, MARBLE, t),
        keep: keepOf(s),
      })
      if (op) ops.push(op)
    }
  }
  return ops
}

/** How far a rim bleeds INWARD past the band it has to cover, in metres. Each rim abuts the next one in,
 *  and the innermost abuts the road -- which is stroked from the SPLINE while these hang off a polyline
 *  sampled at ~3m, so the two disagree by a few centimetres through corners. A rim cut exactly to its own
 *  band would show ground through that seam, and a one-pixel gap here is more visible than the rim. Opaque
 *  paint over the same colour costs nothing, so consecutive rims overlap instead. */
const RIM_BLEED_M = 0.6

/** How much of a corner's own radius a rim may use before `noFold` pinches it inward. */
const RIM_SAFE = 0.8

/** The drop from asphalt into the verge, drawn UNDER the road, so the road itself covers all but the rim.
 *  The shape of the fade is shared with the pit lane's own apron (`edgeLayer`); what is here is the lap it
 *  runs round.
 *
 *  Drawn as RIMS, two per band, not as strokes spanning the whole road. Each layer is only ever SEEN
 *  between its own reach and the next one in: everything inside that is painted over, first by the
 *  narrower layers above it and finally by the road. Spanning strokes put 85.6m of width down per metre of
 *  road for the 5.3m of it that survives -- measured at racing zoom, 4 to 8 megapixels a frame against a
 *  3.2Mpx viewport, which was more fill than everything else worn into the tarmac put together. Rims paint
 *  the same pixels for about a seventh of that.
 *
 *  Both sides of a band go in ONE op as two subpaths: same colour, same width, and a stroke can carry any
 *  number of subpaths. */
export function edgeOps(s: Surface): DrawOp[] {
  const { u, centre, ground, shadow, ribbonHalfM, lineWidthM } = s
  if (!centre || centre.length < 3 || !ground || !shadow || !ribbonHalfM || !lineWidthM) return []
  const layers = SOFT_LAYERS
  // The asphalt's true outer edge: past the white line by twice the line's own width.
  const apronHalf = u(ribbonHalfM + APRON_LINES * lineWidthM)
  const bleed = u(RIM_BLEED_M)
  const lap = arcs(centre, ARCS)
  const limits = curveLimits(centre)
  const ops: DrawOp[] = []
  const rim = (inner: number, outer: number, colour: string) => {
    const width = outer - inner
    if (width <= 0) return
    const off = (inner + outer) / 2
    for (const { idx } of lap) {
      const left = stripe(centre, idx, noFold(off, limits, RIM_SAFE))
      const right = stripe(centre, idx, noFold(-off, limits, RIM_SAFE))
      ops.push({ d: `${left} ${right}`, stroke: colour, width, cap: 'round' })
    }
  }
  // Widest and faintest first, exactly as the stripes above, and layer-major for the same reason. The
  // innermost layer's band closes on the apron, which is why the reach list runs one past the layers.
  const reach = Array.from(
    { length: layers + 1 },
    (_, k) => (k < layers ? u(edgeLayer(k, layers, ground, s.tarmac).reachM) : 0),
  )
  for (let k = 0; k < layers; k++) {
    const { colour } = edgeLayer(k, layers, ground, s.tarmac)
    rim(apronHalf + reach[k + 1] - bleed, apronHalf + reach[k], colour)
  }
  // The apron itself, over the falloff and under the white line, so what the falloff falls away FROM is
  // asphalt rather than paint. Its inner edge meets the road's own casing.
  rim(u(ribbonHalfM) - bleed, apronHalf, s.tarmac)
  return ops
}

/** Surface grain: the same patchy treatment as the marbles, spread over the WHOLE road rather than one
 *  band outside the corners. Every patch is either a little paler and dustier or a little darker and more
 *  rubbered-in, so the variance runs both ways rather than only lightening the road.
 *
 *  Deliberately at the edge of perception: about three grey levels either way. Bands run ALONG the road,
 *  because that is the direction tarmac is laid and worn in, and they do not overlap: opaque paint cannot
 *  blend, so touching bands would trade a soft join for a hard one. At three levels of contrast the
 *  boundaries read as streaking, which is what a resurfaced circuit looks like. */
const GRAIN_BANDS = 3

/** Peak grain strength, as a blend weight. */
const GRAIN_ALPHA = 0.075

/** Metres of road per patch. Short enough to read as mottling from a car, long enough not to cost an op
 *  every few metres of a five-kilometre lap. */
const GRAIN_PATCH_M = 45

export function grainOps(s: Surface): DrawOp[] {
  const { u, centre, tarmacHalfM } = s
  if (!centre || centre.length < 3 || !tarmacHalfM) return []
  const bandW = (2 * tarmacHalfM) / GRAIN_BANDS
  // Stations per patch, measured off the centreline's OWN spacing rather than assumed: it is sampled for
  // the tarmac edge's benefit, not this one's, and that sampling is free to change.
  const spacing = spacingOf(centre, u)
  const perPatch = Math.max(2, Math.round(GRAIN_PATCH_M / Math.max(1e-6, spacing)))
  const whole = Array.from({ length: centre.length + 1 }, (_, i) => i % centre.length)
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
      ops.push({
        d: stripe(centre, idx, () => off),
        stroke: blend(s.tarmac, w > 0 ? MARBLE : RUBBER, t),
        width,
        cap: 'butt',
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
