import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SPRITE, UNITS_PER_M } from '@/lib/ui/car-sprite'
import { buildCarMesh } from './car-mesh'

const car = buildCarMesh('#E8442E')
car.group.updateMatrixWorld(true)
const bounds = new THREE.Box3().setFromObject(car.group)

describe('buildCarMesh', () => {
  it('spans the sprite it was lofted from: length, width and a sane roofline', () => {
    // Nose tip at sprite z=8, rear wing trailing edge at 490: the drawn car's own span.
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(460)
    expect(bounds.max.z - bounds.min.z).toBeLessThan(510)
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(SPRITE.len / 520 * 240)
    // The airbox is the summit, authored at 0.95m.
    expect(bounds.max.y).toBeGreaterThan(0.88 * UNITS_PER_M)
    expect(bounds.max.y).toBeLessThan(1.05 * UNITS_PER_M)
    // Nothing pokes through the tarmac.
    expect(bounds.min.y).toBeGreaterThanOrEqual(0)
  })

  it('hangs its wheels on the sprite axles, rolling radius off the drawn tyre', () => {
    expect(car.wheels.fl.position.x).toBe(-90)
    expect(car.wheels.fr.position.x).toBe(90)
    expect(car.wheels.fl.position.z).toBe(108 - SPRITE.cy)
    expect(car.wheels.rl.position.z).toBe(398 - SPRITE.cy)
    // Centre height = radius: the tyre touches the ground exactly.
    expect(car.wheels.fl.position.y).toBe(44)
    expect(car.wheels.rr.position.y).toBe(48)
  })

  it('steers a front wheel about its own pivot without moving it', () => {
    const before = car.wheels.fr.position.clone()
    car.wheels.fr.rotation.y = -0.4
    car.group.updateMatrixWorld(true)
    expect(car.wheels.fr.position.equals(before)).toBe(true)
    car.wheels.fr.rotation.y = 0
  })

  it('builds every part double-sided, because the sink winds quads by hand', () => {
    let parts = 0
    car.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        parts++
        expect((o.material as THREE.MeshLambertMaterial).side).toBe(THREE.DoubleSide)
      }
    })
    expect(parts).toBeGreaterThan(25)
  })
})
