// Per-circuit 2D track layouts (#sim-overhaul phase 6). Hand-authored stylized silhouettes of the real
// venues, keyed by the circuit ids in src/data/calendars/circuits.ts. Authored as corner-point lists in
// race direction (see track-path.ts); the pit straight is the closing edge so path progress 0 = the S/F line.
// Spike: Monaco only. Remaining venues get authored once the look/feel is approved.

import { buildTrackPath, type TrackPoint, type TrackStart } from '@/lib/ui/track-path'
import { MONACO_POINTS, MONACO_VIEWBOX } from './monaco'

export interface TrackLayout {
  circuitId: string
  /** SVG viewBox, "x y w h". */
  viewBox: string
  /** Closed rounded outline path in viewBox coordinates. Progress 0 along it = the S/F line. */
  d: string
  start: TrackStart
}

function layout(circuitId: string, viewBox: string, points: TrackPoint[]): TrackLayout {
  const { d, start } = buildTrackPath(points)
  return { circuitId, viewBox, d, start }
}

export const TRACK_LAYOUTS: Record<string, TrackLayout> = {
  monaco: layout('monaco', MONACO_VIEWBOX, MONACO_POINTS),
}
