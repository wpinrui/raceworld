// The perf lab's plan and its arithmetic (#sim-2d). Pure: no DOM, no React, no canvas.
//
// The lap benchmark this replaces asked a live race to be its clock. One configuration per LAP, segment
// boundaries at the followed car crossing the line, so a run cost fifteen laps of somebody's afternoon
// and the numbers were only ever comparable to numbers from the same circuit. Worse, it only ever
// ablated LAYERS: it could say what the trees cost, and it could not say whether the Path2D cache was
// still doing anything.
//
// What replaces it drives the camera itself (the shots live in perf-shots.ts). A cell is a fixed number
// of FRAMES on a scripted camera path, so frame 40 of one cell frames exactly what frame 40 of every
// other cell frames, and a cell costs a second and a half rather than a lap.
//
// What is here is everything downstream of that: what a run is made of, what it is allowed to skip, and
// the arithmetic that turns a pile of frame times into a sentence about one mitigation.

import type { Quality } from './lod'
import { PERF_FLAGS, PERF_FLAG_INFO, type PerfFlag } from './perf-flags'
import { shotById, type Shot, type ShotId } from './perf-shots'

/** A frame this long is felt rather than measured. */
export const LONG_FRAME_MS = 25

// ── Configurations ──

export interface CellConfig {
  hide: string[]
  quality: Quality
  canvas: boolean
  flagsOff: PerfFlag[]
}

export const BASELINE_CONFIG: CellConfig = { hide: [], quality: 'medium', canvas: true, flagsOff: [] }

export type VariantGroup = 'mitigation' | 'layer' | 'quality' | 'renderer'

export interface Variant {
  id: string
  group: VariantGroup
  label: string
  /** What a positive delta against the baseline means for this row. */
  reads: string
  config: Partial<CellConfig>
  /** A reason this variant cannot differ from the baseline in this shot, or null to run it. Returning a
   *  reason is not hiding the row: the plan keeps it and the report prints the reason. */
  skipIn?: (shot: Shot, cars: number) => string | null
}

/** The drawn layers the map can hide, one per category, plus the two SPLITS: the whole static world
 *  against the whole moving one. Those two are what say whether a frame's cost is the circuit standing
 *  there or the field driving through it, which no single category can answer. */
const STATIC_LAYERS = ['trees', 'shadows', 'buildings', 'stands', 'furniture', 'ground', 'kerbs', 'pit']
const DYNAMIC_LAYERS = ['cars', 'boxes']

const LAYERS: Array<{ id: string; label: string; hide: string[] }> = [
  ...[
    ['trees', 'Trees and marshal posts'], ['shadows', 'Scenery shadows'], ['buildings', 'Buildings'],
    ['stands', 'Grandstands'], ['furniture', 'Barriers and fences'], ['ground', 'Ground plane'],
    ['kerbs', 'Kerbs'], ['pit', 'Pit complex'], ['signs', 'Garage name boards'],
    ['boxes', 'Pit boxes and crew'], ['cars', 'Car sprites'],
  ].map(([id, label]) => ({ id, label, hide: [id] })),
  { id: 'static', label: 'The whole static world', hide: STATIC_LAYERS },
  { id: 'dynamic', label: 'The whole moving world', hide: DYNAMIC_LAYERS },
]

/** What a mitigation needs from a shot before it can possibly show itself. Skipping the rest is the
 *  difference between a lab that runs in a minute and one that runs in ten, and it is also what keeps
 *  the report honest: a mitigation measured where it cannot act comes back "no effect", and "no effect"
 *  is the verdict this whole thing exists to be trusted on. */
type Need = 'repaint' | 'compose' | 'stillCamera' | 'cars'

const NEEDS: Record<PerfFlag, Need> = {
  // Everything that lives inside a paint needs the shot to keep painting.
  pathCache: 'repaint',
  paintState: 'repaint',
  itemCull: 'repaint',
  // These change what a paint is HANDED. The composing is done once by the settle either way, so what
  // they need is repeated paints to hand it to, not repeated composes.
  batchFlat: 'repaint',
  lodRungs: 'repaint',
  cullDisc: 'repaint',
  // These are paid at COMPOSE time and nowhere else.
  geomCache: 'compose',
  warmSwap: 'compose',
  // The guard's whole subject is a camera that is not moving.
  cameraGuard: 'stillCamera',
  visElide: 'cars',
}

const SKIP_REASON: Record<Need, (shot: Shot, cars: number) => string | null> = {
  repaint: (s) => (s.repaints ? null : 'the guard holds this shot to one paint, so nothing inside a paint can differ'),
  compose: (s) => (s.recomposes ? null : 'no geometry is composed during this shot'),
  stillCamera: (s) => (s.moves ? 'camera moves every frame, so the guard never fires' : null),
  cars: (_s, cars) => (cars > 0 ? null : 'no cars on the map to write visibility for'),
}

const mitigationSkip = (flag: PerfFlag) => (shot: Shot, cars: number): string | null => {
  // One extra rule on top of the need, because a disc that contains the whole circuit is not a disc.
  if (flag === 'cullDisc' && shot.whole) {
    return 'the whole circuit is in shot, so the disc contains everything'
  }
  return SKIP_REASON[NEEDS[flag]](shot, cars)
}

export const VARIANTS: readonly Variant[] = [
  ...PERF_FLAGS.map((flag): Variant => ({
    id: `off:${flag}`,
    group: 'mitigation',
    label: PERF_FLAG_INFO[flag].label,
    reads: PERF_FLAG_INFO[flag].claim,
    config: { flagsOff: [flag] },
    skipIn: mitigationSkip(flag),
  })),
  ...LAYERS.map((l): Variant => ({
    id: `hide:${l.id}`,
    group: 'layer',
    label: l.label,
    reads: 'what this layer costs the frame',
    config: { hide: l.hide },
  })),
  {
    id: 'quality:low',
    group: 'quality',
    label: 'Quality Low',
    reads: 'what the low preset saves against medium',
    config: { quality: 'low' },
  },
  {
    id: 'quality:high',
    group: 'quality',
    label: 'Quality High',
    reads: 'what the high preset costs against medium',
    config: { quality: 'high' },
  },
  {
    id: 'renderer:svg',
    group: 'renderer',
    label: 'SVG renderer',
    reads: 'the document renderer the canvas replaced',
    config: { canvas: false },
  },
]

export const DEFAULT_VARIANTS: string[] = VARIANTS.filter((v) => v.group === 'mitigation').map((v) => v.id)
/** The default plan. Four shots rather than three, and the two additions are not decoration: the
 *  parked camera is the ONLY shot the repaint guard can act in, and the zoom sweep is the only one
 *  that composes anything, so without them the shipped run cannot answer three of the ten
 *  mitigations at all. */
export const DEFAULT_SHOTS: ShotId[] = ['racing', 'pit', 'wide', 'zoom', 'still']

export interface LabConfig {
  shots: ShotId[]
  variants: string[]
  /** Measured frames per cell. */
  frames: number
  /** Frames thrown away first: the configuration switch is a render the lab caused, not the game. */
  warmup: number
}

export const DEFAULT_LAB_CONFIG: LabConfig = {
  shots: DEFAULT_SHOTS,
  variants: DEFAULT_VARIANTS,
  frames: 90,
  warmup: 20,
}

// ── Run codes ──
//
// A selection is seven shots against twenty-six variants plus two frame counts, and ticking it by hand
// is both slow and a place to make a mistake nobody can see afterwards. A run code is that selection as
// sixteen hex characters, so a run can be handed over in a sentence and reproduced exactly.
//
// The bit order is FROZEN and is not the order anything is displayed in. Reordering the catalogue would
// otherwise silently repoint every code ever pasted at different rows; new entries go on the END of
// these lists, and a test fails if one is added to the catalogue and not to them.

const RUN_CODE_VERSION = 1

const SHOT_CODE_ORDER: readonly ShotId[] = [
  'racing', 'pit', 'start', 'wide', 'zoom', 'rotate', 'still',
]

const VARIANT_CODE_ORDER: readonly string[] = [
  'off:pathCache', 'off:paintState', 'off:itemCull', 'off:batchFlat', 'off:geomCache',
  'off:cameraGuard', 'off:cullDisc', 'off:lodRungs', 'off:warmSwap', 'off:visElide',
  'hide:trees', 'hide:shadows', 'hide:buildings', 'hide:stands', 'hide:furniture', 'hide:ground',
  'hide:kerbs', 'hide:pit', 'hide:signs', 'hide:boxes', 'hide:cars', 'hide:static', 'hide:dynamic',
  'quality:low', 'quality:high', 'renderer:svg',
]

/** Exported for the test that keeps them in step with the catalogue, and for nothing else. */
export const RUN_CODE_ORDERS = { shots: SHOT_CODE_ORDER, variants: VARIANT_CODE_ORDER }

/** Widths in hex characters, in order. Fixed rather than delimited, so a code is one token to select. */
const CODE_FIELDS = { version: 1, shots: 2, variants: 7, frames: 3, warmup: 3 }
const CODE_LENGTH = Object.values(CODE_FIELDS).reduce((s, w) => s + w, 0)

/** What the config screen will accept, mirroring what its own number fields clamp to. */
const FRAME_BOUNDS = { min: 30, max: 600 }
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function encodeRunCode(cfg: LabConfig): string {
  const mask = (order: readonly string[], on: readonly string[]) =>
    order.reduce((m, id, i) => (on.includes(id) ? m | (1 << i) : m), 0)
  const hex = (v: number, w: number) => Math.max(0, Math.round(v)).toString(16).padStart(w, '0').slice(-w)
  return `${RUN_CODE_VERSION}`
    + hex(mask(SHOT_CODE_ORDER, cfg.shots), CODE_FIELDS.shots)
    + hex(mask(VARIANT_CODE_ORDER, cfg.variants), CODE_FIELDS.variants)
    + hex(cfg.frames, CODE_FIELDS.frames)
    + hex(cfg.warmup, CODE_FIELDS.warmup)
}

/** A code back into a selection, or null if it is not one. Null rather than a partial config: half a
 *  run applied from a mistyped code is worse than nothing happening. */
export function decodeRunCode(code: string): LabConfig | null {
  const s = code.trim().toLowerCase().replace(/[\s-]/g, '')
  if (s.length !== CODE_LENGTH || !/^[0-9a-f]+$/.test(s)) return null
  if (s[0] !== String(RUN_CODE_VERSION)) return null
  let at = CODE_FIELDS.version
  const take = (w: number) => { const v = parseInt(s.slice(at, at + w), 16); at += w; return v }
  const pick = <T extends string>(order: readonly T[], m: number) => order.filter((_, i) => (m >> i) & 1)
  const shots = pick(SHOT_CODE_ORDER, take(CODE_FIELDS.shots))
  const variants = pick(VARIANT_CODE_ORDER, take(CODE_FIELDS.variants))
  // A run of no shots is not a run, and the screen would offer a Run button that measures nothing.
  if (shots.length === 0) return null
  return {
    shots: [...shots],
    variants: [...variants],
    frames: clampTo(take(CODE_FIELDS.frames), FRAME_BOUNDS.min, FRAME_BOUNDS.max),
    warmup: clampTo(take(CODE_FIELDS.warmup), 0, FRAME_BOUNDS.max),
  }
}

export interface Cell {
  key: string
  shot: ShotId
  /** 'baseline', 'repeat', or a variant id. */
  variant: string
  label: string
  group: VariantGroup | 'baseline'
  config: CellConfig
  /** Set when the cell is planned but not run, with the reason. */
  skip?: string
}

const merge = (delta: Partial<CellConfig>): CellConfig => ({
  hide: delta.hide ?? BASELINE_CONFIG.hide,
  quality: delta.quality ?? BASELINE_CONFIG.quality,
  canvas: delta.canvas ?? BASELINE_CONFIG.canvas,
  flagsOff: delta.flagsOff ?? BASELINE_CONFIG.flagsOff,
})

/** The run, in order.
 *
 *  Every variant is one step from the SAME baseline rather than a point in a cross product, so N
 *  variants cost N+2 cells a shot instead of 2^N. The two baselines are the first and last cell of each
 *  shot, and the spread between them is the run's own noise: without it "this mitigation saves 0.3ms"
 *  and "this mitigation saves nothing" are the same sentence. */
export function planCells(cfg: LabConfig, cars: number): Cell[] {
  const out: Cell[] = []
  for (const shotId of cfg.shots) {
    const shot = shotById(shotId)
    const base = (variant: string, label: string): Cell => ({
      key: `${shotId}/${variant}`, shot: shotId, variant, label, group: 'baseline',
      config: { ...BASELINE_CONFIG },
    })
    // A discarded cell at the baseline config, FIRST, and it is not a formality.
    //
    // The geometry memo and the Path2D cache live across cells, so the first cell of a shot pays for
    // every rung, bearing and path the shot will ever visit and no later cell pays for any of them. That
    // is not noise, it is a one-way step: the baseline is the cell that pays, so every row after it is
    // scored against a number inflated by exactly the thing the caches exist to remove. Measured on
    // monaco (2026-07-31): the bearing shot's baseline composed 0.95ms/frame and its repeat 0.08, a 12x
    // spread that made the shot's noise floor 0.90ms and swallowed every row in it, including a geometry
    // memo that was in fact earning about 0.75ms/frame.
    out.push(base('warm', 'Warm'))
    out.push(base('baseline', 'Baseline'))
    // Walked in CATALOGUE order rather than selection order, so a report's rows sit in the same places
    // whatever order the boxes happened to be ticked in and two runs can be read side by side.
    for (const v of VARIANTS) {
      if (!cfg.variants.includes(v.id)) continue
      const skip = v.skipIn?.(shot, cars) ?? null
      out.push({
        key: `${shotId}/${v.id}`, shot: shotId, variant: v.id, label: v.label, group: v.group,
        config: merge(v.config), ...(skip ? { skip } : {}),
      })
    }
    out.push(base('repeat', 'Baseline again'))
  }
  return out
}

/** Roughly how long the plan takes, so the configuration screen can say it before it is started.
 *  A cell is its frames plus the settle that precedes them (a forced recompose and its warmed swap). */
const SETTLE_SECONDS = 0.4

export function estimateSeconds(cells: readonly Cell[], cfg: LabConfig): number {
  const run = cells.filter((c) => !c.skip).length
  return run * ((cfg.frames + cfg.warmup) / 60 + SETTLE_SECONDS)
}

// ── Frame arithmetic ──

/** How close to the fastest frame in a cell still counts as sitting on the display's own floor. */
const FLOOR_BAND_MS = 1.5
/** The share of a cell's frames that has to be on that floor before the cell is called vsync bound. */
const FLOOR_SHARE = 0.7

export interface FrameStats {
  frames: number
  fps: number
  meanMs: number
  /** The mean of the worst one per cent of frames, as a rate. What a stutter actually feels like. */
  low1: number
  low1Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  longFrames: number
  /** Share of frames sitting within a hair of the fastest one, which is what a vsync-locked cell looks
   *  like. A cell with headroom cannot be compared on frame time, because the display is choosing it. */
  atFloor: number
}

const EMPTY_STATS: FrameStats = {
  frames: 0, fps: 0, meanMs: 0, low1: 0, low1Ms: 0, p95Ms: 0, minMs: 0, maxMs: 0,
  longFrames: 0, atFloor: 0,
}

export function frameStats(deltas: readonly number[]): FrameStats {
  if (deltas.length === 0) return { ...EMPTY_STATS }
  const sorted = [...deltas].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  // At least one frame, so a short cell reports its worst rather than reporting nothing.
  const worst = sorted.slice(-Math.max(1, Math.round(n * 0.01)))
  const worstMean = worst.reduce((s, v) => s + v, 0) / worst.length
  const floor = sorted[0]
  return {
    frames: n,
    fps: mean > 0 ? 1000 / mean : 0,
    meanMs: mean,
    low1: worstMean > 0 ? 1000 / worstMean : 0,
    low1Ms: worstMean,
    p95Ms: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
    minMs: floor,
    maxMs: sorted[n - 1],
    longFrames: sorted.filter((d) => d > LONG_FRAME_MS).length,
    atFloor: sorted.filter((d) => d <= floor + FLOOR_BAND_MS).length / n,
  }
}

/** True when the cell spent most of its frames waiting for the display rather than working.
 *
 *  This is the one thing that would otherwise make the whole lab lie. A machine with headroom runs the
 *  baseline at 60 and runs every mitigation-off row at 60 as well, because the saving was never the
 *  binding constraint, and every row comes back "no effect" whether the mitigation is worth 4ms or
 *  worth nothing at all. When a shot is up against the vsync ceiling the rows have to be judged on the
 *  main-thread time they actually spend, and the report has to say that is what it did. */
export const vsyncBound = (s: FrameStats): boolean => s.atFloor >= FLOOR_SHARE

export interface CellResult {
  cell: Cell
  stats: FrameStats
  paint: {
    /** Main-thread command time per PAINT. */
    msPerPaint: number
    /** Share of frames that painted at all. A still camera under the repaint guard paints once and
     *  then never again, which is the whole of what the guard buys. */
    paintedFrac: number
    /** Draw calls issued and scene items skipped by the viewport test, per paint. */
    calls: number
    skipped: number
    /** Paint time by scene section, per frame. */
    sections: Record<string, number>
  }
  scene: { items: number; ops: number; pathKb: number; nodes: number }
  /** The race loop's own JS cost per frame, which separates a slow script from a heavy raster. */
  tickMs: number
  /** Geometry rebuilt and paths warmed, per FRAME. The third main-thread clock, and the only one the
   *  two compose-time mitigations report to. */
  composeMs: number
  /** Main-thread time this cell spends per FRAME: the loop's tick, the paint commands and the composes,
   *  taken over frames rather than over paints so a frame that skipped its paint counts as having paid
   *  nothing for it. What the verdict falls back to when frame time has no headroom left to move in.
   *
   *  The compose term was missing, and its absence was not a rounding error. Composing and warming are
   *  main-thread work that happens outside any paint and outside the tick, so a sum of those two saw
   *  none of it: every row for a mitigation paid at compose time was scored on a clock that could not
   *  move, and printed "no effect" as though that were a measurement.
   *
   *  It is still not the whole frame: the rasteriser's own work and the document renderer's layout are
   *  not observable from here, so this UNDERSTATES a layer. */
  busyMs: number
  /** Every measured frame, for the question an aggregate cannot answer: WHERE the cost fell. */
  trace?: FrameSample[]
}

// ── The per-frame trace ──
//
// A cell's aggregate says a shot lost twenty frames of ninety. It cannot say whether they were twenty
// stalls at the moments the scene recomposed or twenty frames of a band that is simply expensive to
// draw, and those two have nothing in common: one is fixed in the swap, the other in the ladder. So each
// frame carries what the camera was doing on it, and the summary below puts the long frames next to the
// crossings and lets the run answer it.

/** One measured frame. `pxPerM` and `bucket` come from the POSE, which is pure in the frame index, so
 *  they cost nothing and cannot be a frame out of step with what was drawn. */
export interface FrameSample {
  i: number
  ms: number
  pxPerM: number
  bucket: number
  /** A freshly composed scene replaced the painted one on this frame. */
  swapped: boolean
}

/** How near a crossing a long frame has to land to be blamed on it. One frame either side: the compose
 *  runs on the frame the bucket changes and the paint that first hands its geometry to the rasteriser is
 *  the frame after, so a crossing's cost can show up on either. */
const CROSSING_WINDOW = 1

/** One detail bucket's worth of frames. `pxPerM` is the mean scale the frames in it were actually at,
 *  rather than the bucket's representative scale, so a band that was only clipped reads as clipped. */
export interface BandRow { bucket: number; pxPerM: number; frames: number; meanMs: number; long: number }

export interface TraceSummary {
  frames: number
  /** Frames whose detail bucket differs from the frame before. */
  crossings: number
  swaps: number
  longFrames: number
  /** Long frames within `CROSSING_WINDOW` of a crossing or a landed swap, and the rest. */
  longAtCrossing: number
  longSteady: number
  /** Mean frame time on those same two populations, which is the same question asked of every frame
   *  rather than only of the long ones. */
  crossingMs: number
  steadyMs: number
  /** Frame time by detail bucket, coarsest first: where in the zoom band the cost actually lives. */
  bands: BandRow[]
}

const meanOf = (v: readonly number[]): number => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0)

/** What a trace says, as the numbers the crossings-or-steady-state question is decided on.
 *
 *  Pure, and the whole verdict is arithmetic rather than a reading, because "the long frames looked
 *  clustered" is exactly the kind of claim this lab exists to stop anyone making. */
export function traceSummary(trace: readonly FrameSample[]): TraceSummary {
  const n = trace.length
  const empty: TraceSummary = {
    frames: 0, crossings: 0, swaps: 0, longFrames: 0, longAtCrossing: 0, longSteady: 0,
    crossingMs: 0, steadyMs: 0, bands: [],
  }
  if (n === 0) return empty
  // A frame is an EVENT frame if the bucket moved on it or a scene landed on it. The first frame has no
  // predecessor to differ from, so it is never a crossing on its own account.
  const event = trace.map((f, i) => f.swapped || (i > 0 && f.bucket !== trace[i - 1].bucket))
  const nearEvent = trace.map((_, i) => {
    for (let k = Math.max(0, i - CROSSING_WINDOW); k <= Math.min(n - 1, i + CROSSING_WINDOW); k++) {
      if (event[k]) return true
    }
    return false
  })
  const long = trace.map((f) => f.ms > LONG_FRAME_MS)
  const bands = new Map<number, { px: number[]; ms: number[]; long: number }>()
  for (const f of trace) {
    const b = bands.get(f.bucket) ?? { px: [], ms: [], long: 0 }
    b.px.push(f.pxPerM)
    b.ms.push(f.ms)
    if (f.ms > LONG_FRAME_MS) b.long++
    bands.set(f.bucket, b)
  }
  return {
    frames: n,
    crossings: trace.filter((f, i) => i > 0 && f.bucket !== trace[i - 1].bucket).length,
    swaps: trace.filter((f) => f.swapped).length,
    longFrames: long.filter(Boolean).length,
    longAtCrossing: long.filter((v, i) => v && nearEvent[i]).length,
    longSteady: long.filter((v, i) => v && !nearEvent[i]).length,
    crossingMs: meanOf(trace.filter((_, i) => nearEvent[i]).map((f) => f.ms)),
    steadyMs: meanOf(trace.filter((_, i) => !nearEvent[i]).map((f) => f.ms)),
    bands: [...bands.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, b]) => ({
        bucket, pxPerM: meanOf(b.px), frames: b.ms.length, meanMs: meanOf(b.ms), long: b.long,
      })),
  }
}

/** The long frames themselves, with what the camera was doing on each. Short by construction (a cell
 *  that stutters on most of its frames has bigger problems than where), so it prints in full. */
export const longFramesOf = (trace: readonly FrameSample[]): FrameSample[] =>
  trace.filter((f) => f.ms > LONG_FRAME_MS)

/** Everything the painter and the race loop counted, read once. Deltas between two of these are what a
 *  cell's numbers are made of. */
export interface Counters {
  /** Paints, and the section time they logged. */
  n: number
  ms: number
  drawn: number
  skipped: number
  sections: Record<string, number>
  /** Race-loop ticks, and the JS time they spent. */
  tickN: number
  tickSum: number
  /** Composes, and the main-thread time they and their warms spent. */
  composeN: number
  composeSum: number
  /** Frames on which the painter ran at all. Counted by the caller, one sample per frame, because a
   *  single frame can paint more than once (a cull step composes and paints inside the camera's own
   *  paint) and "paints over frames" is then not a fraction at all. */
  paintedFrames: number
}

/** A cell's numbers from the counters either side of its MEASURED window.
 *
 *  Pure and exported because this is where the arithmetic that decides every verdict lives, and because
 *  the window is the thing that is easy to get wrong: the counters have to be read at the first measured
 *  frame, not before the warmup, or a cell's cpu time carries frames the design threw away. */
export function cellMetrics(
  before: Counters, after: Counters, frames: number,
): Pick<CellResult, 'paint' | 'tickMs' | 'composeMs' | 'busyMs'> {
  const paints = after.n - before.n
  const f = Math.max(1, frames)
  const paintMs = Math.max(0, after.ms - before.ms)
  const composeMs = Math.max(0, after.composeSum - before.composeSum)
  const ticks = after.tickN - before.tickN
  const sections: Record<string, number> = {}
  for (const [k, v] of Object.entries(after.sections)) {
    const d = v - (before.sections[k] ?? 0)
    if (d > 0) sections[k] = +(d / f).toFixed(3)
  }
  const tickMs = ticks > 0 ? Math.max(0, after.tickSum - before.tickSum) / ticks : 0
  return {
    paint: {
      msPerPaint: paints > 0 ? paintMs / paints : 0,
      paintedFrac: Math.min(1, (after.paintedFrames - before.paintedFrames) / f),
      calls: paints > 0 ? Math.round((after.drawn - before.drawn) / paints) : 0,
      skipped: paints > 0 ? Math.round((after.skipped - before.skipped) / paints) : 0,
      sections,
    },
    tickMs,
    composeMs: composeMs / f,
    // Over FRAMES, like the paint term: a compose lands on one frame of the window and the question the
    // verdict asks is what the cell cost per frame, not what one compose cost.
    busyMs: tickMs + paintMs / f + composeMs / f,
  }
}

/** The floor below which a difference is the machine rather than the change.
 *
 *  Taken from the two baselines of the shot, because that pair differs by nothing at all: whatever
 *  separates them is drift, GC and whatever else the browser did in between. Floored so a pair that
 *  happens to land on the same number does not make every row significant. */
export function noiseFloorMs(baseline: FrameStats, repeat: FrameStats): number {
  const spread = Math.abs(baseline.meanMs - repeat.meanMs)
  return Math.max(spread, 0.15, baseline.meanMs * 0.02)
}

/** The main-thread floor a difference has to clear when the verdict is being read off `busyMs`. The
 *  performance clock is coarser than the numbers being subtracted, so a small floor stands under it. */
const BUSY_FLOOR_MS = 0.1

/** The same floor in MAIN-THREAD time, which is the only unit a vsync-bound shot's rows are judged in.
 *
 *  It used to have no measured floor at all. The block printed its frame-time floor or, once the shot
 *  came back vsync bound, printed no floor and quietly scored every row against five per cent of the
 *  baseline's cpu time: a number derived from nothing that had been measured. The two baselines differ
 *  by nothing but drift in cpu time exactly as they do in frame time, so that spread is the floor, and
 *  the block prints whichever one its verdicts were actually read against. */
export function noiseFloorCpuMs(baseline: CellResult, repeat: CellResult): number {
  return Math.max(Math.abs(baseline.busyMs - repeat.busyMs), BUSY_FLOOR_MS, baseline.busyMs * 0.05)
}

export type VerdictKind = 'saves' | 'nothing' | 'backfires' | 'cost'

export interface Verdict { kind: VerdictKind; text: string; deltaMs: number }

/** What a row means.
 *
 *  A mitigation row is the mitigation turned OFF, so a row that is SLOWER than the baseline is a
 *  mitigation that is working, and one that is level is a mitigation buying nothing. A mitigation row
 *  that is FASTER than the baseline is the finding worth having: the thing costs more to run than it
 *  saves.
 *
 *  `vsync` says the shot had no frame-time headroom, in which case the comparison moves to main-thread
 *  time. That reads a bit lower than the truth (the rasteriser is not on this clock) but it MOVES, which
 *  a frame time pinned to the display does not. */
export interface VerdictInput {
  row: CellResult
  baseline: CellResult
  /** The block's own measured floor, IN THE BASIS BELOW. `blocksOf` takes it from the two baselines. */
  noiseMs: number
  /** 'frame' is what the player feels; 'cpu' is main-thread time, which is all that is left to read
   *  once the display is choosing the frame time. `blocksOf` picks this per shot. */
  basis: 'frame' | 'cpu'
}

export function verdictFor({ row, baseline, noiseMs, basis }: VerdictInput): Verdict {
  // The cpu clock is the CANVAS painter's own commands. The SVG renderer reports to it not at all, so
  // its row's cpu time is the race tick alone against a baseline of tick plus paint: the comparison
  // comes out large and negative and reads the renderer this branch replaced as a main-thread saving.
  // It is only ever comparable on frame time, which is where its cost actually lands.
  if (basis === 'cpu' && row.cell.config.canvas === false) {
    return { kind: 'nothing', text: 'not comparable on cpu time', deltaMs: 0 }
  }
  const vsync = basis === 'cpu'
  const deltaMs = vsync
    ? row.busyMs - baseline.busyMs
    : row.stats.meanMs - baseline.stats.meanMs
  // One floor, measured, in the unit the delta is in. Not a synthetic percentage standing in for one.
  const floor = noiseMs
  const unit = vsync ? 'ms cpu' : 'ms/frame'
  const ms = Math.abs(deltaMs).toFixed(2)
  if (row.cell.group === 'mitigation') {
    if (deltaMs > floor) return { kind: 'saves', text: `saves ${ms}${unit}`, deltaMs }
    if (deltaMs < -floor) return { kind: 'backfires', text: `costs ${ms}${unit}`, deltaMs }
    return { kind: 'nothing', text: 'no effect', deltaMs }
  }
  if (Math.abs(deltaMs) <= floor) return { kind: 'nothing', text: 'no effect', deltaMs }
  // Hiding a layer that makes the frame FASTER means the layer costs that much.
  return deltaMs < 0
    ? { kind: 'cost', text: `worth ${ms}${unit}`, deltaMs }
    : { kind: 'backfires', text: `${ms}${unit} slower`, deltaMs }
}

export interface ShotBlock {
  shot: Shot
  baseline?: CellResult
  repeat?: CellResult
  /** The two baselines' own spread, in whatever unit `basis` says the verdicts are read in. */
  noiseMs: number
  /** The name of that unit, so a printed floor can never be read as the other one. */
  noiseUnit: string
  /** The baseline never left the display's floor, so this shot's verdicts read main-thread time. */
  vsync: boolean
  /** What every verdict in this block is measured on, derived from `vsync`. */
  basis: VerdictInput['basis']
  rows: CellResult[]
  skipped: Cell[]
}

/** The row of numbers both the modal and the pasted report print, defined once so they cannot drift.
 *  It already had: one said `p95ms` and the other `p95 ms` for the same column. */
export interface Column {
  key: string
  head: string
  /** Fixed-width slot in the text report; the modal picks its own Tailwind width. */
  width: number
  dp: number
  of: (r: CellResult) => number
}

export const COLUMNS: readonly Column[] = [
  { key: 'fps', head: 'fps', width: 6, dp: 0, of: (r) => r.stats.fps },
  { key: 'low1', head: '1% low', width: 8, dp: 0, of: (r) => r.stats.low1 },
  { key: 'p95', head: 'p95 ms', width: 8, dp: 1, of: (r) => r.stats.p95Ms },
  { key: 'max', head: 'max ms', width: 8, dp: 1, of: (r) => r.stats.maxMs },
  { key: 'long', head: 'long', width: 6, dp: 0, of: (r) => r.stats.longFrames },
  { key: 'cpu', head: 'cpu ms', width: 8, dp: 2, of: (r) => r.busyMs },
  // Beside the cpu total rather than folded into it, because it is the only column the geometry memo and
  // the warmed swap can move and it is a rounding error next to the paint on every other row.
  { key: 'compose', head: 'comp ms', width: 9, dp: 2, of: (r) => r.composeMs },
  { key: 'calls', head: 'calls', width: 8, dp: 0, of: (r) => r.paint.calls },
]

/** What the baseline row says about the scene it was measured on. One sentence, one definition. */
export function baselineSummary(b: CellResult): string {
  return `scene ${b.scene.items} items, ${b.scene.ops} ops, ${b.scene.pathKb.toFixed(0)}KB paths, `
    + `${b.scene.nodes} nodes | tick ${b.tickMs.toFixed(2)}ms | `
    + `paint ${b.paint.msPerPaint.toFixed(2)}ms on ${(b.paint.paintedFrac * 100).toFixed(0)}% of frames`
    + ` | ${b.paint.skipped} items skipped/paint | compose ${b.composeMs.toFixed(2)}ms/frame`
}

/** Group a finished run by shot, resolving each shot's baselines and its noise floor. */
export function blocksOf(cells: readonly Cell[], results: ReadonlyMap<string, CellResult>): ShotBlock[] {
  const order: ShotId[] = []
  for (const c of cells) if (!order.includes(c.shot)) order.push(c.shot)
  return order.map((id) => {
    const mine = cells.filter((c) => c.shot === id)
    const baseline = results.get(`${id}/baseline`)
    const repeat = results.get(`${id}/repeat`)
    const vsync = !!baseline && vsyncBound(baseline.stats)
    // Measured in the unit the block's verdicts are read in, not in frame time and then applied to cpu
    // numbers. Falls back to the bare floor of that unit when a run was stopped before its repeat.
    const floor = baseline && repeat
      ? (vsync ? noiseFloorCpuMs(baseline, repeat) : noiseFloorMs(baseline.stats, repeat.stats))
      : (vsync ? BUSY_FLOOR_MS : 0.15)
    return {
      shot: shotById(id),
      baseline,
      repeat,
      noiseMs: floor,
      noiseUnit: vsync ? 'ms cpu' : 'ms/frame',
      vsync,
      basis: vsync ? 'cpu' : 'frame',
      rows: mine.filter((c) => !['warm', 'baseline', 'repeat'].includes(c.variant))
        .map((c) => results.get(c.key)).filter((r): r is CellResult => !!r),
      skipped: mine.filter((c) => !!c.skip),
    }
  })
}
