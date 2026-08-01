import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CarField3D } from './car-field3d'

describe('CarField3D', () => {
  it('builds a car per entrant at the circuit scale and rebuilds only on a livery or compound change', () => {
    const field = new CarField3D(0.01)
    field.ensure('a', '#E8442E', 'soft')
    expect(field.group.children).toHaveLength(1)
    const wrap = field.group.children[0]
    expect(wrap.scale.x).toBeCloseTo(0.01, 10)
    field.ensure('a', '#E8442E', 'soft')
    expect(field.group.children[0]).toBe(wrap)
    field.ensure('a', '#E8442E', 'wet')
    expect(field.group.children[0]).not.toBe(wrap)
    field.dispose()
  })

  it('poses in world units: position, heading, lock in degrees, lean and dive as real rotations', () => {
    const field = new CarField3D(0.01)
    field.ensure('a', '#E8442E')
    field.pose('a', {
      x: 120, y: 340, rot: 1.2, steerLeft: 10, steerRight: 12, lat: 1, long: -1, ds: 0,
    })
    const wrap = field.group.children[0] as THREE.Group
    expect(wrap.position.x).toBe(120)
    expect(wrap.position.z).toBe(340)
    expect(wrap.rotation.y).toBeCloseTo(-1.2, 10)
    // Full lateral load leans the car its whole authored angle; full braking dips the nose.
    expect(wrap.rotation.z).toBeLessThan(0)
    expect(wrap.rotation.x).toBeLessThan(0)
    const mesh = wrap.children[0]
    const fl = mesh.children.find((o) => o.position.x === -90 && o.position.z < 0)!
    expect(fl.rotation.y).toBeCloseTo(-(10 * Math.PI) / 180, 10)
    field.dispose()
  })

  it('rolls the wheels with distance, fronts faster than the larger rears', () => {
    const field = new CarField3D(0.01)
    field.ensure('a', '#E8442E')
    const pose = {
      x: 0, y: 0, rot: 0, steerLeft: 0, steerRight: 0, lat: 0, long: 0, ds: 0.5,
    }
    field.pose('a', pose)
    field.pose('a', pose)
    const wrap = field.group.children[0] as THREE.Group
    const mesh = wrap.children[0]
    const wheels = mesh.children.filter((o) => Math.abs(o.position.x) === 90)
    const front = wheels.find((o) => o.position.z < 0)!.children[0]
    const rear = wheels.find((o) => o.position.z > 0)!.children[0]
    expect(front.rotation.x).toBeLessThan(0)
    expect(Math.abs(front.rotation.x)).toBeGreaterThan(Math.abs(rear.rotation.x))
    field.dispose()
  })

  it('hides the wheels for the crew swap and fades a retired car', () => {
    const field = new CarField3D(0.01)
    field.ensure('a', '#E8442E')
    field.setWheelsVisible('a', false)
    const wrap = field.group.children[0] as THREE.Group
    const hidden = wrap.children[0].children.filter((o) => !o.visible)
    expect(hidden).toHaveLength(4)
    field.setWheelsVisible('a', true)
    field.setOpacity('a', 0.35)
    let faded = 0
    wrap.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.Material).opacity === 0.35) faded++
    })
    expect(faded).toBeGreaterThan(10)
    field.dispose()
  })

  it('sweeps entrants that left', () => {
    const field = new CarField3D(0.01)
    field.ensure('a', '#E8442E')
    field.ensure('b', '#2F7BE8')
    field.sweep(new Set(['b']))
    expect(field.group.children).toHaveLength(1)
    field.dispose()
    expect(field.group.children).toHaveLength(0)
  })
})
