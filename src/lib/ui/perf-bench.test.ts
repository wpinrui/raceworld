import { describe, expect, it } from 'vitest'
import {
  COLUMNS, DEFAULT_LAB_CONFIG, blocksOf, cellMetrics, estimateSeconds, frameStats, noiseFloorMs,
  planCells, verdictFor, vsyncBound, type Cell, type CellResult, type Counters,
} from './perf-bench'

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

describe('the shared column model', () => {
  it('covers the 1% low, which is the number a mean frame rate hides', () => {
    expect(COLUMNS.map((c) => c.key)).toContain('low1')
  })

  it('gives every column a distinct key', () => {
    expect(new Set(COLUMNS.map((c) => c.key)).size).toBe(COLUMNS.length)
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

  it('skips every paint-side mitigation in the parked shot, which only ever paints once', () => {
    const inside = ['off:pathCache', 'off:paintState', 'off:itemCull', 'off:mergePaint',
      'off:batchFlat', 'off:lodRungs', 'off:cullDisc']
    const cells = planCells({ ...cfg, shots: ['still'], variants: inside }, 20)
    for (const id of inside) {
      expect(cells.find((c) => c.variant === id)!.skip).toMatch(/one paint/)
    }
    // And runs every one of them where the shot does keep painting.
    const racing = planCells({ ...cfg, shots: ['racing'], variants: inside }, 20)
    for (const id of inside) expect(racing.find((c) => c.variant === id)!.skip).toBeUndefined()
  })

  it('splits the static world from the moving one, which no single category can', () => {
    const cells = planCells({ ...cfg, shots: ['racing'], variants: ['hide:static', 'hide:dynamic'] }, 20)
    expect(cells.find((c) => c.variant === 'hide:static')!.config.hide).toContain('trees')
    expect(cells.find((c) => c.variant === 'hide:dynamic')!.config.hide).toEqual(['cars', 'boxes'])
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
  paint: { msPerPaint: 1, paintedFrac: 1, calls: 100, skipped: 0, sections: {} },
  scene: { items: 10, ops: 20, pathKb: 1, nodes: 100 },
  tickMs: 0.5,
  busyMs,
})

describe('cellMetrics', () => {
  const counters = (over: Partial<Counters> = {}): Counters => ({
    n: 0, ms: 0, drawn: 0, skipped: 0, sections: {}, tickN: 0, tickSum: 0, paintedFrames: 0, ...over,
  })

  it('spreads paint time over FRAMES and command time over PAINTS', () => {
    // 90 frames, 90 paints of 4ms each, 90 ticks of 0.8ms.
    const m = cellMetrics(
      counters(),
      counters({ n: 90, ms: 360, tickN: 90, tickSum: 72, paintedFrames: 90 }),
      90,
    )
    expect(m.paint.msPerPaint).toBeCloseTo(4, 9)
    expect(m.tickMs).toBeCloseTo(0.8, 9)
    expect(m.busyMs).toBeCloseTo(4.8, 9)
  })

  // The bug this function was pulled out to make testable: reading the counters before the warmup
  // charges the configuration switch and its forced compose against the measured frames.
  it('carries no warmup work when the window is the measured frames', () => {
    const warmedUp = counters({ n: 20, ms: 80, tickN: 20, tickSum: 16, paintedFrames: 20 })
    const end = counters({ n: 110, ms: 440, tickN: 110, tickSum: 88, paintedFrames: 110 })
    expect(cellMetrics(warmedUp, end, 90).busyMs).toBeCloseTo(4.8, 9)
    // Read from before the warmup instead and the same cell reads a fifth heavier.
    expect(cellMetrics(counters(), end, 90).busyMs).toBeCloseTo(5.689, 3)
  })

  it('charges a frame that skipped its paint nothing for it', () => {
    // The parked shot under the guard: one paint in ninety frames.
    const m = cellMetrics(
      counters(), counters({ n: 1, ms: 4, tickN: 90, tickSum: 72, paintedFrames: 1 }), 90,
    )
    expect(m.paint.msPerPaint).toBeCloseTo(4, 9)
    expect(m.paint.paintedFrac).toBeCloseTo(1 / 90, 9)
    expect(m.busyMs).toBeCloseTo(0.8 + 4 / 90, 9)
  })

  it('never reports more painted frames than frames', () => {
    // A cull step composes and paints inside the camera's own paint, so paints outrun frames.
    const m = cellMetrics(counters(), counters({ n: 140, paintedFrames: 90 }), 90)
    expect(m.paint.paintedFrac).toBe(1)
  })

  it('meters draw calls and skipped items per paint, and sections per frame', () => {
    const m = cellMetrics(
      counters({ sections: { trees: 10 } }),
      counters({ n: 90, drawn: 27000, skipped: 3600, sections: { trees: 100, road: 45 } }),
      90,
    )
    expect(m.paint.calls).toBe(300)
    expect(m.paint.skipped).toBe(40)
    expect(m.paint.sections).toEqual({ trees: 1, road: 0.5 })
  })

  it('reports zeroes rather than dividing by nothing on a cell that never painted or ticked', () => {
    const m = cellMetrics(counters(), counters(), 0)
    expect(m.paint.msPerPaint).toBe(0)
    expect(m.paint.calls).toBe(0)
    expect(m.tickMs).toBe(0)
    expect(m.busyMs).toBe(0)
  })
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
    const v = verdictFor({ row: result(mitigation, 18), baseline: base, noiseMs: 0.2, basis: 'frame' })
    expect(v.kind).toBe('saves')
    expect(v.text).toBe('saves 2.00ms/frame')
  })

  it('reads a level mitigation-off row as the mitigation earning nothing', () => {
    expect(verdictFor({ row: result(mitigation, 16.1), baseline: base, noiseMs: 0.2, basis: 'frame' }).kind).toBe('nothing')
  })

  it('reads a faster mitigation-off row as the mitigation costing more than it saves', () => {
    const v = verdictFor({ row: result(mitigation, 15), baseline: base, noiseMs: 0.2, basis: 'frame' })
    expect(v.kind).toBe('backfires')
    expect(v.text).toBe('costs 1.00ms/frame')
  })

  it('reads a faster layer-hidden row as what that layer costs to draw', () => {
    const v = verdictFor({ row: result(layer, 14), baseline: base, noiseMs: 0.2, basis: 'frame' })
    expect(v.kind).toBe('cost')
    expect(v.text).toBe('worth 2.00ms/frame')
  })

  it('judges on main-thread time when the shot had no frame-time headroom', () => {
    // Same frame time either way, which is what a vsync ceiling does to every row on a fast machine.
    const row = result(mitigation, 16, 9)
    expect(verdictFor({ row: row, baseline: base, noiseMs: 0.2, basis: false ? 'cpu' : 'frame' }).kind).toBe('nothing')
    const v = verdictFor({ row: row, baseline: base, noiseMs: 0.2, basis: true ? 'cpu' : 'frame' })
    expect(v.kind).toBe('saves')
    expect(v.text).toBe('saves 4.00ms cpu')
  })

  it('still calls a mitigation idle when neither frame time nor cpu time moved', () => {
    expect(verdictFor({ row: result(mitigation, 16, 5.1), baseline: base, noiseMs: 0.2, basis: true ? 'cpu' : 'frame' }).kind).toBe('nothing')
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
