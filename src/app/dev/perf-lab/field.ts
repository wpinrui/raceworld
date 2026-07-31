// A field for the perf lab, built from nothing (#sim-2d).
//
// The lab must not need a save. Reading one would mean the numbers depended on whose career it was, on
// how many teams had folded and on where the cars happened to be that lap, and it would mean opening a
// race screen to measure a renderer. So the field here is fabricated: a fixed twenty, fixed teams,
// fixed colours, at fixed places round the lap.
//
// FIXED is the point rather than a shortcut. A cell is compared against another cell, so anything that
// differs between them is noise the report cannot separate from the change being measured. A field
// parked at known lap fractions puts the identical twenty cars in the identical twenty places on every
// frame of every cell, while still paying the whole per-frame cost the race loop pays: the arc lookups,
// the separation passes, the attitude and steering writes, the visibility settles.

import type { TrackCarMeta, TrackSample } from '@/components/race/RaceTrackMap'
import type { TyreCompound } from '@/lib/sim/types'
import { MOCK_DRIVERS, MOCK_TEAMS } from '../track-preview/mock'

/** Cars parked in a pit box, and how far through the stop they are.
 *
 *  Staged on purpose. A pit stop is the busiest thing the map ever draws (the complex, the garages, the
 *  boxes, four gunners, eight carriers, two jack men and a lollipop man per box) and it is the shot the
 *  still-camera repaint guard was put in for. A live race cannot be asked to produce one on demand,
 *  which is exactly why the old lap benchmark could only hope to catch one. Here it is simply true. */
const STOPPING = 2
const STOP_FRAC = 0.35

const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard']

export const LAB_CARS: TrackCarMeta[] = MOCK_DRIVERS.slice(0, 20).map((d, i) => {
  const team = MOCK_TEAMS.find((t) => t.id === d.teamId)
  return {
    id: d.id,
    pos: i + 1,
    color: team?.color ?? '#888888',
    name: d.name,
    team: team?.name,
    nationality: d.nationality,
    compound: COMPOUNDS[i % COMPOUNDS.length],
    isPlayer: i === 0,
  }
})

export const LAB_TEAM_ORDER: string[] = [...new Set(LAB_CARS.map((c) => c.team ?? c.id))]

/** Where each car sits, by index. Spread evenly round the lap so every shot frames some of the field
 *  rather than all of it or none, with a short train at the front so the side-by-side separation and
 *  the never-overlap sweeps have something to resolve. */
function placeOf(i: number, n: number): number {
  if (i < 4) return 0.02 + i * 0.004 // a train, close enough to trigger the cluster fan-out
  return ((i - 4) + 1) / (n - 4 + 1)
}

export interface FieldOpts {
  /** Roll the field round the lap instead of parking it.
   *
   *  Off by default and it should stay off for a measured run: rolling means frame 40 of one cell has
   *  the cars somewhere frame 40 of the next one does not, and that difference lands in the same column
   *  as the mitigation being measured. On, it is the honest picture of a race in progress. */
  rolling: boolean
  /** Put two cars in their boxes mid-stop, with the crews out. */
  pitStop: boolean
  /** Wall clock, only read while rolling. */
  now: number
}

/** How long a lap takes the rolling field, in ms. A real one, so the cars move at a believable rate. */
const LAP_MS = 90_000

export function labSample(id: string, o: FieldOpts): TrackSample {
  const i = LAB_CARS.findIndex((c) => c.id === id)
  if (i < 0) return null
  if (o.pitStop && i >= LAB_CARS.length - STOPPING) {
    // 0.5 is the box itself: the lane's progress parks there for the length of the stop.
    return {
      prog: 0.5,
      pit: true,
      pitPhase: 'box',
      stopFrac: STOP_FRAC,
      pitNewCompound: COMPOUNDS[(i + 1) % COMPOUNDS.length],
    }
  }
  const base = placeOf(i, LAB_CARS.length)
  return { prog: o.rolling ? (base + o.now / LAP_MS) % 1 : base }
}
