// The perf lab's SHOTS (#sim-2d): where the camera is put, frame by frame. Pure.
//
// Camera scale is written in SCREEN PIXELS PER METRE and never in zoom, because zoom is not a shared
// unit: a circuit's own metres per unit and viewBox decide how big it draws, and 20x frames Monza very
// differently from Monaco. The shots then anchor to landmarks the circuit describes for ITSELF (its
// tightest corner, the point on the lap nearest its pit complex) rather than to authored coordinates.
// So the same run means the same thing on all 37 layouts and the rows compare.
//
// A pose is a pure function of the frame INDEX, which is what makes a cell reproducible: frame 40 of
// one configuration frames exactly what frame 40 of every other one frames. Warmup frames arrive with a
// negative index and simply start further back up the road.
//
// Every moving shot is also written at a CADENCE: metres a second, octaves a second, degrees a step. Not
// one is written as a fraction of the cell. A shot posed off `i / n` covers its whole path in whatever
// window it is handed, which makes the cell length part of the workload: the same shot at 90 frames and
// at 300 is then two different gestures, and the longer run is not the finer measurement it looks like.

import type { Camera } from './geom'

export type { Camera }

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
/** The rate every cadence below is written at. Nominal rather than measured: the lab runs uncapped, so a
 *  cell that drops to 45fps takes longer in wall clock than the seconds these constants name. Anchoring
 *  the poses to the INDEX is what keeps frame 40 of one cell framing what frame 40 of every other one
 *  frames, and the seconds are how a gesture gets chosen and argued about. */
const FRAME_HZ = 60
/** Octaves the zoom shot sweeps down and back. Rungs are keyed in half-octaves, so three octaves is
 *  six bucket crossings each way: the whole ladder, twice. */
const ZOOM_OCTAVES = 3
/** How fast the zoom shot travels, and the reason this file has a cadence section at all.
 *
 *  The shot used to pose off `i / n`, which put the entire out-and-back inside whatever window the cell
 *  was given: at ninety frames that is six octaves in a second and a half, twelve bucket crossings, about
 *  sixteen wheel notches a second. Nobody scrolls like that, so the cell was not measuring a zoom, and
 *  raising its frame count did not sample the same workload more finely, it made the zoom slower. A rate
 *  fixes both: the gesture is the same gesture whatever `n` is, and more frames are simply more of it.
 *
 *  One octave a second is two bucket crossings a second, about four wheel notches: a deliberate zoom out
 *  to find the field rather than a flick. */
const ZOOM_OCTAVES_PER_SEC = 1
/** Frames one full out-and-back takes at that rate. A cell shorter than this measures part of the sweep,
 *  a cell longer measures more than one, and neither changes what the shot is doing per frame. */
export const ZOOM_SWEEP_FRAMES = Math.round((2 * ZOOM_OCTAVES * FRAME_HZ) / ZOOM_OCTAVES_PER_SEC)
/** The scale a player watching a car actually uses, and the half of the range nothing measured.
 *
 *  Racing scale is calibrated to ZOOM_DEFAULT, and every shot here sat at it or swept OUT from it, so
 *  the lab never rendered a frame inward of the view the game opens on. The wheel goes seven more
 *  notches past it (ZOOM_MAX 60 against ZOOM_DEFAULT 20 at ZOOM_STEP 1.18), and that is where an object
 *  reaches its finest rung and where the cull disc is finally small enough to leave anything out. */
export const CLOSE_PX_PER_M = 6
/** Octaves from racing scale up to close: log2(6/2). */
const ZOOMIN_OCTAVES = Math.log2(CLOSE_PX_PER_M / RACE_PX_PER_M)
/** Frames one full in-and-out takes, at the same cadence the outward sweep travels at. */
export const ZOOMIN_SWEEP_FRAMES = Math.round((2 * ZOOMIN_OCTAVES * FRAME_HZ) / ZOOM_OCTAVES_PER_SEC)
/** The wide shot's pan, there and back, in seconds. Same fault as the zoom and the same fix: its pan was
 *  a fraction of the cell rather than a speed, so the camera crossed the stage faster the shorter the
 *  cell was. Two seconds across a tenth of the stage is a drag rather than a flick. */
const WIDE_PAN_SECONDS = 2
const WIDE_PAN_FRAMES = Math.round(WIDE_PAN_SECONDS * FRAME_HZ)

/** Position within a repeating cadence, as 0..1. Warmup arrives with a negative index and holds at the
 *  phase the measured window opens on, rather than running the gesture backwards into it. */
const phaseOf = (i: number, periodFrames: number): number => {
  const f = Math.max(0, i) / periodFrames
  return f - Math.floor(f)
}

export function zoomForPxPerM(pxPerM: number, w: ShotWorld): number {
  return (pxPerM * w.metresPerUnit * w.vb.w) / Math.max(1, w.stage.w)
}

/** The scale a camera is actually at, which is the above run backwards. The per-frame trace needs it and
 *  gets it from the POSE rather than from the renderer: a shot is a pure function of the frame index, so
 *  what the camera was showing on frame 40 is knowable without asking the map anything. */
export function pxPerMOf(z: number, w: ShotWorld): number {
  return (z * Math.max(1, w.stage.w)) / (w.metresPerUnit * w.vb.w)
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

export type ShotId =
  'racing' | 'pit' | 'start' | 'wide' | 'zoom' | 'zoomin' | 'close' | 'rotate' | 'still'

export interface Shot {
  id: ShotId
  label: string
  note: string
  /** False only for the parked camera, which is the one case the repaint guard can fire in. */
  moves: boolean
  /** True where the shot paints on frame after frame. False where the repaint guard holds it to a
   *  single paint, which is the whole point of the parked shot and is also what makes every mitigation
   *  living INSIDE a paint unmeasurable there. */
  repaints: boolean
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
    // NOT a recomposing shot, and that is measured rather than assumed: the cull disc only steps once
    // the camera has left 30% of its radius, which at racing scale is about 175m, and a 110-frame cell
    // covers 2% of a lap. The zoom holds, so no detail rung moves either. Nothing composes in the
    // window, which is why the compose-time mitigations are skipped here instead of coming back
    // "no effect" and being printed as mitigations that earned nothing.
    moves: true, repaints: true, recomposes: false, whole: false,
    pose: (i, n, w) => sweep(w.cornerF, i, n, w),
  },
  {
    id: 'pit',
    label: 'Pit straight',
    note: 'the same camera down the pit straight, with the complex and the garages in shot',
    moves: true, repaints: true, recomposes: false, whole: false,
    pose: (i, n, w) => sweep(w.pitF, i, n, w),
  },
  {
    id: 'start',
    label: 'Start line',
    note: 'the chequer, the grid boxes and the packed field at racing scale',
    moves: true, repaints: true, recomposes: false, whole: false,
    pose: (i, n, w) => sweep(0, i, n, w),
  },
  {
    id: 'wide',
    label: 'Whole circuit',
    note: 'the full track fitted to the stage, panning: the most draw calls a frame ever pays',
    moves: true, repaints: true, recomposes: false, whole: true,
    pose: (i, _n, w) => {
      const cam = centreOn(w.trackAt(0), 1, w.rot0, w)
      // A slow pan across a tenth of the stage, at a speed rather than at a fraction of the cell. At this
      // scale nothing crosses a rung or a disc, so the camera moving is the whole of what separates this
      // from the parked shot.
      const pan = Math.sin(phaseOf(i, WIDE_PAN_FRAMES) * Math.PI * 2) * w.stage.w * 0.05
      return { ...cam, x: cam.x + pan }
    },
  },
  {
    id: 'zoom',
    label: 'Zoom sweep',
    note: `racing scale out ${ZOOM_OCTAVES} octaves and back at ${ZOOM_OCTAVES_PER_SEC} octave a second:`
      + ` a full sweep is ${ZOOM_SWEEP_FRAMES} frames`,
    moves: true, repaints: true, recomposes: true, whole: false,
    pose: (i, _n, w) => {
      // Periodic and paced, NOT `i / n`. The sweep takes as long as it takes at the shipped cadence and
      // repeats, so the cell's length decides how much of the gesture is sampled and never how fast the
      // gesture is. Warmup holds at the starting scale rather than sweeping out past the camera's own
      // zoom limits before the measured frames begin.
      const tri = 1 - Math.abs(1 - 2 * phaseOf(i, ZOOM_SWEEP_FRAMES)) // 0 -> 1 -> 0
      // Racing scale at both ends and fully out in the middle, which is the gesture a player makes
      // looking for the field: out to find it, back in to watch it.
      const px = RACE_PX_PER_M * 2 ** (-ZOOM_OCTAVES * tri)
      return centreOn(w.trackAt(w.cornerF), zoomForPxPerM(px, w), w.rot0, w)
    },
  },
  {
    id: 'close',
    label: 'Close corner',
    note: `the same corner as the racing shot, at ${CLOSE_PX_PER_M} px/m: the scale a player watches a`
      + ' car at, and the only one where the cull disc is smaller than a circuit',
    // RECOMPOSING, unlike its racing-scale twin, and the difference is arithmetic rather than a
    // judgement. The disc steps once the camera has left 30% of its radius; the radius goes as 1/scale,
    // so tripling the scale thirds it. On monaco that is 874m and 424 frames a step at racing scale
    // against 291m and 141 frames here, so a cell of any usable length crosses several.
    moves: true, repaints: true, recomposes: true, whole: false,
    pose: (i, n, w) => sweep(w.cornerF, i, n, w, CLOSE_PX_PER_M),
  },
  {
    id: 'zoomin',
    label: 'Close zoom sweep',
    note: `racing scale in to ${CLOSE_PX_PER_M} px/m and back at ${ZOOM_OCTAVES_PER_SEC} octave a`
      + ` second: a full sweep is ${ZOOMIN_SWEEP_FRAMES} frames`,
    // The outward sweep's mirror. Both are needed rather than one shot spanning the whole range,
    // because a rung is a threshold: the costly band is where the most objects are in shot AND at their
    // finest rung, which is somewhere between the two ends and not at either of them.
    moves: true, repaints: true, recomposes: true, whole: false,
    pose: (i, _n, w) => {
      const tri = 1 - Math.abs(1 - 2 * phaseOf(i, ZOOMIN_SWEEP_FRAMES)) // 0 -> 1 -> 0
      const px = RACE_PX_PER_M * 2 ** (ZOOMIN_OCTAVES * tri)
      return centreOn(w.trackAt(w.cornerF), zoomForPxPerM(px, w), w.rot0, w)
    },
  },
  {
    id: 'rotate',
    label: 'Bearing steps',
    note: 'the camera turned in held steps, so each rebuild on the new bearing lands inside the window',
    moves: true, repaints: true, recomposes: true, whole: false,
    pose: (i, n, w) => {
      const rot = w.rot0 + Math.floor(i / ROT_HOLD_FRAMES) * ROT_STEP_RAD
      return centreOn(w.trackAt(w.cornerF), zoomForPxPerM(RACE_PX_PER_M, w), rot, w)
    },
  },
  {
    id: 'still',
    label: 'Parked camera',
    // Aimed at the pit straight and not at the corner, because this is the shot a SERVICED CAR
    // produces: pinned to its box for the whole stop with the busiest thing on the map around it. That
    // is where the repaint guard was put in to earn its keep, so that is where it gets asked.
    note: 'a car pinned in its box: the camera does not move, and the guard is all that stops the repaint',
    moves: false, repaints: false, recomposes: false, whole: false,
    pose: (i, n, w) => centreOn(w.trackAt(w.pitF), zoomForPxPerM(RACE_PX_PER_M, w), w.rot0, w),
  },
]

export const shotById = (id: ShotId): Shot => SHOTS.find((s) => s.id === id) ?? SHOTS[0]

