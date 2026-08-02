// The pit boxes and their crews in-scene (#3d-port increment 5): the same choreography, real people
// and props. The rAF state machine in RaceTrackMap is untouched — it computes slot-local METRES
// exactly as it did for the SVG crew, and this manager is the surface those numbers land on now.
// What changes is only what the numbers move: capsule people in team colours, a lollipop with a real
// pole, and tyre props cut from the car's own wheel table, so the invisible swap at the hub matches
// by construction. The box's static furniture (work pad, markings, gantry) lives here too: as DOM it
// floated ABOVE the GL cars, a translucent film the car drove under.

import * as THREE from 'three'
import type { PitSlot } from '@/lib/ui/pit-zone'
import { WHEELS } from './car-mesh'
import { scaleUV } from './detail3d'
import { DECAL_PULL, ROUGH, surface } from './materials3d'
import { FLAT_GROUND, type Ground } from './terrain3d'
import { grainTile, radialShade, treadSurface, wallSurface } from './rubber3d'
import { GeometrySink, v3 } from './solids3d'

/** Underside of the overhead gantry booms. Low: they clear a crew member's head and no more. */
export const GANTRY_H_M = 2.2
/** Boom length: back to the building's front face, with a few centimetres of overlap. */
export const GANTRY_REACH_M = 4.75

const STEEL = '#8B929E'
const GUN = '#5E6673'
const LOLLI_DISC = '#E8C33A'
const RIM = '#2E3138'
const PAD = '#3C434F'
const MARK = '#E8C33A'
/** Gantry steel. NOT the SVG's near-tarmac dark: from straight above a boom is a strip lying on the
 *  grimed apron, and at 6 counts off the asphalt it read as three stains splitting the box. Lit
 *  steel with a bright cap reads as a beam standing over it. */
const BOOM = '#5E6673'
const BOOM_CAP = '#8B929E'
/** The pad and markings ride just over the whole road stack, just under the cars' clearance. */
const PAD_M = 0.027
const MARK_M = 0.028
/** A crew member, bold like everything at map scale: radius off the SVG's drawn discs. */
const PERSON_R_M = 0.34
const PERSON_H_M = 1.6

interface Slot3D {
  inner: THREE.Group
  crew: THREE.Group
  parts: Map<string, THREE.Object3D>
  /** Sidewall band materials per tyre prop role (`oldT0`...), for the compound recolour. */
  bands: Map<string, THREE.MeshStandardMaterial>
}

export interface PitCrew3DInput {
  slots: PitSlot[]
  u: (m: number) => number
  /** Team colour per garage index. */
  colors: string[]
  /** World units per sprite unit: the car scale, which is also the tyre props' scale. */
  carScale: number
  /** The cars' ride height in world units; a prop seated on a hub must sit at hub height. */
  rideY: number
  /** The paddock each box stands on. Absent, the world is flat. */
  ground?: Ground
}

export class PitCrew3D {
  readonly group = new THREE.Group()
  private slots3d: Slot3D[] = []
  private u: (m: number) => number

  constructor({ slots, u, colors, carScale, rideY, ground = FLAT_GROUND }: PitCrew3DInput) {
    this.u = u
    const personGeo = new THREE.CapsuleGeometry(u(PERSON_R_M), u(PERSON_H_M - 2 * PERSON_R_M), 3, 8)
    const person = (colour: string): THREE.Mesh => {
      const m = new THREE.Mesh(personGeo, surface(colour, { roughness: ROUGH.chalk }))
      m.position.y = u(PERSON_H_M) / 2
      m.castShadow = true
      return m
    }
    const box = (w: number, h: number, d: number, colour: string): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d), surface(colour, { roughness: ROUGH.chalk }),
      )
      m.castShadow = true
      return m
    }

    slots.forEach((s, i) => {
      const root = new THREE.Group()
      root.position.set(s.x, ground(s.x, s.y), s.y)
      root.rotation.y = -s.rot
      const inner = new THREE.Group()
      root.add(inner)

      // The static furniture: work pad, broadcast markings, and the overhead gantry, which now
      // throws its shadow from the actual sun instead of carrying a painted one.
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(u(6.9), u(3.8)).rotateX(-Math.PI / 2),
        surface(PAD, { alpha: 0.45, layer: DECAL_PULL, roughness: ROUGH.matte }),
      )
      // Above every road decal's renderOrder (the ink stack numbers into the low hundreds on a busy
      // circuit and a LATER decal paints over an EARLIER one regardless of height, since none of
      // them writes depth), below the fences at 1000.
      pad.position.set(u(0.25), u(PAD_M), 0)
      pad.renderOrder = 900
      pad.receiveShadow = true
      inner.add(pad)
      const marks = new GeometrySink()
      const flat = (x0: number, z0: number, w: number, d: number) => marks.quad(
        v3(u(x0), u(MARK_M), u(z0)), v3(u(x0 + w), u(MARK_M), u(z0)),
        v3(u(x0 + w), u(MARK_M), u(z0 + d)), v3(u(x0), u(MARK_M), u(z0 + d)),
      )
      for (const sy of [1, -1]) {
        flat(-3, sy * 1.62 - 0.07, 6, 0.14)
        for (const tx of [-3, 0, 3]) flat(tx - 0.07, sy > 0 ? 1.62 : -1.62 - 0.55, 0.14, 0.55)
      }
      for (const ax of [-4.7, 3.2]) {
        flat(ax, -0.07, 1.5, 0.14)
        marks.tri(
          v3(u(ax + 1.15), u(MARK_M), u(-0.35)), v3(u(ax + 1.55), u(MARK_M), 0),
          v3(u(ax + 1.15), u(MARK_M), u(0.35)),
        )
      }
      const marksMesh = new THREE.Mesh(
        marks.build(), surface(MARK, { alpha: 0.95, layer: DECAL_PULL, roughness: ROUGH.matte }),
      )
      marksMesh.renderOrder = 901
      inner.add(marksMesh)
      for (const bx of [1.5, -1.5]) {
        const boom = new THREE.Mesh(
          new THREE.BoxGeometry(u(0.6), u(0.25), u(GANTRY_REACH_M)),
          surface(BOOM, { roughness: ROUGH.paint }),
        )
        boom.position.set(u(bx), u(GANTRY_H_M + 0.125), u(-1.5 + GANTRY_REACH_M / 2))
        boom.castShadow = true
        boom.receiveShadow = true
        inner.add(boom)
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(u(0.24), u(0.05), u(GANTRY_REACH_M)),
          surface(BOOM_CAP, { roughness: ROUGH.paint }),
        )
        cap.position.set(u(bx), u(GANTRY_H_M + 0.275), u(-1.5 + GANTRY_REACH_M / 2))
        inner.add(cap)
      }

      const crew = new THREE.Group()
      crew.visible = false
      inner.add(crew)
      const parts = new Map<string, THREE.Object3D>()
      const bands = new Map<string, THREE.MeshStandardMaterial>()
      const colour = colors[i] ?? '#9AA3B2'
      const add = (role: string, part: THREE.Group) => {
        parts.set(role, part)
        crew.add(part)
      }

      for (const j of [0, 1] as const) {
        const jack = new THREE.Group()
        jack.add(person(colour))
        const handle = box(this.u(0.85), this.u(0.12), this.u(0.2), STEEL)
        handle.position.set((j === 0 ? 1 : -1) * this.u(0.425), this.u(0.3), 0)
        jack.add(handle)
        add(`jack${j}`, jack)
      }
      for (let c = 0; c < 4; c++) {
        const gun = new THREE.Group()
        gun.add(person(colour))
        const tool = box(this.u(0.18), this.u(0.18), this.u(0.34), GUN)
        // Held toward the hub: the SVG drew it on the wheel side of the member.
        tool.position.set(0, this.u(0.9), -this.u(0.42))
        gun.add(tool)
        add(`gun${c}`, gun)
        const handA = new THREE.Group()
        handA.add(person(colour))
        add(`handA${c}`, handA)
        const handB = new THREE.Group()
        handB.add(person(colour))
        add(`handB${c}`, handB)

        // The props: the car's own wheel, upright with its axis across the box, the orientation a
        // parked car's wheels have. Corners 0/2 are the front axle.
        const dims = WHEELS[c === 0 || c === 2 ? 0 : 2]
        const r = dims.r * carScale
        const w = dims.w * carScale
        for (const kind of ['oldT', 'newT'] as const) {
          const prop = new THREE.Group()
          const tyreGeo = new THREE.CylinderGeometry(r, r, w, 14)
          // The same two rubbers the car's own wheels wear (`rubber3d`), and a cylinder splits them
          // for free: its own material groups are the barrel, then the two end caps, which is
          // exactly tread and sidewalls. A prop is handled at arm's length in front of the camera
          // for the length of a stop, so a wheel that is one averaged black here undoes the split on
          // the car it is about to be bolted to.
          const tile = grainTile(this.u(1))
          if (tile > 0) scaleUV(tyreGeo, (2 * Math.PI * r) / tile, w / tile)
          radialShade(tyreGeo, r * 0.58)
          tyreGeo.rotateX(Math.PI / 2)
          const tyre = new THREE.Mesh(tyreGeo, [treadSurface(), wallSurface(), wallSurface()])
          tyre.castShadow = true
          prop.add(tyre)
          const rimGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + this.u(0.02), 10)
          rimGeo.rotateX(Math.PI / 2)
          prop.add(new THREE.Mesh(rimGeo, surface(RIM, { roughness: ROUGH.gloss, metalness: 1 })))
          // The compound band, one ring per sidewall, recoloured when the stop's tyres are known.
          const bandMat = surface('#FFD700', { roughness: ROUGH.paint })
          for (const sign of [-1, 1]) {
            const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.72, r * 0.9, 14), bandMat)
            ring.position.z = (sign * (w + this.u(0.03))) / 2
            prop.add(ring)
          }
          bands.set(`${kind}${c}`, bandMat)
          // Seated on a hub the prop must match the ridden car's wheel centre exactly.
          prop.position.y = rideY + r
          prop.visible = false
          parts.set(`${kind}${c}`, prop)
          crew.add(prop)
        }
      }
      const lolli = new THREE.Group()
      lolli.add(person(colour))
      const pole = box(this.u(0.08), this.u(1.9), this.u(0.08), STEEL)
      pole.position.set(this.u(0.3), this.u(0.95), 0)
      lolli.add(pole)
      const discGeo = new THREE.CylinderGeometry(this.u(0.27), this.u(0.27), this.u(0.04), 12)
      const disc = new THREE.Mesh(discGeo, surface(LOLLI_DISC, { roughness: ROUGH.paint }))
      disc.position.set(this.u(0.3), this.u(1.92), 0)
      lolli.add(disc)
      add('lolli', lolli)

      this.slots3d[i] = { inner, crew, parts, bands }
      this.group.add(root)
    })
  }

  /** Which way the box is mirrored, measured by the layout pass exactly as the SVG inner was. */
  setFlip(si: number, flip: number): void {
    const s = this.slots3d[si]
    if (s) s.inner.scale.z = flip
  }

  setRootVisible(si: number, visible: boolean): void {
    const s = this.slots3d[si]
    if (s) s.crew.visible = visible
  }

  /** One choreography write: slot-local METRES, the same numbers the SVG transform carried. */
  setPart(si: number, role: string, xM: number, yM: number): void {
    const part = this.slots3d[si]?.parts.get(role)
    if (part) {
      part.position.x = this.u(xM)
      part.position.z = this.u(yM)
    }
  }

  setPartVisible(si: number, role: string, visible: boolean): void {
    const part = this.slots3d[si]?.parts.get(role)
    if (part) part.visible = visible
  }

  /** Latch the stop's compound colours onto a corner's two props. */
  setBands(si: number, corner: number, oldColour: string, newColour: string): void {
    const s = this.slots3d[si]
    s?.bands.get(`oldT${corner}`)?.color.set(oldColour)
    s?.bands.get(`newT${corner}`)?.color.set(newColour)
  }

  get slotCount(): number {
    return this.slots3d.length
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        ;(o.geometry as THREE.BufferGeometry).dispose()
        const m = o.material
        for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
      }
    })
    this.group.clear()
    this.slots3d = []
  }
}
