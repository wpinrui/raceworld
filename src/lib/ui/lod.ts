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
// The middle rung was introduced for BATCHING rather than for pixels: it drops per-object gradients so
// that a hundred flat canopies sharing one paint could be concatenated into a single draw call. That
// merge is GONE, and the reason is worth keeping. The perf lab ablated it (hungary, 2026-07-26): with
// the merge off every shot ran 60 fps at a 1% low of 60, against 13-27ms frames with it on, while
// issuing MORE draw calls (1910 against 2165) for LESS main-thread time (2.93ms against 2.71ms). The
// premise "draw-call bound at 19 microseconds a call" did not survive contact with this machine, which
// is fill-rate bound: one concatenated fill covers the union of its parts' extents in a single coverage
// pass and can no longer be culled a part at a time, so trading N small draws for one screen-sized one
// is a straight loss.
//
// So the mid rung currently sheds internal shading and buys nothing that has been measured. It stays
// as it is for now: the whole ladder has to be re-derived against the floor that removing the merge
// exposed, and guessing at new rungs before re-measuring is how the old premise got here.

import type { Bounds } from './scenery-draw'
import { PERF } from './perf-flags'

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
  // Ladder off: everything is drawn at full detail whatever size it covers, which is the renderer as it
  // was before this file existed and the thing the ladder's saving is measured against.
  if (!PERF.lodRungs) return 'near'
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

/** The camera scale a bucket stands for, and the ONLY scale a rung may be decided from.
 *
 *  Quantising when to recompose is not enough on its own: feed the ladder the live scale at the moment
 *  a bucket happened to change and the rung depends on where the zoom steps landed, which differs
 *  going in from going out. Objects then appear at one scale and disappear at another, which is the
 *  hysteresis this ladder is not supposed to have. Deciding from the bucket's own representative scale
 *  makes a rung a pure function of the bucket, so it flips at the same place in both directions. */
export function lodScale(pxPerM: number): number {
  return 2 ** (lodBucket(pxPerM) / 2)
}

/** The disc containing every disc given. Conservative, which is the only thing a cull disc may be. */
export function unionOf(discs: readonly Bounds[]): Bounds {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const b of discs) {
    if (b.cx - b.r < x0) x0 = b.cx - b.r
    if (b.cy - b.r < y0) y0 = b.cy - b.r
    if (b.cx + b.r > x1) x1 = b.cx + b.r
    if (b.cy + b.r > y1) y1 = b.cy + b.r
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 }
}
