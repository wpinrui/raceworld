// What the PIT LANE remembers (#sim-2d increment C, the other half of the tarmac).
//
// The circuit got its worn line, its marbles and its asphalt apron and the pit lane did not, which left
// the one stretch of road the camera sits on for a whole stop looking like a grey rectangle ruled onto
// the grass beside a road that had been driven on.
//
// It is the same ink ([surface-ink.ts](./surface-ink.ts)) and deliberately NOT the same marks, because a
// pit lane is not a slow lap. Nobody takes a line through it, nothing gets thrown off the road in a
// corner, and nothing brakes hard enough to lock a wheel. What a pit lane actually shows from above is:
//
//  - an asphalt apron, exactly like the circuit's -- the one cue that makes a ribbon sit ON the ground;
//  - a band worn down the middle of the fast lane, strongest at the EXIT, where the only real traction
//    event of the whole lane happens;
//  - grime around each box, where cars stop, crews work and fluid gets spilt, and a scuff where each
//    car swings out of its box and back across the lane.
//
// Two orderings this file depends on, both set by the renderer:
//  - the apron and the fade beyond it are painted UNDER the lane, and under the garage floors, so a
//    dilated ring may spill toward the garages without anything having to clamp it;
//  - everything else is painted OVER the lane's asphalt and under the pit complex.

import type { DrawOp } from './scenery-draw'
import type { Vec } from './geom'
import type { PitSlot } from './pit-zone'
import {
  APRON_LINES, MARBLE, RUBBER, SOFT_LAYERS, blend, chunk, edgeLayer, grainWeight, layerStrength,
  midFrac, offsetPolyline, patch, softStroke, softStrokeAll, spacingOf, stripe,
} from './surface-ink'
import { LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M } from './track-path'

/** How far the asphalt reaches past the lane's own white line. */
const APRON_M = APRON_LINES * LANE_LINE_M
/** Half the fast lane's drawn casing, and the apron half-width measured off it. */
const CASING_HALF_M = LANE_WIDTH_M / 2
const FAST_APRON_HALF_M = CASING_HALF_M + APRON_M
/** The working apron is a filled ring at its asphalt edge, carrying the same white line, so its own
 *  asphalt fringe is dilated by the line plus the apron beyond it. */
const WORK_APRON_M = LANE_LINE_M + APRON_M

/** Metres of lane per arc. The marks are painted opaquely, so a mark's strength can only change where
 *  one arc ends and the next begins; this is what sets how smoothly the lane's wear can vary along it,
 *  at the same grain as the lap beside it. */
const ARC_M = 45

/** Peak strength of the band worn down the fast lane, as a blend weight. Well under the circuit's laid
 *  line: this is a road driven at 80 km/h under a limiter, and a stripe as dark as a racing line would
 *  claim the field races down it. */
const WEAR_ALPHA = 0.19

/** Grime around a box: what a stop leaves behind. Sized to read as a halo AROUND the painted work pad
 *  rather than as a second pad fighting it. */
const BOX_ALPHA = 0.34
/** The stain runs a car's length either side of the stop, and is held just inside the apron's own width
 *  so it never reaches the team-coloured garage floor behind it. */
const BOX_LEN_M = 4.6
const BOX_CORE_M = 4.2
const BOX_SPREAD_M = 0.5
/** The scuff a car lays swinging out of its box and back across the lane: how far down the lane it
 *  reaches, and how far across toward the fast lane it has got by then. */
const SWING_LEN_M = 9.0
const SWING_LAT_M = 3.2
const SWING_CORE_M = 2.4
/** Stations a box mark is drawn through. Enough that the softening's per-layer trim has something to
 *  take off each end, and enough that the swing reads as a curve rather than as a bent line. */
const STATIONS = 9
/** Softening layers a box mark gets. One fewer than everything else, because two marks per box across a
 *  full row is the densest thing this file puts on the pit straight, and a mark a few metres across
 *  cannot show a fourth step of falloff anyway. */
const BOX_LAYERS = 3

/** Grain bands across the lane and across the working apron. Fewer than the circuit's three, because
 *  these are narrow roads: three bands across 4.2 m would be strips too fine to read as paving. */
const LANE_GRAIN_BANDS = 2
const WORK_GRAIN_BANDS = 2
/** Peak grain strength, as a blend weight -- the same three grey levels the circuit is mottled with. */
const GRAIN_ALPHA = 0.075
/** Metres of road per grain patch, as on the circuit: short enough to read as mottling, long enough not
 *  to cost an op every few metres. */
const GRAIN_PATCH_M = 45

export interface PitSurface {
  /** metres to viewBox units. */
  u: (m: number) => number
  /** The drawn fast-lane ribbon's centreline, in travel order: entry at 0, exit at the end. */
  fast: readonly Vec[]
  /** The working apron's two edges, station for station. Absent on a layout with no box row. */
  apron?: { outer: readonly Vec[]; inner: readonly Vec[] }
  /** Where each car stops and which way it points. */
  boxes?: readonly PitSlot[]
  /** The road these marks are worn into, so they can be pre-blended against it. */
  tarmac: string
  /** The ground the lane is laid on, which its apron fades into. */
  ground: string
}

/** Stations of an OPEN polyline that span `metres` of road, measured off its own spacing rather than
 *  assumed: the lane is sampled for the geometry's benefit and that sampling is free to change. */
function stationsPer(pts: readonly Vec[], u: (m: number) => number, metres: number): number {
  return Math.max(2, Math.round(metres / Math.max(1e-6, spacingOf(pts, u, false))))
}

const allOf = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** One colour laid along a polyline in arcs, `width` units wide. */
function strokeRuns(
  pts: readonly Vec[], runs: number[][], width: number, colour: string,
): DrawOp[] {
  return runs.map((idx) => (
    { d: stripe(pts, idx, () => 0), stroke: colour, width, cap: 'round' }
  ))
}

/** The asphalt the lane is actually laid on, and its fade into the verge.
 *
 *  Both the lane and the working apron are edged the same way: a stroke centred on the road's own line
 *  and wider than the road. The apron's interior needs no fade, because the apron's own fill covers it.
 *
 *  Drawn UNDER everything else in the pit complex, which is what lets the fringe run toward the garages
 *  unclamped: the garage floors and then the building itself paint over whatever reaches in there, and
 *  what is left is asphalt around the ends of the box row, which is where a real complex has it. */
/** The lane's edge falloff, grouped by soft layer for the same layer-major zip the circuit's fade
 *  exposes (edgeOpsByLayer): interleaved, the two roads wear one merged falloff at the junctions. */
export function pitEdgeOpsByLayer(s: PitSurface): { fades: DrawOp[][]; asphalt: DrawOp[] } {
  const { u, fast } = s
  if (fast.length < 3) return { fades: [], asphalt: [] }
  const layers = SOFT_LAYERS
  // `halfM` is how far the asphalt reaches EITHER SIDE of the line: for the lane that is its apron's
  // half-width off the centreline, for the working apron how far its asphalt is dilated past its edge.
  const edges = [
    { pts: fast, halfM: FAST_APRON_HALF_M },
    ...(s.apron && s.apron.outer.length >= 3 ? [{ pts: s.apron.outer, halfM: WORK_APRON_M }] : []),
  ].map((e) => ({ ...e, runs: chunk(allOf(e.pts.length), stationsPer(e.pts, u, ARC_M)) }))

  // Widest and faintest first, and layer-major across the lane AND its apron together: the two meet
  // along the whole box row, so a wide pale layer of one landing after the other's core would scrub a
  // pale notch down the join between them.
  const fades = Array.from({ length: layers }, (_, k) => {
    const { reachM, colour } = edgeLayer(k, layers, s.ground, s.tarmac)
    return edges.flatMap((e) => strokeRuns(e.pts, e.runs, 2 * u(e.halfM + reachM), colour))
  })
  // The asphalt itself, over the fade and under the white line, so what the fade falls away FROM is
  // asphalt rather than paint.
  return { fades, asphalt: edges.flatMap((e) => strokeRuns(e.pts, e.runs, 2 * u(e.halfM), s.tarmac)) }
}

export function pitEdgeOps(s: PitSurface): DrawOp[] {
  const { fades, asphalt } = pitEdgeOpsByLayer(s)
  return [...fades.flat(), ...asphalt]
}

/** How used the lane is at a fraction along it, 0 at the entry and 1 at the exit.
 *
 *  Squared toward the exit because that is the one place a pit lane is genuinely loaded: a car leaves
 *  its box on the limiter and then puts everything it has down at the exit line. The rest of the lane is
 *  transit at a constant crawl, so it darkens evenly, patchily and not much. */
function wearWeight(frac: number): number {
  const patchy = 0.72 + 0.28 * Math.sin(2 * Math.PI * 3.4 * frac + 1.1)
  return WEAR_ALPHA * (0.4 + 0.6 * frac * frac) * patchy
}

/** The band worn down the middle of the fast lane: every car that pits drives the same three metres of
 *  it, which over a season is the only part of the lane that sees a tyre at all. */
function wearOps(s: PitSurface): DrawOp[] {
  const { u, fast } = s
  const layers = SOFT_LAYERS
  const core = u(1.6)
  const spread = u(0.35)
  const runs = chunk(allOf(fast.length), stationsPer(fast, u, ARC_M))
  const ops: DrawOp[] = []
  for (let k = 0; k < layers; k++) {
    for (const idx of runs) {
      // Runs abut each other end to end, so no run has a free end to taper and round caps leave no nub.
      const colour = blend(s.tarmac, RUBBER, wearWeight(midFrac(idx, fast.length)) * layerStrength(k, layers))
      const op = softStroke(fast, idx, k, layers, { core, spread, colour })
      if (op) ops.push(op)
    }
  }
  return ops
}

/** Grime and scuff at each box: a stain over the stop, and the arc a car scrubs swinging back out into
 *  the lane. */
function boxOps(s: PitSurface): DrawOp[] {
  const { u, boxes } = s
  if (!boxes || boxes.length === 0) return []
  const layers = Math.min(SOFT_LAYERS, BOX_LAYERS)
  // Both marks are sampled at STATIONS rather than drawn end to end, because the softening trims a
  // fifth of a run per layer and a two-point run has nothing to trim: without the stations a mark would
  // narrow toward its core but keep a hard end.
  const runsOf = (f: (b: PitSlot, t: number) => Vec) => boxes.map((b) => (
    Array.from({ length: STATIONS }, (_, i) => f(b, i / (STATIONS - 1)))
  ))
  const at = (b: PitSlot, m: number, lat: number): Vec => ({
    // The station normal points at the GARAGES, so the fast lane is the other way.
    x: b.x + Math.cos(b.rot) * u(m) - b.nx * u(lat),
    y: b.y + Math.sin(b.rot) * u(m) - b.ny * u(lat),
  })
  const stains = runsOf((b, t) => at(b, -BOX_LEN_M + 2 * BOX_LEN_M * t, 0))
  // Out of the box, across the lane, and gone. The lateral runs as the SQUARE of the distance down the
  // lane, so the mark leaves the box along the car's own axis and bends away from it: a straight
  // diagonal would have the car step sideways the instant it moved.
  const swings = runsOf((b, t) => at(b, 0.5 + SWING_LEN_M * t, SWING_LAT_M * t * t))
  const ops: DrawOp[] = []
  for (let k = 0; k < layers; k++) {
    const t = layerStrength(k, layers)
    // The whole row as one path per mark per layer: every box's grime is the same colour and width at a
    // given layer, and a pit straight is looked at as a row rather than a box at a time.
    const stain = softStrokeAll(stains, k, layers, {
      core: u(BOX_CORE_M),
      spread: u(BOX_SPREAD_M),
      colour: blend(s.tarmac, RUBBER, BOX_ALPHA * t),
      taper: true,
    })
    if (stain) ops.push(stain)
    const swing = softStrokeAll(swings, k, layers, {
      core: u(SWING_CORE_M),
      spread: u(0.4),
      colour: blend(s.tarmac, RUBBER, BOX_ALPHA * 0.55 * t),
      taper: true,
    })
    if (swing) ops.push(swing)
  }
  return ops
}

/** Bands of mottling ALONG a road of changing width, as filled quads between two edges. A stroke has one
 *  width and the working apron does not, so the circuit's band-as-a-stroke does not carry over here. */
function bandOps(
  s: PitSurface, outer: readonly Vec[], inner: readonly Vec[], bands: number, seed: number,
): DrawOp[] {
  const { u } = s
  const n = Math.min(outer.length, inner.length)
  if (n < 3) return []
  const perPatch = stationsPer(outer, u, GRAIN_PATCH_M)
  const at = (i: number, f: number): Vec => ({
    x: inner[i].x + (outer[i].x - inner[i].x) * f,
    y: inner[i].y + (outer[i].y - inner[i].y) * f,
  })
  const ops: DrawOp[] = []
  for (let band = 0; band < bands; band++) {
    const f0 = band / bands
    const f1 = (band + 1) / bands
    for (const idx of chunk(allOf(n), perPatch)) {
      const w = grainWeight(midFrac(idx, n), band + seed)
      const t = Math.abs(w) * GRAIN_ALPHA
      if (t < 0.004) continue
      // Down one edge of the band and back up the other: adjacent patches share their end stations, so
      // the quads abut exactly and opaque paint leaves no seam between them.
      const quad = [
        ...idx.map((i) => at(i, f0)),
        ...[...idx].reverse().map((i) => at(i, f1)),
      ]
      ops.push({ d: patch(quad), fill: blend(s.tarmac, w > 0 ? MARBLE : RUBBER, t) })
    }
  }
  return ops
}

/** The lane's own grain. */
function grainOps(s: PitSurface): DrawOp[] {
  const { u, fast } = s
  if (fast.length < 3) return []
  // The fast lane is described by its centreline, so its two edges are built from it; the working apron
  // already comes as a pair of edges.
  const half = u(LANE_TARMAC_M / 2)
  return [
    ...bandOps(s, offsetPolyline(fast, half, false), offsetPolyline(fast, -half, false), LANE_GRAIN_BANDS, 0),
    ...(s.apron ? bandOps(s, s.apron.outer, s.apron.inner, WORK_GRAIN_BANDS, LANE_GRAIN_BANDS) : []),
  ]
}

/** Everything worn into the lane, in the order it was laid: the road's own grain, then the band driven
 *  down it, then what the stops left around the boxes. Drawn OVER the lane's asphalt; `pitEdgeOps` goes
 *  under it. */
export function pitSurfaceOps(s: PitSurface): DrawOp[] {
  return [...grainOps(s), ...wearOps(s), ...boxOps(s)]
}
