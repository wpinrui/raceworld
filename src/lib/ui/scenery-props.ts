// Trackside furniture (#sim-2d). Before this the circuit had kerbs and nothing else between the
// tarmac and the grass: no fencing, no tyre walls, no marshal posts. Those are the
// details that say "motor racing" rather than "road through a park", and they are cheap — long
// polylines and pattern-filled rects, next to nothing beside the ~1140 tree canopies.

import { smoothOpenPath } from './track-path'
import type { Vec } from './geom'

/** Trackside cross-section, metres from the centreline. Everything placed beside the circuit
 *  measures its clearance against these: a grandstand sited closer than the debris fence ends up
 *  drawn straight through its own barrier. */
export const TYRE_REF_OFFSET_M = 11.5
export const FENCE_OFFSET_M = 15.5

export interface SceneryFence {
  d: string
  /** The run's points. The renderer needs these, not just the path string: a wall's height face is
   *  the ribbon swept between its top line and its base, and that has to be rebuilt whenever the
   *  light moves. */
  pts: Vec[]
}
export interface SceneryTyreWall {
  d: string
  pts: Vec[]
  bands: string[]
  /** Outward normal at this corner. The tyre wall sits INBOARD of the barrier, so whether it is
   *  nearer or further than the barrier from the viewer depends on which way the circuit faces here
   *  — and that flips around the lap. The renderer dots this with the light to order the two. */
  nOut: Vec
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

/** The red blocks of a kerb, as filled quads baked along its centreline.
 *
 *  These used to be a `strokeDasharray` on the kerb path, which is one attribute and looks free. It is
 *  not: a dashed stroke is re-flattened, re-split and re-expanded on EVERY repaint, and the camera
 *  transform repaints every frame. A lap's kerbs came to roughly two thousand dash segments recomputed
 *  sixty times a second, which is why driving through a corner stuttered and driving down a straight
 *  did not. Baked once, the rasteriser only has to fill polygons. */
export function kerbBlocks(pts: Vec[], half: number, block: number): string {
  if (pts.length < 2 || block <= 0) return ''
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const total = cum[cum.length - 1]
  const at = (s: number) => {
    let k = 0
    while (k < pts.length - 2 && cum[k + 1] < s) k++
    const seg = cum[k + 1] - cum[k] || 1
    const f = Math.max(0, Math.min(1, (s - cum[k]) / seg))
    const dx = (pts[k + 1].x - pts[k].x) / seg
    const dy = (pts[k + 1].y - pts[k].y) / seg
    return {
      x: pts[k].x + (pts[k + 1].x - pts[k].x) * f,
      y: pts[k].y + (pts[k + 1].y - pts[k].y) * f,
      nx: -dy * half,
      ny: dx * half,
    }
  }
  let d = ''
  // Every other block interval is red; the white between them is the continuous stroke underneath.
  for (let k = 0; k * block < total; k += 2) {
    const a = at(k * block)
    const b = at(Math.min(total, (k + 1) * block))
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
    d += `M ${(a.x + a.nx).toFixed(1)} ${(a.y + a.ny).toFixed(1)} `
      + `L ${(b.x + b.nx).toFixed(1)} ${(b.y + b.ny).toFixed(1)} `
      + `L ${(b.x - b.nx).toFixed(1)} ${(b.y - b.ny).toFixed(1)} `
      + `L ${(a.x - a.nx).toFixed(1)} ${(a.y - a.ny).toFixed(1)} Z `
  }
  return d
}

/** Continuous debris fencing down both edges of the whole lap.
 *  Broken at the pit mouths, where the lane leaves and rejoins and there is no run to make. */
export function buildFences(
  frame: TrackFrame,
  { offsetM, skip }: { offsetM: number; skip: (s: number, side: number) => boolean },
): SceneryFence[] {
  const { total, u } = frame
  const out: SceneryFence[] = []
  const stepU = u(9)
  for (const side of [1, -1]) {
    {
      const lat = offsetM
      // Walk the lap, breaking the run wherever the barrier is suppressed, so each unbroken stretch
      // becomes its own path instead of one path leaping across the gaps.
      let run: Vec[] = []
      const flush = () => {
        if (run.length >= 3) out.push({ d: smoothOpenPath(run), pts: run })
        run = []
      }
      for (let s = 0; s <= total; s += stepU) {
        if (skip(s, side)) { flush(); continue }
        const p = frame.at(s)
        const nrm = frame.normalAt(s)
        run.push({ x: p.x + nrm.x * u(lat) * side, y: p.y + nrm.y * u(lat) * side })
      }
      flush()
    }
  }
  return out
}

const TYRE_BANDS = ['#C8352F', '#E6E3DC', '#2E333B']

/** Stacked tyre barriers on the outside of the sharpest corners: the most recognisable piece of
 *  circuit furniture there is, and it reads even at low zoom because of the colour banding. */
export function buildTyreWalls(
  frame: TrackFrame, corners: number[], { offsetM, spanM }: { offsetM: number; spanM: number },
): SceneryTyreWall[] {
  const { u } = frame
  return corners.map((s) => {
    const pts: Vec[] = []
    for (let d = -spanM / 2; d <= spanM / 2; d += 6) {
      const p = frame.at(s + u(d))
      const nrm = frame.normalAt(s + u(d))
      pts.push({ x: p.x + nrm.x * u(offsetM), y: p.y + nrm.y * u(offsetM) })
    }
    return { d: smoothOpenPath(pts), pts, bands: TYRE_BANDS, nOut: frame.normalAt(s) }
  })
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
