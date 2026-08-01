import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { WHEELS } from './car-mesh'
import { PitCrew3D } from './crew3d'
import { RUBBER } from './rubber3d'

const u = (m: number) => m / 2 // a 2 metres-per-unit circuit
const slots = [
  { x: 100, y: 50, nx: 0, ny: 1, rot: 0.4 },
  { x: 120, y: 50, nx: 0, ny: 1, rot: 0.4 },
]
const crew = new PitCrew3D({ slots, u, colors: ['#E8442E', '#2F7BE8'], carScale: 0.005, rideY: 0.1 })

/** The slot's inner (flipped) group, and the crew group inside it: the crew is the inner's one
 *  GROUP child, everything else is the box's static furniture. */
const innerOf = (si: number) => (crew.group.children[si] as THREE.Group).children[0] as THREE.Group
const crewOf = (si: number) =>
  innerOf(si).children.find((o): o is THREE.Group => o instanceof THREE.Group)!

describe('PitCrew3D', () => {
  it('builds every role the choreography addresses, per slot', () => {
    expect(crew.slotCount).toBe(2)
    const roles = ['jack0', 'jack1', 'lolli',
      ...[0, 1, 2, 3].flatMap((c) => [`gun${c}`, `handA${c}`, `handB${c}`, `oldT${c}`, `newT${c}`])]
    for (const role of roles) {
      // A missed role would silently no-op the write, which is exactly how parts go still.
      crew.setPart(0, role, 1, 2)
    }
    const root = crew.group.children[0] as THREE.Group
    expect(root.position.x).toBe(100)
    expect(root.rotation.y).toBeCloseTo(-0.4, 10)
  })

  it('takes the choreography numbers in slot-local metres and lands them in units', () => {
    crew.setPart(0, 'lolli', 4.35, 0)
    const lolli = crewOf(0).children.find((o) =>
      o.children.some((c2) => c2 instanceof THREE.Mesh
        && (c2.geometry as THREE.BufferGeometry).type === 'CapsuleGeometry')
      && o.children.length === 3)!
    expect(lolli.position.x).toBeCloseTo(u(4.35), 10)
    expect(lolli.position.z).toBe(0)
  })

  it('mirrors a flipped box across the lane exactly as the SVG inner did', () => {
    crew.setFlip(0, -1)
    expect(innerOf(0).scale.z).toBe(-1)
    crew.setFlip(0, 1)
  })

  it('builds the box furniture beside the crew: pad, markings, and shadow-casting booms', () => {
    const furniture = innerOf(0).children.filter((o) => o instanceof THREE.Mesh)
    // Pad + markings + two gantry booms with their bright caps.
    expect(furniture).toHaveLength(6)
    const booms = furniture.filter((o) => o.castShadow)
    expect(booms).toHaveLength(2)
    expect(booms[0].position.y).toBeGreaterThan(u(2.2))
    const pad = furniture.find((o) => (
      (o as THREE.Mesh).material as THREE.MeshLambertMaterial).opacity === 0.45)!
    expect(((pad as THREE.Mesh).material as THREE.MeshLambertMaterial).transparent).toBe(true)
    // Over the whole ink decal range, under the fences: later-ordered depthless decals paint over
    // earlier ones whatever their height, and the road's grime sits in the same square metres.
    expect(pad.renderOrder).toBe(900)
  })

  it('cuts the tyre props from the car wheel table and seats them at hub height', () => {
    // Fronts on corners 0/2, rears on 1/3; centre height = ride + radius, the ridden hub.
    crew.setPart(0, 'oldT0', 0, 0)
    crew.setPartVisible(0, 'oldT0', true)
    const props = crewOf(0).children.filter((o) => o.visible
      && o.children.some((c2) => c2 instanceof THREE.Mesh
        && (c2.geometry as THREE.BufferGeometry).type === 'CylinderGeometry'))
    expect(props.length).toBeGreaterThan(0)
    expect(props[0].position.y).toBeCloseTo(0.1 + WHEELS[0].r * 0.005, 10)
    crew.setPartVisible(0, 'oldT0', false)
  })

  it('cuts them from the car\'s own rubber too, tread split from sidewall', () => {
    // A prop is handled at arm's length in front of the camera for the length of a stop, and it is
    // about to be bolted onto a wheel that HAS the split. One averaged black here undoes it.
    const props: THREE.Mesh[] = []
    crew.group.traverse((o) => {
      if (o instanceof THREE.Mesh && Array.isArray(o.material)) props.push(o)
    })
    // Two slots, four corners, an old tyre and a new one.
    expect(props).toHaveLength(2 * 4 * 2)
    // A cylinder's own material groups are the barrel then the two caps, which is exactly tread
    // then sidewalls: the split costs no second mesh.
    const [tread, ...walls] = props[0].material as THREE.MeshStandardMaterial[]
    expect(tread.roughness).toBe(RUBBER.treadRough)
    expect(walls).toHaveLength(2)
    for (const wall of walls) expect(wall.roughness).toBe(RUBBER.wallRough)
    // And the caps carry the shade their material reads, or they render black rather than matte.
    expect(props[0].geometry.getAttribute('color')).toBeDefined()
  })

  it('recolours a corner pair of sidewall bands for the stop', () => {
    crew.setBands(0, 2, '#111111', '#222222')
    const colours = new Set<string>()
    crew.group.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.geometry as THREE.BufferGeometry).type === 'RingGeometry') {
        colours.add('#' + (o.material as THREE.MeshLambertMaterial).color.getHexString())
      }
    })
    expect(colours).toContain('#111111')
    expect(colours).toContain('#222222')
  })

  it('shows and hides a crew whole, leaving the box furniture standing', () => {
    crew.setRootVisible(1, true)
    expect(crewOf(1).visible).toBe(true)
    crew.setRootVisible(1, false)
    expect(crewOf(1).visible).toBe(false)
    expect(innerOf(1).children.filter((o) => o instanceof THREE.Mesh).every((o) => o.visible)).toBe(true)
  })
})
