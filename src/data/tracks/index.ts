// Per-circuit 2D track layouts (#sim-overhaul phase 6), keyed by the circuit ids in
// src/data/calendars/circuits.ts. Layouts come from real GPS traces imported via
// scripts/track-import.ts (bacinger/f1-circuits GeoJSON); venues missing from that dataset can be
// hand-authored as corner-point lists (buildTrackPath). Path progress 0 = the S/F line.
// Spike: Monaco only. Remaining venues get imported once the look/feel is approved.

import { buildPitLane, buildTracePath, type PitLane, type TrackStart, type TrackTrace } from '@/lib/ui/track-path'
import { TRACK as monaco } from './monaco'

export interface TrackLayout {
  circuitId: string
  /** SVG viewBox, "x y w h". */
  viewBox: string
  /** Closed outline path in viewBox coordinates. Progress 0 along it = the S/F line. */
  d: string
  start: TrackStart
  /** Procedurally generated pit lane (entry before the S/F line, box at its midpoint, exit after turn 1). */
  pit: PitLane
}

function traceLayout(circuitId: string, track: { viewBox: string; trace: TrackTrace }): TrackLayout {
  const { d, start } = buildTracePath(track.trace)
  return { circuitId, viewBox: track.viewBox, d, start, pit: buildPitLane(track.trace) }
}

export const TRACK_LAYOUTS: Record<string, TrackLayout> = {
  monaco: traceLayout('monaco', monaco),
}
