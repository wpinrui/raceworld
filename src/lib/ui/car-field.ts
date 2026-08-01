// A field of cars strung round the solved racing line (#sim-2d / #3d-port), each at its real
// heading, leaning and steering exactly as much as the lap's own dynamics say it should at that
// point. Placement only: the 2D preview dresses these as SVG sprites, the 3D as impostors or
// meshes, and both must put the same car in the same corner at the same lock.

import type { TrackLayout } from '@/data/tracks'
import { FRONT_LEAD_M, carAttitude, steerAngles, type Attitude, type Steer } from './car-sprite'
import { PROFILE_N, lateralG, sampleLap } from './lap-dynamics'
import { solveLap } from './lap-solve'
import type { Vec } from './geom'

/** Test liveries for preview fields, spread so neighbours never share a colour. */
export const PREVIEW_LIVERIES = [
  '#E8442E', '#2F7BE8', '#F2C230', '#39B26A', '#B565E0', '#E8792E', '#39C4C4', '#E85BA0',
] as const

export interface FieldCar {
  x: number
  y: number
  /** Sprite rotation: heading plus the quarter-turn the artwork is authored at. */
  rot: number
  attitude: Attitude
  steer: Steer
  /** The raw normalised lap accelerations behind the attitude, for the 3D field's real rotations. */
  lat: number
  long: number
  /** Lap fraction, for anything that wants to label or colour by position. */
  frac: number
}

/** Resample a closed polyline to `n` points of equal arc length: what the profile physics assumes. */
export function equalArc(pts: ReadonlyArray<Vec>, n: number): { pts: Vec[]; len: number } {
  const cum = [0]
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i % pts.length]
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const len = cum[pts.length]
  const out: Vec[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const target = (i / n) * len
    while (j < pts.length - 1 && cum[j + 1] < target) j++
    const a = pts[j]
    const b = pts[(j + 1) % pts.length]
    const seg = cum[j + 1] - cum[j] || 1
    const f = (target - cum[j]) / seg
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
  }
  return { pts: out, len }
}

export function carField(layout: TrackLayout, n: number): FieldCar[] {
  const lap = solveLap(layout)
  const { pts, len } = equalArc(lap.line.pts, PROFILE_N)
  const dyn = lap.dyn
  return Array.from({ length: n }, (_, i) => {
    const frac = i / n
    const st = Math.round(frac * PROFILE_N) % PROFILE_N
    const here = pts[st]
    const ahead = pts[(st + 2) % PROFILE_N]
    const rot = Math.atan2(ahead.y - here.y, ahead.x - here.x) + Math.PI / 2
    const lat = sampleLap(dyn.lat, frac)
    const long = sampleLap(dyn.long, frac)
    const attitude = carAttitude(lat, long)
    // Wheels turned for the corner a front axle's lead up the road, as the live map does it.
    const steer = steerAngles(
      sampleLap(dyn.curvature, frac + FRONT_LEAD_M / layout.metresPerUnit / len) / layout.metresPerUnit,
      lateralG(dyn, frac, layout.metresPerUnit),
    )
    return { x: here.x, y: here.y, rot, attitude, steer, lat, long, frac }
  })
}
