// Per-circuit 2D track layouts (#sim-overhaul phase 6), keyed by the circuit ids in
// src/data/calendars/circuits.ts. Layouts come from real GPS traces imported via
// scripts/track-import-all.ts (bacinger/f1-circuits GeoJSON). Path progress 0 = the S/F line.
// Not in that dataset (need another source or hand-authoring): fuji, valencia, korea, india, jerez —
// those circuits fall back to the classic race screen until covered.

import { buildPitLane, buildTracePath, type PitLane, type TrackStart, type TrackTrace } from '@/lib/ui/track-path'
import { TRACK as abuDhabi } from './abu-dhabi'
import { TRACK as argentina } from './argentina'
import { TRACK as australia } from './australia'
import { TRACK as austria } from './austria'
import { TRACK as azerbaijan } from './azerbaijan'
import { TRACK as bahrain } from './bahrain'
import { TRACK as belgium } from './belgium'
import { TRACK as brazil } from './brazil'
import { TRACK as canada } from './canada'
import { TRACK as china } from './china'
import { TRACK as estoril } from './estoril'
import { TRACK as hockenheim } from './hockenheim'
import { TRACK as hungary } from './hungary'
import { TRACK as imola } from './imola'
import { TRACK as indianapolis } from './indianapolis'
import { TRACK as italy } from './italy'
import { TRACK as japan } from './japan'
import { TRACK as lasVegas } from './las-vegas'
import { TRACK as madrid } from './madrid'
import { TRACK as magnyCours } from './magny-cours'
import { TRACK as malaysia } from './malaysia'
import { TRACK as mexico } from './mexico'
import { TRACK as miami } from './miami'
import { TRACK as monaco } from './monaco'
import { TRACK as mugello } from './mugello'
import { TRACK as netherlands } from './netherlands'
import { TRACK as nurburgring } from './nurburgring'
import { TRACK as paulRicard } from './paul-ricard'
import { TRACK as portimao } from './portimao'
import { TRACK as qatar } from './qatar'
import { TRACK as russia } from './russia'
import { TRACK as saudiArabia } from './saudi-arabia'
import { TRACK as singapore } from './singapore'
import { TRACK as spain } from './spain'
import { TRACK as turkey } from './turkey'
import { TRACK as usa } from './usa'

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

type ImportedTrack = { viewBox: string; trace: TrackTrace; lengthM: number }

function traceLayout(circuitId: string, track: ImportedTrack): TrackLayout {
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

const IMPORTED: Record<string, ImportedTrack> = {
  'abu-dhabi': abuDhabi,
  argentina,
  australia,
  austria,
  azerbaijan,
  bahrain,
  belgium,
  brazil,
  canada,
  china,
  estoril,
  hockenheim,
  hungary,
  imola,
  indianapolis,
  italy,
  japan,
  'las-vegas': lasVegas,
  madrid,
  'magny-cours': magnyCours,
  malaysia,
  mexico,
  miami,
  monaco,
  mugello,
  netherlands,
  nurburgring,
  'paul-ricard': paulRicard,
  portimao,
  qatar,
  russia,
  'saudi-arabia': saudiArabia,
  singapore,
  spain,
  turkey,
  usa,
}

export const TRACK_LAYOUTS: Record<string, TrackLayout> = Object.fromEntries(
  Object.entries(IMPORTED).map(([id, track]) => [id, traceLayout(id, track)]),
)
