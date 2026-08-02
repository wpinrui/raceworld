// The live car field as real solids (#3d-port increment 5): one lofted car per entrant, posed every
// frame by the same rAF loop that drove the SVG sprites, from the same numbers. What the sprite
// faked — the counter-rotated sheen, the displaced contact shadow, the body-slide roll and the
// foreshortening squash — has no code here at all: the sun, the shadow map and real rotations do
// those jobs. What it could never do arrives free: the wheels roll.

import * as THREE from 'three'
import { SPRITE } from '@/lib/ui/car-sprite'
import {
  CAR_TIERS, buildCarFrom, type CarLivery, type CarMesh, type TyreCompound,
} from './car-mesh'
import { ContactShadows } from './contact3d'

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
  /** Ground height under the car in world units, for the day the track gains elevation: sample the
   *  same profile the road is built from (`gradeToTrack` already computes it) at the car's arc
   *  position and hand it here. Absent, the world is flat. */
  ground?: number
}

/** Body angles at the limit, at REAL F1 stiffness. The 2D exaggerated its cues because a top-down
 *  view could not show honest ones; a perspective camera at wing height can, and an F1 car barely
 *  moves: a degree of roll at full lateral load, under a degree of dive on the brakes. Only the
 *  CHASSIS takes them; the wheels stay planted. */
const ROLL_MAX_RAD = (1.3 * Math.PI) / 180
const DIVE_MAX_RAD = (0.8 * Math.PI) / 180

const WHEEL_TAGS = ['fl', 'fr', 'rl', 'rr'] as const

/** How far above the GROUND PLANE the cars ride, in metres: just over the painter stack's top, so
 *  no part of the car (the front wing under brake dive, the tyres' lower halves) is ever below the
 *  road sheets and silently depth-buried by them. The stack itself is millimetres now, so the tyres
 *  sit a centimetre off the drawn tarmac: planted, even from the near-flat camera that exposed the
 *  old 20cm hover by its tyre-to-shadow gap. */
export const CAR_RIDE_M = 0.03

interface Entry {
  key: string
  /** EVERY rung, built with the car and kept. Crossing a zoom band is then a visibility swap.
   *
   *  Built up front rather than on demand, and the difference matters more than it sounds. Rebuilding
   *  per crossing stalled the zoom outright. Building on FIRST demand only moves that stall to the
   *  first time the player crosses each band, which is the same bug wearing a delay: the cost still
   *  lands mid-gesture, just once per rung.
   *
   *  Measured, per car: 41 ms at rung 0, then 31, 20, 8.5, 0.3, so 101 ms for the set and about two
   *  seconds for a twenty-car field. That is paid at race load, beside a world build that is already
   *  happening, instead of in the middle of a camera move. */
  tiers: Map<number, CarMesh>
  /** The rung currently shown, which is the one `pose` drives. */
  mesh: CarMesh
  wrap: THREE.Group
  /** The car's contact occlusion, absent where no canvas could generate one. Held out of the
   *  wrap's material walk: see `setOpacity`. */
  contact: THREE.Mesh | null
  /** Accumulated spin per wheel, radians. */
  spun: Record<(typeof WHEEL_TAGS)[number], number>
  /** What this car was built FROM, so a detail change can rebuild it without the caller re-supplying
   *  what it already said once. */
  livery: CarLivery
  compound: TyreCompound
  /** The last pose, opacity and wheel state, re-applied over a rebuild. A car that blinked back to
   *  the origin, fully opaque, with its wheels back on, every time the camera crossed a detail
   *  threshold would be a worse bug than the draw calls the threshold exists to save. */
  last: CarPose | null
  opacity: number
  wheels: boolean
}

function disposeDeep(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      // Geometry cloned from a blank borrows every attribute but its colour, so freeing it here
      // would take the shape off every other car cut from the same blank. The blank owns those
      // buffers and frees them with the field.
      const geo = o.geometry as THREE.BufferGeometry
      if (!geo.userData.fromBlank) geo.dispose()
      const m = o.material
      // Shared finishes belong to the FIELD, not to this car: twenty cars bind the same carbon now
      // that colour rides on the vertices, and freeing it here would strip the paint off the other
      // nineteen the moment one retired. The field frees them when the field goes.
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (!mat.userData.shared) mat.dispose()
      }
    }
  })
}

export class CarField3D {
  /** The cars sit out the ambient occlusion pass.
   *
   *  Screen-space AO cannot tell a crease that should hold dirt from a panel gap that should hold a
   *  highlight, so it darkens every seam on a lofted body indiscriminately. On car paint that is
   *  worse than nothing: the finish is carried by the clear coat's reflection of the environment,
   *  and multiplying an occlusion term into it dulls exactly the surfaces the two-lobe material
   *  exists to make shine. A car's own contact shadow comes from the shadow map, which is the right
   *  tool for it. */
  readonly group = Object.assign(new THREE.Group(), { name: 'cars', userData: { noAO: true } })
  private entries = new Map<string, Entry>()
  /** One texture and geometry for the whole field, one material per car. */
  private shadows = new ContactShadows()

  /** `scaleUnits`: world units per sprite unit, the circuit's own car scale. `rideY`: the ride
   *  height in WORLD units, `CAR_RIDE_M` through the circuit's metres-per-unit. */
  constructor(private scaleUnits: number, private rideY = 0) {}

  /** The detail rung every car in the field is currently built at. */
  private tier = 0
  /** One finish per (material, tier) across the whole field, shared by every car that wears it. */
  private finishes = new Map<string, THREE.Material>()
  /** One blank per (compound, rung), which every car in that combination is cloned and repainted
   *  from. A car's geometry does not depend on its livery, so building it per car was building the
   *  same solids twenty times: 2021 ms for a field's whole ladder against 186 ms this way. */
  private blanks = new Map<string, CarMesh>()

  /** Build (or rebuild, on a livery or compound change) the car for an entrant. */
  ensure(id: string, livery: CarLivery, compound: TyreCompound = 'medium'): void {
    const key = `${typeof livery === 'string' ? livery : JSON.stringify(livery)}@${compound}`
    const current = this.entries.get(id)
    if (current?.key === key) {
      this.showTier(current)
      return
    }
    const carry = current
      ? { last: current.last, opacity: current.opacity, wheels: current.wheels }
      : { last: null, opacity: 1, wheels: true }
    if (current) this.drop(id)
    const wrap = new THREE.Group()
    wrap.scale.setScalar(this.scaleUnits)
    // On the WRAP, so it takes the car's position and heading but none of its roll or dive: the
    // patch lies on the road, and the road does not lean into the corner with the bodywork.
    const contact = this.shadows.create()
    if (contact) wrap.add(contact)
    this.group.add(wrap)
    const entry: Entry = {
      key, tiers: new Map(), mesh: undefined as unknown as CarMesh, wrap, contact,
      spun: { fl: 0, fr: 0, rl: 0, rr: 0 }, livery, compound, ...carry,
    }
    this.entries.set(id, entry)
    // Every rung, now, while the field is being assembled. See `Entry.tiers`.
    for (let t = 0; t < CAR_TIERS.length; t++) this.buildTier(entry, t)
    this.showTier(entry)
    if (carry.last) this.pose(id, carry.last)
    if (carry.opacity !== 1) this.setOpacity(id, carry.opacity)
    if (!carry.wheels) this.setWheelsVisible(id, false)
  }

  /** Build one rung and park it, hidden, on the car's wrap. */
  private buildTier(e: Entry, tier: number): CarMesh {
    const held = e.tiers.get(tier)
    if (held) return held
    const made = buildCarFrom(this.blanks, e.livery, e.compound, tier, this.finishes)
    made.group.visible = false
    e.tiers.set(tier, made)
    e.wrap.add(made.group)
    return made
  }

  /** Put this car on the field's current rung. Every rung already exists by the time this runs. */
  private showTier(e: Entry): void {
    const next = this.buildTier(e, this.tier)
    if (e.mesh === next) return
    if (e.mesh) e.mesh.group.visible = false
    next.group.visible = true
    e.mesh = next
    // The new rung is a fresh set of pivots, so everything the old one was holding has to be put on
    // it: a car that switched rung mid-corner would otherwise snap its wheels straight and its body
    // level until the next pose arrived.
    if (e.last) this.pose(this.idOf(e), e.last)
    for (const tag of WHEEL_TAGS) next.spin[tag].rotation.x = e.spun[tag]
    this.setWheelsVisible(this.idOf(e), e.wheels)
    if (e.opacity !== 1) this.setOpacity(this.idOf(e), e.opacity)
  }

  private idOf(entry: Entry): string {
    for (const [id, e] of this.entries) if (e === entry) return id
    return ''
  }

  /** Pick the detail tier for a car this many PIXELS long on screen, rebuilding the field if that
   *  moves it (`CAR_TIERS`).
   *
   *  The ladder has been in `car-mesh` since the car was modelled, with thresholds authored against
   *  what each rung still shows, and nothing ever called it: the live field built tier 0 whatever the
   *  zoom, so a grid of twenty cars four centimetres long on screen was carrying full cockpits and
   *  suspension linkage. Measured on one car, tier 0 is 56,550 triangles and tier 2 is 28,664.
   *
   *  Rebuilds rather than holding every rung: five built tiers per car is five times the build and
   *  the memory for rungs a given race may never visit. The cost is a hitch when the zoom crosses a
   *  threshold, which is a deliberate camera move rather than something that happens mid-corner. */
  setDetail(pxLength: number): void {
    let next = CAR_TIERS.length - 1
    for (let t = 0; t < CAR_TIERS.length; t++) {
      if (pxLength >= CAR_TIERS[t].minPx) { next = t; break }
    }
    if (next === this.tier) return
    this.tier = next
    for (const e of this.entries.values()) this.showTier(e)
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
    e.last = p
    e.wrap.position.set(p.x, (p.ground ?? 0) + this.rideY, p.y)
    e.wrap.rotation.y = -p.rot
    // A car leans AWAY from the corner and dips its nose under the brakes, the same signs the
    // sprite's slide encoded: on the CHASSIS only, over wheels that never leave the road.
    e.mesh.chassis.rotation.z = -p.lat * ROLL_MAX_RAD
    e.mesh.chassis.rotation.x = p.long * DIVE_MAX_RAD
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
    e.wheels = visible
    for (const tag of WHEEL_TAGS) e.mesh.wheels[tag].visible = visible
  }

  /** Retired cars fade exactly as their DOM markers did. */
  setOpacity(id: string, opacity: number): void {
    const e = this.entries.get(id)
    if (!e) return
    e.opacity = opacity
    e.wrap.traverse((o) => {
      // The contact patch is skipped deliberately. This walk turns `transparent` OFF at full
      // opacity, which for a patch that is nothing BUT its alpha would draw a solid black rectangle
      // under every car on the grid. It fades below, on its own terms.
      if (o instanceof THREE.Mesh && o !== e.contact) {
        const m = o.material as THREE.Material
        m.transparent = opacity < 1
        m.opacity = opacity
      }
    })
    if (e.contact) (e.contact.material as THREE.Material).opacity = opacity
  }

  dispose(): void {
    this.sweep(new Set())
    this.shadows.dispose()
    // The shared finishes, which no car frees because no car owns one.
    for (const mat of this.finishes.values()) mat.dispose()
    this.finishes.clear()
    // The blanks are never mounted, so nothing else can be holding one.
    for (const blank of this.blanks.values()) disposeDeep(blank.group)
    this.blanks.clear()
  }
}

/** World units per sprite unit for a circuit: the same footprint the DOM sprite renders at. */
export function carScaleUnits(metresPerUnit: number, carLengthM: number): number {
  return carLengthM / metresPerUnit / SPRITE.len
}
