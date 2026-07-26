// #sim-2d — the pit complex as canvas ops. The complex is submitted STRETCH BY STRETCH along the lane
// rather than whole, so each op carries a disc of its own rather than sharing one that covers the
// whole building. That is the point of the change and also its one new failure mode: a disc that does
// not hold its own path means `drawScene` skips a path the viewport can see, and a slice of the
// building blinks out as the camera moves along it.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildPitSlots, buildPitZone, pitViewAzimuth } from '@/lib/ui/pit-zone'
import { MOODS, litFace, screenUpAzimuth, shadeFace, shadowFill } from '@/lib/ui/lighting'
import { PIT_WHITE, pitComplexOps, pitFloorOps } from './PitBuilding'

const IDS = Object.keys(TRACK_LAYOUTS)

/** Every coordinate pair a path names. Everything here is written as M/L, so the numbers are points. */
function points(d: string): Array<{ x: number; y: number }> {
  const nums = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? []
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] })
  return out
}

const build = (id: string, teams: number, rot = 0) => {
  const layout = TRACK_LAYOUTS[id]
  const u = (m: number) => m / layout.metresPerUnit
  const lighting = { ...MOODS.afternoon, azimuth: pitViewAzimuth(layout) ?? MOODS.afternoon.azimuth }
  const zone = buildPitZone(layout, buildPitSlots(layout, teams))!
  return {
    zone,
    u,
    ops: [
      ...pitFloorOps(zone, lighting),
      ...pitComplexOps(zone, u, lighting, screenUpAzimuth(rot)),
    ],
  }
}

describe('pitComplexOps', () => {
  it('gives every op a disc that holds its own path', () => {
    // Checked at several camera rotations: the projection direction follows the camera, so which way
    // a wall or a shadow leans off its footprint is not fixed, and a disc measured off the footprint
    // alone would pass at one bearing and clip the mass off at another.
    for (const id of IDS) {
      for (const rot of [0, 0.9, -2.1]) {
        const { ops } = build(id, 11, rot)
        expect(ops.length).toBeGreaterThan(0)
        for (const [i, op] of ops.entries()) {
          expect(op.clip, `${id} @ ${rot}: op ${i} has no disc`).toBeDefined()
          for (const p of points(op.d)) {
            const d = Math.hypot(p.x - op.clip!.cx, p.y - op.clip!.cy)
            expect(d, `${id} @ ${rot}: op ${i} reaches ${(d - op.clip!.r).toFixed(3)} outside its disc`)
              .toBeLessThanOrEqual(op.clip!.r + 1e-6)
          }
        }
      }
    }
  }, 30000)

  it('keeps every disc far smaller than one round the whole complex', () => {
    // The whole reason for the cut. One disc round the complex can never cull anything at racing zoom,
    // because the complex is always at least partly in shot when you are on the pit straight.
    for (const id of IDS) {
      const { zone, ops } = build(id, 11)
      const pts = [...zone.buildingPts, ...zone.upperPts]
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const whole = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)))
      const worst = Math.max(...ops.map((op) => op.clip!.r))
      expect(worst, `${id}: an op still reaches across the whole complex`).toBeLessThan(whole * 0.75)
    }
  })

  it('paints layer by layer across the stretches, never stretch by stretch', () => {
    // Stretch-major would let one stretch's roof land under its neighbour's wall, which is a different
    // picture from the whole-complex version this replaces, and the union of the stretches is only
    // identical to the whole while the layers stay in the order it drew them.
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const lighting = { ...MOODS.afternoon, azimuth: pitViewAzimuth(layout) ?? MOODS.afternoon.azimuth }
      const { zone, ops } = build(id, 11)
      const n = zone.spans.length
      const at = (fill: string) => ops.flatMap((op, i) => (op.fill === fill ? [i] : []))
      const shade = at(shadeFace(PIT_WHITE, lighting))
      const lit = at(litFace(PIT_WHITE, lighting))
      const shade2 = at(shadowFill(lighting))
      // One shadow and one roof per stretch, and the two storeys' walls share their tone.
      expect(shade2, `${id}: shadows`).toHaveLength(n)
      expect(lit, `${id}: roofs`).toHaveLength(n)
      expect(shade, `${id}: walls`).toHaveLength(2 * n)
      expect(Math.max(...shade2), `${id}: a shadow lands over a wall`).toBeLessThan(Math.min(...shade))
      expect(Math.max(...shade), `${id}: a wall lands over a roof`).toBeLessThan(Math.min(...lit))
    }
  })
})
