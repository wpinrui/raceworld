import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAB_CONFIG, encodeRunCode, frameStats, planCells,
  type Cell, type CellResult, type FrameSample,
} from './perf-bench'
import { formatRaw, formatReport, type LabReport } from './perf-report'

/** Frame times spread either side of the mean, so the run is not read as pinned to the display. */
const result = (cell: Cell, meanMs: number): CellResult => ({
  cell,
  stats: frameStats([...Array.from({ length: 99 }, (_, i) => meanMs + (i % 5) - 2), meanMs * 3]),
  paint: { msPerPaint: 4.2, paintedFrac: 1, calls: 318, skipped: 44, sections: { trees: 1.1 } },
  scene: { items: 640, ops: 1180, pathKb: 96, nodes: 2400 },
  tickMs: 0.8,
  composeMs: 0.3, composes: 12, msPerCompose: 9, coldComposeMs: 0, coldComposes: 0,
  busyMs: 5,
})

/** A run where one mitigation pays and one does nothing, which is the pair the report has to separate. */
function run(): LabReport {
  const config = {
    ...DEFAULT_LAB_CONFIG,
    shots: ['racing' as const],
    variants: ['off:pathCache', 'off:visElide', 'hide:trees'],
  }
  const cells = planCells(config, 20)
  const meanFor = (variant: string) => {
    if (variant === 'off:pathCache') return 22 // the cache is earning 6ms a frame
    if (variant === 'off:visElide') return 16.02 // the elision is doing nothing here
    if (variant === 'hide:trees') return 12 // the trees cost 4ms a frame
    return 16
  }
  return {
    circuit: 'monaco',
    at: '2026-07-31T09:00:00.000Z',
    dpr: 2,
    viewport: { w: 1600, h: 900 },
    cars: 20,
    config,
    aborted: false,
    cells,
    results: cells.filter((c) => !c.skip && c.variant !== 'warm').map((c) => result(c, meanFor(c.variant))),
  }
}

describe('formatReport', () => {
  const text = formatReport(run())

  it('carries the run\'s identity and its whole configuration, so a paste needs no covering note', () => {
    expect(text).toContain('circuit monaco')
    expect(text).toContain('viewport 1600x900')
    expect(text).toContain('dpr 2')
    expect(text).toContain('cars 20')
    expect(text).toContain('2026-07-31T09:00:00.000Z')
    expect(text).toContain(`frames ${DEFAULT_LAB_CONFIG.frames}`)
    expect(text).toContain('shots racing')
  })

  it('names every selected variant and the code that reproduces the selection', () => {
    expect(text).toContain('variants off:pathCache, off:visElide, hide:trees')
    expect(text).toContain(`code ${encodeRunCode(run().config)}`)
  })

  it('reports the 1% low as a column of its own', () => {
    expect(text).toContain('1% low')
  })

  it('carries compose time as its own column, the one clock a compose-time mitigation reports to', () => {
    expect(text).toContain('comp ms')
  })

  // A claim about composing is written per compose ("28ms on Monaco"), and the per-frame figure is that
  // divided by however often the shot happened to compose. Both, or the claim cannot be checked.
  it('reports what ONE compose cost, not only what composing cost a frame', () => {
    expect(text).toContain('ms/comp')
    expect(text).toContain('12 composes at 9.00ms each')
  })

  it('states the noise floor, in the unit the deltas are in', () => {
    expect(text).toMatch(/noise \d+\.\d\dms\/frame/)
  })

  // Each cell is 99 frames at its mean and one at three times it, so every mean carries a 1.02 factor
  // and the deltas below are 6ms and 4ms scaled by it.
  it('gives every row a signed delta against what it was scored on', () => {
    expect(text).toMatch(/Path2D cache.*\+6\.12/)
    expect(text).toMatch(/Visibility write elision.*\+0\.02/)
    expect(text).toMatch(/Trees and marshal posts.*-4\.08/)
  })

  // The whole point of this paste: numbers, and nothing that reads them for you. The verdicts, the
  // claims and the sites live in the modal, in front of the run.
  it('states no verdict, no claim and no guidance anywhere', () => {
    for (const prose of [
      'saves ', 'costs ', 'no effect', 'worth ', 'slower', 'EARNED NOTHING', 'claim:', 'site:',
      'VSYNC BOUND', 'A mitigation row is', 'not comparable',
    ]) {
      expect(text).not.toContain(prose)
    }
  })

  it('keeps the JSON out of the numbers, so neither paste is the other\'s tax', () => {
    expect(text).not.toContain('{"circuit"')
  })

  it('says so when a run was stopped part way', () => {
    expect(formatReport({ ...run(), aborted: true })).toContain('aborted 1')
  })
})

describe('formatRaw', () => {
  const parsed = JSON.parse(formatRaw(run()))

  it('is the run on its own, so the text is never the only record', () => {
    expect(parsed.circuit).toBe('monaco')
    expect(parsed.config.shots).toEqual(['racing'])
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows[0].low1).toBeGreaterThan(0)
  })

  it('carries the run code, so a paste of it can be re-run without the text', () => {
    expect(parsed.code).toBe(encodeRunCode(parsed.config))
  })
})

// A mitigation row can turn off more than one flag, and its id is not a flag name.
describe('a mitigation row that turns off a pair of flags', () => {
  const config = {
    ...DEFAULT_LAB_CONFIG,
    shots: ['zoom' as const],
    variants: ['off:geomCache', 'off:cullDisc+geomCache'],
  }
  const cells = planCells(config, 20)
  const text = formatReport({
    circuit: 'monaco',
    at: '2026-07-31T09:00:00.000Z',
    dpr: 2,
    viewport: { w: 1600, h: 900 },
    cars: 20,
    config,
    aborted: false,
    cells,
    results: cells.filter((c) => !c.skip && c.variant !== 'warm').map((c) => result(c, 16)),
  })

  it('carries its own label rather than a flag parsed out of its id', () => {
    expect(text).toContain('Cull disc, memo off')
  })

  it('names the row it was scored against, since it is not the baseline', () => {
    expect(text).toMatch(/Cull disc, memo off.*vs off:geomCache/)
  })
})

/** A run of one shot, with the frame times and the trace the caller cares about. */
function shotRun(
  shot: 'zoom' | 'racing',
  over: (cell: Cell) => Partial<CellResult>,
): LabReport {
  const config = { ...DEFAULT_LAB_CONFIG, shots: [shot], variants: ['off:lodRungs'] }
  const cells = planCells(config, 20)
  return {
    circuit: 'hungary',
    at: '2026-07-31T09:00:00.000Z',
    dpr: 2,
    viewport: { w: 1600, h: 900 },
    cars: 20,
    config,
    aborted: false,
    cells,
    results: cells.filter((c) => !c.skip && c.variant !== 'warm').map((c) => ({ ...result(c, 16), ...over(c) })),
  }
}

/** Twenty frames crossing one detail bucket at frame 10, with a landed scene and a stall on it. */
const CROSSING_TRACE: FrameSample[] = Array.from({ length: 20 }, (_, i) => ({
  i,
  ms: i === 10 ? 40 : 10,
  pxPerM: i < 10 ? 2 : 1.4,
  bucket: i < 10 ? 2 : 1,
  swapped: i === 10,
}))

describe('the frame trace in the report', () => {
  const text = formatReport(shotRun('zoom', () => ({ trace: CROSSING_TRACE })))

  it('puts the long frames next to the recomposes, which no aggregate row can', () => {
    expect(text).toContain('-- frame trace --')
    expect(text).toMatch(/1 cross\s+1 swap\s+1 long\s+1 atCross\s+0 steady\s+20\.0ms cross\s+10\.0ms other/)
  })

  it('breaks the baseline down by detail bucket, so a steady-state cost has somewhere to show', () => {
    expect(text).toContain('-- baseline buckets --')
    expect(text).toMatch(/bucket\s+1\s+1\.40 px\/m\s+10 frames/)
    expect(text).toMatch(/bucket\s+2\s+2\.00 px\/m\s+10 frames/)
  })

  it('marks each long frame with whether a scene landed on it', () => {
    expect(text).toContain('-- baseline long frames --')
    expect(text).toMatch(/#\s+10\s+40\.0ms\s+1\.40 px\/m\s+bucket\s+1\s+swapped 1/)
  })

  it('leaves the section out of a shot that composes nothing and stuttered on nothing', () => {
    const clean: FrameSample[] = Array.from({ length: 20 }, (_, i) => ({
      i, ms: 10, pxPerM: 2, bucket: 2, swapped: false,
    }))
    expect(formatReport(shotRun('racing', () => ({ trace: clean })))).not.toContain('-- frame trace --')
  })

  it('carries the summary and the long frames in the JSON, and not three hundred rows a cell', () => {
    const raw = JSON.parse(formatRaw(shotRun('zoom', () => ({ trace: CROSSING_TRACE }))))
    expect(raw.rows[0].trace.crossings).toBe(1)
    expect(raw.rows[0].trace.longAtCrossing).toBe(1)
    expect(raw.rows[0].longFrameDetail).toHaveLength(1)
    // The count column keeps its own meaning: the detail list is beside it, not on top of it.
    expect(raw.rows[0].longFrames).toBe(1)
  })
})

describe('the noise floor the report prints', () => {
  it('prints it in cpu units on a shot the display was choosing the frame time of', () => {
    // Pinned frame times, so the block reads cpu time; the two baselines drift 0.8ms of it.
    const busyOf = (variant: string) => (variant === 'repeat' ? 4.8 : variant === 'baseline' ? 4 : 4.5)
    const text = formatReport(shotRun('zoom', (c) => ({
      stats: frameStats(Array(100).fill(16.7)), busyMs: busyOf(c.variant),
    })))
    // The share of baseline frames pinned to the display's floor, which is the number that says the
    // block moved to the cpu clock. It replaced a paragraph saying so.
    expect(text).toContain('atFloor 100%')
    expect(text).toMatch(/noise 0\.80ms cpu/)
    // And the row's delta is on that same clock: 4.5 against the baseline's 4.
    expect(text).toMatch(/Detail ladder.*\+0\.50/)
  })

  it('still prints it in frame units where frame time had room to move', () => {
    expect(formatReport(run())).toMatch(/noise \d+\.\d\dms\/frame/)
  })
})
