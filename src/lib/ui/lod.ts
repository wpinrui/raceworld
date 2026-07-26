// One rule for how much detail anything on the map is drawn with (#sim-2d).
//
// The map used to carry a single boolean, `full`, flipped by a single zoom number. Two things were
// wrong with that, and they are separate. It asked one threshold to serve a 12m tree, a 40m grandstand
// and a 2.8m marshal hut, which stop being resolvable at wildly different zooms. And it had nothing
// between "every detail" and "not drawn", so the only saving it could ever offer was deletion — which
// is how a shot framing the pit building ended up choosing between 993 draw calls and no trees.
//
// What replaces it is one formula, applied to everything:
//
//     rung = f(how many SCREEN PIXELS this object covers)
//
// An object's pixel size is its own size in metres times the camera's pixels per metre, so the rule
// needs no per-class zoom numbers: a hut reaches a rung earlier than a grandstand because it is
// smaller, which is the whole of what we were hand-tuning before.
//
// GRAPHICS QUALITY is a single multiplier on the thresholds, and nothing else. Higher quality divides
// them, so every object holds its detail to a smaller on-screen size and the whole ladder slides out
// with the zoom. That is the only knob a settings dial ever has to touch.
//
// The middle rung is the point of the exercise, and it exists because of BATCHING rather than because
// of pixels. This renderer is draw-call bound (measured at roughly 19 microseconds a call on the
// machine this was tuned against, with 993 calls in the bad shot and hiding 70% of the PIXELS changing
// nothing). One draw call per object is the cost whatever that object is made of, so a "simpler tree"
// saves nothing on its own. It only pays if a hundred trees become one draw, and they can only merge
// if they share a paint — which is why the mid rung drops per-object gradients. That is the trade: an
// object at mid keeps its position, size, silhouette and colour, and loses its internal shading.

import type { Bounds, DrawOp } from './scenery-draw'

/** How much of an object is drawn. Ordered coarsest last, so comparisons read the way they sound. */
export type Rung = 'near' | 'mid' | 'far' | 'gone'

/** Thresholds in SCREEN PIXELS of an object's own size, at quality 1.
 *
 *  In pixels because that is what the eye is given, and the numbers are about perception rather than
 *  about any circuit: below roughly a dozen pixels the shading inside a shape stops being separable
 *  from a flat fill of its average colour, and below a few pixels the shape is a dot whose silhouette
 *  carries nothing either. Tuned against the measured shots rather than guessed: at the pit-building
 *  framing (3.5px/m) a tree canopy is about 19px and a marshal hut about 10, which is exactly the
 *  spread a single zoom threshold could never express. */
const NEAR_PX = 34
const MID_PX = 11
const FAR_PX = 2.5

/** Graphics quality, as the only thing that moves the ladder. Higher keeps detail to a smaller
 *  on-screen size, so detail survives further out; lower sheds it sooner. A settings dial picks one of
 *  these and changes nothing else anywhere. */
export const QUALITY = { low: 0.55, medium: 1, high: 2 } as const
export type Quality = keyof typeof QUALITY

/** The rule. `sizeM` is the object's own characteristic size in metres — a canopy's diameter, a
 *  building's frontage, a stripe's width — and `pxPerM` is the camera's scale. */
export function rungFor(sizeM: number, pxPerM: number, quality = 1): Rung {
  const px = sizeM * pxPerM * quality
  if (px >= NEAR_PX) return 'near'
  if (px >= MID_PX) return 'mid'
  if (px >= FAR_PX) return 'far'
  return 'gone'
}

/** True at `rung` or anything finer. Reads better than an ordering comparison at the call sites, which
 *  are nearly all "is this at least mid". */
export function atLeast(rung: Rung, floor: Rung): boolean {
  const order: Rung[] = ['gone', 'far', 'mid', 'near']
  return order.indexOf(rung) >= order.indexOf(floor)
}

/** Quantised camera scale, for cache keys.
 *
 *  The scene's static geometry is cached on everything the ops are built from, so feeding it a raw
 *  pixels-per-metre would rebuild a whole circuit's string geometry on every zoom notch. Rungs only
 *  change at discrete scales anyway, so the key travels in half-octave steps: about one bucket per two
 *  wheel notches, which is the cadence the cull disc already recomposes at. */
export function lodBucket(pxPerM: number): number {
  return Math.round(Math.log2(Math.max(1e-3, pxPerM)) * 2)
}

/** Everything a paint is identified by. Two ops with the same signature draw identically, so they can
 *  be one path with two subpaths and cost one draw call instead of two.
 *
 *  An op carrying a `bbox` is given a key of its own and never merges with anything: a bbox is there
 *  because the paint is a gradient resolving against that shape's own extent, so merging two would
 *  stretch one ramp across both. This is what confines merging to the flat rungs without any caller
 *  having to remember to. */
function paintKey(op: DrawOp, i: number): string {
  if (op.bbox) return `bbox${i}`
  return [
    op.fill ?? '', op.stroke ?? '', op.width ?? '', op.cap ?? '', op.alpha ?? '',
    op.evenOdd ? 'eo' : '', op.dash ? `${op.dash.on},${op.dash.off},${op.dash.shift}` : '',
  ].join('|')
}

/** The disc containing every disc given. Conservative, which is the only thing a cull disc may be. */
function unionOf(discs: readonly Bounds[]): Bounds {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const b of discs) {
    if (b.cx - b.r < x0) x0 = b.cx - b.r
    if (b.cy - b.r < y0) y0 = b.cy - b.r
    if (b.cx + b.r > x1) x1 = b.cx + b.r
    if (b.cy + b.r > y1) y1 = b.cy + b.r
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 }
}

/** Merge ops that paint identically into one path each, preserving the order they were given in.
 *
 *  What makes the mid rung affordable. A stroke or a fill carries any number of subpaths, so a hundred
 *  flat canopies of the same green are one call. Two limits are deliberate and worth knowing:
 *
 *  Merging is only order-safe among ops that do not need to interleave with each other, so it is the
 *  CALLER's business to hand over a run where that holds. Flat trees qualify because opaque paint of
 *  one colour over itself is idempotent — which is exactly what the mid rung buys by dropping the
 *  gradients, and exactly why the near rung cannot merge.
 *
 *  A merged op carries the union of its parts' clip discs, so it stops being cullable one object at a
 *  time. That is the right trade at this size: the parts are inside the cull disc already, and one
 *  draw call for a whole grove is cheaper than culling half of it away at one call each.
 *
 *  Ops with no clip disc merge too; the result simply has none, and is drawn always. */
export function mergeByPaint(ops: readonly DrawOp[]): DrawOp[] {
  const order: string[] = []
  const groups = new Map<string, DrawOp[]>()
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const key = paintKey(op, i)
    const got = groups.get(key)
    if (got) got.push(op)
    else {
      groups.set(key, [op])
      order.push(key)
    }
  }
  return order.map((key) => {
    const run = groups.get(key)!
    if (run.length === 1) return run[0]
    const clips = run.map((o) => o.clip).filter((c): c is Bounds => !!c)
    const merged: DrawOp = { ...run[0], d: run.map((o) => o.d).join(' ') }
    if (clips.length === run.length) merged.clip = unionOf(clips)
    else delete merged.clip
    return merged
  })
}
