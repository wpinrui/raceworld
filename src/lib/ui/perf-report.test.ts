import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAB_CONFIG, frameStats, planCells, type Cell, type CellResult,
} from './perf-bench'
import { formatReport, type LabReport } from './perf-report'

const result = (cell: Cell, meanMs: number): CellResult => ({
  cell,
  stats: frameStats([...Array(99).fill(meanMs), meanMs * 3]),
  paint: { msPerPaint: 4.2, frac: 1, calls: 318, skipped: 44, sections: { trees: 1.1 } },
  scene: { items: 640, ops: 1180, pathKb: 96, nodes: 2400 },
  tickMs: 0.8,
})

/** A run where one mitigation pays and one does nothing, which is the pair the report has to separate. */
function run(): LabReport {
  const config = {
    ...DEFAULT_LAB_CONFIG,
    shots: ['racing' as const],
    variants: ['off:pathCache', 'off:mergePaint', 'hide:trees'],
  }
  const cells = planCells(config, 20)
  const meanFor = (variant: string) => {
    if (variant === 'off:pathCache') return 22 // the cache is earning 6ms a frame
    if (variant === 'off:mergePaint') return 16.02 // batching is doing nothing here
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
    expect(text).toMatch(/Paint batching.*no effect/)
  })

  it('reads a hidden layer as what drawing it costs', () => {
    expect(text).toMatch(/Trees and marshal posts.*worth 4\.08ms\/frame/)
  })

  it('names every mitigation that earned nothing, with its claim and its site', () => {
    const tail = text.slice(text.indexOf('MITIGATIONS THAT EARNED NOTHING'))
    expect(tail).toContain('Paint batching')
    expect(tail).toContain('lod.mergeByPaint')
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
