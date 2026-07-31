// The perf lab's run, as text you can paste (#sim-2d).
//
// One button has to hand over everything a reader needs to argue with the numbers: which circuit, which
// viewport, which pixel density, how many frames a cell got, which shots and which variants were
// selected, what the run's own noise floor turned out to be, and then every row. So the copy carries the
// configuration inline rather than as a separate thing to remember to include, and it ends with the raw
// JSON so nothing here has to be the only record.

import { blocksOf, verdictFor, type Cell, type CellResult, type LabConfig, type ShotBlock } from './perf-bench'
import { PERF_FLAG_INFO, type PerfFlag } from './perf-flags'

export interface LabReport {
  circuit: string
  /** ISO stamp, supplied by the caller so this module stays pure. */
  at: string
  dpr: number
  viewport: { w: number; h: number }
  cars: number
  config: LabConfig
  aborted: boolean
  cells: Cell[]
  results: CellResult[]
}

const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length))
const rt = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s)
const num = (v: number, w: number, dp = 0) => rt(Number.isFinite(v) ? v.toFixed(dp) : '-', w)

const NAME_W = 30
/** Column headings and their widths, so the heading row and the data rows cannot drift apart. */
const COLS: ReadonlyArray<readonly [string, number]> = [
  ['fps', 6], ['1% low', 8], ['p95ms', 8], ['max ms', 8], ['long', 6], ['paint', 8], ['calls', 8],
]

const tableHead = (): string =>
  pad('', NAME_W) + COLS.map(([h, w]) => rt(h, w)).join('') + '   verdict'

function rowLine(r: CellResult, verdict: string): string {
  const { stats: s, paint: p } = r
  return pad(`  ${r.cell.label}`, NAME_W)
    + num(s.fps, 6) + num(s.low1, 8) + num(s.p95Ms, 8, 1) + num(s.maxMs, 8, 1)
    + num(s.longFrames, 6) + num(p.msPerPaint, 8, 2) + num(p.calls, 8)
    + (verdict ? `   ${verdict}` : '')
}

function blockText(b: ShotBlock): string[] {
  const out: string[] = ['', `SHOT ${b.shot.label.toUpperCase()}  ${b.shot.note}`]
  if (!b.baseline) return [...out, '  not run']
  out.push(`  noise floor ${b.noiseMs.toFixed(2)}ms/frame (the two baselines' own spread)`)
  out.push(tableHead())
  out.push(rowLine(b.baseline, `scene ${b.baseline.scene.items} items, ${b.baseline.scene.ops} ops, `
    + `${b.baseline.scene.pathKb.toFixed(0)}KB paths, ${b.baseline.scene.nodes} nodes, `
    + `tick ${b.baseline.tickMs.toFixed(2)}ms, painted ${(b.baseline.paint.frac * 100).toFixed(0)}% of frames`))
  const groups: Array<CellResult['cell']['group']> = ['mitigation', 'layer', 'quality', 'renderer']
  for (const g of groups) {
    const rows = b.rows.filter((r) => r.cell.group === g)
    if (rows.length === 0) continue
    out.push(`  -- ${g} --`)
    for (const r of rows) out.push(rowLine(r, verdictFor(r, b.baseline.stats, b.noiseMs).text))
  }
  if (b.repeat) out.push(rowLine(b.repeat, 'the baseline again, at the end of the shot'))
  for (const c of b.skipped) out.push(`  ${pad(c.label, NAME_W - 2)} skipped: ${c.skip}`)
  return out
}

/** Mitigations that failed to justify themselves anywhere they were measured. The point of the lab. */
function idleMitigations(blocks: ShotBlock[]): string[] {
  const seen = new Map<string, { ran: number; idle: number; backfired: number }>()
  for (const b of blocks) {
    if (!b.baseline) continue
    for (const r of b.rows) {
      if (r.cell.group !== 'mitigation') continue
      const v = verdictFor(r, b.baseline.stats, b.noiseMs)
      const rec = seen.get(r.cell.variant) ?? { ran: 0, idle: 0, backfired: 0 }
      rec.ran++
      if (v.kind === 'nothing') rec.idle++
      if (v.kind === 'backfires') rec.backfired++
      seen.set(r.cell.variant, rec)
    }
  }
  const lines: string[] = []
  for (const [id, rec] of seen) {
    if (rec.ran === 0 || rec.idle + rec.backfired < rec.ran) continue
    const flag = id.slice('off:'.length) as PerfFlag
    const info = PERF_FLAG_INFO[flag]
    const how = rec.backfired > 0 ? 'made the frame FASTER when turned off' : 'changed nothing measurable'
    lines.push(`  ${info.label}: ${how} in all ${rec.ran} shot(s) it ran in.`)
    lines.push(`    claim: ${info.claim}`)
    lines.push(`    site: ${info.site}`)
  }
  return lines
}

export function formatReport(report: LabReport): string {
  const results = new Map(report.results.map((r) => [r.cell.key, r]))
  const blocks = blocksOf(report.cells, results)
  const cfg = report.config
  const lines: string[] = [
    'RaceWorld 2D renderer perf lab',
    `circuit ${report.circuit}   viewport ${report.viewport.w}x${report.viewport.h} @ dpr ${report.dpr}`
    + `   ${report.cars} cars   ${report.at}`,
    `${cfg.frames} measured frames per cell (+${cfg.warmup} warmup), uncapped, canvas renderer, quality medium`,
    `shots: ${cfg.shots.join(', ')}`,
    `variants: ${cfg.variants.length} selected`,
  ]
  if (report.aborted) lines.push('RUN ABORTED: the rows below are what completed.')
  lines.push(
    '',
    'A mitigation row is that mitigation turned OFF, so "saves 1.2ms" means the shipping renderer is',
    '1.2ms a frame faster for having it. "no effect" means it is buying nothing here. A layer row is',
    'that layer hidden, so "worth 1.2ms" is what drawing it costs.',
  )
  for (const b of blocks) lines.push(...blockText(b))

  const idle = idleMitigations(blocks)
  lines.push('', 'MITIGATIONS THAT EARNED NOTHING')
  lines.push(...(idle.length > 0 ? idle : ['  none: every measured mitigation moved the frame time.']))

  lines.push('', 'RAW', JSON.stringify({
    circuit: report.circuit, at: report.at, dpr: report.dpr, viewport: report.viewport,
    cars: report.cars, aborted: report.aborted, config: cfg,
    rows: report.results.map((r) => ({
      shot: r.cell.shot, variant: r.cell.variant, group: r.cell.group, config: r.cell.config,
      fps: +r.stats.fps.toFixed(1), low1: +r.stats.low1.toFixed(1), meanMs: +r.stats.meanMs.toFixed(3),
      p95Ms: +r.stats.p95Ms.toFixed(2), maxMs: +r.stats.maxMs.toFixed(2), longFrames: r.stats.longFrames,
      frames: r.stats.frames, paint: r.paint, scene: r.scene, tickMs: +r.tickMs.toFixed(3),
    })),
    skipped: report.cells.filter((c) => c.skip).map((c) => ({ key: c.key, reason: c.skip })),
  }))
  return lines.join('\n')
}
