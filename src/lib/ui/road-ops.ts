// #sim-2d — the road as draw ops: the circuit, the pit lane, the working-lane apron, and the ink worn
// into the tarmac.
//
// Pure and shared, which is the point. The renderer built this list inline and the two probes that
// measure it (`scripts/frame-fill-check.ts`, `scripts/canvas-order-preview.ts`) each wrote their own
// copy of it. That made every road number they reported a measurement of a DIFFERENT road: cutting the
// apron into stretches moved nothing on the probe, because the probe was still submitting it whole.
// A probe that does not read the thing it is measuring is worse than no probe.

import type { TrackLayout } from '@/data/tracks'
import { linePath } from './extrude'
import type { Vec } from './geom'
import type { PitZone } from './pit-zone'
import { discOfPts, type DrawOp } from './scenery-draw'
import { LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, TARMAC_WIDTH_M, TRACK_WIDTH_M } from './track-path'
import { edgeOps, roadArcs, surfaceOps } from './track-surface'
import type { LapDynamics } from './lap-dynamics'

/** Half-width of the racing line the surface ink is hung off, in metres. */
const TRACK_M = 1.6

const CASING = '#D8D8D2'
const TARMAC = '#33383E'

export interface RoadOpts {
  layout: TrackLayout
  /** Metres to viewBox units. */
  u: (m: number) => number
  pitZone: PitZone | null
  /** The solved racing line, once there is one. Before that the circuit is stroked whole: it is one
   *  frame, and the alternative is a frame with no road on it. */
  lap: { pts: Vec[]; lateral: Float64Array; centre: Vec[]; dyn: LapDynamics } | null
  /** The ground the tarmac's edge fades into, and the shade it fades through. */
  ground: string
  shadow: string
  /** False once the softening layers are too small on screen to read. */
  inkFull: boolean
  /** The racing line, brake marks and marbles worn into the tarmac. Off by default: it is the most
   *  expensive thing on the map per unit of picture. */
  surfaceInk: boolean
}

export function roadOps(o: RoadOpts): DrawOp[] {
  const { layout, u, pitZone, lap } = o
  const detail = o.inkFull ? 'full' : 'low'
  const ink = lap && {
    u, line: lap.pts, curvature: lap.dyn.curvature, long: lap.dyn.long, trackM: TRACK_M,
    tarmac: TARMAC, centre: lap.centre, tarmacHalfM: TARMAC_WIDTH_M / 2,
    lateral: lap.lateral, detail: detail as 'full' | 'low',
  }
  const ops: DrawOp[] = []
  if (ink) {
    ops.push(...edgeOps({
      ...ink,
      ground: o.ground,
      shadow: o.shadow,
      ribbonHalfM: TRACK_WIDTH_M / 2,
      lineWidthM: (TRACK_WIDTH_M - TARMAC_WIDTH_M) / 2,
    }))
  }
  // LAYER-MAJOR across the circuit, the pit lane AND the apron: every white casing goes down before any
  // dark tarmac. Interleaved per road instead, the lane's casing lands on top of the track it has
  // already merged into, and its round cap leaves a white outline curving across the tarmac with a blob
  // on the end of it.
  //
  // The circuit is cut into cullable arcs the moment there is a centreline to cut it along: a
  // whole-circuit stroke costs its outline generation at every zoom, and that generation scales with
  // the pen's width and the path's length, so zooming IN makes it worse rather than better. Measured
  // at 60x, the canvas lost to the SVG renderer it replaced on exactly these four ops.
  for (const [colour, trackW, laneW] of [
    [CASING, TRACK_WIDTH_M, LANE_WIDTH_M], [TARMAC, TARMAC_WIDTH_M, LANE_TARMAC_M],
  ] as const) {
    ops.push(...(lap
      ? roadArcs(lap.centre, [{ colour, width: u(trackW) }])
      : [{ d: layout.d, stroke: colour, width: u(trackW) }]))
    // The lane stays whole: it is a few hundred metres rather than five kilometres.
    ops.push({ d: layout.pit.fastD, stroke: colour, width: u(laneW), cap: 'round' })
    if (!pitZone) continue
    // The apron in stretches, like the complex standing over it. One closed fill down the whole box row
    // was the largest single piece of path setup a racing shot of the pit straight submitted once the
    // complex had been cut, and its disc could never drop it: the apron is always in shot when you are
    // on the pit straight.
    //
    // The casing is a STROKE round the same ring, so a stretch also strokes the two edges it was cut
    // on. Those land under the neighbouring stretch's tarmac, which reaches past the cut by more than
    // the casing is wide.
    const wide = colour === CASING
    for (const ring of pitZone.workSpans) {
      ops.push({
        d: `${linePath(ring)}Z`,
        fill: colour,
        ...(wide ? { stroke: colour, width: u(2 * LANE_LINE_M) } : {}),
        clip: discOfPts(ring, u(2 * LANE_LINE_M)),
      })
    }
  }
  // Worn into the tarmac, on top of the road and under the kerbs.
  if (ink && o.surfaceInk) ops.push(...surfaceOps(ink))
  return ops
}
