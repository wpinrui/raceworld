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
/** Octaves the zoom shot sweeps down and back. Rungs are keyed in half-octaves, so three octaves is
 *  six bucket crossings each way: the recompose cadence a player produces looking for the field. */
const ZOOM_OCTAVES = 3

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
    moves: true, repaints: true, recomposes: true, whole: false,
    pose: (i, n, w) => {
      // Clamped, so warmup's negative index holds the shot at its starting scale rather than sweeping
      // out past the camera's own zoom limits before the measured frames begin.
      const t = clamp01(i / Math.max(1, n))
      const tri = 1 - Math.abs(1 - 2 * t) // 0 -> 1 -> 0
      // Racing scale at both ends and fully out in the middle, which is the gesture a player makes
      // looking for the field: out to find it, back in to watch it.
      const px = RACE_PX_PER_M * 2 ** (-ZOOM_OCTAVES * tri)
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

