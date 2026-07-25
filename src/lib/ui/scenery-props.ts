// Trackside furniture (#sim-2d). Before this the circuit had kerbs and nothing else between the
// tarmac and the grass: no fencing, no tyre walls, no marshal posts. Those are the
// details that say "motor racing" rather than "road through a park", and they are cheap — long
// polylines and pattern-filled rects, next to nothing beside the ~1140 tree canopies.

import { closestPointOnPolyline } from './geom'
import { smoothOpenPath } from './track-path'
import type { Vec } from './geom'

/** Trackside cross-section, metres from the centreline. Everything placed beside the circuit
 *  measures its clearance against these: a grandstand sited closer than the debris fence ends up
 *  drawn straight through its own barrier. The inner reference is where the tyre barriers used to
 *  stand; nothing draws there now, but it is still the line the run-off is measured from. */
export const TYRE_REF_OFFSET_M = 11.5
export const FENCE_OFFSET_M = 15.5

export interface SceneryFence {
  d: string
  /** The run's points. The renderer needs these, not just the path string: a wall's height face is
   *  the ribbon swept between its top line and its base, and that has to be rebuilt whenever the
   *  light moves. */
  pts: Vec[]
}
export interface SceneryMarshal { x: number; y: number; rot: number }
export interface SceneryField { d: string; fill: string; crop: boolean }

export interface TrackFrame {
  /** Point at arc position s. */
  at: (s: number) => Vec
  /** Unit tangent at arc position s. */
  tangentAt: (s: number) => Vec
  /** Outward normal sign convention already resolved by the caller. */
  normalAt: (s: number) => Vec
  total: number
  u: (m: number) => number
}

/** Continuous debris fencing down both edges of the whole lap.
 *  Broken at the pit mouths, where the lane leaves and rejoins and there is no run to make. */
/** A fence point is FOLDED when the nearest centreline point is no longer the one it was offset from.
 *  Measured as a fraction of the offset; an honest point at any curvature lands at essentially zero,
 *  so this is nowhere near a borderline call. Distance to the centreline cannot stand in for it: at a
 *  hairpin the folded point sits midway between the two straights and is still far from both, which
 *  is why measuring distance left the crossing in place. */
const FOLD_TOL = 0.5
/** Samples dropped either side of a fold, at nine metres a sample. Stopping exactly at one leaves the
 *  last surviving point already leaning into the corner, which still draws a crossing, so this errs
 *  well clear: a fence that stops short of a hairpin reads as deliberate, one that crosses itself
 *  never does. */
const FOLD_PAD = 4

export function buildFences(
  frame: TrackFrame,
  { offsetM, skip }: { offsetM: number; skip: (s: number, side: number) => boolean },
): SceneryFence[] {
  const { total, u } = frame
  const out: SceneryFence[] = []
  const stepU = u(9)
  // Offsetting a curve inward by more than the corner's own radius folds it THROUGH the apex and out
  // the far side, where it crosses the fence coming the other way. The fence stops short of that
  // rather than trying to cut the corner: a chord across a hairpin looks like a mistake too.
  const centre: Vec[] = []
  for (let s = 0; s <= total; s += stepU) centre.push(frame.at(s))
  for (const side of [1, -1]) {
    const lat = offsetM
    // Walk the lap once collecting candidates, then build runs from the survivors, so a fold can take
    // its neighbours down with it. A suppressed stretch (the pit mouths) breaks the run without that
    // padding, since nothing there is bent.
    const cand: Array<Vec | null> = []
    const folded: boolean[] = []
    for (let s = 0; s <= total; s += stepU) {
      if (skip(s, side)) {
        cand.push(null)
        folded.push(false)
        continue
      }
      const c = frame.at(s)
      const nrm = frame.normalAt(s)
      const p = { x: c.x + nrm.x * u(lat) * side, y: c.y + nrm.y * u(lat) * side }
      const q = closestPointOnPolyline(p, centre)
      cand.push(p)
      folded.push(Math.hypot(q.x - c.x, q.y - c.y) > u(lat) * FOLD_TOL)
    }
    let run: Vec[] = []
    const flush = () => {
      if (run.length >= 3) out.push({ d: smoothOpenPath(run), pts: run })
      run = []
    }
    for (let i = 0; i < cand.length; i++) {
      const p = cand[i]
      if (!p || folded.slice(Math.max(0, i - FOLD_PAD), i + FOLD_PAD + 1).some(Boolean)) flush()
      else run.push(p)
    }
    flush()
  }
  return out
}

/** Marshal posts at intervals around the lap, always on the outside. */
export function buildMarshalPosts(
  frame: TrackFrame, { everyM, offsetM }: { everyM: number; offsetM: number },
): SceneryMarshal[] {
  const { total, u } = frame
  const out: SceneryMarshal[] = []
  for (let s = 0; s < total; s += u(everyM)) {
    const p = frame.at(s)
    const nrm = frame.normalAt(s)
    const t = frame.tangentAt(s)
    out.push({
      x: p.x + nrm.x * u(offsetM),
      y: p.y + nrm.y * u(offsetM),
      rot: Math.atan2(t.y, t.x),
    })
  }
  return out
}

/** Irregular field patchwork over the rural surround. A single uniform green is the main reason the
 *  world reads as a runway extending forever; real circuits sit in a quilt of fields and hedgerows,
 *  and the boundaries alone give the eye a sense of scale and distance. */
export function buildFields(
  box: { x: number; y: number; w: number; h: number },
  rng: () => number,
  {
    cellU, enclosure, palette, keepOut,
  }: {
    cellU: number
    /** Chance a parcel is ENCLOSED farmland at all. Cells that fail show bare ground — the relief
     *  band underneath — so a forest or a desert is not covered in a farm quilt. */
    enclosure: number
    palette: string[]
    keepOut: (p: Vec) => boolean
  },
): SceneryField[] {
  const cols = Math.max(1, Math.ceil(box.w / cellU))
  const rows = Math.max(1, Math.ceil(box.h / cellU))
  // A JITTERED LATTICE, not independent blobs. Each field is the quad between four lattice points,
  // and neighbours share those points, so the fields tessellate into a continuous quilt with hedge
  // lines between them. Independently-placed ellipses left gaps and read as scattered circles.
  const jitter = cellU * 0.3
  const lat: Vec[][] = []
  for (let gy = 0; gy <= rows; gy++) {
    const row: Vec[] = []
    for (let gx = 0; gx <= cols; gx++) {
      row.push({
        x: box.x + gx * cellU + (rng() * 2 - 1) * jitter,
        y: box.y + gy * cellU + (rng() * 2 - 1) * jitter,
      })
    }
    lat.push(row)
  }

  const out: SceneryField[] = []
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const ring = [lat[gy][gx], lat[gy][gx + 1], lat[gy + 1][gx + 1], lat[gy + 1][gx]]
      const cx = (ring[0].x + ring[1].x + ring[2].x + ring[3].x) / 4
      const cy = (ring[0].y + ring[1].y + ring[2].y + ring[3].y) / 4
      const enclosed = rng() < enclosure
      const fill = palette[Math.floor(rng() * palette.length)]
      const crop = rng() < 0.6
      if (!enclosed) continue
      if (keepOut({ x: cx, y: cy })) continue
      out.push({
        d: `M ${ring.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} Z`,
        fill,
        crop,
      })
    }
  }
  return out
}
