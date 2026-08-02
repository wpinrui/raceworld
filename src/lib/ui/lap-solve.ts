// The racing line solved off a circuit's own trace, plus the lap dynamics along it, without a
// browser (#sim-2d / #3d-port). Lifted out of the 2D preview script: the 3D world needs the same
// solve for the ink worn into its tarmac, and one solver keeps every renderer's rubber on one line.

import type { TrackLayout } from '@/data/tracks'
import { PROFILE_N, lapDynamics, trackPhysics, type LapDynamics } from './lap-dynamics'
import { buildRacingLine, polylineArc, type RacingLine } from './racing-line'
import { densifyTrace } from './track-path'
import type { Vec } from './geom'

export interface SolvedLap {
  line: RacingLine
  arc: ReturnType<typeof polylineArc>
  /** The same ~3m centreline stations the map samples for the tarmac edge. */
  centre: Vec[]
  dyn: LapDynamics
}

export function solveLap(layout: TrackLayout): SolvedLap {
  const centreArc = polylineArc(densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y })))
  const line = buildRacingLine(centreArc, layout.metresPerUnit)
  const arc = polylineArc(line.pts)
  const pts = Array.from({ length: PROFILE_N }, (_, i) => arc.at((i / PROFILE_N) * arc.length))
  const n = Math.max(512, Math.min(4096, Math.round((centreArc.length * layout.metresPerUnit) / 3)))
  const centre = Array.from({ length: n }, (_, i) => centreArc.at((i / n) * centreArc.length))
  return { line, arc, centre, dyn: lapDynamics(pts, arc.length, trackPhysics(layout.metresPerUnit)) }
}

/** The shape `RoadOpts.lap` wants, for handing a solved lap to the road builders. */
export function roadLap(s: SolvedLap): { pts: Vec[]; lateral: Float64Array; centre: Vec[]; dyn: LapDynamics } {
  return { pts: s.line.pts, lateral: s.line.lateral, centre: s.centre, dyn: s.dyn }
}
