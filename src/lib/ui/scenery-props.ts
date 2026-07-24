// Trackside furniture (#sim-2d). Before this the circuit had kerbs and nothing else between the
// tarmac and the grass: no barriers, no fencing, no tyre walls, no marshal posts. Those are the
// details that say "motor racing" rather than "road through a park", and they are cheap — long
// polylines and pattern-filled rects, next to nothing beside the ~1140 tree canopies.

import { smoothOpenPath } from './track-path'
import { blobPath } from './scenery-shapes'
import type { Vec } from './geom'

export interface SceneryBarrier {
  d: string
  /** 'wall' = concrete/armco at the track edge, 'fence' = debris fencing set back behind it. */
  kind: 'wall' | 'fence'
}
export interface SceneryTyreWall { d: string; bands: string[] }
export interface SceneryMarshal { x: number; y: number; rot: number }
export interface SceneryField { d: string; fill: string; crop: boolean }
export interface SceneryCarPark { x: number; y: number; w: number; h: number; rot: number }

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

/** Continuous barriers down both edges of the whole lap, plus debris fencing set back behind them.
 *  Broken at the pit mouths, where the lane leaves and rejoins and there is no wall to run. */
export function buildBarriers(
  frame: TrackFrame,
  { offsetM, fenceOffsetM, skip }:
  { offsetM: number; fenceOffsetM: number; skip: (s: number, side: number) => boolean },
): SceneryBarrier[] {
  const { total, u } = frame
  const out: SceneryBarrier[] = []
  const stepU = u(9)
  for (const side of [1, -1]) {
    for (const [lat, kind] of [[offsetM, 'wall'], [fenceOffsetM, 'fence']] as const) {
      // Walk the lap, breaking the run wherever the barrier is suppressed, so each unbroken stretch
      // becomes its own path instead of one path leaping across the gaps.
      let run: Vec[] = []
      const flush = () => {
        if (run.length >= 3) out.push({ d: smoothOpenPath(run), kind })
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
    return { d: smoothOpenPath(pts), bands: TYRE_BANDS }
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
    cellU, cropChance, palette, keepOut,
  }: {
    cellU: number
    cropChance: number
    palette: string[]
    keepOut: (p: Vec, r: number) => boolean
  },
): SceneryField[] {
  const out: SceneryField[] = []
  const cols = Math.max(1, Math.ceil(box.w / cellU))
  const rows = Math.max(1, Math.ceil(box.h / cellU))
  for (let gx = 0; gx < cols; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      // Jitter each cell's centre and radii so the quilt is irregular rather than a checkerboard.
      const cx = box.x + (gx + 0.15 + rng() * 0.7) * cellU
      const cy = box.y + (gy + 0.15 + rng() * 0.7) * cellU
      const rx = cellU * (0.42 + rng() * 0.26)
      const ry = cellU * (0.42 + rng() * 0.26)
      if (keepOut({ x: cx, y: cy }, Math.max(rx, ry))) continue
      const crop = rng() < cropChance
      out.push({
        // Low jitter: field boundaries are hedge lines and walls, not coastlines.
        d: blobPath(cx, cy, rx, ry, rng() * Math.PI, rng, 7, 0.88, 0.2),
        fill: palette[Math.floor(rng() * palette.length)],
        crop,
      })
    }
  }
  return out
}

/** Spectator car parks, sited out past the buildings where there is room for them. */
export function buildCarParks(
  rng: () => number, count: number,
  { pick, fits, u }: { pick: () => Vec; fits: (o: { x: number; y: number; w: number; h: number; rot: number }) => boolean; u: (m: number) => number },
): SceneryCarPark[] {
  const out: SceneryCarPark[] = []
  for (let i = 0, tries = 0; i < count && tries < count * 8; tries++) {
    const c = pick()
    const w = u(60 + rng() * 90)
    const h = u(45 + rng() * 70)
    const rot = rng() * Math.PI
    const box = { x: c.x, y: c.y, w, h, rot }
    if (!fits(box)) continue
    out.push(box)
    i++
  }
  return out
}
