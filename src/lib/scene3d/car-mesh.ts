// The car as a real solid (#3d-port increment 4): a parametric loft that reads its PLAN from the
// sprite's own geometry — the artwork stays the dimension sheet — and adds the one thing the sprite
// never defined: a height profile. That profile is the design surface of this file, kept below as
// two station tables in metres, to be iterated against turntable stills.
//
// Everything is in SPRITE UNITS in the sprite's own frame (x across, z along, nose at low z), with
// the origin moved to the sprite's pivot so a mesh rotates exactly where the 2D sprite rotates.
// Heights convert through UNITS_PER_M, so a number here reads as the metres it is.

import * as THREE from 'three'
import { shade } from '@/lib/color'
import { SPRITE, UNITS_PER_M } from '@/lib/ui/car-sprite'
import { GeometrySink, v3, type V3 } from './solids3d'

const M = (metres: number) => metres * UNITS_PER_M

/** The BODY loft: nose into chassis into coke bottle, half-widths traced off NOSE_D / CHASSIS_D,
 *  tops authored. `top` and `bottom` in metres, `z` and `half` in sprite units. */
const BODY: Array<{ z: number; half: number; top: number }> = [
  { z: 8, half: 13, top: 0.24 },
  { z: 48, half: 14, top: 0.32 },
  { z: 110, half: 16, top: 0.44 },
  { z: 166, half: 25, top: 0.56 },
  { z: 202, half: 46, top: 0.62 },
  { z: 224, half: 70, top: 0.60 },
  { z: 290, half: 70, top: 0.55 },
  { z: 342, half: 52, top: 0.48 },
  { z: 380, half: 30, top: 0.45 },
  { z: 448, half: 28, top: 0.40 },
]
const BODY_BOTTOM = 0.06

/** The SPINE loft over the centre: cockpit surround, airbox, engine cover tapering to the tail. */
const SPINE: Array<{ z: number; half: number; top: number }> = [
  { z: 190, half: 17, top: 0.62 },
  { z: 226, half: 16, top: 0.70 },
  { z: 258, half: 13, top: 0.95 },
  { z: 300, half: 10, top: 0.82 },
  { z: 380, half: 8, top: 0.58 },
  { z: 446, half: 6, top: 0.44 },
]
const SPINE_BOTTOM = 0.30

/** How much of a station's half-width the flat top keeps; the rest chamfers down to the shoulder. */
const TOP_FRAC = 0.45
/** Shoulder height as a fraction of the station's top. */
const SHOULDER_FRAC = 0.6

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

/** One loft station's cross-section, bottom-left round to bottom-right. */
function section(s: { z: number; half: number; top: number }, bottomM: number): V3[] {
  const z = s.z - SPRITE.cy
  const top = M(s.top)
  const bottom = M(bottomM)
  const shoulder = bottom + (top - bottom) * SHOULDER_FRAC
  const t = s.half * TOP_FRAC
  return [
    v3(-s.half, bottom, z), v3(-s.half, shoulder, z), v3(-t, top, z),
    v3(t, top, z), v3(s.half, shoulder, z), v3(s.half, bottom, z),
  ]
}

/** Skin consecutive cross-sections, cap both ends. */
function loftGeometry(stations: Array<{ z: number; half: number; top: number }>, bottomM: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const rings = stations.map((st) => section(st, bottomM))
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    for (let k = 0; k + 1 < a.length; k++) s.quad(a[k], a[k + 1], b[k + 1], b[k])
    // The underside, closing the section loop.
    s.quad(a[a.length - 1], a[0], b[0], b[b.length - 1])
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

/** An axis-aligned box in sprite coordinates, y in metres. */
function box(s: GeometrySink, x0: number, x1: number, y0M: number, y1M: number, z0: number, z1: number) {
  const cx = SPRITE.cx
  const cz = SPRITE.cy
  const y0 = M(y0M)
  const y1 = M(y1M)
  const c = (x: number, y: number, z: number) => v3(x - cx, y, z - cz)
  s.quad(c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1))
  s.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1))
  s.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0))
  s.quad(c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1))
  s.quad(c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0))
  s.quad(c(x1, y0, z0), c(x1, y0, z1), c(x1, y1, z1), c(x1, y1, z0))
}

function mesh(geo: THREE.BufferGeometry, colour: string): THREE.Mesh {
  // DoubleSide: the sink's quads are wound by hand and a culled wing is a missing wing.
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** Thin members between two points: suspension arms, halo legs. */
function strut(a: V3, b: V3, radius: number, colour: string): THREE.Mesh {
  const from = new THREE.Vector3(a.x, a.y, a.z)
  const to = new THREE.Vector3(b.x, b.y, b.z)
  const geo = new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 5)
  const m = mesh(geo, colour)
  m.position.copy(from.clone().add(to).multiplyScalar(0.5))
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize())
  return m
}

export function buildCarMesh(colour: string): CarMesh {
  const group = new THREE.Group()
  const sec = shade(colour, 0.62)
  const cx = SPRITE.cx
  const cz = SPRITE.cy

  group.add(mesh(loftGeometry(BODY, BODY_BOTTOM), colour))
  group.add(mesh(loftGeometry(SPINE, SPINE_BOTTOM), sec))

  // Floor, proud of the body's sides the way the drawn floor peeks past the coke bottle.
  const floor = new GeometrySink()
  box(floor, 60, 180, 0.03, 0.05, 190, 458)
  group.add(mesh(floor.build(), FLOOR))

  // Front wing: the drawn stack of swept planes as thin plates climbing forward, then endplates.
  const wingF = [
    { x0: 30, x1: 210, z0: 42, z1: 52, y: 0.09, colour: sec },
    { x0: 36, x1: 204, z0: 31, z1: 41, y: 0.14, colour },
    { x0: 44, x1: 196, z0: 21, z1: 30, y: 0.19, colour: sec },
    { x0: 56, x1: 184, z0: 13, z1: 20, y: 0.24, colour: TERTIARY },
  ]
  for (const p of wingF) {
    const s = new GeometrySink()
    box(s, p.x0, p.x1, p.y, p.y + 0.02, p.z0, p.z1)
    group.add(mesh(s.build(), p.colour))
  }
  for (const x of [28, 208]) {
    const s = new GeometrySink()
    box(s, x, x + 4, 0.05, 0.28, 9, 52)
    group.add(mesh(s.build(), TERTIARY))
  }

  // Rear wing: beam low, mains high, endplates bridging them, one pylon on the spine.
  const wingR = [
    { x0: 44, x1: 196, z0: 446, z1: 453, y: 0.36, colour: TERTIARY },
    { x0: 44, x1: 196, z0: 453, z1: 464, y: 0.72, colour },
    { x0: 42, x1: 198, z0: 466, z1: 481, y: 0.80, colour: sec },
  ]
  for (const p of wingR) {
    const s = new GeometrySink()
    box(s, p.x0, p.x1, p.y, p.y + 0.025, p.z0, p.z1)
    group.add(mesh(s.build(), p.colour))
  }
  for (const x of [30, 196]) {
    const s = new GeometrySink()
    box(s, x, x + 14, 0.30, 0.92, 415, 490)
    group.add(mesh(s.build(), TERTIARY))
  }
  const pylon = new GeometrySink()
  box(pylon, 116, 124, 0.40, 0.72, 412, 452)
  group.add(mesh(pylon.build(), STRUCTURE))

  // Diffuser wedge under the tail.
  const diff = new GeometrySink()
  box(diff, 76, 164, 0.05, 0.18, 448, 468)
  group.add(mesh(diff.build(), CARBON))

  // Cockpit: halo hoop over the opening, helmet inside it, mirrors either side.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(16, 2.4, 6, 12, Math.PI),
    new THREE.MeshLambertMaterial({ color: TERTIARY, side: THREE.DoubleSide }),
  )
  halo.castShadow = true
  halo.geometry.rotateZ(Math.PI)
  halo.geometry.rotateX(Math.PI / 2 - 0.35)
  halo.position.set(0, M(0.72), 212 - cz)
  group.add(halo)
  group.add(strut(v3(0, M(0.62), 196 - cz), v3(0, M(0.80), 211 - cz), 1.6, TERTIARY))
  const helmet = mesh(new THREE.SphereGeometry(10, 10, 8), sec)
  helmet.position.set(0, M(0.66), 234 - cz)
  group.add(helmet)
  for (const x of [-30, 30]) {
    const s = new GeometrySink()
    box(s, cx + x - 6, cx + x + 6, 0.52, 0.56, 202, 208)
    group.add(mesh(s.build(), TERTIARY))
  }

  // Suspension: each corner's A-arms as paired struts from chassis shoulder to hub, carbon dark
  // because they hang over bare tarmac exactly as the sprite's do.
  for (const w of WHEELS) {
    const hub: V3 = v3(w.x * 0.82, M(0.34), w.z - cz)
    const spread = w.z < SPRITE.cy ? 34 : 30
    group.add(strut(v3(Math.sign(w.x) * 22, M(0.30), w.z - cz - spread), hub, 1.6, CARBON))
    group.add(strut(v3(Math.sign(w.x) * 22, M(0.30), w.z - cz + spread * 0.85), hub, 1.6, CARBON))
    group.add(strut(v3(Math.sign(w.x) * 24, M(0.20), w.z - cz), hub, 1.3, STRUCTURE))
  }

  // Wheels last, each in its own pivot group so steering and spin are plain rotations.
  const wheels = {} as CarMesh['wheels']
  for (const w of WHEELS) {
    const pivot = new THREE.Group()
    pivot.position.set(w.x, w.r, w.z - cz)
    const tyre = mesh(new THREE.CylinderGeometry(w.r, w.r, w.w, 14), TYRE)
    tyre.geometry.rotateZ(Math.PI / 2)
    pivot.add(tyre)
    const hub = mesh(new THREE.CylinderGeometry(w.r * 0.58, w.r * 0.58, w.w + 2, 10), HUB)
    hub.geometry.rotateZ(Math.PI / 2)
    pivot.add(hub)
    wheels[w.tag] = pivot
    group.add(pivot)
  }

  return { group, wheels }
}
