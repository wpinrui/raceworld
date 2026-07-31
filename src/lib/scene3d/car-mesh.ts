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
  { z: 8, half: 13, top: 0.24, bottom: 0.195 },
  { z: 48, half: 14, top: 0.32, bottom: 0.167 },
  { z: 110, half: 16, top: 0.44, bottom: 0.124 },
  { z: 166, half: 25, top: 0.48, bottom: 0.085 },
  { z: 202, half: 46, top: 0.52 },
  { z: 224, half: 70, top: 0.54 },
  { z: 290, half: 70, top: 0.53 },
  { z: 342, half: 52, top: 0.48 },
  { z: 380, half: 30, top: 0.45 },
  { z: 448, half: 28, top: 0.40 },
]
const BODY_BOTTOM = 0.06

/** The cockpit surround ahead of the tub, and the airbox-to-tail engine cover behind it. The gap
 *  between them IS the cockpit opening; the rear loft's front cap is the headrest bulkhead. */
const SPINE_FRONT: Station[] = [
  { z: 188, half: 17, top: 0.56 },
  { z: 206, half: 16, top: 0.60 },
]
const SPINE_REAR: Station[] = [
  { z: 246, half: 14, top: 0.78 },
  { z: 260, half: 13, top: 0.95 },
  { z: 300, half: 10, top: 0.82 },
  { z: 380, half: 8, top: 0.58 },
  { z: 446, half: 6, top: 0.44 },
]
const SPINE_BOTTOM = 0.30

/** Cross-section profile, one side, bottom to crown: (fraction of half-width, fraction of height).
 *  Five steps a side keeps the shoulder round instead of a single hard chamfer. */
const PROFILE: Array<[number, number]> = [[1, 0], [1, 0.45], [0.92, 0.75], [0.72, 0.93], [0.45, 1]]

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
  { tag: 'fl', x: -90, z: 108, r: 44, w: 48 },
  { tag: 'fr', x: 90, z: 108, r: 44, w: 48 },
  { tag: 'rl', x: -90, z: 398, r: 48, w: 52 },
  { tag: 'rr', x: 90, z: 398, r: 48, w: 52 },
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
  const tyre = { z: 398, y: 48, r: 62 }
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
  group.add(mesh(loftGeometry(SPINE_FRONT, SPINE_BOTTOM), sec))
  group.add(mesh(loftGeometry(SPINE_REAR, SPINE_BOTTOM), sec))

  // The cockpit: a dark open tub between the surround and the headrest bulkhead, the driver's
  // helmet proud of its rim.
  const tub = new GeometrySink()
  box(tub, cx - 12, cx + 12, 0.28, 0.56, 206, 246)
  group.add(mesh(tub.build(), CARBON))
  const helmet = mesh(new THREE.SphereGeometry(13, 16, 12), sec)
  helmet.position.set(0, H(0.56), 228 - cz)
  group.add(helmet)

  // Intakes read as OPENINGS: dark mouths floated just off their leading faces — the airbox above
  // the helmet, one sidepod mouth per flank on the pods' angled fronts.
  const mouths = new GeometrySink()
  mouths.quad(
    v3(-8, H(0.78), 244 - cz), v3(8, H(0.78), 244 - cz),
    v3(8, H(0.93), 246.5 - cz), v3(-8, H(0.93), 246.5 - cz),
  )
  for (const sign of [-1, 1]) {
    mouths.quad(
      v3(sign * 35, H(0.16), 203.5 - cz), v3(sign * 69, H(0.16), 221.5 - cz),
      v3(sign * 69, H(0.48), 221.5 - cz), v3(sign * 35, H(0.48), 203.5 - cz),
    )
  }
  group.add(mesh(mouths.build(), CARBON))

  // Floor, proud of the body's sides the way the drawn floor peeks past the coke bottle.
  const floor = new GeometrySink()
  box(floor, 60, 180, 0.03, 0.05, 190, 458)
  group.add(mesh(floor.build(), FLOOR))

  // Front wing: the cascade climbs REARWARD from the lowest leading element, the drawn plan's
  // colours kept per plate, endplates bookending the stack.
  const wingF = [
    { x0: 56, x1: 184, z0: 13, z1: 20, y: 0.045, colour: TERTIARY },
    { x0: 44, x1: 196, z0: 21, z1: 30, y: 0.075, colour: sec },
    { x0: 36, x1: 204, z0: 31, z1: 41, y: 0.105, colour },
    { x0: 30, x1: 210, z0: 42, z1: 52, y: 0.135, colour: sec },
  ]
  for (const p of wingF) {
    const s = new GeometrySink()
    box(s, p.x0, p.x1, p.y, p.y + 0.02, p.z0, p.z1)
    group.add(mesh(s.build(), p.colour))
  }
  for (const x of [28, 208]) {
    const s = new GeometrySink()
    box(s, x, x + 4, 0.03, 0.165, 9, 52)
    group.add(mesh(s.build(), TERTIARY))
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
  box(pylon, 116, 124, 0.38, 0.53, 412, 452)
  group.add(mesh(pylon.build(), STRUCTURE))

  // Diffuser wedge under the tail.
  const diff = new GeometrySink()
  box(diff, 76, 164, 0.05, 0.18, 448, 468)
  group.add(mesh(diff.build(), CARBON))

  // Halo over the tub, its leg down to the nose deck.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(16, 2.6, 8, 20, Math.PI),
    new THREE.MeshLambertMaterial({ color: TERTIARY, side: THREE.DoubleSide }),
  )
  halo.castShadow = true
  halo.geometry.rotateZ(Math.PI)
  halo.geometry.rotateX(Math.PI / 2 - 0.35)
  halo.position.set(0, H(0.68), 212 - cz)
  group.add(halo)
  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, H(0.68) - H(0.58), 6),
    new THREE.MeshLambertMaterial({ color: TERTIARY, side: THREE.DoubleSide }),
  )
  leg.position.set(0, (H(0.68) + H(0.58)) / 2, 198 - cz)
  group.add(leg)

  // Mirrors OUTBOARD of the bodywork on stalks: exterior fittings, not lumps in the cockpit side.
  for (const sign of [-1, 1]) {
    const head = new GeometrySink()
    box(head, cx + sign * 58 - 5, cx + sign * 58 + 5, 0.50, 0.545, 202, 209)
    group.add(mesh(head.build(), TERTIARY))
    group.add(blade(
      v3(sign * 44, H(0.48), 206 - cz), v3(sign * 54, H(0.525), 205 - cz), 2.4, 1.6, TERTIARY,
    ))
  }

  // Suspension: A-arm blades, wide in plan and thin edge-on, inboard ends INSIDE the nose and tail
  // so they stay attached at any steering lock. The track rod runs lower and narrower.
  for (const w of WHEELS) {
    const front = w.z < SPRITE.cy
    const inX = Math.sign(w.x) * (front ? 13 : 20)
    const hub: V3 = v3(w.x * 0.82, w.r, w.z - cz)
    const spread = front ? 30 : 26
    group.add(blade(v3(inX, H(0.28), w.z - cz - spread), hub, 7, 2, CARBON))
    group.add(blade(v3(inX, H(0.28), w.z - cz + spread * 0.85), hub, 7, 2, CARBON))
    group.add(blade(v3(inX, H(0.20), w.z - cz + 4), hub, 4, 1.6, STRUCTURE))
  }

  // Wheels last, each in its own pivot group so steering and spin are plain rotations.
  const wheels = {} as CarMesh['wheels']
  for (const w of WHEELS) {
    const pivot = new THREE.Group()
    pivot.position.set(w.x, w.r, w.z - cz)
    const tyre = mesh(new THREE.CylinderGeometry(w.r, w.r, w.w, 24), TYRE)
    tyre.geometry.rotateZ(Math.PI / 2)
    pivot.add(tyre)
    const hubDisc = mesh(new THREE.CylinderGeometry(w.r * 0.55, w.r * 0.55, w.w + 2, 18), HUB)
    hubDisc.geometry.rotateZ(Math.PI / 2)
    pivot.add(hubDisc)
    wheels[w.tag] = pivot
    group.add(pivot)
  }

  return { group, wheels }
}
