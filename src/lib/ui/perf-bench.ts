// The perf lab's plan and its arithmetic (#sim-2d). Pure: no DOM, no React, no canvas.
//
// The lap benchmark this replaces asked a live race to be its clock. One configuration per LAP, segment
// boundaries at the followed car crossing the line, so a run cost fifteen laps of somebody's afternoon
// and the numbers were only ever comparable to numbers from the same circuit. Worse, it only ever
// ablated LAYERS: it could say what the trees cost, and it could not say whether the Path2D cache was
// still doing anything.
//
// What replaces it drives the camera itself. A cell is a fixed number of FRAMES on a scripted camera
// path, so frame 40 of one cell frames exactly what frame 40 of every other cell frames, and a cell
// costs a second and a half rather than a lap. Camera scale is written in SCREEN PIXELS PER METRE, which
// is the one measure that means the same thing on Monaco and on Monza, and the shots anchor to features
// the circuit describes for itself (its tightest corner, its pit straight, its start line) rather than
// to authored coordinates. So the same lab runs anywhere and the rows compare.

import type { Quality } from './lod'
import { PERF_FLAGS, PERF_FLAG_INFO, type PerfFlag } from './perf-flags'

export interface Camera { x: number; y: number; z: number; rot: number }

/** Everything a shot needs to aim itself, measured from the live map by the caller. */
export interface ShotWorld {
  vb: { x: number; y: number; w: number; h: number }
  stage: { w: number; h: number }
  metresPerUnit: number
  /** A point on the track centreline at lap fraction `f`, in viewBox units. Wraps. */
  trackAt: (f: number) => { x: number; y: number }
  /** Lap fraction of the circuit's tightest corner: the most scenery, kerb and camber per metre. */
  cornerF: number
  /** Lap fraction on the pit straight, where the complex is in shot. */
  pitF: number
  /** The bearing the player opens on, so a run is judged in the orientation the game ships. */
  rot0: number
}

/** Racing scale. Zoom 20 works out anywhere between 1.2 and 2.2 px/m across the 37 layouts, so the
 *  lab picks the number rather than the zoom and every circuit is framed the same. */
export const RACE_PX_PER_M = 2
/** Frames a lap takes at racing pace: a ~90s lap at 60Hz. The camera advances 1/this per frame, so a
 *  sweeping shot travels at the speed a followed car actually travels and the cull disc steps at the
 *  cadence it actually steps. A cell that covered a quarter lap in ninety frames would be measuring a
 *  camera nobody drives. */
export const LAP_FRAMES = 5400
/** The bearing shot holds still between steps, so the rebuild the settle triggers lands inside the
 *  measured window instead of being smeared across it. */
const ROT_HOLD_FRAMES = 24
const ROT_STEP_RAD = Math.PI / 12
/** Octaves the zoom shot sweeps down and back. Rungs are keyed in half-octaves, so three octaves is
 *  six bucket crossings each way: the recompose cadence a player produces looking for the field. */
const ZOOM_OCTAVES = 3
/** A frame this long is felt rather than measured. */
export const LONG_FRAME_MS = 25

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function zoomForPxPerM(pxPerM: number, w: ShotWorld): number {
  return (pxPerM * w.metresPerUnit * w.vb.w) / Math.max(1, w.stage.w)
}

/** The camera that puts a world point at the centre of the stage. The follow camera's own arithmetic. */
export function centreOn(pt: { x: number; y: number }, z: number, rot: number, w: ShotWorld): Camera {
  const dx = ((pt.x - w.vb.x) / w.vb.w) * w.stage.w - w.stage.w / 2
  const dy = ((pt.y - w.vb.y) / w.vb.h) * w.stage.h - w.stage.h / 2
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  return { x: -z * (dx * cos - dy * sin), y: -z * (dx * sin + dy * cos), z, rot }
}

/** Stations walked when looking for a circuit's own landmarks. About one every 10-20m on a real lap,
 *  which resolves a hairpin without making the search cost anything worth caching harder than a ref. */
const FEATURE_STATIONS = 360
/** The arc a corner is judged over. Short enough that a hairpin is not averaged out by the straights
 *  either side of it, long enough that a spline vertex is not mistaken for a corner. */
const CORNER_WINDOW_M = 15

/** The two places on a circuit a shot can aim at without knowing anything about the circuit.
 *
 *  The tightest corner because that is where scenery, kerb and camber are densest per metre, and it is
 *  where a follow camera spends its worst frames. The pit straight because the complex is the heaviest
 *  single object on the map and the one whose cost has never fully come down. Both are FOUND, so the
 *  lab has no per-circuit table to keep up to date and the same run means the same thing on all 37. */
export function trackFeatures(
  at: (f: number) => { x: number; y: number },
  lengthUnits: number,
  metresPerUnit: number,
  pit: { cx: number; cy: number } | null,
): { cornerF: number; pitF: number } {
  const totalM = Math.max(1, lengthUnits * metresPerUnit)
  const step = CORNER_WINDOW_M / totalM
  const heading: number[] = []
  for (let i = 0; i < FEATURE_STATIONS; i++) {
    const f = i / FEATURE_STATIONS
    const a = at(f)
    const b = at(f + step)
    heading.push(Math.atan2(b.y - a.y, b.x - a.x))
  }
  let cornerF = 0
  let tightest = -1
  for (let i = 0; i < FEATURE_STATIONS; i++) {
    const raw = heading[(i + 1) % FEATURE_STATIONS] - heading[i]
    const turn = Math.abs(((raw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI)
    if (turn > tightest) { tightest = turn; cornerF = i / FEATURE_STATIONS }
  }
  let pitF = 0
  if (pit) {
    let best = Infinity
    for (let i = 0; i < FEATURE_STATIONS; i++) {
      const f = i / FEATURE_STATIONS
      const p = at(f)
      const d = (p.x - pit.cx) ** 2 + (p.y - pit.cy) ** 2
      if (d < best) { best = d; pitF = f }
    }
  }
  return { cornerF, pitF }
}

export type ShotId = 'racing' | 'pit' | 'start' | 'wide' | 'zoom' | 'rotate' | 'still'

export interface Shot {
  id: ShotId
  label: string
  note: string
  /** False only for the parked camera, which is the one case the repaint guard can fire in. */
  moves: boolean
  /** True where the shot crosses cull steps or detail rungs, so scenes are composed and swapped in it. */
  recomposes: boolean
  /** True where the whole circuit is framed, so a cull disc contains everything and saves nothing. */
  whole: boolean
  pose: (i: number, n: number, w: ShotWorld) => Camera
}

/** A shot travelling along the track, centred on its landmark: the cell's middle frame sits ON `f0`, so
 *  the landmark is passed inside the measured window whatever the cell's length is set to. Warmup frames
 *  come in with a negative `i` and simply start further back up the road, which is what a warmup should
 *  be doing anyway. */
const sweep = (f0: number, i: number, n: number, w: ShotWorld, px = RACE_PX_PER_M): Camera =>
  centreOn(w.trackAt(f0 + (i - n / 2) / LAP_FRAMES), zoomForPxPerM(px, w), w.rot0, w)

export const SHOTS: readonly Shot[] = [
  {
    id: 'racing',
    label: 'Racing corner',
    note: 'follow camera at racing scale through the circuit\'s tightest corner',
    moves: true, recomposes: true, whole: false,
    pose: (i, n, w) => sweep(w.cornerF, i, n, w),
  },
  {
    id: 'pit',
    label: 'Pit straight',
    note: 'the same camera down the pit straight, with the complex and the garages in shot',
    moves: true, recomposes: true, whole: false,
    pose: (i, n, w) => sweep(w.pitF, i, n, w),
  },
  {
    id: 'start',
    label: 'Start line',
    note: 'the chequer, the grid boxes and the packed field at racing scale',
    moves: true, recomposes: true, whole: false,
    pose: (i, n, w) => sweep(0, i, n, w),
  },
  {
    id: 'wide',
    label: 'Whole circuit',
    note: 'the full track fitted to the stage, panning: the most draw calls a frame ever pays',
    moves: true, recomposes: false, whole: true,
    pose: (i, n, w) => {
      const cam = centreOn(w.trackAt(0), 1, w.rot0, w)
      // A slow pan across a tenth of the stage. At this scale nothing crosses a rung or a disc, so the
      // camera moving is the whole of what separates this from the parked shot.
      return { ...cam, x: cam.x + Math.sin((clamp01(i / Math.max(1, n))) * Math.PI * 2) * w.stage.w * 0.05 }
    },
  },
  {
    id: 'zoom',
    label: 'Zoom sweep',
    note: `racing scale out ${ZOOM_OCTAVES} octaves and back: every detail rung crossed twice`,
    moves: true, recomposes: true, whole: false,
    pose: (i, n, w) => {
      // Clamped, so warmup's negative index holds the shot at its starting scale rather than sweeping
      // out past the camera's own zoom limits before the measured frames begin.
      const t = clamp01(i / Math.max(1, n))
      const tri = 1 - Math.abs(1 - 2 * t) // 0 -> 1 -> 0
      const px = RACE_PX_PER_M * 2 ** (-ZOOM_OCTAVES * (1 - tri))
      return centreOn(w.trackAt(w.cornerF), zoomForPxPerM(px, w), w.rot0, w)
    },
  },
  {
    id: 'rotate',
    label: 'Bearing steps',
    note: 'the camera turned in held steps, so each rebuild on the new bearing lands inside the window',
    moves: true, recomposes: true, whole: false,
    pose: (i, n, w) => {
      const rot = w.rot0 + Math.floor(i / ROT_HOLD_FRAMES) * ROT_STEP_RAD
      return centreOn(w.trackAt(w.cornerF), zoomForPxPerM(RACE_PX_PER_M, w), rot, w)
    },
  },
  {
    id: 'still',
    label: 'Parked camera',
    note: 'the shot a serviced car and a pre-race grid actually produce: nothing moves',
    moves: false, recomposes: false, whole: false,
    pose: (i, n, w) => centreOn(w.trackAt(w.cornerF), zoomForPxPerM(RACE_PX_PER_M, w), w.rot0, w),
  },
]

export const shotById = (id: ShotId): Shot => SHOTS.find((s) => s.id === id) ?? SHOTS[0]

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

/** The drawn layers, one per category, exactly the set the map can hide. */
const LAYERS: Array<{ id: string; label: string }> = [
  { id: 'trees', label: 'Trees and marshal posts' },
  { id: 'shadows', label: 'Scenery shadows' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'stands', label: 'Grandstands' },
  { id: 'furniture', label: 'Barriers and fences' },
  { id: 'ground', label: 'Ground plane' },
  { id: 'kerbs', label: 'Kerbs' },
  { id: 'pit', label: 'Pit complex' },
  { id: 'signs', label: 'Garage name boards' },
  { id: 'boxes', label: 'Pit boxes and crew' },
  { id: 'cars', label: 'Car sprites' },
]

/** Where a mitigation cannot show itself, stated as the property of the shot that makes it moot. Each
 *  of these is the difference between a lab that runs in a minute and one that runs in ten. */
const MITIGATION_SKIP: Partial<Record<PerfFlag, (shot: Shot, cars: number) => string | null>> = {
  cameraGuard: (s) => (s.moves ? 'camera moves every frame, so the guard never fires' : null),
  warmSwap: (s) => (s.recomposes ? null : 'no scene is composed during this shot'),
  cullDisc: (s) => (s.whole ? 'the whole circuit is in shot, so the disc contains everything' : null),
  visElide: (_s, cars) => (cars > 0 ? null : 'no cars on the map to write visibility for'),
  geomCache: (s) => (s.recomposes ? null : 'no geometry is rebuilt during this shot'),
}

export const VARIANTS: readonly Variant[] = [
  ...PERF_FLAGS.map((flag): Variant => ({
    id: `off:${flag}`,
    group: 'mitigation',
    label: PERF_FLAG_INFO[flag].label,
    reads: PERF_FLAG_INFO[flag].claim,
    config: { flagsOff: [flag] },
    skipIn: MITIGATION_SKIP[flag],
  })),
  ...LAYERS.map((l): Variant => ({
    id: `hide:${l.id}`,
    group: 'layer',
    label: l.label,
    reads: 'what this layer costs the frame',
    config: { hide: [l.id] },
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

export const variantById = (id: string): Variant | undefined => VARIANTS.find((v) => v.id === id)

export const DEFAULT_VARIANTS: string[] = VARIANTS.filter((v) => v.group === 'mitigation').map((v) => v.id)
export const DEFAULT_SHOTS: ShotId[] = ['racing', 'pit', 'wide']

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
    /** Main-thread command time per PAINTED frame. */
    msPerPaint: number
    /** Painted frames over total frames: a still camera under the guard paints none of them. */
    frac: number
    /** Draw calls issued and scene items skipped by the viewport test, per painted frame. */
    calls: number
    skipped: number
    sections: Record<string, number>
  }
  scene: { items: number; ops: number; pathKb: number; nodes: number }
  /** The race loop's own JS cost per frame, which separates a slow script from a heavy raster. */
  tickMs: number
  /** Main-thread time this cell spends per FRAME: the loop's tick plus the paint commands, counting a
   *  frame that skipped its paint as having paid nothing for it. What the verdict falls back to when
   *  frame time has no headroom left to move in. It is not the whole frame: the rasteriser's own work
   *  and the document renderer's layout are not observable from here, so this UNDERSTATES a layer. */
  busyMs: number
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

export type VerdictKind = 'saves' | 'nothing' | 'backfires' | 'cost'

export interface Verdict { kind: VerdictKind; text: string; deltaMs: number }

/** The main-thread floor a difference has to clear when the verdict is being read off `busyMs`. The
 *  performance clock is coarser than the numbers being subtracted, so a small floor stands under it. */
const BUSY_FLOOR_MS = 0.1

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
export function verdictFor(
  row: CellResult, baseline: CellResult, noiseMs: number, vsync = false,
): Verdict {
  const deltaMs = vsync
    ? row.busyMs - baseline.busyMs
    : row.stats.meanMs - baseline.stats.meanMs
  const floor = vsync ? Math.max(BUSY_FLOOR_MS, baseline.busyMs * 0.05) : noiseMs
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
  noiseMs: number
  /** The baseline never left the display's floor, so this shot's verdicts read main-thread time. */
  vsync: boolean
  rows: CellResult[]
  skipped: Cell[]
}

/** Group a finished run by shot, resolving each shot's baselines and its noise floor. */
export function blocksOf(cells: readonly Cell[], results: ReadonlyMap<string, CellResult>): ShotBlock[] {
  const order: ShotId[] = []
  for (const c of cells) if (!order.includes(c.shot)) order.push(c.shot)
  return order.map((id) => {
    const mine = cells.filter((c) => c.shot === id)
    const baseline = results.get(`${id}/baseline`)
    const repeat = results.get(`${id}/repeat`)
    return {
      shot: shotById(id),
      baseline,
      repeat,
      noiseMs: baseline && repeat ? noiseFloorMs(baseline.stats, repeat.stats) : 0.15,
      vsync: !!baseline && vsyncBound(baseline.stats),
      rows: mine.filter((c) => c.variant !== 'baseline' && c.variant !== 'repeat')
        .map((c) => results.get(c.key)).filter((r): r is CellResult => !!r),
      skipped: mine.filter((c) => !!c.skip),
    }
  })
}
