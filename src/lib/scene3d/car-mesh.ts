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
import { GeometrySink, v3, type V3 } from './solids3d'

/** Vertical exaggeration for the whole car, wheels excepted: judged too low against its own tyres
 *  at true height, the same diorama-bold call every structure height already makes. */
export const CAR_HEIGHT_SCALE = 1.75

const M = (metres: number) => metres * UNITS_PER_M
const H = (metres: number) => M(metres * CAR_HEIGHT_SCALE)

interface Station { z: number; half: number; top: number; bottom?: number }

/** The BODY loft: nose into chassis into coke bottle, half-widths traced off NOSE_D / CHASSIS_D.
 *  The nose carries its own UNDERSIDE ramp: a slim raised spar a quarter as thick as the top line
 *  implies, its base sweeping down to the floor only where the sidepods begin. */
const BODY: Station[] = [
  // The tip pinches in every axis so the nose ends in a rounded point, not a bulkhead. The nose
  // reaches thirty units further forward than the sprite drew it: the wheelbase grew through it,
  // and the whole front assembly (wing, wheels, suspension) went along. The belly stays HIGH the
  // whole way out, only dropping to floor height at the monocoque.
  { z: -22, half: 3, top: 0.207, bottom: 0.202 },
  { z: -18, half: 9, top: 0.215, bottom: 0.197 },
  { z: -8, half: 12, top: 0.228, bottom: 0.193 },
  { z: 18, half: 14, top: 0.29, bottom: 0.183 },
  { z: 80, half: 16, top: 0.38, bottom: 0.16 },
  { z: 166, half: 25, top: 0.42, bottom: 0.12 },
  { z: 202, half: 30, top: 0.46 },
  { z: 224, half: 32, top: 0.47 },
  // Behind the cockpit the body SCULPTS AWAY under the spine: a slimming keel, not a flat slab,
  // so the airbox tube and the pods carry the rear bodywork's form.
  { z: 264, half: 30, top: 0.45 },
  { z: 300, half: 25, top: 0.40 },
  { z: 342, half: 21, top: 0.34 },
  { z: 380, half: 17, top: 0.29 },
  { z: 448, half: 13, top: 0.23 },
]
const BODY_BOTTOM = 0.06

/** The sidepods as their OWN volumes, hung either side of a monocoque that stays narrow: their
 *  front faces are where the mouths open, and the undercut between pod and floor stays air. */
interface PodStation { z: number; inner: number; outer: number; top: number; bottom: number }
const POD: PodStation[] = [
  // The intake's top lip IS the pod's summit: nothing behind it runs higher. The underside
  // boat-tails, sweeping up toward the coke bottle.
  // Inner edges track the slimming keel so pod and body stay one surface with no slot between.
  // Stations dense through the shoulder and the boat-tail so the PLAN reads as one swept curve.
  // Below the mouth's sill the front face RECEDES: an undercut sweeping back and down into the
  // floor, the sill itself the forward-most point. The step to full height hides behind the
  // socket's recessed cap.
  { z: 209, inner: 30, outer: 52, top: 0.235, bottom: 0.20 },
  { z: 213, inner: 29, outer: 56, top: 0.24, bottom: 0.13 },
  { z: 219, inner: 28, outer: 62, top: 0.24, bottom: 0.07 },
  { z: 222, inner: 27, outer: 66, top: 0.40, bottom: 0.06 },
  { z: 226, inner: 26, outer: 68, top: 0.40, bottom: 0.06 },
  { z: 244, inner: 25, outer: 70, top: 0.40, bottom: 0.06 },
  { z: 296, inner: 22, outer: 68, top: 0.39, bottom: 0.07 },
  // The REAR closes early in a tight inward curl to the keel, per the sketch: no drawn-out sliver.
  { z: 326, inner: 20, outer: 62, top: 0.37, bottom: 0.08 },
  { z: 350, inner: 18, outer: 52, top: 0.34, bottom: 0.11 },
  { z: 366, inner: 16, outer: 38, top: 0.31, bottom: 0.14 },
  { z: 376, inner: 15, outer: 22, top: 0.29, bottom: 0.16 },
]

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
  { z: 240, half: 9, yBase: 0.575, yApex: 0.71 },
  { z: 252, half: 11, yBase: 0.52, yApex: 0.73 },
  { z: 270, half: 12, yBase: 0.43, yApex: 0.72 },
  { z: 300, half: 11, yBase: 0.37, yApex: 0.65 },
  { z: 350, half: 9, yBase: 0.29, yApex: 0.52 },
  { z: 400, half: 7, yBase: 0.23, yApex: 0.42 },
  { z: 446, half: 6, yBase: 0.19, yApex: 0.33 },
]

function spineGeometry(): THREE.BufferGeometry {
  const s = new GeometrySink()
  // Catmull over every field, so the stations read as one sculpted body rather than joined tubes.
  const dense: SpineStation[] = []
  for (let i = 0; i + 1 < SPINE.length; i++) {
    const p0 = SPINE[Math.max(0, i - 1)]
    const p1 = SPINE[i]
    const p2 = SPINE[i + 1]
    const p3 = SPINE[Math.min(SPINE.length - 1, i + 2)]
    for (let k = 0; k < 3; k++) {
      const t = k / 3
      dense.push({
        z: catmull(p0.z, p1.z, p2.z, p3.z, t),
        half: catmull(p0.half, p1.half, p2.half, p3.half, t),
        yBase: catmull(p0.yBase, p1.yBase, p2.yBase, p3.yBase, t),
        yApex: catmull(p0.yApex, p1.yApex, p2.yApex, p3.yApex, t),
      })
    }
  }
  dense.push(SPINE[SPINE.length - 1])
  const rings = dense.map((st) => TRI_RIM.map(([fx, fy]) =>
    v3((fx / 9) * st.half, H(st.yBase + (st.yApex - st.yBase) * fy), st.z - SPRITE.cy)))
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length
      s.quad(a[k], a[k2], b[k2], b[k])
    }
  }
  for (const [ring, flip] of [[rings[0], false], [rings[rings.length - 1], true]] as const) {
    for (let k = 1; k + 1 < ring.length; k++) {
      if (flip) s.tri(ring[0], ring[k + 1], ring[k])
      else s.tri(ring[0], ring[k], ring[k + 1])
    }
  }
  return s.build()
}

/** Cross-section profile, one side, bottom to crown: (fraction of half-width, fraction of height).
 *  The crown is FLAT: rounding lives only in the shoulder where the top rolls into the side wall. */
const PROFILE: Array<[number, number]> = [[1, 0], [1, 0.55], [0.97, 0.85], [0.88, 0.97], [0.72, 1]]

/** Catmull-Rom subdivisions per station gap: what turns the tables into curves. */
const LOFT_SUBDIV = 4

const CARBON = '#0B0D10'
const STRUCTURE = '#2E3138'
const TYRE = '#16181D'
const HUB = '#2E3138'
const FLOOR = '#14171E'
const TERTIARY = '#969CA6'

/** Wheel geometry off the artwork: the drawn tyre footprints ARE the diameters and widths. */
const WHEELS = [
  // Front axle thirty units ahead of the sprite's: the wheelbase lengthened through the nose.
  // Radii at 0.9 of the drawn tyre; pivots sit at radius height so every tyre still touches.
  { tag: 'fl', x: -90, z: 78, r: 39.6, w: 48 },
  { tag: 'fr', x: 90, z: 78, r: 39.6, w: 48 },
  { tag: 'rl', x: -90, z: 398, r: 43.2, w: 52 },
  { tag: 'rr', x: 90, z: 398, r: 43.2, w: 52 },
] as const

export interface CarMesh {
  group: THREE.Group
  /** Steerable and spinnable wheels, keyed the way the sprite tags them. */
  wheels: Record<'fl' | 'fr' | 'rl' | 'rr', THREE.Object3D>
}

const catmull = (a: number, b: number, c: number, d: number, t: number): number => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
}

function densify(stations: Required<Station>[], per = LOFT_SUBDIV): Required<Station>[] {
  const n = stations.length
  const out: Required<Station>[] = []
  for (let i = 0; i + 1 < n; i++) {
    const p0 = stations[Math.max(0, i - 1)]
    const p1 = stations[i]
    const p2 = stations[i + 1]
    const p3 = stations[Math.min(n - 1, i + 2)]
    for (let k = 0; k < per; k++) {
      const t = k / per
      out.push({
        z: catmull(p0.z, p1.z, p2.z, p3.z, t),
        half: Math.max(1, catmull(p0.half, p1.half, p2.half, p3.half, t)),
        top: catmull(p0.top, p1.top, p2.top, p3.top, t),
        bottom: catmull(p0.bottom, p1.bottom, p2.bottom, p3.bottom, t),
      })
    }
  }
  out.push(stations[n - 1])
  return out
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
  return [...left, ...right]
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
    const at = (f: number) => p.inner + (p.outer - p.inner) * f
    // The flank curves INWARD and UPWARD into a rounded shoulder: no boxy corner at the top.
    return [
      v3(sign * p.inner, b, z), v3(sign * at(1), b, z), v3(sign * at(1), b + (t - b) * 0.5, z),
      v3(sign * at(0.93), b + (t - b) * 0.85, z), v3(sign * at(0.5), t, z), v3(sign * p.inner, t, z),
    ]
  }
  // Catmull between stations: the plan outline sweeps rather than cornering station to station.
  const dense: PodStation[] = []
  for (let i = 0; i + 1 < POD.length; i++) {
    const p0 = POD[Math.max(0, i - 1)]
    const p1 = POD[i]
    const p2 = POD[i + 1]
    const p3 = POD[Math.min(POD.length - 1, i + 2)]
    for (let k = 0; k < 3; k++) {
      const t = k / 3
      dense.push({
        z: catmull(p0.z, p1.z, p2.z, p3.z, t),
        inner: catmull(p0.inner, p1.inner, p2.inner, p3.inner, t),
        outer: catmull(p0.outer, p1.outer, p2.outer, p3.outer, t),
        top: catmull(p0.top, p1.top, p2.top, p3.top, t),
        bottom: catmull(p0.bottom, p1.bottom, p2.bottom, p3.bottom, t),
      })
    }
  }
  dense.push(POD[POD.length - 1])
  const rings = dense.map(ring)
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length
      s.quad(a[k], a[k2], b[k2], b[k])
    }
  }
  // Caps fore and aft on the body; the lip's front cap is small and low.
  for (const [ringPts, flip] of [[rings[0], false], [rings[rings.length - 1], true]] as const) {
    for (let k = 1; k + 1 < ringPts.length; k++) {
      if (flip) s.tri(ringPts[0], ringPts[k + 1], ringPts[k])
      else s.tri(ringPts[0], ringPts[k], ringPts[k + 1])
    }
  }
  // The intake: a WIDE socket standing in the top half of the front face, its dark collar sweeping
  // back over the lip's rising slope into a recessed cap.
  const outline: V3[] = ([
    [31, 0.245], [49, 0.245], [51, 0.27], [51, 0.355], [48, 0.375], [33, 0.375], [31, 0.35],
  ] as Array<[number, number]>).map(([x, y]) => v3(sign * x, H(y), 209 - SPRITE.cy))
  const ocx = outline.reduce((acc, p) => acc + p.x, 0) / outline.length
  const ocy = outline.reduce((acc, p) => acc + p.y, 0) / outline.length
  // Shallow collar: the cap must sit AHEAD of the step wall behind it, or the wall shows through.
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
  const resolved = stations.map((st) => ({ ...st, bottom: st.bottom ?? bottomM }))
  const rings = densify(resolved).map((st) => section(st))
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
  cap(rings[0], false)
  cap(rings[rings.length - 1], true)
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

/** A wing plate whose front and rear edges sit at different heights: the slope a wing element has. */
function slopedPlate(
  s: GeometrySink, x0: number, x1: number, z0: number, z1: number,
  yFrontM: number, yRearM: number, thickM: number,
) {
  const cz = SPRITE.cy
  const c = (x: number, yM: number, z: number, lift: number) => v3(x - SPRITE.cx, H(yM + lift), z - cz)
  const corners = (lift: number) => [
    c(x0, yFrontM, z0, lift), c(x1, yFrontM, z0, lift), c(x1, yRearM, z1, lift), c(x0, yRearM, z1, lift),
  ]
  const lo = corners(0)
  const hi = corners(thickM)
  s.quad(hi[0], hi[1], hi[2], hi[3])
  s.quad(lo[0], lo[1], lo[2], lo[3])
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4
    s.quad(lo[k], lo[k2], hi[k2], hi[k])
  }
}

function mesh(geo: THREE.BufferGeometry, colour: string): THREE.Mesh {
  // DoubleSide: the sink's quads are wound by hand and a culled wing is a missing wing.
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** A thin round member between two points: a mirror stalk. */
function strut(a: V3, b: V3, radius: number, colour: string): THREE.Mesh {
  const from = new THREE.Vector3(a.x, a.y, a.z)
  const to = new THREE.Vector3(b.x, b.y, b.z)
  const geo = new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 6)
  const m = mesh(geo, colour)
  m.position.copy(from.clone().add(to).multiplyScalar(0.5))
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
  return m
}

/** A suspension member as the WISHBONE BLADE it is: wide in plan, thin edge-on. A tube thick enough
 *  to read from above turns into scaffolding from the side. */
function blade(a: V3, b: V3, planWidth: number, thick: number, colour: string): THREE.Mesh {
  const s = new GeometrySink()
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz) || 1
  const nx = (-dz / len) * (planWidth / 2)
  const nz = (dx / len) * (planWidth / 2)
  const corner = (p: V3, sign: number, y: number) => v3(p.x + sign * nx, p.y + y, p.z + sign * nz)
  const lo = [corner(a, -1, -thick / 2), corner(b, -1, -thick / 2), corner(b, 1, -thick / 2), corner(a, 1, -thick / 2)]
  const hi = [corner(a, -1, thick / 2), corner(b, -1, thick / 2), corner(b, 1, thick / 2), corner(a, 1, thick / 2)]
  s.quad(hi[0], hi[1], hi[2], hi[3])
  s.quad(lo[0], lo[1], lo[2], lo[3])
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4
    s.quad(lo[k], lo[k2], hi[k2], hi[k])
  }
  return mesh(s.build(), colour)
}

/** A rear wing endplate, its lower-front corner cut in an arc round the rear tyre plus margin. */
function endplateGeometry(xCentre: number, thick: number): THREE.BufferGeometry {
  const cz = SPRITE.cy
  // The square part above the tyre-clearance arc, halved: the arc's crest sits near 0.55 of car
  // height, so the plate tops out half the old headroom above it.
  const yTop = H(0.73)
  const yBot = H(0.30)
  const zFront = 418
  const zRear = 490
  const tyre = { z: 398, y: 43.2, r: 57 }
  const outline: Array<{ z: number; y: number }> = [
    { z: zFront, y: yTop }, { z: zRear, y: yTop }, { z: zRear, y: yBot },
  ]
  // Bottom edge runs forward only to the tyre's clearance arc, then the arc climbs to the front edge.
  const dzBottom = Math.sqrt(tyre.r * tyre.r - (yBot - tyre.y) ** 2)
  const aStart = Math.atan2(yBot - tyre.y, dzBottom)
  const aEnd = Math.atan2(Math.sqrt(tyre.r * tyre.r - (zFront - tyre.z) ** 2), zFront - tyre.z)
  outline.push({ z: tyre.z + dzBottom, y: yBot })
  for (let k = 1; k <= 8; k++) {
    const a = aStart + ((aEnd - aStart) * k) / 8
    outline.push({ z: tyre.z + Math.cos(a) * tyre.r, y: tyre.y + Math.sin(a) * tyre.r })
  }
  const s = new GeometrySink()
  const tris = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p.z, p.y)), [])
  for (const x of [xCentre - thick / 2, xCentre + thick / 2]) {
    for (const [i, j, k] of tris) {
      s.tri(
        v3(x, outline[i].y, outline[i].z - cz),
        v3(x, outline[j].y, outline[j].z - cz),
        v3(x, outline[k].y, outline[k].z - cz),
      )
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    s.quad(
      v3(xCentre - thick / 2, p.y, p.z - cz), v3(xCentre - thick / 2, q.y, q.z - cz),
      v3(xCentre + thick / 2, q.y, q.z - cz), v3(xCentre + thick / 2, p.y, p.z - cz),
    )
  }
  return s.build()
}

export function buildCarMesh(colour: string): CarMesh {
  const group = new THREE.Group()
  const sec = shade(colour, 0.62)
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

  // The cockpit: a dark open tub between the surround and the headrest bulkhead, the driver's
  // helmet proud of its rim.
  const tub = new GeometrySink()
  box(tub, cx - 12, cx + 12, 0.26, 0.50, 206, 246)
  group.add(mesh(tub.build(), CARBON))
  const helmet = mesh(new THREE.SphereGeometry(13, 16, 12), sec)
  helmet.position.set(0, H(0.50), 228 - cz)
  group.add(helmet)


  // The airbox mouth IS the snorkel's front cap: the same rim, a step inset and a hair proud, so
  // the hole and the prism it opens can never disagree.
  const intake = new GeometrySink()
  {
    const st = SPINE[0]
    const span = st.yApex - st.yBase
    const ring = TRI_RIM.map(([fx, fy]) => v3(
      (fx / 9) * st.half * 0.82,
      H(st.yBase + span * (0.08 + fy * 0.84)),
      st.z - 1.2 - cz,
    ))
    for (let k = 1; k + 1 < ring.length; k++) intake.tri(ring[0], ring[k], ring[k + 1])
  }
  group.add(mesh(intake.build(), CARBON))

  // Floor, proud of the body's sides the way the drawn floor peeks past the coke bottle.
  const floor = new GeometrySink()
  box(floor, 60, 180, 0.03, 0.05, 190, 458)
  group.add(mesh(floor.build(), FLOOR))

  // Front wing, shaped like the reference: one THIN full-width neutral plane low to the ground —
  // bare where the pylons take it — with the sculpted lift built as taller cambered flap stacks
  // OUTBOARD only, rising rearward over each wheel's approach.
  const mainPlane = new GeometrySink()
  box(mainPlane, 30, 210, 0.04, 0.052, -14, 20)
  group.add(mesh(mainPlane.build(), TERTIARY))
  // The sculpted flaps, plan drawn to the sketch: TWO thin red elements sharing the swept outline,
  // overlapping a little where the second takes over, both running hard into the endplate.
  const flapElement = (
    sign: number, zLead: number, zTrailOut: number,
    ctrl: [number, number], inEnd: [number, number], yF: number, yR: number,
  ) => {
    const flap = new GeometrySink()
    const plan: Array<[number, number]> = [[inEnd[0], zLead], [89, zLead], [89, zTrailOut]]
    for (let k = 1; k <= 8; k++) {
      const t = k / 8
      const s2 = 1 - t
      plan.push([
        s2 * s2 * 89 + 2 * s2 * t * ctrl[0] + t * t * inEnd[0],
        s2 * s2 * zTrailOut + 2 * s2 * t * ctrl[1] + t * t * inEnd[1],
      ])
    }
    const yAt = (z: number) => H(yF + (yR - yF) * Math.min(1, Math.max(0, (z - zLead) / (zTrailOut - zLead))))
    const pts = plan.map(([x, z]) => ({ x: sign * x, z: z - cz, y: yAt(z) }))
    const tris = THREE.ShapeUtils.triangulateShape(plan.map(([x, z]) => new THREE.Vector2(x, z)), [])
    const lift = H(0.01)
    for (const [i, j, k] of tris) {
      flap.tri(v3(pts[i].x, pts[i].y, pts[i].z), v3(pts[j].x, pts[j].y, pts[j].z), v3(pts[k].x, pts[k].y, pts[k].z))
      flap.tri(
        v3(pts[i].x, pts[i].y + lift, pts[i].z), v3(pts[j].x, pts[j].y + lift, pts[j].z),
        v3(pts[k].x, pts[k].y + lift, pts[k].z),
      )
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      flap.quad(
        v3(p.x, p.y, p.z), v3(q.x, q.y, q.z), v3(q.x, q.y + lift, q.z), v3(p.x, p.y + lift, p.z),
      )
    }
    group.add(mesh(flap.build(), colour))
  }
  for (const sign of [-1, 1]) {
    flapElement(sign, -8, 8, [60, 10], [26, -2], 0.055, 0.085)
    flapElement(sign, 4, 20, [58, 20], [30, 6], 0.082, 0.118)
  }
  for (const x of [28, 208]) {
    const s = new GeometrySink()
    box(s, x, x + 4, 0.03, 0.165, -21, 22)
    group.add(mesh(s.build(), TERTIARY))
  }
  // The wing hangs off the nose on two vertical pylons just ahead of the spar's droop.
  for (const x of [104, 130]) {
    const s = new GeometrySink()
    box(s, x, x + 6, 0.052, 0.19, -6, 10)
    group.add(mesh(s.build(), colour))
  }

  // Rear wing: beam low, main plane high, and a top element that SLOPES, trailing edge higher.
  const beam = new GeometrySink()
  box(beam, 44, 196, 0.36, 0.385, 446, 453)
  group.add(mesh(beam.build(), TERTIARY))
  const main = new GeometrySink()
  box(main, 44, 196, 0.53, 0.555, 453, 464)
  group.add(mesh(main.build(), colour))
  const upper = new GeometrySink()
  slopedPlate(upper, 42, 198, 466, 481, 0.61, 0.67, 0.025)
  group.add(mesh(upper.build(), sec))
  for (const x of [-83, 83]) group.add(mesh(endplateGeometry(x, 4), TERTIARY))
  const pylon = new GeometrySink()
  box(pylon, 116, 124, 0.26, 0.53, 412, 452)
  group.add(mesh(pylon.build(), STRUCTURE))

  // Diffuser wedge under the tail.
  const diff = new GeometrySink()
  box(diff, 76, 164, 0.05, 0.18, 448, 468)
  group.add(mesh(diff.build(), CARBON))

  // Mirrors: rounded pebbles close to the cockpit sides, their short stalks swept BACKWARDS.
  for (const sign of [-1, 1]) {
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 9),
      new THREE.MeshLambertMaterial({ color: TERTIARY }),
    )
    head.scale.set(5.5, 3.2, 4.5)
    head.position.set(sign * 46, H(0.47), 214 - cz)
    head.rotation.y = -sign * 0.5
    head.castShadow = true
    group.add(head)
    group.add(strut(
      v3(sign * 31, H(0.44), 206 - cz), v3(sign * 44, H(0.465), 213 - cz), 1.1, TERTIARY,
    ))
  }

  // Suspension: A-arm blades, wide in plan and thin edge-on, inboard ends INSIDE the nose and tail
  // so they stay attached at any steering lock. The track rod runs lower and narrower.
  for (const w of WHEELS) {
    const front = w.z < SPRITE.cy
    const inX = Math.sign(w.x) * (front ? 13 : 14)
    const hub: V3 = v3(w.x * 0.82, w.r, w.z - cz)
    const spread = front ? 30 : 26
    group.add(blade(v3(inX, H(0.28), w.z - cz - spread), hub, 7, 2, CARBON))
    group.add(blade(v3(inX, H(0.28), w.z - cz + spread * 0.85), hub, 7, 2, CARBON))
    group.add(blade(v3(inX, H(0.20), w.z - cz + 4), hub, 4, 1.6, STRUCTURE))
  }

  // Wheels last, each in its own pivot group so steering and spin are plain rotations. The tyre is
  // a lathe with FILLETED shoulders: tread rolling into sidewall, not a sharp-edged cylinder.
  const tyreGeometry = (r: number, w: number): THREE.BufferGeometry => {
    const f = r * 0.16
    const pts: THREE.Vector2[] = [new THREE.Vector2(r * 0.58, -w / 2), new THREE.Vector2(r - f, -w / 2)]
    for (let k = 1; k <= 4; k++) {
      const a = (k / 4) * (Math.PI / 2)
      pts.push(new THREE.Vector2(r - f + Math.sin(a) * f, -w / 2 + f - Math.cos(a) * f))
    }
    pts.push(new THREE.Vector2(r, w / 2 - f))
    for (let k = 1; k <= 4; k++) {
      const a = (k / 4) * (Math.PI / 2)
      pts.push(new THREE.Vector2(r - f + Math.cos(a) * f, w / 2 - f + Math.sin(a) * f))
    }
    pts.push(new THREE.Vector2(r * 0.58, w / 2))
    const g = new THREE.LatheGeometry(pts, 28)
    g.rotateZ(Math.PI / 2)
    return g
  }
  const wheels = {} as CarMesh['wheels']
  for (const w of WHEELS) {
    const pivot = new THREE.Group()
    pivot.position.set(w.x, w.r, w.z - cz)
    const tyre = mesh(tyreGeometry(w.r, w.w), TYRE)
    pivot.add(tyre)
    const hubDisc = mesh(new THREE.CylinderGeometry(w.r * 0.55, w.r * 0.55, w.w + 2, 18), HUB)
    hubDisc.geometry.rotateZ(Math.PI / 2)
    pivot.add(hubDisc)
    wheels[w.tag] = pivot
    group.add(pivot)
  }

  return { group, wheels }
}
