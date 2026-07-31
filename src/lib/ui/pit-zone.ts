// #sim-2d — pit-complex geometry. Lifted out of RaceTrackMap so it is pure: the renderer, the
// preview script and the geometry probe all measure the same numbers, and none of it needs a DOM.

import type { TrackLayout } from '@/data/tracks'
import type { Vec } from './geom'
import { screenUpAzimuth } from './lighting'

/** A vertex of the complex's outline in (arc, lateral) space. The outline is RECTILINEAR there:
 *  horizontal runs at a constant offset from the lane, joined by vertical steps at a constant arc
 *  position, which is what lets the front face carry garage recesses without any intersection work. */
interface PitNode {
  /** Arc position along the pit lane's centreline, in viewBox units. */
  s: number
  /** Offset from that centreline, in metres, toward the garages. */
  lat: number
}

/** Lateral offsets from the lane centreline, in metres, that shape the complex. */
const GARAGE_FACE = 4.45
const GARAGE_BACK = 13.1  // 8.65 m deep: a car's length plus the crew room behind it
const REAR_LAT = 13.8
/** The block that steps out behind the middle of the complex. */
const BLOCK_LAT = 16.0
const TERRACE_FRONT = 9.0
const TERRACE_BACK = 11.6
const PLANT_FRONT = 12.2
const PLANT_BACK = 13.3
/** The lane stripe's own offset, on the track side of the box row. */
const SEP_LAT = -1.3

/** Even samples along the complex for the pieces that follow the lane's curve: the terrace, its rail
 *  and the box-row stripe. */
const SPAN_SAMPLES = 3
/** The apron gets more: it runs past the box row at both ends and its edge is a taper rather than a
 *  constant offset, so it needs the stations to describe a curve the others do not have. */
const WORK_SAMPLES = 4

export interface PitSlot { x: number; y: number; nx: number; ny: number; rot: number }

export interface PitZone {
  /** The working-lane apron, tapered in and out at each end, as a closed ring. */
  work: Vec[]
  /** The same apron as its two edges, station for station: outer (garage side, tapering out and back
   *  in) and inner (a constant 1 m track-side of the lane centreline). What is laid ON the apron --
   *  its asphalt fringe, its grain -- is a band ACROSS a road that changes width, which a stroke of one
   *  width cannot describe. */
  workOuter: Vec[]
  workInner: Vec[]
  /** The white-on-blue separator stripe down the box row. */
  sep: Vec[]
  limiterIn: Vec[]
  limiterOut: Vec[]
  /** The pit building's BASE outline, as a ring: it is surveyed against the lane, so it stays put on
   *  the ground and the roof lifts off it. */
  buildingPts: Vec[]
  /** The storey above, whose front face runs flat across the garage openings. */
  upperPts: Vec[]
  /** The floor of each garage bay, indexed BY PIT SLOT so a team's colour lands in its own box. */
  garageFloors: Vec[][]
  /** Siding seams across the roof, running front to back and following the lane's curve. */
  roofSeams: string
  /** Rooftop viewing terrace as a ring, its railing line, and the plant units behind it. */
  roofDeck: Vec[]
  roofRail: Vec[]
  plant: Vec[][]
}

/** The one direction the oblique projection runs in, chosen so the camera sits square in FRONT of the
 *  pit complex.
 *
 *  That direction decides which faces of every solid are visible. Left as a fixed compass bearing it
 *  is a fixed bearing in WORLD space, so which face of the pit building you end up looking at is an
 *  accident of how each circuit happens to have been drawn: front-on at one, side-on at the next,
 *  from behind at a third. Deriving it from the lane's own normal standardises the whole map against
 *  the one landmark every circuit shares. Put the main straight across the screen and you are always
 *  looking at the garages.
 *
 *  Returns null when a layout has no box row to measure, which is the caller's cue to keep the mood's
 *  own bearing. Shadows run along this direction too, so the sun moves with the camera; they are a
 *  single vector in this renderer, not two. */
export function pitViewAzimuth(layout: TrackLayout): number | null {
  const st = layout.pit.slotStations
  if (st.length === 0) return null
  let nx = 0
  let ny = 0
  for (const s of st) {
    nx += s.nx
    ny += s.ny
  }
  if (Math.hypot(nx, ny) < 1e-9) return null
  // Station normals point to the GARAGE side, so the view runs the other way: out from the building
  // across the lane, which is the side its front face looks onto.
  return Math.atan2(-ny, -nx)
}

/** The world rotation that starts the race with the pit lane running across the screen and the
 *  complex along the top of it.
 *
 *  This is the other half of `pitViewAzimuth`. That one fixes the projection to the building; this
 *  one fixes the CAMERA to it, so the standardised perspective is the one the player actually opens
 *  on rather than one they would have to orbit to find. Putting the garages at the top is what makes
 *  every solid on the map lean away from the eye instead of toward it.
 *
 *  Follow is unaffected: the follow logic owns the pan and leaves rotation alone, so the camera still
 *  tracks a car, just from a known heading. */
export function pitCameraRotation(layout: TrackLayout): number | null {
  const az = pitViewAzimuth(layout)
  // `screenUpAzimuth` is its own inverse, so the rotation that produces a bearing is that same map
  // applied to the bearing. Rotating this far puts the garage side up the screen.
  return az === null ? null : screenUpAzimuth(az)
}

/** Where each garage box sits along the lane: evenly spread through the authored slot band, then
 *  pushed 1.6 m off the centreline onto the working lane. */
export function buildPitSlots(layout: TrackLayout, teamCount: number): PitSlot[] {
  const st = layout.pit.slotStations
  if (st.length < 2) return []
  const cum = [0]
  for (let k = 1; k < st.length; k++) cum.push(cum[k - 1] + Math.hypot(st[k].x - st[k - 1].x, st[k].y - st[k - 1].y))
  const arc = cum[cum.length - 1]
  const count = teamCount
  // Spread into the available room: 70% of the band per team, floored at the old tight
  // 14m pitch, capped at 26m so huge straights don't scatter the row.
  const mpu2 = layout.metresPerUnit
  const spacing = Math.min(arc / count, Math.max(14 / mpu2, Math.min(26 / mpu2, (0.7 * arc) / count)))
  const off16 = 1.6 / layout.metresPerUnit
  return Array.from({ length: count }, (_, i) => {
    const target = arc / 2 + (i - (count - 1) / 2) * spacing
    let k = 0
    while (k < st.length - 2 && cum[k + 1] < target) k++
    const f = Math.max(0, Math.min(1, (target - cum[k]) / (cum[k + 1] - cum[k] || 1)))
    const x = st[k].x + (st[k + 1].x - st[k].x) * f
    const y = st[k].y + (st[k + 1].y - st[k].y) * f
    const nx = st[k].nx + (st[k + 1].nx - st[k].nx) * f
    const ny = st[k].ny + (st[k + 1].ny - st[k].ny) * f
    const nl = Math.hypot(nx, ny) || 1
    const rot = st[k].rot + (st[k + 1].rot - st[k].rot) * f
    return { x: x + (nx / nl) * off16, y: y + (ny / nl) * off16, nx: nx / nl, ny: ny / nl, rot }
  })
}

/** The furniture of the box zone: the working-lane apron, its painted stripe and limiter lines, and
 *  the pit building's roof outline. Pure geometry, so the preview script and the geometry probe see
 *  exactly what the map draws. */
export function buildPitZone(layout: TrackLayout, pitSlots: PitSlot[]): PitZone | null {
  const st0 = layout.pit.slotStations
  if (st0.length < 2 || pitSlots.length === 0) return null
  // Sample the SAME quad-midpoint curve the ribbons are stroked from — chord positions sit
  // up to ~0.5m off the drawn tarmac on curved lanes, which left zone furniture (limiters
  // especially) gapping one boundary and overshooting the other.
  const raw: Array<[number, number]> = [[st0[0].x, st0[0].y], [(st0[0].x + st0[1].x) / 2, (st0[0].y + st0[1].y) / 2]]
  for (let k = 1; k < st0.length - 1; k++) {
    const ax = (st0[k - 1].x + st0[k].x) / 2
    const ay = (st0[k - 1].y + st0[k].y) / 2
    const bx = (st0[k].x + st0[k + 1].x) / 2
    const by = (st0[k].y + st0[k + 1].y) / 2
    for (let q = 1; q <= 4; q++) {
      const t = q / 4
      const s2 = 1 - t
      raw.push([s2 * s2 * ax + 2 * s2 * t * st0[k].x + t * t * bx, s2 * s2 * ay + 2 * s2 * t * st0[k].y + t * t * by])
    }
  }
  raw.push([st0[st0.length - 1].x, st0[st0.length - 1].y])
  const st = raw.map(([x, y], i) => {
    const a = raw[Math.max(0, i - 1)]
    const b = raw[Math.min(raw.length - 1, i + 1)]
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    let nx = -(b[1] - a[1]) / dl
    let ny = (b[0] - a[0]) / dl
    const ref = st0[Math.min(st0.length - 1, Math.round((i / (raw.length - 1)) * (st0.length - 1)))]
    if (nx * ref.nx + ny * ref.ny < 0) {
      nx = -nx
      ny = -ny
    }
    return { x, y, nx, ny }
  })
  const u1 = (m: number) => m / layout.metresPerUnit
  const cum = [0]
  for (let k = 1; k < st.length; k++) cum.push(cum[k - 1] + Math.hypot(st[k].x - st[k - 1].x, st[k].y - st[k - 1].y))
  const arc = cum[cum.length - 1]
  // Zone bounds from the ACTUAL rendered box row (projected onto this polyline) — a
  // parallel spacing formula drifted from the boxes on curved lanes, leaving end boxes
  // outside the working lane.
  const projArc = (q: { x: number; y: number }) => {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < st.length; i++) {
      const dx = st[i].x - q.x
      const dy = st[i].y - q.y
      if (dx * dx + dy * dy < bd) {
        bd = dx * dx + dy * dy
        best = i
      }
    }
    return cum[best]
  }
  const pA = projArc(pitSlots[0])
  const pB = projArc(pitSlots[pitSlots.length - 1])
  const rowLo = Math.min(pA, pB)
  const rowHi = Math.max(pA, pB)
  const a0 = Math.max(0, rowLo - u1(11.5))
  const a1 = Math.min(arc, rowHi + u1(11.5))
  const ptAt = (target: number, lat: number): { x: number; y: number } => {
    let k = 0
    while (k < st.length - 2 && cum[k + 1] < target) k++
    const f = Math.max(0, Math.min(1, (target - cum[k]) / (cum[k + 1] - cum[k] || 1)))
    const x = st[k].x + (st[k + 1].x - st[k].x) * f
    const y = st[k].y + (st[k + 1].y - st[k].y) * f
    const nx = st[k].nx + (st[k + 1].nx - st[k].nx) * f
    const ny = st[k].ny + (st[k + 1].ny - st[k].ny) * f
    const nl = Math.hypot(nx, ny) || 1
    return { x: x + (nx / nl) * lat, y: y + (ny / nl) * lat }
  }
  // Limiters anchored by PROJECTION onto the drawn fast ribbon: the zone polyline keeps its
  // end vertices exact while the drawn curve is smoothing-pulled there (~L^2/8R), which
  // shifted the lines ~0.3m laterally on curved lanes. Projection is exact by construction:
  // centre ON the ribbon, endpoints symmetric +-1.95m along its true perpendicular.
  const fastPts = layout.pit.fastPts
  // Working-lane geometry, hoisted: the limiter's garage-side end must land on the work
  // lane's drawn outer edge wherever its taper has already widened the road at the limiter's
  // station (spanning only the fast lane leaves a gap there).
  const WLAT_IN = -u1(1.0)
  const WLAT_OUT = u1(4.7)
  const w0 = Math.max(u1(2), a0 - u1(4))
  const w1 = Math.min(arc - u1(2), a1 + u1(4))
  const wt0 = Math.max(0, w0 - u1(35))
  const wt1 = Math.min(arc, w1 + u1(35))
  const workOuterLat = (sA: number) => {
    if (sA < wt0 || sA > wt1) return WLAT_IN
    let f = 1
    if (sA < w0) f = (sA - wt0) / (w0 - wt0 || 1)
    else if (sA > w1) f = (wt1 - sA) / (wt1 - w1 || 1)
    const e = f * f * (3 - 2 * f)
    return WLAT_IN + (WLAT_OUT - WLAT_IN) * e
  }
  const limiter = (target: number): Vec[] => {
    const c0 = ptAt(target, -u1(2.8))
    let bi = 1
    let bf = 0
    let bd = Infinity
    for (let i = 1; i < fastPts.length; i++) {
      const ax = fastPts[i - 1].x
      const ay = fastPts[i - 1].y
      const dx = fastPts[i].x - ax
      const dy = fastPts[i].y - ay
      const L2 = dx * dx + dy * dy || 1
      const f = Math.max(0, Math.min(1, ((c0.x - ax) * dx + (c0.y - ay) * dy) / L2))
      const px = ax + dx * f
      const py = ay + dy * f
      const dd = (c0.x - px) * (c0.x - px) + (c0.y - py) * (c0.y - py)
      if (dd < bd) {
        bd = dd
        bi = i
        bf = f
      }
    }
    const ax = fastPts[bi - 1].x
    const ay = fastPts[bi - 1].y
    const cx = ax + (fastPts[bi].x - ax) * bf
    const cy = ay + (fastPts[bi].y - ay) * bf
    const dl = Math.hypot(fastPts[bi].x - ax, fastPts[bi].y - ay) || 1
    const nx = -(fastPts[bi].y - ay) / dl
    const ny = (fastPts[bi].x - ax) / dl
    const h = u1(2.1)
    const gp = ptAt(target, u1(1.6))
    const candA = { x: cx + nx * h, y: cy + ny * h }
    const candB = { x: cx - nx * h, y: cy - ny * h }
    const dA = (candA.x - gp.x) * (candA.x - gp.x) + (candA.y - gp.y) * (candA.y - gp.y)
    const dB = (candB.x - gp.x) * (candB.x - gp.x) + (candB.y - gp.y) * (candB.y - gp.y)
    const trackEnd = dA > dB ? candA : candB
    const wl = workOuterLat(target)
    const garageEnd = wl > WLAT_IN + u1(0.05) ? ptAt(target, wl) : dA > dB ? candB : candA
    return [trackEnd, garageEnd]
  }

  // Articulated footprint, not a slab. The garages are RECESSES: the front face steps back between
  // piers, so each bay reads as an opening bitten out of the mass rather than a door painted on a
  // wall. That makes the ring concave, which is why it is extruded as a ring and not as boxes.
  //
  // Held as a FRONT run and a REAR run in (arc, lateral) space rather than as one flat vertex list.
  // The ring is the two joined; a stretch of it is the two clipped, which is what lets the complex be
  // submitted in pieces without the pieces ever disagreeing with the whole.
  const front: PitNode[] = []
  const bay = (a1 - a0) / Math.max(1, pitSlots.length)
  // Clamped to the bay: a fixed pier is wider than half a bay once a short pit zone is shared by
  // enough teams, and then every bay's start runs past its own end. That inverts the recess vertices
  // into a bow tie, which renders as a stray triangle on the wall rather than as a garage.
  const pier = Math.min(u1(0.9), bay * 0.3)
  front.push({ s: a0, lat: GARAGE_FACE })
  for (let i = 0; i <= pitSlots.length; i++) {
    const sB = a0 + i * bay
    const p0 = Math.max(a0, sB - pier)
    const p1 = Math.min(a1, sB + pier)
    front.push({ s: p0, lat: GARAGE_FACE }, { s: p1, lat: GARAGE_FACE })
    if (i === pitSlots.length) break
    const q0 = Math.min(a1, a0 + (i + 1) * bay - pier)
    front.push({ s: p1, lat: GARAGE_BACK }, { s: q0, lat: GARAGE_BACK }, { s: q0, lat: GARAGE_FACE })
  }
  const c0 = a0 + (a1 - a0) * 0.35
  const c1 = a0 + (a1 - a0) * 0.65
  // Everything from the rear of the front face round the back, shared by both storeys.
  const rear: PitNode[] = [
    { s: a1, lat: GARAGE_FACE }, { s: a1, lat: REAR_LAT },
    { s: c1, lat: REAR_LAT }, { s: c1, lat: BLOCK_LAT }, { s: c0, lat: BLOCK_LAT }, { s: c0, lat: REAR_LAT },
    { s: a0, lat: REAR_LAT },
  ]
  // The upper storey OVERHANGS the garages: the recesses are one storey deep, so above them the
  // front face runs flat and unbroken. Two prisms, not one.
  const upperFront: PitNode[] = [{ s: a0, lat: GARAGE_FACE }, { s: a1, lat: GARAGE_FACE }]

  const sampleCount = Math.max(1, pitSlots.length) * SPAN_SAMPLES
  const stations = Array.from(
    { length: sampleCount + 1 }, (_, j) => a0 + ((a1 - a0) * j) / sampleCount,
  )
  /** Insert a vertex wherever a station falls inside a HORIZONTAL run.
   *
   *  The outline is rectilinear in (arc, lateral) space, so a long run at a constant offset is a
   *  straight chord in world space however hard the lane curves through it. Everything standing on the
   *  roof — the terrace, its rail, the plant — follows the curve, so an un-sampled rear wall leaves 33
   *  of Monaco's 53 roof furniture points off the building with the garage floors showing through the
   *  gap. Vertical steps are left alone: a station cannot fall inside one. */
  const subdivide = (run: readonly PitNode[]): PitNode[] => {
    const out: PitNode[] = []
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i]
      const b = run[i + 1]
      out.push(a)
      if (Math.abs(a.lat - b.lat) > 1e-9) continue
      const inner = stations
        .filter((s) => s > Math.min(a.s, b.s) + 1e-9 && s < Math.max(a.s, b.s) - 1e-9)
        .sort((p, q) => (a.s > b.s ? q - p : p - q))
      for (const s of inner) out.push({ s, lat: a.lat })
    }
    out.push(run[run.length - 1])
    return out
  }
  const rearAll = subdivide(rear)
  /** A front run joined to the shared rear run, in world space. Consecutive duplicates are dropped:
   *  the recess loop opens and closes each bay on the same station, and a zero-length edge comes back
   *  out of `sweptRing` as a wall face standing on nothing. */
  const ringOf = (f: PitNode[]): Vec[] => {
    const out: Vec[] = []
    for (const n of [...subdivide(f), ...rearAll]) {
      const p = ptAt(n.s, u1(n.lat))
      const last = out[out.length - 1]
      if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue
      out.push(p)
    }
    return out
  }
  const runAt = (lat: number) => stations.map((s) => ptAt(s, u1(lat)))
  // Roof siding, front to back, following whatever the roof actually is at each station: the middle of
  // the complex steps out further, and siding that stopped at the main rear wall left that block as a
  // bare white patch.
  const seams: string[] = []
  const seamStep = u1(2.4)
  for (let sv = a0 + seamStep; sv < a1 - seamStep * 0.5; sv += seamStep) {
    const p = ptAt(sv, u1(GARAGE_FACE))
    const q = ptAt(sv, u1(sv > c0 && sv < c1 ? BLOCK_LAT : REAR_LAT))
    seams.push(`M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${q.x.toFixed(1)} ${q.y.toFixed(1)} `)
  }
  // The working-lane apron: its own station list, because it runs wider than the box row and its taper
  // has corners of its own.
  const workStations = [...new Set([
    ...Array.from({ length: Math.max(1, pitSlots.length) * WORK_SAMPLES + 1 },
      (_, j) => wt0 + ((wt1 - wt0) * j) / (Math.max(1, pitSlots.length) * WORK_SAMPLES)),
    w0, w1,
  ])].filter((s) => s >= wt0 && s <= wt1).sort((p, q) => p - q)
  // The apron as two edges rather than one ring, so what is laid on it can be banded across its
  // width; the ring is then just the outer edge and the inner edge walked back.
  const workOuter = workStations.map((s) => ptAt(s, workOuterLat(s)))
  const workInner = workStations.map((s) => ptAt(s, WLAT_IN))
  return {
    work: [...workOuter, ...[...workInner].reverse()],
    workOuter,
    workInner,
    sep: runAt(SEP_LAT),
    limiterIn: limiter(0),
    limiterOut: limiter(arc),
    buildingPts: ringOf(front),
    upperPts: ringOf(upperFront),
    // Bay found by projecting the slot onto the zone polyline rather than assuming slot i is bay i:
    // the box row is spread independently of the zone bounds and can run either way along it.
    garageFloors: pitSlots.map((slot) => {
      const i = Math.max(0, Math.min(pitSlots.length - 1, Math.floor((projArc(slot) - a0) / bay)))
      const s0 = a0 + i * bay + pier
      const s1 = a0 + (i + 1) * bay - pier
      return [
        ptAt(s0, u1(GARAGE_FACE)), ptAt(s1, u1(GARAGE_FACE)),
        ptAt(s1, u1(GARAGE_BACK)), ptAt(s0, u1(GARAGE_BACK)),
      ]
    }),
    // Roof furniture. A pit roof is the one big flat plane a player looks straight down on, so it
    // carries the detail: a viewing terrace along the front, its railing, and the plant that every
    // real complex has lined up behind it.
    roofDeck: [...runAt(TERRACE_FRONT), ...runAt(TERRACE_BACK).reverse()],
    roofSeams: seams.join(''),
    roofRail: runAt(TERRACE_BACK),
    plant: Array.from({ length: 7 }, (_, i) => {
      const c = a0 + (a1 - a0) * ((i + 0.5) / 7)
      const half = ((a1 - a0) / 7) * 0.26
      return [
        ptAt(c - half, u1(PLANT_FRONT)), ptAt(c + half, u1(PLANT_FRONT)),
        ptAt(c + half, u1(PLANT_BACK)), ptAt(c - half, u1(PLANT_BACK)),
      ]
    }),
  }
}
