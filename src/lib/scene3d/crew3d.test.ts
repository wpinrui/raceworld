import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { WHEELS } from './car-mesh'
import { PitCrew3D } from './crew3d'

const u = (m: number) => m / 2 // a 2 metres-per-unit circuit
const slots = [
  { x: 100, y: 50, nx: 0, ny: 1, rot: 0.4 },
  { x: 120, y: 50, nx: 0, ny: 1, rot: 0.4 },
]
const crew = new PitCrew3D({ slots, u, colors: ['#E8442E', '#2F7BE8'], carScale: 0.005, rideY: 0.1 })

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
    const inner = (crew.group.children[0] as THREE.Group).children[0] as THREE.Group
    const crewGroup = inner.children[0] as THREE.Group
    const lolli = crewGroup.children.find((o) =>
      o.children.some((c2) => c2 instanceof THREE.Mesh
        && (c2.geometry as THREE.BufferGeometry).type === 'CapsuleGeometry')
      && o.children.length === 3)!
    expect(lolli.position.x).toBeCloseTo(u(4.35), 10)
    expect(lolli.position.z).toBe(0)
  })

  it('mirrors a flipped box across the lane exactly as the SVG inner did', () => {
    crew.setFlip(0, -1)
    const inner = (crew.group.children[0] as THREE.Group).children[0] as THREE.Group
    expect(inner.scale.z).toBe(-1)
    crew.setFlip(0, 1)
  })

  it('cuts the tyre props from the car wheel table and seats them at hub height', () => {
    // Fronts on corners 0/2, rears on 1/3; centre height = ride + radius, the ridden hub.
    crew.setPart(0, 'oldT0', 0, 0)
    crew.setPartVisible(0, 'oldT0', true)
    const inner = (crew.group.children[0] as THREE.Group).children[0] as THREE.Group
    const crewGroup = inner.children[0] as THREE.Group
    const props = crewGroup.children.filter((o) => o.visible
      && o.children.some((c2) => c2 instanceof THREE.Mesh
        && (c2.geometry as THREE.BufferGeometry).type === 'CylinderGeometry'))
    expect(props.length).toBeGreaterThan(0)
    expect(props[0].position.y).toBeCloseTo(0.1 + WHEELS[0].r * 0.005, 10)
    crew.setPartVisible(0, 'oldT0', false)
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

  it('shows and hides a crew whole', () => {
    crew.setRootVisible(1, true)
    const inner = (crew.group.children[1] as THREE.Group).children[0] as THREE.Group
    expect((inner.children[0] as THREE.Group).visible).toBe(true)
    crew.setRootVisible(1, false)
    expect((inner.children[0] as THREE.Group).visible).toBe(false)
  })
})
