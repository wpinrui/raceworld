// The perf lab's run, as text you can paste (#sim-2d).
//
// TWO pastes, and the split is the point. This one is the NUMBERS: every cell's columns, every delta,
// the floor those deltas were read against, and the configuration that produced them. What a number
// MEANS is not in here. The verdicts, the claims and the sites are on screen in the modal, in front of
// the run, which is where they can be argued with; in a paste they are the part scrolled past to reach
// the data. `formatRaw` is the same run as JSON, on its own button, so neither paste is the other's tax.
//
// The header still carries the whole configuration inline, because a table of numbers with no circuit,
// viewport, pixel density or frame count on it cannot be argued with either, and the run code reproduces
// the selection exactly.

import {
  COLUMNS, baselineSummary, blocksOf, deltaFor, encodeRunCode, longFramesOf, referenceFor,
  traceSummary, type Cell, type CellResult, type LabConfig, type ShotBlock,
} from './perf-bench'

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
const DELTA_W = 10

/** Signed, so the column reads as row-minus-reference without a sentence saying so. `-` is a delta that
 *  does not exist: the reference was not run, or the two rows are not on the same clock. */
const delta = (v: number | null, w: number) =>
  rt(v === null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, w)

const tableHead = (): string =>
  pad('', NAME_W) + COLUMNS.map((c) => rt(c.head, c.width)).join('') + rt('delta', DELTA_W)

const rowLine = (r: CellResult, d?: number | null, versus?: string | null): string =>
  pad(`  ${r.cell.label}`, NAME_W)
  + COLUMNS.map((c) => num(c.of(r), c.width, c.dp)).join('')
  + (d === undefined ? '' : delta(d, DELTA_W))
  + (versus ? `  vs ${versus}` : '')

/** The long frames put next to the recomposes, which is the one question an aggregate cannot answer.
 *
 *  Printed where a shot composes anything or where the baseline stuttered, and left out otherwise: a
 *  clean shot that never leaves its bucket has a trace saying so in one bucket and one number, and
 *  twelve rows of it in every block is how a report stops being read. */
function traceText(b: ShotBlock): string[] {
  const traced = [b.baseline, ...b.rows, b.repeat]
    .filter((r): r is CellResult & { trace: NonNullable<CellResult['trace']> } => !!r?.trace?.length)
  const base = b.baseline?.trace ? traceSummary(b.baseline.trace) : null
  if (traced.length === 0 || !base) return []
  if (!b.shot.recomposes && base.longFrames === 0) return []
  const out: string[] = ['  -- frame trace --']
  for (const r of traced) {
    const t = traceSummary(r.trace)
    out.push(`  ${pad(r.cell.label, NAME_W - 2)}`
      + `${num(t.crossings, 4)} cross${num(t.swaps, 5)} swap${num(t.longFrames, 6)} long`
      + `${num(t.longAtCrossing, 6)} atCross${num(t.longSteady, 6)} steady`
      + `${num(t.crossingMs, 8, 1)}ms cross${num(t.steadyMs, 8, 1)}ms other`)
  }
  out.push('  -- baseline buckets --')
  for (const band of base.bands) {
    out.push(`    bucket ${rt(String(band.bucket), 3)}${num(band.pxPerM, 7, 2)} px/m`
      + `${num(band.frames, 6)} frames${num(band.meanMs, 7, 1)}ms mean${num(band.long, 5)} long`)
  }
  const longs = b.baseline?.trace ? longFramesOf(b.baseline.trace) : []
  if (longs.length > 0) {
    out.push('  -- baseline long frames --')
    for (const f of longs) {
      out.push(`    #${rt(String(f.i), 4)}${num(f.ms, 8, 1)}ms${num(f.pxPerM, 7, 2)} px/m`
        + `  bucket ${rt(String(f.bucket), 3)}  swapped ${f.swapped ? 1 : 0}`)
    }
  }
  return out
}

/** What one compose costs on a FIRST encounter, which is the only thing several mitigations move.
 *
 *  Its own section rather than a column, because it is measured once per cell outside the window while
 *  every column is an average across it, and printing the two side by side invites reading a per-compose
 *  figure as a per-frame one. */
function coldText(b: ShotBlock): string[] {
  const rows = [b.baseline, ...b.rows, b.repeat]
    .filter((r): r is CellResult => !!r && r.coldComposes > 0)
  if (rows.length === 0) return []
  const out = ['  -- cold compose, ms per compose --']
  for (const r of rows) {
    out.push(`  ${pad(r.cell.label, NAME_W - 2)}${num(r.coldComposeMs, 8, 2)} cold`
      + `${num(r.msPerCompose, 8, 2)} warm`)
  }
  return out
}

function blockText(b: ShotBlock): string[] {
  if (!b.baseline) return ['', `shot ${b.shot.id}`, '  not run']
  const out: string[] = [
    '',
    `shot ${b.shot.id}  noise ${b.noiseMs.toFixed(2)}${b.noiseUnit}`
    + `  atFloor ${(b.baseline.stats.atFloor * 100).toFixed(0)}%`,
    `  ${baselineSummary(b.baseline)}`,
    tableHead(),
    rowLine(b.baseline),
  ]
  const groups: Array<CellResult['cell']['group']> = ['mitigation', 'layer', 'quality', 'renderer']
  for (const g of groups) {
    const rows = b.rows.filter((r) => r.cell.group === g)
    if (rows.length === 0) continue
    out.push(`  -- ${g} --`)
    for (const r of rows) {
      const against = referenceFor(b, r)
      out.push(against
        ? rowLine(r, deltaFor(r, against.ref, b.basis), against.versus)
        : rowLine(r, null))
    }
  }
  if (b.repeat) out.push(rowLine(b.repeat, deltaFor(b.repeat, b.baseline, b.basis)))
  // Kept, because a variant that vanishes from the table with no line at all reads as one that was never
  // selected. The reason is what the cell recorded, not a reading of any number.
  for (const c of b.skipped) out.push(`  ${pad(c.label, NAME_W - 2)}  skipped: ${c.skip}`)
  return [...out, ...coldText(b), ...traceText(b)]
}

export function formatReport(report: LabReport): string {
  const results = new Map(report.results.map((r) => [r.cell.key, r]))
  const blocks = blocksOf(report.cells, results)
  const cfg = report.config
  const lines: string[] = [
    'RaceWorld 2D renderer perf lab',
    `circuit ${report.circuit}  viewport ${report.viewport.w}x${report.viewport.h}  dpr ${report.dpr}`
    + `  cars ${report.cars}  at ${report.at}`,
    `frames ${cfg.frames}  warmup ${cfg.warmup}  cold ${cfg.cold ? 1 : 0}  code ${encodeRunCode(cfg)}`,
    `shots ${cfg.shots.join(', ')}`,
    `variants ${cfg.variants.join(', ')}`,
  ]
  if (report.aborted) lines.push('aborted 1')
  for (const b of blocks) lines.push(...blockText(b))
  return lines.join('\n')
}

/** The same run as JSON, on its own button. Nothing here is derived: the numbers pass through as they
 *  were measured, so the text above never has to be the only record of a run. */
export function formatRaw(report: LabReport): string {
  const blocks = blocksOf(report.cells, new Map(report.results.map((r) => [r.cell.key, r])))
  return JSON.stringify({
    circuit: report.circuit, at: report.at, dpr: report.dpr, viewport: report.viewport,
    cars: report.cars, aborted: report.aborted, config: report.config,
    code: encodeRunCode(report.config),
    rows: report.results.map((r) => ({
      shot: r.cell.shot, variant: r.cell.variant, group: r.cell.group, config: r.cell.config,
      fps: +r.stats.fps.toFixed(1), low1: +r.stats.low1.toFixed(1), meanMs: +r.stats.meanMs.toFixed(3),
      p95Ms: +r.stats.p95Ms.toFixed(2), minMs: +r.stats.minMs.toFixed(2),
      maxMs: +r.stats.maxMs.toFixed(2), longFrames: r.stats.longFrames,
      atFloor: +r.stats.atFloor.toFixed(2), frames: r.stats.frames,
      paint: r.paint, scene: r.scene, tickMs: +r.tickMs.toFixed(3),
      composeMs: +r.composeMs.toFixed(3), busyMs: +r.busyMs.toFixed(3),
      // The trace SUMMARISED, plus the long frames themselves. The per-frame arrays are three hundred
      // numbers a cell and twenty cells a run, which would make the one thing anybody pastes too big to
      // paste; everything a reader argues with is in the summary and the frames it points at.
      ...(r.trace ? { trace: traceSummary(r.trace), longFrameDetail: longFramesOf(r.trace) } : {}),
      ...(r.coldComposes > 0
        ? { coldComposeMs: +r.coldComposeMs.toFixed(3), coldComposes: r.coldComposes }
        : {}),
    })),
    vsyncBound: blocks.filter((b) => b.vsync).map((b) => b.shot.id),
    skipped: report.cells.filter((c) => c.skip).map((c) => ({ key: c.key, reason: c.skip })),
  })
}
