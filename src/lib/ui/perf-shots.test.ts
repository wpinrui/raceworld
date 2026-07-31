import { describe, expect, it } from 'vitest'
import {
  LAP_FRAMES, RACE_PX_PER_M, SHOTS, centreOn, shotById, trackFeatures, zoomForPxPerM,
  type ShotWorld,
} from './perf-shots'

const world = (over: Partial<ShotWorld> = {}): ShotWorld => ({
  vb: { x: 0, y: 0, w: 1000, h: 600 },
  stage: { w: 1600, h: 960 },
  metresPerUnit: 2,
  trackAt: (f) => ({ x: (((f % 1) + 1) % 1) * 1000, y: 300 }),
  cornerF: 0.25,
  pitF: 0.9,
  rot0: 0,
  ...over,
})

describe('camera arithmetic', () => {
  it('turns a pixels-per-metre into the zoom that produces it', () => {
    const w = world()
    const z = zoomForPxPerM(RACE_PX_PER_M, w)
    // The renderer's own definition of the scale, inverted.
    expect((w.stage.w / w.vb.w) * z / w.metresPerUnit).toBeCloseTo(RACE_PX_PER_M, 9)
  })

  it('puts the named point at the centre of the stage', () => {
    const w = world()
    const cam = centreOn({ x: 250, y: 300 }, 4, 0, w)
    // Undo the transform the world layer applies and the point should land on the stage centre.
    const sx = ((250 - w.vb.x) / w.vb.w) * w.stage.w * cam.z + cam.x
    const sy = ((300 - w.vb.y) / w.vb.h) * w.stage.h * cam.z + cam.y
    expect(sx).toBeCloseTo((w.stage.w / 2) * cam.z, 6)
    expect(sy).toBeCloseTo((w.stage.h / 2) * cam.z, 6)
  })
})

describe('shots', () => {
  it('holds the parked camera absolutely still, which is what the repaint guard needs', () => {
    const w = world()
    const still = shotById('still')
    const a = still.pose(0, 90, w)
    const b = still.pose(60, 90, w)
    expect(b).toEqual(a)
  })

  it('advances a sweeping shot at the speed a followed car travels', () => {
    const w = world()
    const racing = shotById('racing')
    const a = racing.pose(0, 90, w)
    const b = racing.pose(60, 90, w)
    expect(b.x).not.toBe(a.x)
    // Sixty frames is 60/LAP_FRAMES of a lap and no more: a shot that covered a quarter lap in a cell
    // would be measuring a camera nobody drives.
    const travelled = Math.abs(b.x - a.x) / (a.z * (w.stage.w / w.vb.w))
    expect(travelled).toBeCloseTo((60 / LAP_FRAMES) * w.vb.w, 3)
  })

  it('centres a sweeping shot on its landmark at the middle frame', () => {
    const w = world({ cornerF: 0.25 })
    const mid = shotById('racing').pose(45, 90, w)
    expect(mid).toEqual(centreOn(w.trackAt(0.25), zoomForPxPerM(RACE_PX_PER_M, w), 0, w))
  })

  it('holds the zoom sweep at its starting scale through warmup rather than past the zoom limits', () => {
    const w = world()
    const zoom = shotById('zoom')
    expect(zoom.pose(-20, 90, w).z).toBeCloseTo(zoom.pose(0, 90, w).z, 9)
  })

  it('steps the bearing shot rather than turning it continuously', () => {
    const w = world()
    const rot = shotById('rotate')
    expect(rot.pose(0, 90, w).rot).toBe(rot.pose(20, 90, w).rot)
    expect(rot.pose(30, 90, w).rot).not.toBe(rot.pose(0, 90, w).rot)
  })

  it('gives every shot a distinct id', () => {
    expect(new Set(SHOTS.map((s) => s.id)).size).toBe(SHOTS.length)
  })

  it('aims the parked shot at the pit straight, which is where a serviced car sits', () => {
    const w = world({ cornerF: 0.25, pitF: 0.9 })
    expect(shotById('still').pose(0, 90, w))
      .toEqual(centreOn(w.trackAt(0.9), zoomForPxPerM(RACE_PX_PER_M, w), 0, w))
  })

  it('marks exactly one shot as not repainting, because the guard is the only thing that stops a paint', () => {
    expect(SHOTS.filter((s) => !s.repaints).map((s) => s.id)).toEqual(['still'])
  })
})

describe('trackFeatures', () => {
  // A long straight along +x, then a tight return: the turn is unambiguously in the last tenth.
  const at = (f: number) => {
    const t = (((f % 1) + 1) % 1)
    if (t < 0.9) return { x: (t / 0.9) * 900, y: 0 }
    const a = ((t - 0.9) / 0.1) * Math.PI
    return { x: 900 + Math.sin(a) * 50, y: 50 - Math.cos(a) * 50 }
  }

  it('finds the tightest corner rather than a point on the straight', () => {
    const { cornerF } = trackFeatures(at, 1900, 1, null)
    expect(cornerF).toBeGreaterThanOrEqual(0.89)
    expect(cornerF).toBeLessThan(1)
  })

  it('finds the lap fraction nearest the pit complex', () => {
    const { pitF } = trackFeatures(at, 1900, 1, { cx: 450, cy: 0 })
    expect(pitF).toBeCloseTo(0.45, 2)
  })

  it('leaves the pit fraction at the start when a circuit has no complex', () => {
    expect(trackFeatures(at, 1900, 1, null).pitF).toBe(0)
  })
})
