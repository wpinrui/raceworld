import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAB_CONFIG, frameStats, planCells,
  type Cell, type CellResult, type FrameSample,
} from './perf-bench'
import { formatReport, type LabReport } from './perf-report'

/** Frame times spread either side of the mean, so the run is not read as pinned to the display. */
const result = (cell: Cell, meanMs: number): CellResult => ({
  cell,
  stats: frameStats([...Array.from({ length: 99 }, (_, i) => meanMs + (i % 5) - 2), meanMs * 3]),
  paint: { msPerPaint: 4.2, paintedFrac: 1, calls: 318, skipped: 44, sections: { trees: 1.1 } },
  scene: { items: 640, ops: 1180, pathKb: 96, nodes: 2400 },
  tickMs: 0.8,
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
    results: cells.filter((c) => !c.skip).map((c) => result(c, meanFor(c.variant))),
  }
}

describe('formatReport', () => {
  const text = formatReport(run())

  it('carries the run\'s identity and its whole configuration, so a paste needs no covering note', () => {
    expect(text).toContain('circuit monaco')
    expect(text).toContain('1600x900 @ dpr 2')
    expect(text).toContain('20 cars')
    expect(text).toContain('2026-07-31T09:00:00.000Z')
    expect(text).toContain(`${DEFAULT_LAB_CONFIG.frames} measured frames per cell`)
    expect(text).toContain('shots: racing')
  })

  it('reports the 1% low as a column of its own', () => {
    expect(text).toContain('1% low')
  })

  it('states the noise floor the verdicts were judged against', () => {
    expect(text).toMatch(/noise floor \d+\.\d\dms\/frame/)
  })

  // Each cell is 99 frames at its mean and one at three times it, so every mean carries a 1.02 factor
  // and the deltas below are 6ms and 4ms scaled by it.
  it('separates a mitigation that pays from one that does not', () => {
    expect(text).toMatch(/Path2D cache.*saves 6\.12ms\/frame/)
    expect(text).toMatch(/Visibility write elision.*no effect/)
  })

  it('reads a hidden layer as what drawing it costs', () => {
    expect(text).toMatch(/Trees and marshal posts.*worth 4\.08ms\/frame/)
  })

  it('names every mitigation that earned nothing, with its claim and its site', () => {
    const tail = text.slice(text.indexOf('MITIGATIONS THAT EARNED NOTHING'))
    expect(tail).toContain('Visibility write elision')
    expect(tail).toContain('RaceTrackMap.setVis')
    expect(tail).not.toContain('Path2D cache')
  })

  it('ends with the run as JSON, so the text is never the only record', () => {
    const raw = text.slice(text.lastIndexOf('\n', text.indexOf('{"circuit"')) + 1)
    const parsed = JSON.parse(raw)
    expect(parsed.circuit).toBe('monaco')
    expect(parsed.config.shots).toEqual(['racing'])
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows[0].low1).toBeGreaterThan(0)
  })

  it('says so when a run was stopped part way', () => {
    expect(formatReport({ ...run(), aborted: true })).toContain('RUN ABORTED')
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
    results: cells.filter((c) => !c.skip).map((c) => ({ ...result(c, 16), ...over(c) })),
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
    expect(text).toMatch(/1 cross\s+1 swap\s+1 long \(1 within a frame of one, 0 nowhere near one\)/)
  })

  it('breaks the baseline down by detail bucket, so a steady-state cost has somewhere to show', () => {
    expect(text).toContain('baseline by detail bucket, coarsest first')
    expect(text).toMatch(/bucket\s+1\s+1\.40 px\/m\s+10 frames/)
    expect(text).toMatch(/bucket\s+2\s+2\.00 px\/m\s+10 frames/)
  })

  it('names each long frame with what the camera was doing on it', () => {
    expect(text).toContain('baseline long frames:')
    expect(text).toMatch(/#\s+10\s+40\.0ms\s+1\.40 px\/m\s+bucket\s+1\s+a scene landed on this frame/)
  })

  it('leaves the section out of a shot that composes nothing and stuttered on nothing', () => {
    const clean: FrameSample[] = Array.from({ length: 20 }, (_, i) => ({
      i, ms: 10, pxPerM: 2, bucket: 2, swapped: false,
    }))
    expect(formatReport(shotRun('racing', () => ({ trace: clean })))).not.toContain('-- frame trace --')
  })

  it('carries the summary and the long frames in the JSON, and not three hundred rows a cell', () => {
    const raw = JSON.parse(text.slice(text.lastIndexOf('\n', text.indexOf('{"circuit"')) + 1))
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
    expect(text).toContain('VSYNC BOUND')
    expect(text).toMatch(/noise floor 0\.80ms cpu \(the two baselines' own spread\)/)
    // And the row inside that drift is read as the machine rather than as a finding.
    expect(text).toMatch(/Detail ladder.*no effect/)
  })

  it('still prints it in frame units where frame time had room to move', () => {
    expect(formatReport(run())).toMatch(/noise floor \d+\.\d\dms\/frame/)
  })
})
