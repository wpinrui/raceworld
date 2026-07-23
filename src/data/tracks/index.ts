// Per-circuit 2D track layouts (#sim-overhaul phase 6), keyed by the circuit ids in
// src/data/calendars/circuits.ts. Layouts come from real GPS traces imported via
// scripts/track-import.ts (bacinger/f1-circuits GeoJSON); venues missing from that dataset can be
// hand-authored as corner-point lists (buildTrackPath). Path progress 0 = the S/F line.
// Spike: Monaco only. Remaining venues get imported once the look/feel is approved.

import { buildPitLane, buildTracePath, type PitLane, type TrackStart, type TrackTrace } from '@/lib/ui/track-path'
import { TRACK as monaco } from './monaco'

// Real-world sizes rendered at true scale via each layout's metresPerUnit.
const PIT_LANE_OFFSET_M = 15

export interface TrackLayout {
  circuitId: string
  /** SVG viewBox, "x y w h". */
  viewBox: string
  /** Closed outline path in viewBox coordinates. Progress 0 along it = the S/F line. */
  d: string
  start: TrackStart
  /** Procedurally generated pit lane (entry before the S/F line, box at its midpoint, exit after turn 1). */
  pit: PitLane
  /** Real-world scale: metres per viewBox unit (circuit length / trace polyline length). */
  metresPerUnit: number
  /** The raw imported trace (scenery generation samples it). */
  trace: TrackTrace
}

function traceLength(trace: TrackTrace): number {
  let total = 0
  for (let i = 0; i < trace.length; i++) {
    const [ax, ay] = trace[i]
    const [bx, by] = trace[(i + 1) % trace.length]
    total += Math.hypot(bx - ax, by - ay)
  }
  return total
}

function traceLayout(circuitId: string, track: { viewBox: string; trace: TrackTrace; lengthM: number }): TrackLayout {
  const { d, start } = buildTracePath(track.trace)
  const metresPerUnit = track.lengthM / traceLength(track.trace)
  return {
    circuitId,
    viewBox: track.viewBox,
    d,
    start,
    pit: buildPitLane(track.trace, { offset: PIT_LANE_OFFSET_M / metresPerUnit, metresPerUnit }),
    metresPerUnit,
    trace: track.trace,
  }
}

export const TRACK_LAYOUTS: Record<string, TrackLayout> = {
  monaco: traceLayout('monaco', monaco),
}
