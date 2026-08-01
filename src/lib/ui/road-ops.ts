// #sim-2d — the road as draw ops: the circuit, the pit lane, the working-lane apron, and the ink worn
// into the tarmac.
//
// Pure and shared, which is the point: the renderer and the preview script build the same road from
// the same call, so nothing can measure or draw a road nobody else has.

import type { TrackLayout } from '@/data/tracks'
import { linePath } from './extrude'
import type { Vec } from './geom'
import type { PitSlot, PitZone } from './pit-zone'
import type { DrawOp } from './scenery-draw'
import { LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, TARMAC_WIDTH_M, TRACK_WIDTH_M } from './track-path'
import { edgeOps, surfaceOps } from './track-surface'
import { pitEdgeOps, pitSurfaceOps } from './pit-surface'
import type { LapDynamics } from './lap-dynamics'

/** Half-width of the racing line the surface ink is hung off, in metres. */
const TRACK_M = 1.6

/** The road's two paints, exported so the 3D renderer lays the same colours (#3d-port). */
export const ROAD_CASING = '#D8D8D2'
export const ROAD_TARMAC = '#33383E'

export interface RoadOpts {
  layout: TrackLayout
  /** Metres to viewBox units. */
  u: (m: number) => number
  pitZone: PitZone | null
  pitSlots: PitSlot[]
  /** The solved racing line, once there is one. Before that the circuit is stroked whole: it is one
   *  frame, and the alternative is a frame with no road on it. */
  lap: { pts: Vec[]; lateral: Float64Array; centre: Vec[]; dyn: LapDynamics } | null
  /** The ground the tarmac's edge fades into, and the shade it fades through. */
  ground: string
  shadow: string
}

/** The two ink bundles every surface module reads, built once from the shared opts. */
function inkArgs(o: RoadOpts) {
  const { layout, u, pitZone, pitSlots, lap } = o
  const ink = lap && {
    u, line: lap.pts, curvature: lap.dyn.curvature, long: lap.dyn.long, trackM: TRACK_M,
    tarmac: ROAD_TARMAC, centre: lap.centre, tarmacHalfM: TARMAC_WIDTH_M / 2,
    lateral: lap.lateral,
  }
  const pitInk = {
    u,
    fast: layout.pit.fastPts,
    apron: pitZone ? { outer: pitZone.workOuter, inner: pitZone.workInner } : undefined,
    boxes: pitSlots,
    tarmac: ROAD_TARMAC,
    ground: o.ground,
  }
  return { ink, pitInk }
}

/** The asphalt aprons and their fade into the verge, UNDER the road: the circuit's under its own
 *  ribbon, the lane's under the garage floors, which is what lets the working apron's fringe run
 *  toward the garages without anything having to clamp it. Exported apart from `roadOps` so the 3D
 *  world can lay the same ink at its own lifts (#3d-port). */
export function roadInkUnder(o: RoadOpts): DrawOp[] {
  const { ink, pitInk } = inkArgs(o)
  // The pit lane's ink first, the circuit's over it: where the two roads meet (the exit's fade
  // running across the track edge, the entry's grime under a braking zone) the MAIN ROAD's story
  // wins, because the racing surface is the one the eye follows through the junction.
  const ops: DrawOp[] = [...pitEdgeOps(pitInk)]
  if (ink) {
    ops.push(...edgeOps({
      ...ink,
      ground: o.ground,
      shadow: o.shadow,
      ribbonHalfM: TRACK_WIDTH_M / 2,
      lineWidthM: (TRACK_WIDTH_M - TARMAC_WIDTH_M) / 2,
    }))
  }
  return ops
}

/** Worn into the tarmac, on top of the road and under the kerbs. Pit first here too: the lane's
 *  wear never paints over the circuit's brake marks and marbles where the roads join. */
export function roadInkOver(o: RoadOpts): DrawOp[] {
  const { ink, pitInk } = inkArgs(o)
  const ops: DrawOp[] = [...pitSurfaceOps(pitInk)]
  if (ink) ops.push(...surfaceOps(ink))
  return ops
}

/** The whole road surface, in paint order.
 *
 *  LAYER-MAJOR across the circuit, the pit lane AND the apron: every white casing goes down before any
 *  dark tarmac. Interleaved per road instead, the lane's casing lands on top of the track it has
 *  already merged into, and its round cap leaves a white outline curving across the tarmac with a blob
 *  on the end of it. */
export function roadOps(o: RoadOpts): DrawOp[] {
  const { layout, u, pitZone } = o
  const ops: DrawOp[] = roadInkUnder(o)
  for (const [colour, trackW, laneW] of [
    [ROAD_CASING, TRACK_WIDTH_M, LANE_WIDTH_M], [ROAD_TARMAC, TARMAC_WIDTH_M, LANE_TARMAC_M],
  ] as const) {
    ops.push({ d: layout.d, stroke: colour, width: u(trackW), cap: 'round' })
    ops.push({ d: layout.pit.fastD, stroke: colour, width: u(laneW), cap: 'round' })
    if (!pitZone) continue
    // The apron carries the same white edge line, so its casing is a stroke round the same ring.
    ops.push({
      d: `${linePath(pitZone.work)}Z`,
      fill: colour,
      ...(colour === ROAD_CASING ? { stroke: colour, width: u(2 * LANE_LINE_M) } : {}),
    })
  }
  ops.push(...roadInkOver(o))
  return ops
}
