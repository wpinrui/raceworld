import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAB_CONFIG, LAP_FRAMES, RACE_PX_PER_M, SHOTS, blocksOf, centreOn, estimateSeconds,
  frameStats, noiseFloorMs, planCells, shotById, trackFeatures, verdictFor, vsyncBound,
  zoomForPxPerM, type Cell, type CellResult, type ShotWorld,
} from './perf-bench'

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

describe('frameStats', () => {
  it('reports the 1% low as the mean of the worst one per cent of frames', () => {
    // Ninety-nine 10ms frames and one 100ms frame: the mean rate is fine and the stutter is not.
    const deltas = [...Array(99).fill(10), 100]
    const s = frameStats(deltas)
    expect(s.frames).toBe(100)
    expect(s.fps).toBeCloseTo(1000 / 10.9, 3)
    expect(s.low1Ms).toBe(100)
    expect(s.low1).toBeCloseTo(10, 6)
    expect(s.maxMs).toBe(100)
    expect(s.longFrames).toBe(1)
  })

  it('takes at least one frame into the 1% low, so a short cell still reports its worst', () => {
    expect(frameStats([10, 12, 40]).low1Ms).toBe(40)
  })

  it('averages the whole tail when one per cent is several frames', () => {
    const deltas = [...Array(198).fill(10), 40, 60]
    // 1% of 200 is 2 frames: the two worst, meaned.
    expect(frameStats(deltas).low1Ms).toBe(50)
  })

  it('survives an empty cell', () => {
    const s = frameStats([])
    expect(s.frames).toBe(0)
    expect(s.fps).toBe(0)
    expect(s.low1).toBe(0)
  })
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

describe('planCells', () => {
  const cfg = { ...DEFAULT_LAB_CONFIG, shots: ['racing', 'still'] as const, variants: ['off:cameraGuard', 'hide:trees'] }

  it('runs one baseline before and one after each shot, so the run carries its own noise floor', () => {
    const cells = planCells({ ...cfg, shots: ['racing'] }, 20)
    expect(cells.map((c) => c.variant)).toEqual(['baseline', 'off:cameraGuard', 'hide:trees', 'repeat'])
  })

  it('keeps a variant that cannot apply, with the reason, rather than dropping it silently', () => {
    const cells = planCells({ ...cfg, shots: ['racing'] }, 20)
    const guard = cells.find((c) => c.variant === 'off:cameraGuard')!
    expect(guard.skip).toMatch(/camera moves/)
  })

  it('runs the same variant where the shot can exercise it', () => {
    const cells = planCells({ ...cfg, shots: ['still'] }, 20)
    expect(cells.find((c) => c.variant === 'off:cameraGuard')!.skip).toBeUndefined()
  })

  it('skips the cull disc only where the whole circuit is in shot', () => {
    const v = ['off:cullDisc']
    expect(planCells({ ...cfg, shots: ['wide'], variants: v }, 20)
      .find((c) => c.variant === 'off:cullDisc')!.skip).toMatch(/whole circuit/)
    expect(planCells({ ...cfg, shots: ['racing'], variants: v }, 20)
      .find((c) => c.variant === 'off:cullDisc')!.skip).toBeUndefined()
  })

  it('skips the visibility-write row when there is no field to write visibility for', () => {
    const v = ['off:visElide']
    expect(planCells({ ...cfg, shots: ['racing'], variants: v }, 0)
      .find((c) => c.variant === 'off:visElide')!.skip).toMatch(/no cars/)
    expect(planCells({ ...cfg, shots: ['racing'], variants: v }, 20)
      .find((c) => c.variant === 'off:visElide')!.skip).toBeUndefined()
  })

  it('orders rows by the catalogue, not by the order the boxes were ticked', () => {
    const a = planCells({ ...cfg, shots: ['still'], variants: ['hide:trees', 'off:cameraGuard'] }, 20)
    const b = planCells({ ...cfg, shots: ['still'], variants: ['off:cameraGuard', 'hide:trees'] }, 20)
    expect(a.map((c) => c.variant)).toEqual(b.map((c) => c.variant))
  })

  it('costs one cell per variant per shot plus the two baselines, never a cross product', () => {
    const cells = planCells({ ...cfg, shots: ['racing', 'still'] }, 20)
    expect(cells.length).toBe(2 * (2 + 2))
  })

  it('leaves a skipped cell out of the estimate', () => {
    const cells = planCells({ ...cfg, shots: ['racing'] }, 20)
    const run = cells.filter((c) => !c.skip).length
    expect(run).toBe(3)
    expect(estimateSeconds(cells, DEFAULT_LAB_CONFIG))
      .toBeCloseTo(run * ((DEFAULT_LAB_CONFIG.frames + DEFAULT_LAB_CONFIG.warmup) / 60 + 0.4), 6)
  })
})

/** A cell whose frame times vary, so it is not mistaken for one pinned to the display. */
const stats = (meanMs: number) => frameStats(
  Array.from({ length: 100 }, (_, i) => meanMs + (i % 5) - 2),
)

const result = (cell: Cell, meanMs: number, busyMs = 5): CellResult => ({
  cell,
  stats: stats(meanMs),
  paint: { msPerPaint: 1, frac: 1, calls: 100, skipped: 0, sections: {} },
  scene: { items: 10, ops: 20, pathKb: 1, nodes: 100 },
  tickMs: 0.5,
  busyMs,
})

describe('vsyncBound', () => {
  it('calls a cell pinned to the display floor bound, whatever its mean says', () => {
    expect(vsyncBound(frameStats(Array(100).fill(16.7)))).toBe(true)
    expect(vsyncBound(frameStats([...Array(95).fill(16.7), ...Array(5).fill(40)]))).toBe(true)
  })

  it('leaves a cell with real spread alone', () => {
    expect(vsyncBound(stats(24))).toBe(false)
  })
})

describe('verdicts', () => {
  const cells = planCells(
    { ...DEFAULT_LAB_CONFIG, shots: ['racing'], variants: ['off:pathCache', 'hide:trees'] }, 20,
  )
  const mitigation = cells.find((c) => c.variant === 'off:pathCache')!
  const layer = cells.find((c) => c.variant === 'hide:trees')!
  const base = result(cells[0], 16)

  it('reads a slower mitigation-off row as the mitigation earning its keep', () => {
    const v = verdictFor(result(mitigation, 18), base, 0.2)
    expect(v.kind).toBe('saves')
    expect(v.text).toBe('saves 2.00ms/frame')
  })

  it('reads a level mitigation-off row as the mitigation earning nothing', () => {
    expect(verdictFor(result(mitigation, 16.1), base, 0.2).kind).toBe('nothing')
  })

  it('reads a faster mitigation-off row as the mitigation costing more than it saves', () => {
    const v = verdictFor(result(mitigation, 15), base, 0.2)
    expect(v.kind).toBe('backfires')
    expect(v.text).toBe('costs 1.00ms/frame')
  })

  it('reads a faster layer-hidden row as what that layer costs to draw', () => {
    const v = verdictFor(result(layer, 14), base, 0.2)
    expect(v.kind).toBe('cost')
    expect(v.text).toBe('worth 2.00ms/frame')
  })

  it('judges on main-thread time when the shot had no frame-time headroom', () => {
    // Same frame time either way, which is what a vsync ceiling does to every row on a fast machine.
    const row = result(mitigation, 16, 9)
    expect(verdictFor(row, base, 0.2, false).kind).toBe('nothing')
    const v = verdictFor(row, base, 0.2, true)
    expect(v.kind).toBe('saves')
    expect(v.text).toBe('saves 4.00ms cpu')
  })

  it('still calls a mitigation idle when neither frame time nor cpu time moved', () => {
    expect(verdictFor(result(mitigation, 16, 5.1), base, 0.2, true).kind).toBe('nothing')
  })

  it('takes the noise floor from the two baselines, with a floor under it', () => {
    expect(noiseFloorMs(stats(16), stats(16.9))).toBeCloseTo(0.9, 6)
    // Identical baselines do not make every row significant.
    expect(noiseFloorMs(stats(16), stats(16))).toBeCloseTo(0.32, 6)
    expect(noiseFloorMs(stats(1), stats(1))).toBe(0.15)
  })
})

describe('blocksOf', () => {
  it('resolves each shot\'s baselines and keeps its skipped rows with it', () => {
    const cells = planCells(
      { ...DEFAULT_LAB_CONFIG, shots: ['racing', 'still'], variants: ['off:cameraGuard', 'hide:trees'] },
      20,
    )
    const results = new Map(
      cells.filter((c) => !c.skip).map((c) => [c.key, result(c, c.variant === 'baseline' ? 16 : 18)]),
    )
    const blocks = blocksOf(cells, results)
    expect(blocks.map((b) => b.shot.id)).toEqual(['racing', 'still'])
    expect(blocks[0].baseline).toBeDefined()
    expect(blocks[0].repeat).toBeDefined()
    expect(blocks[0].skipped.map((c) => c.variant)).toEqual(['off:cameraGuard'])
    expect(blocks[0].rows.map((r) => r.cell.variant)).toEqual(['hide:trees'])
    expect(blocks[1].rows.map((r) => r.cell.variant)).toEqual(['off:cameraGuard', 'hide:trees'])
    expect(blocks[0].vsync).toBe(false)
  })

  it('marks a shot vsync bound from its own baseline', () => {
    const cells = planCells({ ...DEFAULT_LAB_CONFIG, shots: ['racing'], variants: [] }, 20)
    const pinned = (c: Cell): CellResult => ({
      ...result(c, 16), stats: frameStats(Array(100).fill(16.7)),
    })
    expect(blocksOf(cells, new Map(cells.map((c) => [c.key, pinned(c)])))[0].vsync).toBe(true)
  })
})
