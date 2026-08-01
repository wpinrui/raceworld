// The car as a real solid (#3d-port increment 4): a parametric loft that reads its PLAN from the
// sprite's own geometry — the artwork stays the dimension sheet — and adds the one thing the sprite
// never defined: a height profile. That profile is the design surface of this file, kept below as
// station tables in metres, iterated against scripts/car-preview-3d.ts turntables.
//
// Everything is in SPRITE UNITS in the sprite's own frame (x across, z along, nose at low z), with
// the origin moved to the sprite's pivot so a mesh rotates exactly where the 2D sprite rotates.
// Heights convert through UNITS_PER_M and the vertical exaggeration below, so a number here reads
// as the metres it is.

import * as THREE from 'three'
import { shade } from '@/lib/color'
import { SPRITE, UNITS_PER_M } from '@/lib/ui/car-sprite'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GeometrySink, v3, type V3 } from './solids3d'

/** Vertical exaggeration for the whole car, wheels excepted: judged too low against its own tyres
 *  at true height, the same diorama-bold call every structure height already makes. */
export const CAR_HEIGHT_SCALE = 1.75

const M = (metres: number) => metres * UNITS_PER_M
const H = (metres: number) => M(metres * CAR_HEIGHT_SCALE)

/** LOD. The same car is drawn onboard, where it fills the screen, and from a whole-track zoom where
 *  it is four pixels long; one build cannot serve both. A tier is picked by the car's LENGTH IN
 *  PIXELS on screen, which is the only measure that stays honest when the camera changes distance
 *  AND field of view, as a race-day zoom does.
 *
 *  `loft` scales every catmull subdivision and every radial segment count, which is where the
 *  triangles live. The flags drop whole assemblies once they stop being legible: below a few pixels
 *  a driver is one shaded pixel and a spoke is none. */
export interface CarDetail {
  /** Shortest on-screen car length, in pixels, this tier is good for. */
  minPx: number
  loft: number
  /** Driver, steering wheel, harness, helmet and mirrors. */
  cockpit: boolean
  /** Suspension wishbone blades. */
  linkage: boolean
  /** Rim spokes, wheel bolts, brake discs and ducts. */
  wheelParts: boolean
  /** Wheels keep their own pivots and can steer and roll. Off, they bake into the shell and the
   *  car becomes a single rigid body. */
  liveWheels: boolean
  /** Build the BLOCK car instead of the real one. Subdividing cannot take a 56,000-triangle sculpt
   *  anywhere near a whole-track budget, because section point counts and boxes do not scale with
   *  it: measured, the most aggressive subdivision setting still left 9,724 triangles. Past a
   *  certain smallness the answer is a different model, not a coarser one. */
  proxy: boolean
}

export const CAR_TIERS: readonly CarDetail[] = [
  { minPx: 400, loft: 1.0, cockpit: true, linkage: true, wheelParts: true, liveWheels: true, proxy: false },
  { minPx: 150, loft: 0.7, cockpit: true, linkage: true, wheelParts: true, liveWheels: true, proxy: false },
  { minPx: 60, loft: 0.45, cockpit: false, linkage: true, wheelParts: true, liveWheels: true, proxy: false },
  { minPx: 25, loft: 0.30, cockpit: false, linkage: false, wheelParts: false, liveWheels: true, proxy: false },
  { minPx: 0, loft: 0.18, cockpit: false, linkage: false, wheelParts: false, liveWheels: false, proxy: true },
]

/** The tier the current build runs at. Module state on purpose: threading a detail argument through
 *  forty geometry builders would bury the sculpting under plumbing, and a build is one synchronous
 *  call that sets this first and never yields. */
let detail: CarDetail = CAR_TIERS[0]

/** Catmull steps across a station gap at the current tier. Never below one: at zero a table stops
 *  being a curve and starts being a polygon with holes in it. */
const steps = (full: number) => Math.max(1, Math.round(full * detail.loft))

/** Radial segments for a lathed or cylindrical part. Three is the floor, since a cylinder with two
 *  sides is a pair of back-to-back quads and reads as a crack. */
const seg = (full: number) => Math.max(3, Math.round(full * detail.loft))

interface Station { z: number; half: number; top: number; bottom?: number; dip?: number }

/** The BODY loft: nose into chassis into coke bottle, half-widths traced off NOSE_D / CHASSIS_D.
 *  The nose carries its own UNDERSIDE ramp: a slim raised spar a quarter as thick as the top line
 *  implies, its base sweeping down to the floor only where the sidepods begin. */
const BODY: Station[] = [
  // The tip pinches in every axis so the nose ends in a rounded point, not a bulkhead. The nose
  // reaches thirty units further forward than the sprite drew it: the wheelbase grew through it,
  // and the whole front assembly (wing, wheels, suspension) went along. The belly stays HIGH the
  // whole way out, only dropping to floor height at the monocoque.
  // Reprofiled to the drawn line: a LOW nose rising gently and late, the chassis side curving DOWN
  // into cockpit height where the helmet sits (a saddle, not a held shoulder), and the flank
  // staying chassis-narrow longer so it tapers into the pods further back.
  // The cone runs FLAT at 0.30 from the chassis until it clears the front upper arm (z~50), then
  // slants down to the tip: three co-linear stations pin the flat, the knee sits at the arm.
  // The tip is a plain ROUNDED END: the section shrinks about a constant centreline at 0.1955,
  // keeping its own width-to-height ratio the whole way, so it closes the way the nose's own
  // ellipse would. Capping a narrow z-22 station and then flaring hard to half 9 at z-18 is what
  // made a snout: a thin muzzle poking out of a body that was still full width behind it.
  { z: -24, half: 0.9, top: 0.1985, bottom: 0.1925 },
  { z: -23.3, half: 2.9, top: 0.2013, bottom: 0.1897 },
  { z: -22, half: 5.0, top: 0.2058, bottom: 0.1852 },
  { z: -20, half: 7.3, top: 0.2105, bottom: 0.1805 },
  { z: -18, half: 9, top: 0.215, bottom: 0.176 },
  { z: -8, half: 12, top: 0.235, bottom: 0.172 },
  { z: 18, half: 14, top: 0.27, bottom: 0.168 },
  { z: 55, half: 15, top: 0.31, bottom: 0.16 },
  { z: 80, half: 16, top: 0.325, bottom: 0.15 },
  { z: 120, half: 19, top: 0.35, bottom: 0.135 },
  { z: 166, half: 25, top: 0.375, bottom: 0.12 },
  // The spar does NOT dive into the floor at the monocoque: it keeps its shallow rake all the way
  // back under the driver, a raised keel with the pods' undercut hanging outboard of it, and only
  // meets floor height at the seat. Dropping it at z188 as it used to put the car on its belly a
  // third of the way up the chassis.
  { z: 188, half: 26, top: 0.385, bottom: 0.114 },
  { z: 209, half: 26.5, top: 0.39, bottom: 0.107, dip: 0.015 },
  { z: 218, half: 27, top: 0.395, bottom: 0.103, dip: 0.095 },
  // The COCKPIT drop: the rear crest dives at 45 degrees in rendered space right at the cockpit,
  // finished before the sidepod's face, pinned by close stations so the catmull cannot soften it.
  { z: 230, half: 27.5, top: 0.40, bottom: 0.098, dip: 0.10 },
  { z: 235, half: 27.6, top: 0.40, dip: 0.10 },
  { z: 241, half: 27.8, top: 0.425, dip: 0.125 },
  { z: 246, half: 28, top: 0.452, dip: 0.152 },
  // Behind the cockpit the body SCULPTS AWAY under the spine: a slimming keel, not a flat slab,
  // so the airbox tube and the pods carry the rear bodywork's form.
  // The SHOULDER LINE re-profiled: the steep rise into the cockpit rim is untouched, but past the
  // crest it FALLS AWAY at once and keeps falling. No second crest behind the driver, no swell
  // over the coke bottle, so the deck reads as a taper rather than a bulge. Each cockpit dip drops
  // with its own crest, which keeps the aperture exactly as deep as it was.
  { z: 264, half: 28, top: 0.443 },
  { z: 300, half: 25, top: 0.412 },
  { z: 342, half: 21, top: 0.372 },
  // The tail's UNDERSIDE lifts with the diffuser's ramp rather than running flat at floor height:
  // left low it hung below the ceiling as a red keel jammed through the middle two channels.
  { z: 380, half: 17, top: 0.335, bottom: 0.065 },
  { z: 448, half: 13, top: 0.26, bottom: 0.135 },
]
const BODY_BOTTOM = 0.06

/** The sidepods as their OWN volumes, hung either side of a monocoque that stays narrow: their
 *  front faces are where the mouths open, and the undercut between pod and floor stays air. */
interface PodStation { z: number; inner: number; outer: number; top: number; bottom: number; chan: number }
const POD: PodStation[] = [
  // The intake's top lip IS the pod's summit AND its forward-most point: the full-height face
  // leads, and the belly RECEDES under it, sweeping back and down to the floor. The undercut is
  // carried by the bottom column: high at the front face, floor-level by the pod's shoulder.
  // Inner edges track the slimming keel so pod and body stay one surface with no slot between.
  // Slimmed toward the reference (iteration F): outer flanks in ~11%, more tyre in the open.
  // The front face is BLUNT: near-full width at the cap so the intake has a whole face to span,
  // the shoulder flare almost gone.
  // `chan` scoops the UNDERSIDE: a curved channel above the floor on the inner side, deepest
  // mid-pod, faded to nothing at the face (the intake needs the whole face) and at the tail.
  // Drawn to the green: the FRONT FACE is the intake plus a thin lip and nothing more (its sill at
  // 0.245 against the mouth's 0.25), the belly one boat-hull sweep that falls away straight behind
  // the sill and rises hard into the tail, top and flank tapering in early.
  // The top line FALLS the whole way from the inlet's shoulder back to the coke bottle. It used to
  // hold 0.40 dead flat from z214 to z296, which is a shoebox lid: no shape at all over half the
  // pod's length, and nothing for the light to do across it.
  // The UNDERCUT is INBOARD, not underneath. The pod's outer edge stays down near the floor where
  // it belongs; what lifts is the inboard half of the underside, carried by `chan`, so the tunnel
  // runs between the pod's belly and the floor's edge with the body's flank as its inner wall.
  // Raising `bottom` instead floats the whole pod and leaves a void under it with nothing in it.
  // The scoop is deep now (0.19 against 0.10) and it runs the pod's whole length rather than being
  // spent by z244, which was the real fault.
  // The COKE BOTTLE starts at the pod's widest station and never stops. `outer` used to hold 59-62
  // from z226 to z296 and then collapse 59 to 19 in the last eighty units, so the plan was a brick
  // followed by a cliff. It now peaks at z244 and squeezes from there, ending near the rear axle
  // thin enough to be swallowed by the engine cover rather than stopping as a stub in open air.
  { z: 209, inner: 26, outer: 56, top: 0.392, bottom: 0.245, chan: 0 },
  { z: 214, inner: 25.5, outer: 58, top: 0.397, bottom: 0.175, chan: 0.05 },
  { z: 220, inner: 25, outer: 60, top: 0.398, bottom: 0.135, chan: 0.10 },
  { z: 226, inner: 24.5, outer: 61.5, top: 0.395, bottom: 0.112, chan: 0.14 },
  { z: 244, inner: 24, outer: 62, top: 0.384, bottom: 0.092, chan: 0.18 },
  { z: 268, inner: 22.8, outer: 58, top: 0.369, bottom: 0.087, chan: 0.185 },
  { z: 296, inner: 21, outer: 50, top: 0.352, bottom: 0.082, chan: 0.19 },
  { z: 326, inner: 19, outer: 40, top: 0.328, bottom: 0.098, chan: 0.16 },
  { z: 350, inner: 17, outer: 30, top: 0.305, bottom: 0.135, chan: 0.10 },
  { z: 366, inner: 15, outer: 23, top: 0.288, bottom: 0.175, chan: 0.04 },
  { z: 384, inner: 13, outer: 17, top: 0.272, bottom: 0.205, chan: 0 },
]

/** The pod's TOP SURFACE height at a point on it. Anything sitting on the pod reads this rather
 *  than a fixed number: the top line falls the pod's whole length AND falls again outboard of the
 *  crown, so one height for three fins leaves the outer two hanging in the air. */
function podTopAt(xAbs: number, z: number): number {
  let i = 0
  while (i + 2 < POD.length && POD[i + 1].z < z) i++
  const a = POD[i]
  const b = POD[i + 1]
  const t = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)))
  const mix = (u: number, v: number) => u + (v - u) * t
  const inner = mix(a.inner, b.inner)
  const outer = mix(a.outer, b.outer)
  const top = mix(a.top, b.top)
  const bottom = mix(a.bottom, b.bottom)
  const at = (f: number) => inner + (outer - inner) * f
  const xCrown = at(0.55)
  if (xAbs <= xCrown) return top
  const shoulder = bottom + (top - bottom) * 0.8
  return top + (shoulder - top) * Math.min(1, (xAbs - xCrown) / (at(0.95) - xCrown))
}

/** Rounded-triangle rim, apex up: (x in ninths of the half-width, height fraction). ONE shape for
 *  the airbox mouth and the spine it opens in: the hole and the body agree by construction. */
const TRI_RIM: Array<[number, number]> = [
  [0, 0.97], [3.5, 0.9], [6.5, 0.74], [8.2, 0.5], [9, 0.24], [7.6, 0.06], [4, 0.01],
  [0, 0], [-4, 0.01], [-7.6, 0.06], [-9, 0.24], [-8.2, 0.5], [-6.5, 0.74], [-3.5, 0.9],
]

/** The WHOLE spine as one seamless rounded-triangular loft: it starts as the snorkel sitting RIGHT
 *  above the driver's head, nothing taller, and tapers away to the tail. No fin behind it. */
interface SpineStation { z: number; half: number; yBase: number; yApex: number }
const SPINE: SpineStation[] = [
  // The belly OVERHANGS only across the open cockpit; from the headrest back it sinks BELOW the
  // deck line, so tube and bodywork are one surface with no daylight between them.
  // Behind the snorkel the base line STEPS, it does not ramp: the front face drops square to a
  // headrest shelf that runs level over the driver's head, then a second square drop rejoins the
  // fall to the tail. The riser is pinned by a station a stride either side of it so the catmull
  // turns the corner instead of rounding it away. The whole tube sits LOWER than it did: the roof
  // came down to the drawn line, and the mouth with it.
  { z: 240, half: 9, yBase: 0.524, yApex: 0.625 },
  { z: 246.6, half: 10, yBase: 0.525, yApex: 0.62 },
  { z: 247.8, half: 10.3, yBase: 0.447, yApex: 0.619 },
  { z: 249, half: 10.5, yBase: 0.444, yApex: 0.618 },
  { z: 272, half: 12, yBase: 0.432, yApex: 0.605 },
  { z: 300, half: 11, yBase: 0.384, yApex: 0.585 },
  { z: 350, half: 9, yBase: 0.29, yApex: 0.52 },
  { z: 400, half: 7, yBase: 0.23, yApex: 0.42 },
  { z: 446, half: 6, yBase: 0.19, yApex: 0.33 },
]

function spineGeometry(): THREE.BufferGeometry {
  const s = new GeometrySink()
  // Catmull over every field, so the stations read as one sculpted body rather than joined tubes.
  const rim = smoothPairs(TRI_RIM)
  // Front cap OFF: the snorkel's face is the intake's own rolled rim, and the mouth behind it is a
  // real hole. A cap here would seal the airbox and leave the mouth as paint on a lid.
  skinRings(s, densifyBy(SPINE, steps(5)).map((st) => rim.map(([fx, fy]) =>
    v3((fx / 9) * st.half, H(st.yBase + (st.yApex - st.yBase) * fy), st.z - SPRITE.cy))), false)
  return s.build()
}

/** A wing element's AEROFOIL, one closed loop in (chord fraction, offset in chord fractions from
 *  the chord line): upper surface from the leading edge aft, then the lower surface forward again.
 *  Fat rounded nose, thin blunt trailing edge, cambered like an element that is actually working.
 *  A flat extruded plan is what made the old wing read as a toy: everything caught light as one
 *  hard stripe because there was no curvature anywhere to catch it. */
const FOIL: Array<[number, number]> = [
  [0, 0.015],
  [0.04, 0.062], [0.12, 0.092], [0.25, 0.108], [0.45, 0.106], [0.65, 0.090],
  [0.82, 0.066], [0.94, 0.044], [1, 0.030],
  [1, 0.022],
  [0.94, 0.022], [0.82, 0.018], [0.65, 0.008], [0.45, -0.008], [0.25, -0.022],
  [0.12, -0.028], [0.04, -0.018],
]

/** One element across the half-span. `y` is the leading edge in metres; `chord`, `z` and the foil
 *  itself are sprite units, so the section keeps its drawn proportions on screen rather than being
 *  stretched by the height exaggeration. `angle` is the chord line's rake in rendered space. */
interface WingStation { x: number; z: number; y: number; chord: number; angle: number }

/** The FRONT WING: three elements, every one running from the centre section out to the endplate,
 *  each shorter, higher and steeper than the one ahead of and below it, with a real slot of air
 *  between. Chord and angle both grow outboard, which is the twist a real wing carries and the
 *  thing that stops three stacked plates reading as three stacked plates. The lowest element holds
 *  the flat neutral section the rules mandate across the middle, and only starts working outboard
 *  of it. */
const FRONT_WING: WingStation[][] = [
  [
    { x: 0, z: -10, y: 0.040, chord: 28, angle: 0 },
    { x: 22, z: -10, y: 0.040, chord: 28, angle: 0 },
    { x: 36, z: -11, y: 0.039, chord: 30, angle: 0.05 },
    { x: 58, z: -13, y: 0.037, chord: 32, angle: 0.10 },
    { x: 80, z: -14, y: 0.036, chord: 33, angle: 0.14 },
    // Tips end INSIDE the plate, each one far enough out to stay buried after the curl has swung
    // that height of plate outboard. Stopping them all at the plate's nominal 94 opened a slot.
    { x: 95.5, z: -14, y: 0.035, chord: 34, angle: 0.15 },
  ],
  [
    { x: 24, z: 11, y: 0.079, chord: 18, angle: 0.26 },
    { x: 44, z: 11, y: 0.080, chord: 19, angle: 0.28 },
    { x: 68, z: 10.5, y: 0.083, chord: 21, angle: 0.31 },
    { x: 95.5, z: 10, y: 0.086, chord: 22, angle: 0.33 },
  ],
  [
    { x: 28, z: 25, y: 0.126, chord: 13, angle: 0.42 },
    { x: 48, z: 25, y: 0.128, chord: 14, angle: 0.44 },
    { x: 70, z: 24.5, y: 0.133, chord: 15.5, angle: 0.46 },
    { x: 97, z: 24, y: 0.139, chord: 16.5, angle: 0.46 },
  ],
]

/** The REAR WING: a TWO-element beam wing under a mainplane and a flap, every one a real section
 *  with a slot of air above it instead of a box.
 *
 *  Two things a real one has that a straight sweep does not. The flap is pushed up and back until
 *  its trailing edge tucks into the plate's top-rear corner with only a few units of plate showing
 *  past it, which is where a rear wing actually ends. And the main pair are SPOONED: the middle of
 *  the span sits lower with a longer chord and arcs up toward each plate, so the wing reads as a
 *  curve seen from behind rather than as straight bars between two boards. */
const REAR_WING: WingStation[][] = [
  [
    { x: 0, z: 440, y: 0.344, chord: 13, angle: 0.180 },
    { x: 30, z: 440, y: 0.344, chord: 13, angle: 0.180 },
    { x: 56, z: 440.5, y: 0.346, chord: 12.6, angle: 0.185 },
    { x: 84, z: 441, y: 0.349, chord: 12, angle: 0.190 },
  ],
  [
    { x: 0, z: 452, y: 0.374, chord: 11, angle: 0.300 },
    { x: 30, z: 452, y: 0.374, chord: 11, angle: 0.300 },
    { x: 56, z: 452.5, y: 0.376, chord: 10.7, angle: 0.305 },
    { x: 84, z: 453, y: 0.379, chord: 10.4, angle: 0.310 },
  ],
  [
    // Lifted a hair off the swan neck: at the neck's front-top corner the mainplane's underside
    // used to sit below the mount, so the mount broke through the element's upper skin.
    { x: 0, z: 449, y: 0.447, chord: 26, angle: 0.340 },
    { x: 26, z: 449.3, y: 0.4485, chord: 25.6, angle: 0.343 },
    { x: 50, z: 450.2, y: 0.4530, chord: 25.0, angle: 0.350 },
    { x: 70, z: 451.3, y: 0.4585, chord: 24.4, angle: 0.356 },
    { x: 84.5, z: 452, y: 0.4635, chord: 24, angle: 0.360 },
  ],
  [
    { x: 0, z: 467, y: 0.516, chord: 21.5, angle: 0.600 },
    { x: 26, z: 467.3, y: 0.5175, chord: 21.2, angle: 0.603 },
    { x: 50, z: 468.2, y: 0.5220, chord: 20.8, angle: 0.610 },
    { x: 70, z: 469.3, y: 0.5270, chord: 20.3, angle: 0.616 },
    { x: 85, z: 470, y: 0.5320, chord: 20, angle: 0.620 },
  ],
]

/** One element lofted across the span. The inboard end is capped only when it stops short of the
 *  centreline: the neutral section's two halves butt at x0 and need no wall between them. */
function wingElementGeometry(stations: WingStation[], sign: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const rings = densifyBy(stations, steps(4)).map((st) => {
    const ca = Math.cos(st.angle)
    const sa = Math.sin(st.angle)
    return FOIL.map(([u, n]) => v3(
      sign * st.x,
      H(st.y) + st.chord * (u * sa + n * ca),
      st.z + st.chord * (u * ca - n * sa) - SPRITE.cy,
    ))
  })
  skinRings(s, rings, stations[0].x > 0.5)
  return s.build()
}

/** The FLOOR in plan: it narrows toward its leading edge and again into the diffuser's throat,
 *  rather than being a rectangular slab with a blunt end under the nose. */
const FLOOR_PLAN = [
  { z: 190, half: 40, tun: 0 },
  { z: 206, half: 52, tun: 0.35 },
  { z: 230, half: 58, tun: 1 },
  { z: 300, half: 60, tun: 1 },
  { z: 360, half: 58, tun: 1 },
  { z: 402, half: 52, tun: 0.3 },
]
const FLOOR_TOP = 0.05
const FLOOR_BOT = 0.03
/** The PLANK: the wooden skid block down the centreline, the strip the underside is measured by.
 *  It also sets where the tunnels have to stop, since they run either side of it. */
const PLANK = { half: 15, z0: 202, z1: 396, bottom: 0.0205 }

function floorGeometry(): THREE.BufferGeometry {
  const s = new GeometrySink()
  skinRings(s, densifyBy(FLOOR_PLAN, steps(4)).map((st) => {
    const z = st.z - SPRITE.cy
    // The underside is not a flat plate: a VENTURI TUNNEL is recessed either side of the plank's
    // land, so from below the floor reads as two channels rather than one black sheet.
    const d = 0.011 * st.tun
    const xo = Math.min(st.half - 6, 50)
    const xi = PLANK.half + 2
    const lo = (x: number, y: number) => v3(x, H(y), z)
    return [
      lo(-st.half, FLOOR_BOT), lo(-xo - 2, FLOOR_BOT), lo(-xo, FLOOR_BOT + d),
      lo(-xi - 1, FLOOR_BOT + d), lo(-xi + 1, FLOOR_BOT), lo(xi - 1, FLOOR_BOT),
      lo(xi + 1, FLOOR_BOT + d), lo(xo, FLOOR_BOT + d), lo(xo + 2, FLOOR_BOT), lo(st.half, FLOOR_BOT),
      lo(st.half, FLOOR_TOP), lo(-st.half, FLOOR_TOP),
    ]
  }))
  return s.build()
}

/** FLOOR FENCES: the curved blades standing on the floor's leading edge that turn the air coming
 *  under the nose out into the space beneath the sidepod, which is otherwise the emptiest volume
 *  on the car. Four a side, tallest at the front and dying away rearward, each bowing outboard
 *  along its length. `bow` is how far outboard the blade has swung by its trailing edge. */
const FLOOR_FENCES = [
  { x: 30, bow: 3.6, z0: 198, z1: 238, top: 0.094, thick: 0.9 },
  { x: 38, bow: 3.0, z0: 196, z1: 234, top: 0.098, thick: 0.9 },
  // Starts further back than its neighbours: the floor is only 40 half-wide at its leading edge,
  // so a blade this far outboard has nothing under it until z199. A fourth at |x|54 was dropped
  // for the same reason, having been drawn for the old 60-wide rectangular floor.
  { x: 46, bow: 2.2, z0: 200, z1: 230, top: 0.102, thick: 1.0 },
]

/** The floor's half-width at a station, linear between its own numbers. Anything riding the floor's
 *  edge reads it, so a change to the plan drags the edge parts along instead of stranding them. */
function floorHalf(z: number): number {
  const p = FLOOR_PLAN
  for (let i = 0; i + 1 < p.length; i++) {
    if (z <= p[i + 1].z) {
      return p[i].half + (p[i + 1].half - p[i].half) * ((z - p[i].z) / (p[i + 1].z - p[i].z))
    }
  }
  return p[p.length - 1].half
}

/** The FLOOR EDGE WING: the floor's outer lip turned up, running back to just ahead of the rear
 *  tyre. It seals the floor's edge and is the line that ties the flat floor to the diffuser's
 *  throat; without it the whole rear floor reads as a bare plate. */
function floorEdgeGeometry(sign: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const z0 = 288
  const z1 = 392
  const N = 16
  const rings: V3[][] = []
  for (let k = 0; k <= N; k++) {
    const t = k / N
    const z = z0 + (z1 - z0) * t
    const half = floorHalf(z)
    // Dies away at both ends so neither end is a cut-off wall standing on the floor.
    const lift = Math.min(1, Math.min(t, 1 - t) / 0.16)
    const rise = 0.042 * lift
    const at = (dx: number, y: number) => v3(sign * (half + dx), H(y), z - SPRITE.cy)
    rings.push([
      at(-1.5, 0.044), at(1.0, 0.044),
      at(1.0 + 1.4 * lift, 0.044 + rise), at(-1.5 + 2.1 * lift, 0.044 + rise),
    ])
  }
  skinRings(s, rings)
  return s.build()
}

function fenceGeometry(sign: number, f: (typeof FLOOR_FENCES)[number]): THREE.BufferGeometry {
  const s = new GeometrySink()
  const half = f.thick / 2
  const N = 12
  const rings: V3[][] = []
  for (let k = 0; k <= N; k++) {
    const t = k / N
    const z = f.z0 + (f.z1 - f.z0) * t - SPRITE.cy
    const x = sign * (f.x + f.bow * t * t)
    // Full height almost at once, then a long fall away: a fence works hardest where the flow
    // first meets it. Rooted below the floor's top so no blade can be seen to stand on it.
    const lift = Math.pow(1 - t, 0.75) * Math.min(1, 0.15 + t / 0.1)
    const yLo = H(FLOOR_TOP - 0.008)
    const yHi = H(FLOOR_TOP + (f.top - FLOOR_TOP) * lift)
    rings.push([
      v3(x - half, yLo, z), v3(x + half, yLo, z), v3(x + half, yHi, z), v3(x - half, yHi, z),
    ])
  }
  skinRings(s, rings)
  return s.build()
}

/** The DIFFUSER as an EXPANSION rather than a block: a ceiling that starts at floor height under
 *  the gearbox and climbs away to the tail, scalloped across the width into channels so that the
 *  strakes dividing them are the surface's own cusps, cutting down to the floor between arches,
 *  instead of plates stuck onto a slab. The exit is left open, so from behind you look up into the
 *  channels the way you do on a real car. */
const DIFFUSER = {
  half: 48,
  floor: 0.03,
  /** Roof TERRACES, centre outward: (the |x| each runs out to, its share of the central crown).
   *  A real diffuser's roof is stepped, tallest under the gearbox, not one continuous curve. ONE
   *  step, not two: only the central pair of channels is raised, and every channel outboard of it
   *  shares a single lower roof. */
  terraces: [[16, 1], [48, 0.55]] as Array<[number, number]>,
  /** STRAKES: straight vertical fences, one per |x| here, running the length of the expansion. */
  strakes: [8, 25, 41],
  strakeZ: 442,
  strakeThick: 1.8,
}
const DIFFUSER_ROOF = [
  // The throat is at the REAR AXLE (z398), where the floor hands over, and the ramp holds almost
  // flat under the bodywork before kicking up hard over its last twenty units. Exit at z464 puts
  // it under the beam wing's trailing edge and a clear stride ahead of the flap's, instead of
  // ending level with the wing the way a ramp parked behind the tyres did.
  { z: 398, crown: 0.048 },
  { z: 428, crown: 0.066 },
  { z: 444, crown: 0.110 },
  { z: 456, crown: 0.180 },
  { z: 464, crown: 0.235 },
]

/** The central crown at a station, linear between the roof's own numbers. The strakes read it to
 *  find where their top edge has to land, so a fence can never stand proud of its own ceiling. */
function diffuserCrown(z: number): number {
  const r = DIFFUSER_ROOF
  for (let i = 0; i + 1 < r.length; i++) {
    if (z <= r[i + 1].z) {
      return r[i].crown + (r[i + 1].crown - r[i].crown) * ((z - r[i].z) / (r[i + 1].z - r[i].z))
    }
  }
  return r[r.length - 1].crown
}

function diffuserGeometry(): THREE.BufferGeometry {
  const s = new GeometrySink()
  const { half, floor, terraces } = DIFFUSER
  // An OPEN strip, not a closed ring: up one outer wall, across the terraced ceiling, down the
  // other. A diffuser has no bottom. Closing the ring laid a slab across the underside at floor
  // height, and that slab was coplanar with the floor plate's own underside AND with the bottom
  // edge of every strake standing on it, which is three surfaces sharing one plane.
  const rows = densifyBy(DIFFUSER_ROOF, steps(4)).map((st) => {
    const z = st.z - SPRITE.cy
    const y = (frac: number) => H(floor + (st.crown - floor) * frac)
    // Each terrace contributes its tread and the riser that lifts onto the next one inboard.
    const left: Array<[number, number]> = []
    for (let i = terraces.length - 1; i >= 0; i--) {
      const [edge, frac] = terraces[i]
      left.push([-edge, frac], [i === 0 ? 0 : -terraces[i - 1][0], frac])
    }
    const right = left.map(([x, frac]) => [-x, frac] as [number, number]).reverse()
    return [
      v3(-half, H(floor), z),
      ...left.map(([x, frac]) => v3(x, y(frac), z)),
      ...right.slice(1).map(([x, frac]) => v3(x, y(frac), z)),
      v3(half, H(floor), z),
    ]
  })
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k + 1 < rows[i].length; k++) {
      s.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k])
    }
  }
  return s.build()
}

/** The strakes, all six in one sink: straight fences from the floor up into the roof they stand
 *  under, each stopping a hair inside the ceiling so it cannot poke through. */
function diffuserStrakeGeometry(): THREE.BufferGeometry {
  const s = new GeometrySink()
  const { floor, terraces, strakes, strakeZ, strakeThick } = DIFFUSER
  const zEnd = DIFFUSER_ROOF[DIFFUSER_ROOF.length - 1].z
  // No fence at DIFFUSER.half: the shell's own ring already runs a wall from the floor up to the
  // outer terrace there, so one added on top of it is a duplicate surface and fights with it.
  for (const x of strakes) {
    const frac = (terraces.find(([edge]) => x <= edge) ?? terraces[terraces.length - 1])[1]
    const roof = (z: number) => floor + (diffuserCrown(z) - floor) * frac + 0.008
    for (const sign of [-1, 1]) {
      addFin(s, [[strakeZ, floor], [zEnd, floor], [zEnd, roof(zEnd)], [strakeZ, roof(strakeZ)]],
        sign * x, strakeThick)
    }
  }
  return s.build()
}

/** A GURNEY on an element's trailing edge: the square lip a real wing carries there, standing up
 *  off the section's own normal so it follows every bit of the span's twist and spoon. Four points
 *  a ring, which is all a tab is. */
function gurneyGeometry(stations: WingStation[], sign: number, height: number, thick = 0.9): THREE.BufferGeometry {
  const s = new GeometrySink()
  skinRings(s, densifyBy(stations, steps(4)).map((st) => {
    const ca = Math.cos(st.angle)
    const sa = Math.sin(st.angle)
    // The trailing edge itself: the foil's last chord fraction, on its mean line.
    const y0 = H(st.y) + st.chord * (sa + 0.026 * ca)
    const z0 = st.z + st.chord * (ca - 0.026 * sa) - SPRITE.cy
    const at = (along: number, up: number) =>
      v3(sign * st.x, y0 + along * sa + up * ca, z0 + along * ca - up * sa)
    return [at(-thick / 2, 0), at(thick / 2, 0), at(thick / 2, height), at(-thick / 2, height)]
  }))
  return s.build()
}

/** The front ENDPLATE as the shaped panel it is rather than a rectangle: a leading edge raked back
 *  as it rises, an outwash curl bending the trailing edge outboard and bending it harder the
 *  higher it goes, and a footplate flaring outboard along the ground. Built as stacked plan
 *  ribbons, so every one of those is a real surface and not a painted line. */
const ENDPLATE_LEVELS = [
  { y: 0.028, zFront: -18, curl: 1.0, out: 11 },
  { y: 0.044, zFront: -17, curl: 1.4, out: 2 },
  { y: 0.080, zFront: -13, curl: 2.2, out: 2 },
  { y: 0.125, zFront: -8, curl: 3.2, out: 2 },
  { y: 0.168, zFront: -3, curl: 4.2, out: 2 },
  { y: 0.198, zFront: 2, curl: 5.0, out: 2 },
]

function frontEndplateGeometry(sign: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const span = 12
  const zRear = 42
  const rows = ENDPLATE_LEVELS.map((lv) => {
    const outer: V3[] = []
    const inner: V3[] = []
    for (let k = 0; k <= span; k++) {
      const t = k / span
      const z = lv.zFront + (zRear - lv.zFront) * t - SPRITE.cy
      // The curl only starts biting past the plate's midpoint, then eases in rather than kinking.
      const b = Math.min(1, Math.max(0, (t - 0.35) / 0.65))
      const x = 94 + lv.curl * b * b * (3 - 2 * b)
      outer.push(v3(sign * (x + lv.out), H(lv.y), z))
      inner.push(v3(sign * (x - 2), H(lv.y), z))
    }
    return { outer, inner }
  })
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]
    const b = rows[i + 1]
    for (let k = 0; k < span; k++) {
      s.quad(a.outer[k], a.outer[k + 1], b.outer[k + 1], b.outer[k])
      s.quad(a.inner[k], a.inner[k + 1], b.inner[k + 1], b.inner[k])
    }
    s.quad(a.outer[0], a.inner[0], b.inner[0], b.outer[0])
    s.quad(a.outer[span], a.inner[span], b.inner[span], b.outer[span])
  }
  for (const row of [rows[0], rows[rows.length - 1]]) {
    for (let k = 0; k < span; k++) {
      s.quad(row.outer[k], row.outer[k + 1], row.inner[k + 1], row.inner[k])
    }
  }
  return s.build()
}

/** Cross-section profile, one side, bottom to crown: (fraction of half-width, fraction of height).
 *  The crown is FLAT: rounding lives only in the shoulder, dense enough that its roll reads as one
 *  curve rather than a count of facets. */
const PROFILE: Array<[number, number]> = [
  [1, 0], [1, 0.5], [0.995, 0.72], [0.97, 0.87], [0.92, 0.955], [0.83, 0.995], [0.72, 1],
]

/** Catmull-Rom subdivisions per station gap: what turns the tables into curves. */
const LOFT_SUBDIV = 6

/** The PROFILE's half-width fraction at a height fraction: how wide the body is that far up its
 *  own section. The crown is a third narrower than the waist, which is exactly what catches out
 *  anything mounted high into it. */
function profileWidthAt(f: number): number {
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const [w0, f0] = PROFILE[i]
    const [w1, f1] = PROFILE[i + 1]
    if (f <= f1) return w0 + (w1 - w0) * ((Math.max(f, f0) - f0) / (f1 - f0 || 1))
  }
  return PROFILE[PROFILE.length - 1][0]
}

let bodyDense: Required<Station>[] | null = null

/** The body's lofted stations, resolved and densified once. */
function bodyStations(): Required<Station>[] {
  bodyDense ??= densify(BODY.map((st) => ({ ...st, bottom: st.bottom ?? BODY_BOTTOM, dip: st.dip ?? 0 })))
  return bodyDense
}

/** The body's own section at a station, read off the lofted tables rather than guessed, and
 *  INTERPOLATED between them. Snapping to the nearest station makes this a step function: anything
 *  that tracks the body along z then advances in ~4 unit jumps, which is what scalloped the pod's
 *  crest into a sawtooth down the merge line. */
function bodySection(zSprite: number): Required<Station> {
  const rows = bodyStations()
  let i = 0
  while (i + 2 < rows.length && rows[i + 1].z < zSprite) i++
  const a = rows[i]
  const b = rows[i + 1]
  const t = Math.min(1, Math.max(0, (zSprite - a.z) / (b.z - a.z || 1)))
  const mix = (u: number, v: number) => u + (v - u) * t
  return {
    z: zSprite,
    half: mix(a.half, b.half),
    top: mix(a.top, b.top),
    bottom: mix(a.bottom, b.bottom),
    dip: mix(a.dip, b.dip),
  }
}

/** The channel's cross-section at a station: the rolled lip, the wall down and the floor edge, in
 *  the same four control points `section` builds the aperture from. One source for the shape, so
 *  the tub liner cannot drift off the opening it is supposed to line. */
function channelPoints(st: Required<Station>, inset: number): V3[] {
  const z = st.z - SPRITE.cy
  const dw = Math.min(12.5, st.half * 0.55)
  const top = H(st.top)
  const dip = H(st.dip)
  const side = (s: number) => [
    v3(s * (dw + 1.2), top - inset, z),
    v3(s * (dw - 0.4 - inset), top - dip * 0.25 - inset, z),
    v3(s * (dw - 1.6 - inset), top - dip * 0.7 - inset, z),
    v3(s * (dw - 2.4 - inset), top - dip + inset * 0.5, z),
  ]
  return [...side(-1), ...side(1).reverse()]
}

/** The tub LINER: the cockpit's inner walls in carbon, laid a hair inside the body's own channel.
 *  Without it the aperture is a RED bathtub moulded into the deck, because the walls you look down
 *  are the body's own painted surface. */
function cockpitLinerGeometry(): THREE.BufferGeometry {
  const s = new GeometrySink()
  const rows = bodyStations().filter((st) => st.dip > 0.045).map((st) => channelPoints(st, 0.35))
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k + 1 < rows[i].length; k++) {
      s.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k])
    }
  }
  return s.build()
}

/** A pickup point INSIDE the bodywork. `f` places it up the local section and the half-width comes
 *  from that section's own profile, so a member can never end outside the skin however the body's
 *  tables move. Absolute heights cannot promise that: the tail is half the height of the cockpit,
 *  and one number for both leaves rod ends hanging in the open at whichever end is smaller. */
function bodyMount(zSprite: number, f: number, inset: number, sign: number): V3 {
  const sec = bodySection(zSprite)
  const y = sec.bottom + (sec.top - sec.bottom) * f
  return v3(sign * Math.max(2, sec.half * profileWidthAt(f) - inset), H(y), zSprite - SPRITE.cy)
}

/** Closed catmull through (x, y) pairs: the ring densifier every curved rim shares. */
function smoothPairs(pairs: Array<[number, number]>, per = steps(2)): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const n = pairs.length
  for (let i = 0; i < n; i++) {
    const p0 = pairs[(i + n - 1) % n]
    const p1 = pairs[i]
    const p2 = pairs[(i + 1) % n]
    const p3 = pairs[(i + 2) % n]
    for (let k = 0; k < per; k++) {
      const t = k / per
      out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)])
    }
  }
  return out
}

const CARBON = '#0B0D10'
const STRUCTURE = '#2E3138'
const TYRE = '#16181D'
const HUB = '#2E3138'
const FLOOR = '#14171E'
const TERTIARY = '#969CA6'
/** The plank is WOOD, and it is the only part of the car that is. */
const PLANK_WOOD = '#9A7B4F'
/** The rain light's lens: a fixed red, never the livery, because it has to read as a lamp on a car
 *  of any colour. */
const RAIN_LENS = '#E4161F'

/** Wheel geometry off the artwork: the drawn tyre footprints ARE the diameters and widths.
 *  Exported for the pit crew's tyre props, which must be the same tyre or the invisible swap at the
 *  hub stops being invisible (#3d-port). */
export const WHEELS = [
  // Front axle at z106: halfway between the floor's leading edge (190) and the wing's trailing
  // edge (20), where the drawn car put it. Radii at 0.81 of the drawn tyre (0.9 twice), widths at
  // 0.9; pivots sit at radius height so every tyre still touches. Full drawn size was tried
  // against the reference and read too big on this body.
  { tag: 'fl', x: -90, z: 106, r: 35.6, w: 43.2 },
  { tag: 'fr', x: 90, z: 106, r: 35.6, w: 43.2 },
  { tag: 'rl', x: -90, z: 398, r: 38.9, w: 46.8 },
  { tag: 'rr', x: 90, z: 398, r: 38.9, w: 46.8 },
] as const

/** Sidewall band colours, Pirelli's own set. The game passes a compound and the tyres wear it. */
export const TYRE_BANDS = {
  soft: '#E4161F',
  medium: '#F3D02F',
  hard: '#EDEDED',
  intermediate: '#3FBF43',
  wet: '#2060D0',
} as const
export type TyreCompound = keyof typeof TYRE_BANDS

/** The car's painted surfaces, five slots, each independently colourable. Everything NOT here is
 *  either rubber or genuinely carbon: no texture is used for the carbon, because nothing else in
 *  this renderer is textured, the lofts carry no UVs to put a weave on, and at race zoom a weave
 *  is sub-pixel. What made it read as mixed black and grey was picking the dark values ad hoc,
 *  which the three CARBON_* constants now settle by job. */
export interface CarPaint {
  /** Monocoque, nose, sidepods, wing pylons. */
  body: string
  /** Engine cover and airbox spine, the rear flap, the shoulder fins. */
  cover: string
  /** Front wing's neutral plane and the beam wing: the structural planes. */
  wing: string
  /** Front wing flaps and the rear mainplane: the working elements. */
  accent: string
  /** Endplates, mirrors, wheel centre caps. */
  trim: string
}

export type CarLivery = string | CarPaint

/** A single colour expands to the palette the car wore before liveries existed, so every old
 *  caller keeps its exact look. */
export const asPaint = (livery: CarLivery): CarPaint => typeof livery !== 'string' ? livery : {
  body: livery, cover: shade(livery, 0.62), wing: TERTIARY, accent: livery, trim: TERTIARY,
}

/** ONE DRAW CALL PER PAINT, not per part. The car is authored as ~270 separate solids because that
 *  is how you sculpt it, but it must not SHIP that way: measured on the built car, a grid of twenty
 *  is 5,400 draw calls against 1.1M triangles, and it is the draw calls that cost the frame. Baking
 *  every part that shares a paint into one buffer takes a car from 270 calls to ten and changes not
 *  one pixel.
 *
 *  Anything that has to move on its own is a BOUNDARY and is baked separately inside itself: the
 *  four steering pivots and the four rolling hubs within them. Shadow-casting is part of the key,
 *  so the handful of parts that deliberately cast nothing keep their own buffer instead of being
 *  merged into one that does. */
function collapseByPaint(node: THREE.Object3D, boundaries: ReadonlySet<THREE.Object3D>): void {
  interface Batch {
    geos: THREE.BufferGeometry[]
    sources: THREE.Mesh[]
    material: THREE.Material
    cast: boolean
  }
  const batches = new Map<string, Batch>()
  node.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(node.matrixWorld).invert()
  // Merging is all-or-nothing on attribute layout, and this car mixes two sources: the sinks build
  // non-indexed position+normal, three's own primitives arrive indexed and carrying UVs. Everything
  // is flattened to the sinks' layout first, or the merge quietly refuses and parts vanish.
  const bakeable = (source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry => {
    const geo = source.index ? source.toNonIndexed() : source.clone()
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name)
    }
    if (!geo.attributes.normal) geo.computeVertexNormals()
    geo.applyMatrix4(matrix)
    return geo
  }
  const walk = (o: THREE.Object3D) => {
    for (const child of o.children) {
      if (boundaries.has(child)) continue
      walk(child)
    }
    if (!(o instanceof THREE.Mesh)) return
    const material = o.material as THREE.MeshLambertMaterial
    const key = `${material.type}|${material.color.getHexString()}|${o.castShadow ? 1 : 0}`
    const batch = batches.get(key) ?? { geos: [], sources: [], material, cast: o.castShadow }
    batch.geos.push(bakeable(o.geometry as THREE.BufferGeometry, toLocal.clone().multiply(o.matrixWorld)))
    batch.sources.push(o)
    batches.set(key, batch)
  }
  walk(node)
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geos, false)
    for (const g of batch.geos) g.dispose()
    // A refused merge keeps its parts rather than losing them: a silently missing wing is a far
    // worse outcome than a car that is briefly a few draw calls fatter than it should be.
    if (!merged) continue
    for (const source of batch.sources) {
      source.removeFromParent()
      ;(source.geometry as THREE.BufferGeometry).dispose()
    }
    const m = new THREE.Mesh(merged, batch.material)
    m.castShadow = batch.cast
    m.receiveShadow = true
    node.add(m)
  }
}

export interface CarMesh {
  group: THREE.Group
  /** STEERING pivots, keyed the way the sprite tags them. The brake duct hangs off these, because
   *  a duct turns with the wheel but does not go round with it. */
  wheels: Record<'fl' | 'fr' | 'rl' | 'rr', THREE.Object3D>
  /** ROLLING part of each wheel, inside its steering pivot: tyre, rim and everything on them. */
  spin: Record<'fl' | 'fr' | 'rl' | 'rr', THREE.Object3D>
}

const catmull = (a: number, b: number, c: number, d: number, t: number): number => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
}

/** Catmull EVERY field of a station table: the densifier that turns any of the tables in this file
 *  into a curve. Endpoints repeat their neighbour, so a run starts and ends on its own station. */
function densifyBy<T extends Record<keyof T, number>>(rows: readonly T[], per: number): T[] {
  const n = rows.length
  const keys = Object.keys(rows[0]) as Array<keyof T>
  const out: T[] = []
  for (let i = 0; i + 1 < n; i++) {
    const p0 = rows[Math.max(0, i - 1)]
    const p1 = rows[i]
    const p2 = rows[i + 1]
    const p3 = rows[Math.min(n - 1, i + 2)]
    for (let k = 0; k < per; k++) {
      const t = k / per
      const row = {} as T
      for (const key of keys) {
        row[key] = catmull(p0[key], p1[key], p2[key], p3[key], t) as T[keyof T]
      }
      out.push(row)
    }
  }
  out.push(rows[n - 1])
  return out
}

/** Skin a run of equal-length rings into quads and cap the ends: the second half of every loft
 *  here, once its stations have become cross-sections. Caps fan from the ring's first point, which
 *  every rim in this file is star-shaped about. */
function skinRings(s: GeometrySink, rings: V3[][], capFirst = true, capLast = true): void {
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length
      s.quad(a[k], a[k2], b[k2], b[k])
    }
  }
  const cap = (ring: V3[], flip: boolean) => {
    for (let k = 1; k + 1 < ring.length; k++) {
      if (flip) s.tri(ring[0], ring[k + 1], ring[k])
      else s.tri(ring[0], ring[k], ring[k + 1])
    }
  }
  if (capFirst) cap(rings[0], false)
  if (capLast) cap(rings[rings.length - 1], true)
}

function densify(stations: Required<Station>[], per = steps(LOFT_SUBDIV)): Required<Station>[] {
  // Half-width and dip carry clamps the plain catmull cannot: an overshoot must not invert the
  // section or push the cockpit channel above its own crown.
  return densifyBy(stations, per).map((st) => ({
    ...st, half: Math.max(1, st.half), dip: Math.max(0, st.dip),
  }))
}

/** One station's full cross-section ring: left side bottom-to-crown, right side crown-to-bottom,
 *  so the wrap edge closes the underside. */
function section(s: Required<Station>): V3[] {
  const z = s.z - SPRITE.cy
  const top = H(s.top)
  const bottom = H(s.bottom)
  const y = (f: number) => bottom + (top - bottom) * f
  const left = PROFILE.map(([w, f]) => v3(-s.half * w, y(f), z))
  const right = [...PROFILE].reverse().map(([w, f]) => v3(s.half * w, y(f), z))
  // The crown carries the COCKPIT APERTURE as its own surface: a channel with rolled edges, so
  // the opening's lip is bodywork and nothing separate exists to float or read as a collar. At
  // dip zero every edge point collapses onto the crown line and the section is unchanged.
  const dw = Math.min(12.5, s.half * 0.55)
  const roll = (side: number): V3[] => [
    v3(side * (dw + 2.2), top, z),
    v3(side * (dw - 0.4), top - H(s.dip) * 0.25, z),
    v3(side * (dw - 1.6), top - H(s.dip) * 0.7, z),
    v3(side * (dw - 2.4), top - H(s.dip), z),
  ]
  return [...left, ...roll(-1), ...roll(1).reverse(), ...right]
}

/** One sidepod: an asymmetric loft from inner wall to outer flank, capped aft. The FRONT is a real
 *  socket: the loft's own first ring, collared backward into a recessed dark cap, so the intake is
 *  a modelled hole in the surface rather than paint laid over it. */
function podGeometry(sign: number): { body: THREE.BufferGeometry; mouth: THREE.BufferGeometry } {
  const s = new GeometrySink()
  const m = new GeometrySink()
  const ring = (p: PodStation): V3[] => {
    const z = p.z - SPRITE.cy
    const b = H(p.bottom)
    const t = H(p.top)
    const ch = H(p.chan)
    const at = (f: number) => p.inner + (p.outer - p.inner) * f
    // The pod's top RISES inboard to meet the engine cover just under its crown, and it meets it
    // where the body's own section says its flank is at that height. Run flat to the inner edge
    // instead and the two volumes simply cross, cutting a gutter the length of the car; running
    // up to the shoulder makes the junction a ridge and the pair read as one skin.
    // The crest must land a real distance INSIDE the body's skin. Parked a unit under the crown it
    // ran nearly parallel to the shoulder for the pod's whole length, and two surfaces that close
    // and that shallow z-fight: that is the zigzag along the merge line. Ahead of the cockpit the
    // pod is as tall as the chassis, so the crest is also capped BELOW the crown there rather than
    // being allowed to climb through it and poke out as a wedge beside the mirror.
    const sec = bodySection(p.z)
    const crestY = Math.min(Math.max(p.top + 0.006, sec.top - 0.030), sec.top - 0.014)
    const fc = Math.min(1, Math.max(0, (crestY - sec.bottom) / (sec.top - sec.bottom)))
    const xCrest = Math.max(4, sec.half * profileWidthAt(fc) - 2.8)
    const yCrest = H(crestY)
    const xCrown = at(0.55)
    const rise = (f: number, g: number) =>
      v3(sign * (xCrown + (xCrest - xCrown) * f), t + (yCrest - t) * g, z)
    // The UNDERSIDE scoops: a curved channel rising toward the keel so air has a path over the
    // floor, sampled in four points so it reads as a curve, never a rectangular notch. The flank
    // then curves INWARD and UPWARD into a rounded shoulder: no boxy corner anywhere.
    // The flank TUCKS. Its widest point sits at 44% of the section's height and the bottom edge is
    // drawn back inboard under it, so the wall leans out as it rises and the undercut is something
    // you can see from three-quarter. Run the outer edge straight from the floor to mid-height, as
    // it was, and the pod is slab-sided however deep the belly's scoop gets.
    return [
      v3(sign * p.inner, b + ch, z),
      v3(sign * at(0.20), b + ch * 0.45, z),
      v3(sign * at(0.45), b + ch * 0.16, z),
      v3(sign * at(0.68), b + ch * 0.04, z),
      v3(sign * at(0.82), b, z),
      v3(sign * at(1), b + (t - b) * 0.44, z),
      v3(sign * at(0.95), b + (t - b) * 0.80, z),
      rise(0, 0), rise(0.45, 0.22), rise(0.78, 0.62), rise(1, 1),
    ]
  }
  // Catmull between stations: the plan outline sweeps rather than cornering station to station.
  const dense = densifyBy(POD, steps(8)).map((st) => ({ ...st, chan: Math.max(0, st.chan) }))
  // The ring is smoothed through its control points: at seven flat facets the collar's sides could
  // be counted one shading break at a time.
  const smoothRing = (pts: V3[], per = 4): V3[] => {
    const out: V3[] = []
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n]
      const p1 = pts[i]
      const p2 = pts[(i + 1) % n]
      const p3 = pts[(i + 2) % n]
      for (let k = 0; k < per; k++) {
        const t = k / per
        out.push(v3(catmull(p0.x, p1.x, p2.x, p3.x, t), catmull(p0.y, p1.y, p2.y, p3.y, t), p1.z))
      }
    }
    return out
  }
  // The drawn shape: tall and near-vertical at the inboard edge, sweeping outboard as a teardrop
  // to a rounded tip on the flank side, centred on the face's height.
  const outline: V3[] = smoothRing(([
    [31, 0.262], [37, 0.25], [44, 0.262], [50, 0.285], [54.5, 0.318],
    [55, 0.34], [53, 0.362], [47, 0.372], [38, 0.375], [31.5, 0.372], [30.8, 0.318],
  ] as Array<[number, number]>).map(([x, y]) => v3(sign * x, H(y), 210 - SPRITE.cy)))
  const ocx = outline.reduce((acc, p) => acc + p.x, 0) / outline.length
  const ocy = outline.reduce((acc, p) => acc + p.y, 0) / outline.length
  // The FRONT RIM follows the intake: every ring here is the mouth scaled about its own centre, so
  // the lip stays concentric with the hole and nothing about the front is square.
  //
  // The rim STANDS PROUD and the mouth is RECESSED behind it. `rimFront` is the pod's forward-most
  // edge, `rimCrest` its widest a few units back, and the hole sits six units behind that, so the
  // face is a rolled lip with the intake down inside it rather than a flat washer with a hole
  // punched in the pod's leading face.
  const scaled = (k: number, zAt: number): V3[] => outline.map((p) =>
    v3(ocx + (p.x - ocx) * k, ocy + (p.y - ocy) * k, zAt - SPRITE.cy))
  const rimCrest = scaled(1.24, 206.5)
  const rimFront = scaled(1.10, 203.5)

  /** Arc-length resample of a closed planar ring. Kept only for the intake lip, whose control
   *  polygon is a different shape from the section's and so cannot be matched point for point. */
  const resampleRing = (pts: V3[], n: number): V3[] => {
    const cum = [0]
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i % pts.length]
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
    }
    const total = cum[pts.length]
    const out: V3[] = []
    let j = 0
    for (let i = 0; i < n; i++) {
      const target = (i / n) * total
      while (j < pts.length - 1 && cum[j + 1] < target) j++
      const a = pts[j]
      const b = pts[(j + 1) % pts.length]
      const seg = cum[j + 1] - cum[j] || 1
      const f = (target - cum[j]) / seg
      out.push(v3(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z))
    }
    return out
  }

  // Sections are sampled PER CONTROL SEGMENT, not by arc length. Arc length re-parameterises every
  // ring independently, so as the section's proportions change down the pod each corner slides to
  // a different vertex index and the quads shear: that is the jagged creasing across the top.
  // Sampling each segment the same way pins vertex k to the same feature on every ring, and the
  // catmull through the control points takes the facets out at the same time.
  const raw = [rimCrest, ...dense.filter((st) => st.z >= 212).map((st) => smoothRing(ring(st)))]
  // Rotate each ring so its start sits nearest the previous ring's: resampled rings begin at
  // different arc positions, and lofting them un-aligned shears the quads into jagged spikes.
  const rings: V3[][] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const prev = rings[i - 1]
    const cur = raw[i]
    let best = 0
    let bestD = Infinity
    for (let o = 0; o < cur.length; o++) {
      const d = Math.hypot(cur[o].x - prev[0].x, cur[o].y - prev[0].y)
      if (d < bestD) {
        bestD = d
        best = o
      }
    }
    rings.push(cur.map((_, k) => cur[(k + best) % cur.length]))
  }
  // BRIDGE the rim into the first section. The intake's oval and the pod's section are different
  // shapes with only a whole-ring rotation aligning them, so joining them in one step drags a few
  // vertices right across the profile and the quads between come out as long slivers standing off
  // the shoulder. Stepping across in four short hops keeps every quad small.
  rings.splice(1, 0, ...[0.3, 0.58, 0.82].map((t) => rings[0].map((p, k) => v3(
    p.x + (rings[1][k].x - p.x) * t,
    p.y + (rings[1][k].y - p.y) * t,
    p.z + (rings[1][k].z - p.z) * t,
  ))))
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length
      s.quad(a[k], a[k2], b[k2], b[k])
    }
  }
  // Aft cap stays a fan. The front is now THREE swept rings rather than a flat washer: crest back
  // to the pod, front out to the crest, and front down into the mouth. The intake stays a REAL
  // HOLE at the bottom of it.
  const aft = rings[rings.length - 1]
  for (let k = 1; k + 1 < aft.length; k++) s.tri(aft[0], aft[k + 1], aft[k])
  for (const [a, b] of [[rimFront, rimCrest], [rimFront, outline]] as const) {
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length
      s.quad(a[k], a[k2], b[k2], b[k])
    }
  }
  // The socket behind the hole: collar walls sweeping straight back into a recessed dark cap,
  // sharing the hole's exact edge so nothing can misalign.
  const inset = outline.map((p) => v3(ocx + (p.x - ocx) * 0.85, ocy + (p.y - ocy) * 0.85, p.z + 6))
  for (let k = 0; k < outline.length; k++) {
    const k2 = (k + 1) % outline.length
    m.quad(outline[k], outline[k2], inset[k2], inset[k])
  }
  for (let k = 1; k + 1 < inset.length; k++) m.tri(inset[0], inset[k], inset[k + 1])
  return { body: s.build(), mouth: m.build() }
}

function loftGeometry(stations: Station[], bottomM: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const resolved = stations.map((st) => ({ ...st, bottom: st.bottom ?? bottomM, dip: st.dip ?? 0 }))
  skinRings(s, densify(resolved).map((st) => section(st)))
  return s.build()
}

/** An axis-aligned box in sprite coordinates, y in metres through the height scale. */
function box(s: GeometrySink, x0: number, x1: number, y0M: number, y1M: number, z0: number, z1: number) {
  const cz = SPRITE.cy
  const y0 = H(y0M)
  const y1 = H(y1M)
  const c = (x: number, y: number, z: number) => v3(x - SPRITE.cx, y, z - cz)
  s.quad(c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1))
  s.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1))
  s.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0))
  s.quad(c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1))
  s.quad(c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0))
  s.quad(c(x1, y0, z0), c(x1, y0, z1), c(x1, y1, z1), c(x1, y1, z0))
}

/** A flat FIN: an outline in the z-y plane (z in sprite units, y in metres) given real thickness
 *  across x. Both wings hang off pylons that are this and nothing more. */
function addFin(s: GeometrySink, outline: Array<[number, number]>, xCentre: number, thick: number): void {
  const at = (i: number, dx: number) => v3(xCentre + dx, H(outline[i][1]), outline[i][0] - SPRITE.cy)
  for (const dx of [-thick / 2, thick / 2]) {
    for (let i = 1; i + 1 < outline.length; i++) s.tri(at(0, dx), at(i, dx), at(i + 1, dx))
  }
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length
    s.quad(at(i, -thick / 2), at(j, -thick / 2), at(j, thick / 2), at(i, thick / 2))
  }
}

function finGeometry(outline: Array<[number, number]>, xCentre: number, thick: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  addFin(s, outline, xCentre, thick)
  return s.build()
}

/** Surface finish. `flat` is the diorama's matte default; `metal` adds a specular highlight, which
 *  the existing rig gives for free off its directional sun. Deliberately NOT `MeshStandardMaterial`
 *  with metalness: a metal is pure reflection, so with no environment map in the rig it renders
 *  black. An env map is a rig-wide look decision, not a per-part one. */
export type Finish = 'flat' | 'metal'

function mesh(geo: THREE.BufferGeometry, colour: string, finish: Finish = 'flat'): THREE.Mesh {
  // DoubleSide: the sink's quads are wound by hand and a culled wing is a missing wing.
  const material = finish === 'metal'
    ? new THREE.MeshPhongMaterial({
      // A BROAD lobe, not a tight one: spoke faces are flat and small, and a hard highlight only
      // lands on the one spoke whose normal happens to bisect sun and eye. Wide catches several.
      color: colour, side: THREE.DoubleSide, shininess: 34, specular: new THREE.Color('#CBD4DE'),
    })
    : new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide })
  const m = new THREE.Mesh(geo, material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** A thin round member between two points: a mirror stalk. */
function strut(a: V3, b: V3, radius: number, colour: string): THREE.Mesh {
  const from = new THREE.Vector3(a.x, a.y, a.z)
  const to = new THREE.Vector3(b.x, b.y, b.z)
  const geo = new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), seg(6))
  const m = mesh(geo, colour)
  m.position.copy(from.clone().add(to).multiplyScalar(0.5))
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
  return m
}

/** TEARDROP section for a suspension member: (fraction of chord, fraction of half-thickness),
 *  symmetric, nose first. A wishbone is a faired aerofoil, not a bar: square-sectioned arms are
 *  the single loudest tell that a car was assembled out of boxes. */
const ARM_FOIL: Array<[number, number]> = [
  [0, 0],
  [0.04, 0.62], [0.12, 0.90], [0.26, 1], [0.46, 0.90], [0.66, 0.68], [0.85, 0.38], [1, 0.06],
  [1, -0.06], [0.85, -0.38], [0.66, -0.68], [0.46, -0.90], [0.26, -1], [0.12, -0.90], [0.04, -0.62],
]

/** Scale along a member's run: (fraction of the way out, scale on the section). The first three
 *  stations are the COLLAR, the raised fairing ring around the pickup where the arm enters the
 *  bodywork, and the last tapers the arm slightly toward the upright. */
const ARM_SWEEP: Array<[number, number]> = [[0, 1.75], [0.045, 1.66], [0.1, 1.02], [1, 0.86]]

/** A suspension member: the teardrop swept from a chassis pickup out to the upright, wearing its
 *  collar where it leaves the body. */
function armGeometry(a: V3, b: V3, chord: number, thick: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
  const len = dir.length() || 1
  dir.divideScalar(len)
  // Chord axis across the arm and horizontal, forced to point aft so the nose faces the airflow on
  // BOTH sides: taking the cross product as it comes flips the teardrop end-for-end across the car.
  const chordAxis = new THREE.Vector3(0, 1, 0).cross(dir)
  if (chordAxis.lengthSq() < 1e-6) chordAxis.set(0, 0, 1)
  chordAxis.normalize()
  if (chordAxis.z < 0) chordAxis.negate()
  const thickAxis = dir.clone().cross(chordAxis).normalize()
  skinRings(s, ARM_SWEEP.map(([t, scale]) => ARM_FOIL.map(([u, n]) => {
    const along = len * t
    const c = (u - 0.3) * chord * scale
    const h = n * (thick / 2) * scale
    return v3(
      a.x + dir.x * along + chordAxis.x * c + thickAxis.x * h,
      a.y + dir.y * along + chordAxis.y * c + thickAxis.y * h,
      a.z + dir.z * along + chordAxis.z * c + thickAxis.z * h,
    )
  })))
  return s.build()
}

/** The rear plate's drawn box. Grown to the drawn line: it still crests just over the top element
 *  rather than billboarding above the car, but it reaches further down toward the diffuser,
 *  further back past the flap and a good stride further forward alongside the tyre. */
const REAR_PLATE = { yTop: H(0.62), yBot: H(0.25), zFront: 408, zRear: 492, x: 83, thick: 4 }

/** OUTWASH: the plate bows outboard over its rear third, and bows harder the higher up it is, so
 *  the trailing edge throws air around the tyre instead of standing there as a flat billboard.
 *  Purely a plan change, so the drawn side profile is untouched. Kept small on purpose: the
 *  elements' tips are buried a fixed distance in, and a curl deep enough to outrun them would open
 *  a slot at every trailing edge. */
function rearPlateCurl(z: number, y: number, side: number): number {
  const t = Math.min(1, Math.max(0, (z - 452) / (REAR_PLATE.zRear - 452)))
  const h = Math.min(1, Math.max(0, (y - REAR_PLATE.yBot) / (REAR_PLATE.yTop - REAR_PLATE.yBot)))
  return side * (1.0 + 3.0 * h) * t * t * (3 - 2 * t)
}

/** A rear wing endplate, its lower-front corner cut in an arc round the rear tyre plus margin. */
function endplateGeometry(xCentre: number, thick: number): THREE.BufferGeometry {
  const cz = SPRITE.cy
  // The clearance arc is the tyre's own circle plus a hand's width, centred on the axle, so the
  // plate wraps it instead of standing off.
  const { yTop, yBot, zFront, zRear } = REAR_PLATE
  const tyre = { z: 398, y: 38.9, r: 44 }
  // Corners are RADIUSED, not mitred: a plate this size with square corners reads as a cut sheet.
  const rc = 9
  const corner = (cz2: number, cy: number, from: number, to: number) => {
    const out: Array<{ z: number; y: number }> = []
    for (let k = 0; k <= 5; k++) {
      const a = from + ((to - from) * k) / 5
      out.push({ z: cz2 + Math.cos(a) * rc, y: cy + Math.sin(a) * rc })
    }
    return out
  }
  const outline: Array<{ z: number; y: number }> = [
    { z: zFront + rc, y: yTop },
    ...corner(zRear - rc, yTop - rc, Math.PI / 2, 0),
    ...corner(zRear - rc, yBot + rc, 0, -Math.PI / 2),
  ]
  // Bottom edge runs forward only to the tyre's clearance arc, then the arc climbs to the front edge.
  const dzBottom = Math.sqrt(tyre.r * tyre.r - (yBot - tyre.y) ** 2)
  const aStart = Math.atan2(yBot - tyre.y, dzBottom)
  const aEnd = Math.atan2(Math.sqrt(tyre.r * tyre.r - (zFront - tyre.z) ** 2), zFront - tyre.z)
  outline.push({ z: tyre.z + dzBottom, y: yBot })
  for (let k = 1; k <= 14; k++) {
    const a = aStart + ((aEnd - aStart) * k) / 14
    outline.push({ z: tyre.z + Math.cos(a) * tyre.r, y: tyre.y + Math.sin(a) * tyre.r })
  }
  const side = Math.sign(xCentre)
  const s = new GeometrySink()
  const at = (p: { z: number; y: number }, dx: number) =>
    v3(xCentre + rearPlateCurl(p.z, p.y, side) + dx, p.y, p.z - cz)
  const tris = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p.z, p.y)), [])
  for (const dx of [-thick / 2, thick / 2]) {
    for (const [i, j, k] of tris) s.tri(at(outline[i], dx), at(outline[j], dx), at(outline[k], dx))
  }
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    s.quad(at(p, -thick / 2), at(q, -thick / 2), at(q, thick / 2), at(p, thick / 2))
  }
  return s.build()
}

interface HelmetRow { y: number; rF: number; rS: number; rB: number }

/** The shell's radius at an angle: front and back radii blended into the side one, which is what
 *  gives the head its flattened face and swollen rear. Theta 0 faces the nose (-z). The visor
 *  rides this same formula, so it can never sink into the shell or float off it. */
function helmetRadius(th: number, rF: number, rS: number, rB: number): number {
  const c = Math.cos(th)
  return rS + (rF - rS) * Math.pow(Math.max(0, c), 1.4) + (rB - rS) * Math.pow(Math.max(0, -c), 1.4)
}

/** A HELMET, not a primitive: an asymmetric loft with separate front, side and back radius
 *  columns per height, giving the chin bar, the flattened face, the swollen rear and the ducktail
 *  lip a real crash helmet carries. */
function buildHelmet(sec: string): THREE.Group {
  const g = new THREE.Group()
  // Front, side and back radius per height, bottom to crown, in sprite units.
  const P: HelmetRow[] = [
    { y: 0, rF: 5.0, rS: 5.4, rB: 5.8 },
    { y: 1.4, rF: 6.2, rS: 6.4, rB: 7.2 },
    { y: 3, rF: 7.3, rS: 6.8, rB: 7.6 },
    { y: 5, rF: 7.1, rS: 6.9, rB: 7.7 },
    { y: 7.5, rF: 6.6, rS: 6.9, rB: 7.7 },
    { y: 10, rF: 6.2, rS: 6.6, rB: 7.2 },
    { y: 12.3, rF: 5.2, rS: 5.5, rB: 5.9 },
    { y: 14.2, rF: 3.1, rS: 3.3, rB: 3.5 },
    { y: 15, rF: 0.01, rS: 0.01, rB: 0.01 },
  ]
  const SEG = 40
  const shell = new GeometrySink()
  const ringOf = ({ y, rF, rS, rB }: HelmetRow): V3[] => {
    const out: V3[] = []
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2
      out.push(v3(Math.sin(th) * helmetRadius(th, rF, rS, rB), y, -Math.cos(th) * helmetRadius(th, rF, rS, rB)))
    }
    return out
  }
  const rings = densifyBy(P, steps(3)).map(ringOf)
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < SEG; k++) {
      const k2 = (k + 1) % SEG
      shell.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k])
    }
  }
  const base = rings[0]
  for (let k = 1; k + 1 < base.length; k++) shell.tri(base[0], base[k + 1], base[k])
  g.add(mesh(shell.build(), sec))

  // The visor: a curved patch riding the face's own curvature, plus a slim brow trim above it.
  // The visor is a mini-loft over the shell's OWN radius formula, floated 0.3 proud: it follows
  // the face exactly at every angle and height, so it can neither sink nor vanish.
  // Each row carries its OWN half-sweep, so the aperture is a lens: widest across the eyes,
  // drawn in at the brow and again at the chin. Sweeping every row the same 0.85 made it a
  // square-cornered rectangle, which is what a visor decal looks like, not a visor.
  const visorSink = new GeometrySink()
  const vRows = densifyBy<HelmetRow & { sweep: number }>([
    { y: 4.4, rF: 7.2, rS: 6.95, rB: 7.7, sweep: 0.72 },
    { y: 6.4, rF: 6.85, rS: 6.9, rB: 7.7, sweep: 0.88 },
    { y: 8.6, rF: 6.45, rS: 6.75, rB: 7.5, sweep: 0.84 },
    { y: 10.4, rF: 6.1, rS: 6.5, rB: 7.05, sweep: 0.56 },
  ], 6)
  const vPt = (row: HelmetRow & { sweep: number }, th: number): V3 => {
    const r = helmetRadius(th, row.rF, row.rS, row.rB) + 0.3
    return v3(Math.sin(th) * r, row.y, -Math.cos(th) * r)
  }
  const VSEG = 30
  for (let i = 0; i + 1 < vRows.length; i++) {
    for (let k = 0; k < VSEG; k++) {
      const f0 = -1 + (2 * k) / VSEG
      const f1 = -1 + (2 * (k + 1)) / VSEG
      visorSink.quad(
        vPt(vRows[i], f0 * vRows[i].sweep), vPt(vRows[i], f1 * vRows[i].sweep),
        vPt(vRows[i + 1], f1 * vRows[i + 1].sweep), vPt(vRows[i + 1], f0 * vRows[i + 1].sweep),
      )
    }
  }
  g.add(mesh(visorSink.build(), CARBON))

  // Chin vent under the visor, two crown vents on top: small recessed darks.
  const chin = mesh(new THREE.BoxGeometry(3.6, 1.1, 0.8), CARBON)
  chin.position.set(0, 3.4, -7.0)
  g.add(chin)
  // The ducktail lip at the rear base.
  const lip = mesh(new THREE.BoxGeometry(7.6, 1.2, 1.8), sec)
  lip.position.set(0, 1.2, 7.6)
  lip.rotation.x = -0.3
  g.add(lip)
  // Aero trim tabs at the rear-top, tucked into the shell.
  for (const sign of [-1, 1]) {
    const tab = mesh(new THREE.BoxGeometry(2.0, 0.5, 1.8), CARBON)
    tab.position.set(sign * 2.8, 11.6, 4.9)
    tab.rotation.x = -0.5
    g.add(tab)
  }
  return g
}

/** A car at every tier at once, one of them visible. Built once per livery and CLONED per car on
 *  the grid: `Object3D.clone` shares geometry and material, so twenty cars in a livery cost one
 *  build and twenty transforms.
 *
 *  Switching is driven by the car's on-screen LENGTH IN PIXELS, which the caller measures, because
 *  only the caller knows the camera. Pose goes to every tier rather than the visible one, so a
 *  switch can never reveal a wheel that stopped turning three seconds ago. */
export interface CarLod {
  group: THREE.Group
  /** Index of the tier currently shown. */
  tier: number
  /** Steering lock in radians, per front wheel. */
  steer(fl: number, fr: number): void
  /** Rolling angle in radians, applied to all four. */
  roll(angle: number): void
  /** Choose the tier for a car this many pixels long on screen. Returns the tier now showing. */
  show(pxLength: number): number
}

export function buildCarLod(livery: CarLivery, compound: TyreCompound = 'medium'): CarLod {
  const group = new THREE.Group()
  const built = CAR_TIERS.map((_, t) => {
    const car = buildCarMesh(livery, compound, t)
    car.group.visible = false
    group.add(car.group)
    return car
  })
  built[0].group.visible = true
  const lod: CarLod = {
    group,
    tier: 0,
    steer(fl, fr) {
      for (const car of built) {
        car.wheels.fl.rotation.y = fl
        car.wheels.fr.rotation.y = fr
      }
    },
    roll(angle) {
      for (const car of built) for (const w of Object.values(car.spin)) w.rotation.x = angle
    },
    show(pxLength) {
      let next = CAR_TIERS.length - 1
      for (let t = 0; t < CAR_TIERS.length; t++) {
        if (pxLength >= CAR_TIERS[t].minPx) { next = t; break }
      }
      if (next !== lod.tier) {
        built[lod.tier].group.visible = false
        built[next].group.visible = true
        lod.tier = next
      }
      return next
    },
  }
  return lod
}

/** A wing shrunk IN PLACE. The scale is uniform and taken about the car's centreline and the
 *  ground, so span, chord and ride height all come down together and the wing stays symmetric and
 *  stays planted; the z anchor holds its station, or a scale would also slide it toward the middle
 *  of the car. Pylons are deliberately outside it: they bridge the wing to the car, and shrinking
 *  them with it would just unbolt the wing from the nose. */
function wingScale(scale: number, anchorZ: number): THREE.Group {
  const g = new THREE.Group()
  g.scale.setScalar(scale)
  g.position.z = (anchorZ - SPRITE.cy) * (1 - scale)
  return g
}

/** The BLOCK car for the far tiers: the same silhouette in slabs, its dimensions read off the very
 *  tables the real car lofts from, so a switch changes the resolution and not the shape. Wheels are
 *  boxes on the real hub positions, and nothing moves, because at this size nothing can be seen to.
 *  Roughly a hundred and seventy triangles against fifty-six thousand. */
function buildProxyCar(paint: CarPaint): THREE.Group {
  const group = new THREE.Group()
  const slabs: Array<[number, number, number, number, number, number, string]> = [
    // x0, x1, y0, y1, z0, z1, paint
    [106, 134, 0.10, 0.30, -22, 120, paint.body],
    [92, 148, 0.06, 0.42, 120, 300, paint.body],
    [100, 140, 0.06, 0.34, 300, 450, paint.body],
    [56, 88, 0.08, 0.40, 209, 376, paint.body],
    [152, 184, 0.08, 0.40, 209, 376, paint.body],
    [108, 132, 0.42, 0.62, 238, 300, paint.cover],
    [72, 168, 0.03, 0.06, 190, 458, FLOOR],
    [24, 216, 0.03, 0.10, -14, 34, paint.wing],
    [24, 30, 0.03, 0.20, -18, 42, paint.wing],
    [210, 216, 0.03, 0.20, -18, 42, paint.wing],
    [37, 203, 0.42, 0.57, 446, 480, paint.cover],
    [33, 41, 0.25, 0.62, 408, 492, paint.wing],
    [199, 207, 0.25, 0.62, 408, 492, paint.wing],
  ]
  for (const w of WHEELS) {
    const halfW = w.w / 2
    slabs.push([
      SPRITE.cx + w.x - halfW, SPRITE.cx + w.x + halfW,
      0, (w.r * 2) / (UNITS_PER_M * CAR_HEIGHT_SCALE), w.z - w.r, w.z + w.r, TYRE,
    ])
  }
  const sinks = new Map<string, GeometrySink>()
  for (const [x0, x1, y0, y1, z0, z1, tint] of slabs) {
    const sink = sinks.get(tint) ?? new GeometrySink()
    box(sink, x0, x1, y0, y1, z0, z1)
    sinks.set(tint, sink)
  }
  for (const [tint, sink] of sinks) group.add(mesh(sink.build(), tint))
  return group
}

export function buildCarMesh(livery: CarLivery, compound: TyreCompound = 'medium', tier = 0): CarMesh {
  detail = CAR_TIERS[Math.min(CAR_TIERS.length - 1, Math.max(0, tier))]
  if (detail.proxy) {
    const group = buildProxyCar(asPaint(livery))
    // Dead pivots, so a caller can steer and roll every tier without asking which one it has.
    const parked = () => {
      const g = new THREE.Group()
      group.add(g)
      return g
    }
    const wheels = { fl: parked(), fr: parked(), rl: parked(), rr: parked() }
    return { group, wheels, spin: { fl: parked(), fr: parked(), rl: parked(), rr: parked() } }
  }
  const group = new THREE.Group()
  const paint = asPaint(livery)
  const colour = paint.body
  const sec = paint.cover
  const cx = SPRITE.cx
  const cz = SPRITE.cy

  group.add(mesh(loftGeometry(BODY, BODY_BOTTOM), colour))
  group.add(mesh(spineGeometry(), sec))
  for (const sign of [-1, 1]) {
    const pod = podGeometry(sign)
    group.add(mesh(pod.body, colour))
    const socket = mesh(pod.mouth, CARBON)
    socket.castShadow = false
    group.add(socket)
  }

  // The aperture is the body crown's own rolled channel, but the tub inside it is LINED: walls and
  // floor in carbon, a dash bulkhead across the front with the column through it, and the driver
  // in the seat. Left bare, the walls you look down are the body's painted surface, and the
  // cockpit reads as a red bathtub with a black plate at the bottom.
  {
    group.add(mesh(cockpitLinerGeometry(), CARBON))
    const basin = new GeometrySink()
    box(basin, SPRITE.cx - 10.5, SPRITE.cx + 10.5, 0.296, 0.306, 205, 247)
    group.add(mesh(basin.build(), CARBON))
    // The dash bulkhead: the wall the driver's legs go under and the column comes out of, set just
    // ahead of the wheel so the tub has a front rather than running away into the nose.
    const dash = new GeometrySink()
    box(dash, SPRITE.cx - 9.5, SPRITE.cx + 9.5, 0.302, 0.372, 208.5, 210.5)
    group.add(mesh(dash.build(), STRUCTURE))

    // Everything from here down is cockpit FURNITURE and the first thing a tier drops: it is the
    // densest assembly on the car, and below roughly a hundred and fifty pixels of car length there
    // is not a pixel of driver left to read. The lined tub above stays at every tier, because an
    // empty red bathtub is worse than a dark one.
    if (detail.cockpit) {
      // The wheel is an assembly, not a ring in space: rim, hub disc and crossed spokes in one tilted
      // group, its column running from the hub into the dash wall at the channel's front.
      const wheelGroup = new THREE.Group()
      wheelGroup.position.set(0, H(0.36), 217 - SPRITE.cy)
      wheelGroup.rotation.x = -1.15
      // An F1 wheel is a YOKE: carbon body with the display block proud of it, capsule grips
      // canted inward at the sides, thumb paddles at the top corners. No ring anywhere.
      const body = mesh(new THREE.BoxGeometry(10, 6, 1.8), CARBON)
      wheelGroup.add(body)
      const screen = mesh(new THREE.BoxGeometry(5.8, 3.4, 0.6), STRUCTURE)
      screen.position.z = 1.05
      wheelGroup.add(screen)
      for (const sign of [-1, 1]) {
        const grip = mesh(new THREE.CapsuleGeometry(1.4, 4.8, 4, 10), STRUCTURE)
        grip.position.set(sign * 4.3, -0.3, 0)
        grip.rotation.z = -sign * 0.14
        wheelGroup.add(grip)
        const paddle = mesh(new THREE.BoxGeometry(2.3, 1.3, 0.9), CARBON)
        paddle.position.set(sign * 3.5, 3.3, 0)
        wheelGroup.add(paddle)
      }
      group.add(wheelGroup)
      // Arms BEND. One strut from shoulder to wheel is a handlebar; an upper arm out to a raised
      // elbow and a forearm back in to the grip is a person driving.
      // The grip point is the wheel's OWN grip in world space, so the gloves sit on the rim rather
      // than hanging a couple of units behind it.
      for (const sign of [-1, 1]) {
        const shoulder = v3(sign * 8.2, H(0.314), 237 - SPRITE.cy)
        const elbow = v3(sign * 9.6, H(0.324), 228 - SPRITE.cy)
        const grip = v3(sign * 4.3, H(0.3595), 217.4 - SPRITE.cy)
        group.add(strut(shoulder, elbow, 3.0, CARBON))
        group.add(strut(elbow, grip, 2.5, CARBON))
        const glove = mesh(new THREE.SphereGeometry(2.5, 12, 9), CARBON)
        glove.position.set(grip.x, grip.y, grip.z)
        group.add(glove)
      }

      // Column runs from INSIDE the dash bulkhead to just BEHIND the wheel's back face. Ending it at
      // the hub pushed its tip out through the display, which is the overlap you could see.
      group.add(strut(v3(0, H(0.344), 209.5 - SPRITE.cy), v3(0, H(0.354), 216.4 - SPRITE.cy), 1.5, CARBON))

      // The torso half a helmet BELOW the rim, with the harness over it: two webbing straps from
      // behind the shoulders converging on a central buckle, electronics tucked beside the hips.
      const torso = mesh(new THREE.SphereGeometry(1, 14, 10), CARBON)
      torso.scale.set(10.6, 6, 10)
      torso.position.set(0, H(0.304), 238 - SPRITE.cy)
      group.add(torso)
      for (const sign of [-1, 1]) {
        const strap = mesh(new THREE.BoxGeometry(2.3, 0.5, 8.5), STRUCTURE)
        strap.position.set(sign * 2.9, H(0.318), 236.5 - SPRITE.cy)
        strap.rotation.x = 0.42
        strap.rotation.y = -sign * 0.22
        group.add(strap)
      }
      const buckle = mesh(new THREE.BoxGeometry(2.4, 0.8, 1.8), TERTIARY)
      buckle.position.set(0, H(0.308), 233 - SPRITE.cy)
      buckle.rotation.x = 0.42
      group.add(buckle)
      for (const [gx, gz] of [[6.8, 244], [-6.4, 246]]) {
        const gear = mesh(new THREE.BoxGeometry(2.6, 1.6, 3.2), STRUCTURE)
        gear.position.set(gx, H(0.312), gz - SPRITE.cy)
        group.add(gear)
      }

      // The helmet, reclined the way the driver actually lies, neck rooted in the torso. The head
      // surround is a PILLOWED horseshoe: one smooth tube wrapping the helmet's sides and rear, its
      // lower half buried in the deck edge so it sits proud without floating.
      // Scaled UP: at its drawn size the head measured about two thirds of a real one against this
      // car's track, and a driver you can barely see over the rim reads as a toy in the seat.
      const helmet = buildHelmet(sec)
      helmet.scale.setScalar(1.25)
      helmet.position.set(0, H(0.372), 229 - SPRITE.cy)
      helmet.rotation.x = 0.22
      group.add(helmet)
      const neck = mesh(new THREE.CylinderGeometry(4.2, 4.8, 7.5, 12), CARBON)
      neck.position.set(0, H(0.372) - 2.6, 231.5 - SPRITE.cy)
      group.add(neck)
      // Tips dive into the deck so the tube's open ends are buried, never showing their mouths. The
      // section is SQUASHED and the run sits lower: at full round it stood proud of the rim like a
      // set of handlebars instead of reading as padding let into the edge.
      const padY = H(0.398)
      const horseshoe: Array<[number, number, number]> = [
        [-9.6, padY - 3.5, 219], [-10.8, padY, 223], [-11.4, padY, 230], [-9.8, padY, 237.5],
        [-5.5, padY, 242], [0, padY, 243.5], [5.5, padY, 242], [9.8, padY, 237.5],
        [11.4, padY, 230], [10.8, padY, 223], [9.6, padY - 3.5, 219],
      ]
      const pad = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
        horseshoe.map(([x, y, zw]) => new THREE.Vector3(x, y, zw - SPRITE.cy)),
      ), 36, 2.4, 10), CARBON)
      // Widened with the head: at its old span the bigger helmet fouled the padding's inner face.
      pad.scale.set(1.12, 0.58, 1)
      pad.position.y = padY * 0.42
      group.add(pad)

    }
  }

  // The airbox mouth gets the pod intake's treatment: a rim standing PROUD of the snorkel's face
  // with the hole RECESSED behind it and a throat receding into the airbox. It used to be a dark
  // plate floating a unit off a sealed cap, which is a decal, not an intake. Every ring is the
  // snorkel's own rim scaled about its own centre, so the hole and the prism it opens agree by
  // construction.
  const intake = new GeometrySink()
  const throat = new GeometrySink()
  {
    const st = SPINE[0]
    const span = st.yApex - st.yBase
    const rim = smoothPairs(TRI_RIM)
    const ring = (k: number, lo: number, hi: number, zAt: number): V3[] => rim.map(([fx, fy]) => v3(
      (fx / 9) * st.half * k, H(st.yBase + span * (lo + fy * (hi - lo))), zAt - cz,
    ))
    const band = (a: V3[], b: V3[], sink: GeometrySink) => {
      for (let k = 0; k < a.length; k++) {
        const k2 = (k + 1) % a.length
        sink.quad(a[k], a[k2], b[k2], b[k])
      }
    }
    // Forward of the helmet's crown, so the lip can stand proud without fouling the head.
    const rimFront = ring(0.90, 0.05, 0.95, 236.5)
    band(rimFront, ring(1, 0, 1, st.z), intake)
    band(rimFront, ring(0.74, 0.12, 0.88, 243), intake)
    band(ring(0.74, 0.12, 0.88, 243), ring(0.62, 0.18, 0.82, 250), throat)
    const gullet = ring(0.62, 0.18, 0.82, 250)
    for (let k = 1; k + 1 < gullet.length; k++) throat.tri(gullet[0], gullet[k], gullet[k + 1])
  }
  group.add(mesh(intake.build(), sec))
  group.add(mesh(throat.build(), CARBON))

  // Floor, proud of the body's sides the way the drawn floor peeks past the coke bottle. It ends
  // at the rear axle and hands straight over to the diffuser's throat, rather than the two running
  // past each other for a stretch.
  group.add(mesh(floorGeometry(), FLOOR))
  // The plank, proud of the floor's underside by a couple of millimetres, and the titanium skids
  // let into it: the four bright squares that actually touch the road.
  const plank = new GeometrySink()
  box(plank, cx - PLANK.half, cx + PLANK.half, PLANK.bottom, FLOOR_BOT + 0.0005, PLANK.z0, PLANK.z1)
  group.add(mesh(plank.build(), PLANK_WOOD))
  const skids = new GeometrySink()
  for (const z of [228, 278, 328, 372]) {
    box(skids, cx - 9, cx + 9, PLANK.bottom - 0.0012, PLANK.bottom + 0.004, z, z + 15)
  }
  group.add(mesh(skids.build(), TERTIARY))
  for (const sign of [-1, 1]) {
    for (const f of FLOOR_FENCES) group.add(mesh(fenceGeometry(sign, f), STRUCTURE))
    group.add(mesh(floorEdgeGeometry(sign), STRUCTURE))
    // Rear BRAKE DUCT WINGLETS: a stack on the inboard face of each rear wheel, in the gap between
    // the tyre's inner wall and the wishbones, hung off a mounting fin against the tyre so the
    // blades are attached to something rather than floating beside it.
    const duct = new GeometrySink()
    for (const [y, xIn, xOut, zA, zB] of [
      [0.135, 57, 65.5, 386, 406], [0.185, 58, 65, 388, 405], [0.235, 59, 64.5, 390, 404],
    ]) {
      const lo = cx + Math.min(sign * xIn, sign * xOut)
      const hi = cx + Math.max(sign * xIn, sign * xOut)
      box(duct, lo, hi, y, y + 0.006, zA, zB)
    }
    group.add(mesh(duct.build(), CARBON))
    group.add(mesh(finGeometry(
      [[392, 0.128], [404, 0.128], [404, 0.245], [392, 0.245]], sign * 65.8, 1.2,
    ), CARBON))
  }

  // Front wing: three lofted aerofoils per side, the lowest carrying the flat neutral section
  // across the middle, all three running unbroken out to a shaped endplate. Every element is a
  // real section with a rounded nose and a slot of air under the one above it.
  const frontWing = wingScale(0.95, 12)
  group.add(frontWing)
  for (const sign of [-1, 1]) {
    FRONT_WING.forEach((element, i) => {
      frontWing.add(mesh(wingElementGeometry(element, sign), i === 0 ? paint.wing : paint.accent))
    })
    frontWing.add(mesh(frontEndplateGeometry(sign), paint.trim))
  }
  // The wing hangs off the nose on two pylons: BLADES raked forward as they climb, rooted inside
  // the neutral section and buried in the nose at the top, not square posts standing in the open.
  // Thin, and set so their outer face sits FLUSH with the nose's flank (half ~13 at these
  // stations) rather than standing proud of it as a pair of posts in the airflow.
  for (const sign of [-1, 1]) {
    group.add(mesh(finGeometry([[2, 0.048], [13, 0.048], [9, 0.20], [-3, 0.20]], sign * 12.3, 1.5), colour))
  }

  // Rear wing: beam low, mainplane, flap above it, each a lofted section running unbroken into a
  // plate that bows outboard behind the tyre. The whole assembly still sits INTO the car's
  // silhouette (iteration A): the airbox is the tallest point and the wing second.
  const REAR_SKIN = [paint.wing, paint.wing, paint.accent, paint.cover]
  const rearWing = wingScale(0.90, 450)
  group.add(rearWing)
  for (const sign of [-1, 1]) {
    REAR_WING.forEach((element, i) => {
      rearWing.add(mesh(wingElementGeometry(element, sign), REAR_SKIN[i]))
    })
    // The flap carries a gurney: a real wing's last two centimetres are a square lip, and its
    // shadow line is most of what tells you the flap is a wing and not a plank.
    rearWing.add(mesh(gurneyGeometry(REAR_WING[3], sign, 1.8), sec))
    rearWing.add(mesh(endplateGeometry(sign * REAR_PLATE.x, REAR_PLATE.thick), paint.trim))
    // LOUVRES up the plate's rear quarter: on a real car the panel is slotted and each strip of it
    // rolled outboard, so they read as dark gills lying along the plate rather than as paint.
    for (const y of [0.455, 0.492, 0.529, 0.566]) {
      const gill = new GeometrySink()
      const yIn = H(y)
      // The curl is already signed, so only the plate's own offsets get mirrored. Multiplying the
      // whole expression by `sign` flips the curl back inboard and buries the gills in the panel.
      const face = (z: number, out: number, drop: number) => v3(
        sign * (REAR_PLATE.x + REAR_PLATE.thick / 2 + out) + rearPlateCurl(z, yIn, sign),
        yIn - drop, z - cz,
      )
      // Inner edge is EMBEDDED in the plate, not laid on it. At out 0 the gill's inboard face was
      // exactly coplanar with the plate's outer face, which is a guaranteed depth fight.
      const corners = (drop: number) => [
        face(463, -0.7, drop), face(485, -0.7, drop),
        face(485, 3, drop + 1.7), face(463, 3, drop + 1.7),
      ]
      const lo = corners(0.9)
      const hi = corners(0)
      gill.quad(hi[0], hi[1], hi[2], hi[3])
      gill.quad(lo[0], lo[1], lo[2], lo[3])
      for (let k = 0; k < 4; k++) gill.quad(lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k])
      rearWing.add(mesh(gill.build(), STRUCTURE))
    }
  }
  // The wing rides one central SWAN NECK: a raked arch off the deck, its top buried in the
  // mainplane, not a rectangular post standing under it.
  group.add(mesh(finGeometry(
    // Top edge RAKED to the mainplane's underside rather than level: a flat top would hang clear of
    // the element at the back the moment the element gains any angle at all.
    [[414, 0.26], [447, 0.26], [462, 0.36], [467, 0.492], [455, 0.463], [446, 0.36]], 0, 8,
  ), STRUCTURE))

  // Diffuser under the tail, reaching back under the wing (iteration E): the car ends in floor the
  // way the reference does, not in air.
  // Shell lighter than the fences, not darker: the roof is what should catch light and show its
  // terraces, and the channels between strakes should read as the dark slots they are.
  group.add(mesh(diffuserGeometry(), STRUCTURE))
  group.add(mesh(diffuserStrakeGeometry(), CARBON))
  // RAIN LIGHT: housing rooted in the crash structure's rear face, sitting on the diffuser's tall
  // central terrace with the beam wing directly over it. Lens proud of the housing, facing aft.
  const lampBody = new GeometrySink()
  box(lampBody, SPRITE.cx - 6.5, SPRITE.cx + 6.5, 0.244, 0.306, 448, 466)
  group.add(mesh(lampBody.build(), CARBON))
  const lens = new GeometrySink()
  box(lens, SPRITE.cx - 5, SPRITE.cx + 5, 0.254, 0.296, 465, 467.5)
  group.add(mesh(lens.build(), RAIN_LENS))

  // Developed-car detail, the things a launch car does not have yet.
  for (const sign of [-1, 1]) {
    // VORTEX GENERATORS on the pod's shoulder: three little fins straddling its top surface, so
    // each is rooted whatever the pod's top line is doing at that station.
    for (const [x, z0, z1] of [[41, 231, 243], [48, 233, 244], [55, 235, 245]]) {
      const y0 = podTopAt(x, z0)
      const y1 = podTopAt(x, z1)
      group.add(mesh(finGeometry(
        [[z0, y0 - 0.016], [z1, y1 - 0.016], [z1, y1 + 0.021], [z0, y0 + 0.017]], sign * x, 0.8,
      ), sec))
    }
    // COOLING LOUVRES on the engine cover's shoulder, laid on the body's own flank. Each reads its
    // corner off `bodyMount`, so the panel sits on the skin wherever the shoulder line moves to.
    const gills = new GeometrySink()
    const at = (z: number, f: number, out: number, drop: number) => {
      const p = bodyMount(z, f, -out, sign)
      return v3(p.x, p.y - drop, p.z)
    }
    for (const [z0, f] of [[268, 0.83], [277, 0.81], [286, 0.79], [295, 0.77]] as const) {
      const lip = [at(z0, f, 0.2, 0), at(z0 + 7, f - 0.02, 0.2, 0)]
      const out = [at(z0 + 7, f - 0.02, 1.9, 1.5), at(z0, f, 1.9, 1.5)]
      gills.quad(lip[0], lip[1], out[0], out[1])
      gills.quad(
        v3(lip[0].x, lip[0].y - 0.9, lip[0].z), v3(lip[1].x, lip[1].y - 0.9, lip[1].z),
        out[0], out[1],
      )
    }
    group.add(mesh(gills.build(), STRUCTURE))
  }

  // Mirrors: rounded-rectangle housings in the LIVERY colour, glass on the driver's side, their
  // stalks rooted INSIDE the deck flank so nothing floats.
  for (const sign of detail.cockpit ? [-1, 1] : []) {
    const rot = -sign * 0.32
    // Mounted where the sprite draws them: on the chassis shoulder BESIDE the cockpit, ahead of
    // the pad. The stalk starts inside the shoulder and ends inside the head.
    const head = mesh(new RoundedBoxGeometry(5.4, 3.4, 1.4, 4, 0.65), paint.trim)
    head.position.set(sign * 30.5, H(0.41), 208 - cz)
    head.rotation.y = rot
    group.add(head)
    const glass = mesh(new RoundedBoxGeometry(4.3, 2.4, 0.5, 3, 0.5), STRUCTURE)
    glass.position.set(sign * 30.5 + Math.sin(rot) * 0.75, H(0.41), 208 - cz + Math.cos(rot) * 0.75)
    glass.rotation.y = rot
    group.add(glass)
    group.add(strut(
      v3(sign * 24, H(0.35), 206 - cz), v3(sign * 29.3, H(0.402), 207.8 - cz), 1.0, colour,
    ))
  }

  // Suspension: a DOUBLE WISHBONE per corner, the way the real thing is built. An A-arm top AND
  // bottom (the lower one was simply missing, which left every wheel hanging off one arm), a toe
  // link behind the axle, and a pushrod climbing inboard off the bottom of the upright. Arms are
  // blades, wide in plan and thin edge-on. Their inboard ends sit INSIDE the body so they stay
  // attached at any steering lock, and their outboard ends run PAST the tyre's inner wall so they
  // vanish into the wheel instead of stopping short of it in mid-air.
  for (const w of detail.linkage ? WHEELS : []) {
    const front = w.z < SPRITE.cy
    const sign = Math.sign(w.x)
    const z = w.z - cz
    const spread = front ? 30 : 26
    // The upright's two pickups, high and low on the wheel's inboard face.
    const top: V3 = v3(w.x * 0.8, w.r * 1.28, z)
    const bottom: V3 = v3(w.x * 0.8, w.r * 0.46, z)
    // Chassis ends are placed as a fraction UP the local section, not at a fixed height. The lower
    // arm picks up far down the monocoque, which is what gives the pair its splay.
    for (const lean of [-1, 0.85]) {
      group.add(mesh(armGeometry(bodyMount(w.z + spread * lean, 0.78, 3, sign), top, 7, 2.6), CARBON))
      group.add(mesh(
        armGeometry(bodyMount(w.z + spread * lean * 0.92, 0.18, 3, sign), bottom, 8, 2.9), CARBON,
      ))
    }
    group.add(mesh(armGeometry(
      bodyMount(w.z + 12, 0.42, 3, sign), v3(w.x * 0.8, w.r * 0.75, z + 8), 4.5, 2.1,
    ), STRUCTURE))
    group.add(mesh(armGeometry(
      bodyMount(w.z + (front ? -19 : 17), 0.82, 4, sign), v3(w.x * 0.78, w.r * 0.52, z), 4, 3.4,
    ), STRUCTURE))
  }

  // Wheels last, each in its own pivot group so steering and spin are plain rotations. The tyre is
  // a lathe with FILLETED shoulders: tread rolling into sidewall, not a sharp-edged cylinder.
  const tyreGeometry = (r: number, w: number): THREE.BufferGeometry => {
    const f = r * 0.16
    const pts: THREE.Vector2[] = [new THREE.Vector2(r * 0.58, -w / 2), new THREE.Vector2(r - f, -w / 2)]
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2)
      pts.push(new THREE.Vector2(r - f + Math.sin(a) * f, -w / 2 + f - Math.cos(a) * f))
    }
    pts.push(new THREE.Vector2(r, w / 2 - f))
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2)
      pts.push(new THREE.Vector2(r - f + Math.cos(a) * f, w / 2 - f + Math.sin(a) * f))
    }
    pts.push(new THREE.Vector2(r * 0.58, w / 2))
    const g = new THREE.LatheGeometry(pts, seg(36))
    g.rotateZ(Math.PI / 2)
    return g
  }
  // The RIM is an assembly, not a filled disc: a barrel at the bead seat, a flange lipping over it
  // at each face, ten spokes standing off both faces and a centre lock nut through the middle.
  // Everything here rides the wheel's own pivot, so it all steers and spins with the tyre.
  const wheels = {} as CarMesh['wheels']
  const spin = {} as CarMesh['spin']
  const band = TYRE_BANDS[compound]
  for (const w of WHEELS) {
    const pivot = new THREE.Group()
    pivot.position.set(w.x, w.r, w.z - cz)
    // Everything that ROLLS goes in here; the duct below stays on the steering pivot outside it.
    const roll = new THREE.Group()
    pivot.add(roll)
    roll.add(mesh(tyreGeometry(w.r, w.w), TYRE))
    // Barrel and flanges are OPEN ENDED. A capped cylinder puts a solid disc across the wheel's
    // face and every spoke behind it disappears; what fills the middle is the brake disc, which is
    // what fills it on the car.
    const barrel = mesh(new THREE.CylinderGeometry(w.r * 0.60, w.r * 0.60, w.w - 1, seg(26), 1, true), CARBON)
    barrel.geometry.rotateZ(Math.PI / 2)
    roll.add(barrel)
    // Rim furniture, brake and duct: all of it is inside the tyre's silhouette or smaller than
    // a few pixels once the car is under about twenty-five, so the whole lot drops together.
    if (detail.wheelParts) {
      const brake = mesh(new THREE.CylinderGeometry(w.r * 0.42, w.r * 0.42, 2.6, seg(22)), STRUCTURE)
      brake.geometry.rotateZ(Math.PI / 2)
      roll.add(brake)
      for (const side of [-1, 1]) {
        const flange = mesh(new THREE.CylinderGeometry(w.r * 0.645, w.r * 0.60, 2.2, seg(26), 1, true), HUB, 'metal')
        flange.geometry.rotateZ(Math.PI / 2)
        flange.position.x = side * (w.w / 2 - 1.4)
        roll.add(flange)
        // The rim's EDGE: a flat annulus standing PROUD of the spoke web. It is most of what you see
        // of a wheel's rim, and without it the spokes appear to run straight into the tyre.
        const rimFace = mesh(new THREE.RingGeometry(w.r * 0.50, w.r * 0.632, 34), HUB, 'metal')
        rimFace.geometry.rotateY(Math.PI / 2)
        rimFace.position.x = side * (w.w / 2 - 1.0)
        roll.add(rimFace)
        // The COMPOUND band, on the flat of the sidewall and a hair proud of it. Casts no shadow:
        // it is a marking, and a marking that shadows reads as a raised ring. BOTH walls carry it,
        // so it is added before the outboard-only work below.
        const ring = mesh(new THREE.RingGeometry(w.r * 0.70, w.r * 0.80, 32), band)
        ring.geometry.rotateY(Math.PI / 2)
        ring.position.x = side * (w.w / 2 + 0.25)
        ring.castShadow = false
        roll.add(ring)
        // Spokes on the OUTBOARD face only. The inboard face of an F1 wheel is not a mirror of it:
        // that side is taken up by the brake duct and the upright, and nobody sees a spoke there.
        if (side !== Math.sign(w.x)) continue
        const web = mesh(new THREE.CylinderGeometry(w.r * 0.21, w.r * 0.21, 1.8, seg(22)), HUB, 'metal')
        web.geometry.rotateZ(Math.PI / 2)
        web.position.x = side * (w.w / 2 - 2.2)
        roll.add(web)
        // Set BACK from the rim face and stopping just inside it, so the web reads as recessed. The
        // spokes are the one part of the car that should CATCH the light as the wheel turns.
        for (let k = 0; k < 10; k++) {
          const spoke = mesh(new THREE.BoxGeometry(1.1, w.r * 0.36, 2.8), HUB, 'metal')
          spoke.position.set(side * (w.w / 2 - 2.4), 0, 0)
          spoke.rotation.x = (k / 10) * Math.PI * 2
          spoke.translateY(w.r * 0.35)
          roll.add(spoke)
        }
        // Bolt circle on the web, then the centre lock: retaining collar, hex nut, coloured cap.
        for (let k = 0; k < 8; k++) {
          const bolt = mesh(new THREE.CylinderGeometry(w.r * 0.022, w.r * 0.022, 1.4, seg(8)), STRUCTURE)
          bolt.geometry.rotateZ(Math.PI / 2)
          bolt.position.set(side * (w.w / 2 - 1.6), 0, 0)
          bolt.rotation.x = (k / 8) * Math.PI * 2
          bolt.translateY(w.r * 0.155)
          roll.add(bolt)
        }
        for (const [rad, len, off, segs, tint] of [
          [0.135, 2.6, 0.6, 24, STRUCTURE], [0.098, 4.4, 1.9, 6, HUB], [0.055, 5.6, 2.6, 16, paint.trim],
        ] as const) {
          const part = mesh(new THREE.CylinderGeometry(w.r * rad, w.r * rad, len, seg(segs)), tint, 'metal')
          part.geometry.rotateZ(Math.PI / 2)
          part.position.x = side * (w.w / 2 + off)
          roll.add(part)
        }
      }
      const axle = mesh(new THREE.CylinderGeometry(w.r * 0.075, w.r * 0.075, w.w + 1, seg(12)), STRUCTURE)
      axle.geometry.rotateZ(Math.PI / 2)
      roll.add(axle)

      // BRAKE DUCT: a drum wrapping the disc on the wheel's inboard face, with a scoop under its
      // leading edge feeding it. On the STEERING pivot rather than inside the rolling group, because
      // a duct turns with the wheel and stays put while the wheel goes round.
      const inb = -Math.sign(w.x)
      const drum = mesh(new THREE.CylinderGeometry(w.r * 0.55, w.r * 0.50, 13, seg(20), 1, true), CARBON)
      drum.geometry.rotateZ(Math.PI / 2)
      drum.position.x = inb * (w.w / 2 - 2)
      pivot.add(drum)
      // The duct's BACKPLATE is solid, and has to be. The old wheel filled its centre with a hub
      // disc; the open rim that replaced it left a clear line of sight into the middle of the wheel,
      // and the suspension's outboard ends sit in there. At lock they swung into view.
      const back = mesh(new THREE.CylinderGeometry(w.r * 0.52, w.r * 0.52, 2.2, seg(22)), CARBON)
      back.geometry.rotateZ(Math.PI / 2)
      back.position.x = inb * (w.w / 2 + 4)
      pivot.add(back)
      const scoop = mesh(new RoundedBoxGeometry(9, 12, 10, 3, 1.8), CARBON)
      scoop.position.set(inb * (w.w / 2 - 2), -w.r * 0.33, -w.r * 0.42)
      pivot.add(scoop)
      const mouth = mesh(new THREE.BoxGeometry(6.4, 8.4, 1.4), STRUCTURE)
      mouth.position.set(inb * (w.w / 2 - 2), -w.r * 0.33, -w.r * 0.42 - 4.9)
      pivot.add(mouth)
    }

    wheels[w.tag] = pivot
    spin[w.tag] = roll
    group.add(pivot)
  }

  // Sculpting done: bake it down. Each rolling hub collapses inside itself, then each steering
  // pivot around it, then the shell around all four, so every part that has to move still can.
  // At the far tiers nothing has to move: a wheel is under a pixel across and its rotation is not
  // observable, so the boundaries come down and the whole car bakes into one buffer per paint.
  if (detail.liveWheels) {
    for (const tag of Object.keys(wheels) as Array<keyof CarMesh['wheels']>) {
      collapseByPaint(spin[tag], EMPTY_BOUNDARY)
      collapseByPaint(wheels[tag], new Set([spin[tag]]))
    }
    collapseByPaint(group, new Set(Object.values(wheels)))
  } else {
    collapseByPaint(group, EMPTY_BOUNDARY)
  }

  return { group, wheels, spin }
}

const EMPTY_BOUNDARY: ReadonlySet<THREE.Object3D> = new Set()
