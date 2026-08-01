// The live car field as real solids (#3d-port increment 5): one lofted car per entrant, posed every
// frame by the same rAF loop that drove the SVG sprites, from the same numbers. What the sprite
// faked — the counter-rotated sheen, the displaced contact shadow, the body-slide roll and the
// foreshortening squash — has no code here at all: the sun, the shadow map and real rotations do
// those jobs. What it could never do arrives free: the wheels roll.

import * as THREE from 'three'
import { SPRITE } from '@/lib/ui/car-sprite'
import { buildCarMesh, type CarLivery, type CarMesh, type TyreCompound } from './car-mesh'

export interface CarPose {
  /** World position, viewBox units. */
  x: number
  y: number
  /** Sprite rotation: heading plus the artwork's quarter turn, exactly what the sprite div gets. */
  rot: number
  /** Front wheel lock in degrees, the numbers `steerAngles` hands the sprite. */
  steerLeft: number
  steerRight: number
  /** Normalised lap accelerations: +lat is a right-hander at the limit, -long is full braking. */
  lat: number
  long: number
  /** Arc travelled since the last pose, world units, for wheel spin. */
  ds: number
}

/** Body angles at the limit. Bolder than a real car's degree-or-two for the same reason every cue
 *  on this map is: at map scale the honest value does not exist. The whole car leans (the mesh has
 *  no chassis/wheel split yet), so these stay below where wheel float starts to read. */
const ROLL_MAX_RAD = (3.6 * Math.PI) / 180
const DIVE_MAX_RAD = (2.4 * Math.PI) / 180

const WHEEL_TAGS = ['fl', 'fr', 'rl', 'rr'] as const

/** How far above the GROUND PLANE the cars ride, in metres: just over the painter stack's top, so
 *  no part of the car (the front wing under brake dive, the tyres' lower halves) is ever below the
 *  road sheets and silently depth-buried by them. The float above the drawn tarmac surface is a few
 *  centimetres, unreadable from any camera the map has. */
export const CAR_RIDE_M = 0.2

interface Entry {
  key: string
  mesh: CarMesh
  wrap: THREE.Group
  /** Accumulated spin per wheel, radians. */
  spun: Record<(typeof WHEEL_TAGS)[number], number>
}

function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      ;(o.geometry as THREE.BufferGeometry).dispose()
      const m = o.material
      for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
    }
  })
}

export class CarField3D {
  readonly group = new THREE.Group()
  private entries = new Map<string, Entry>()

  /** `scaleUnits`: world units per sprite unit, the circuit's own car scale. `rideY`: the ride
   *  height in WORLD units, `CAR_RIDE_M` through the circuit's metres-per-unit. */
  constructor(private scaleUnits: number, private rideY = 0) {}

  /** Build (or rebuild, on a livery or compound change) the car for an entrant. */
  ensure(id: string, livery: CarLivery, compound: TyreCompound = 'medium'): void {
    const key = `${typeof livery === 'string' ? livery : JSON.stringify(livery)}@${compound}`
    const current = this.entries.get(id)
    if (current?.key === key) return
    if (current) this.drop(id)
    const mesh = buildCarMesh(livery, compound)
    const wrap = new THREE.Group()
    wrap.scale.setScalar(this.scaleUnits)
    // Heading about y, then roll about the car's own length, then dive about its axle line.
    wrap.rotation.order = 'YZX'
    wrap.add(mesh.group)
    this.group.add(wrap)
    this.entries.set(id, { key, mesh, wrap, spun: { fl: 0, fr: 0, rl: 0, rr: 0 } })
  }

  drop(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.group.remove(entry.wrap)
    disposeDeep(entry.wrap)
    this.entries.delete(id)
  }

  /** Drop every car not in the live set: entrants leave between races, not mid-frame. */
  sweep(liveIds: ReadonlySet<string>): void {
    for (const id of [...this.entries.keys()]) {
      if (!liveIds.has(id)) this.drop(id)
    }
  }

  pose(id: string, p: CarPose): void {
    const e = this.entries.get(id)
    if (!e) return
    e.wrap.position.set(p.x, this.rideY, p.y)
    e.wrap.rotation.y = -p.rot
    // A car leans AWAY from the corner and dips its nose under the brakes, the same signs the
    // sprite's slide encoded.
    e.wrap.rotation.z = -p.lat * ROLL_MAX_RAD
    e.wrap.rotation.x = p.long * DIVE_MAX_RAD
    e.mesh.wheels.fl.rotation.y = -(p.steerLeft * Math.PI) / 180
    e.mesh.wheels.fr.rotation.y = -(p.steerRight * Math.PI) / 180
    if (p.ds > 0) {
      const dsSprite = p.ds / this.scaleUnits
      for (const tag of WHEEL_TAGS) {
        // The steering pivot sits at hub height, which IS the rolling radius.
        const r = e.mesh.wheels[tag].position.y || 1
        e.spun[tag] = (e.spun[tag] - dsSprite / r) % (Math.PI * 2)
        e.mesh.spin[tag].rotation.x = e.spun[tag]
      }
    }
  }

  /** The pit choreography's invisible swap: the crew's tyre props take over from the car's wheels. */
  setWheelsVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id)
    if (!e) return
    for (const tag of WHEEL_TAGS) e.mesh.wheels[tag].visible = visible
  }

  /** Retired cars fade exactly as their DOM markers did. */
  setOpacity(id: string, opacity: number): void {
    const e = this.entries.get(id)
    if (!e) return
    e.wrap.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.Material
        m.transparent = opacity < 1
        m.opacity = opacity
      }
    })
  }

  dispose(): void {
    this.sweep(new Set())
  }
}

/** World units per sprite unit for a circuit: the same footprint the DOM sprite renders at. */
export function carScaleUnits(metresPerUnit: number, carLengthM: number): number {
  return carLengthM / metresPerUnit / SPRITE.len
}
