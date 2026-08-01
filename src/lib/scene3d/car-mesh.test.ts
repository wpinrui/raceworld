import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SPRITE, UNITS_PER_M } from '@/lib/ui/car-sprite'
import { CAR_HEIGHT_SCALE, TYRE_BANDS, asPaint, buildCarMesh } from './car-mesh'

const car = buildCarMesh('#E8442E')
car.group.updateMatrixWorld(true)
const bounds = new THREE.Box3().setFromObject(car.group)

describe('buildCarMesh', () => {
  it('spans the sprite it was lofted from: length, width and a sane roofline', () => {
    // Nose tip at sprite z=-24, rear endplate trailing edge at 492: the drawn car's own span.
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(490)
    expect(bounds.max.z - bounds.min.z).toBeLessThan(530)
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(SPRITE.len / 520 * 240)
    // The airbox is the summit, authored at 0.625m through the car's vertical exaggeration.
    expect(bounds.max.y).toBeGreaterThan(0.56 * CAR_HEIGHT_SCALE * UNITS_PER_M)
    expect(bounds.max.y).toBeLessThan(0.70 * CAR_HEIGHT_SCALE * UNITS_PER_M)
    // Nothing pokes through the tarmac. The tyre lathe lands a float epsilon under zero, so the
    // bar is "not visibly through", not "not one ten-millionth of a unit through".
    expect(bounds.min.y).toBeGreaterThan(-0.01)
  })

  it('hangs its wheels on the sprite axles, rolling radius off the drawn tyre', () => {
    expect(car.wheels.fl.position.x).toBe(-90)
    expect(car.wheels.fr.position.x).toBe(90)
    expect(car.wheels.fl.position.z).toBe(106 - SPRITE.cy)
    expect(car.wheels.rl.position.z).toBe(398 - SPRITE.cy)
    // Centre height = radius: the tyre touches the ground exactly.
    expect(car.wheels.fl.position.y).toBe(35.6)
    expect(car.wheels.rr.position.y).toBe(38.9)
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

  it('expands a single colour to the palette the car wore before liveries existed', () => {
    const paint = asPaint('#E8442E')
    expect(paint.body).toBe('#E8442E')
    expect(paint.accent).toBe('#E8442E')
    // Cover is the shaded secondary, and the structural planes stay tertiary grey.
    expect(paint.cover).not.toBe(paint.body)
    expect(paint.wing).toBe(paint.trim)
    // A palette passes through untouched.
    const five = { body: '#1', cover: '#2', wing: '#3', accent: '#4', trim: '#5' }
    expect(asPaint(five)).toBe(five)
  })

  /** Every distinct material colour on a built car, lower-cased the way three.js reports them. */
  const coloursOf = (car: ReturnType<typeof buildCarMesh>): Set<string> => {
    const out = new Set<string>()
    car.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        out.add('#' + (o.material as THREE.MeshLambertMaterial).color.getHexString())
      }
    })
    return out
  }

  it('paints every slot of a livery onto some part of the car', () => {
    const five = {
      body: '#111111', cover: '#222222', wing: '#333333', accent: '#444444', trim: '#555555',
    }
    const painted = coloursOf(buildCarMesh(five))
    for (const hex of Object.values(five)) expect(painted).toContain(hex)
  })

  it('bands the sidewalls in the compound colour it was given', () => {
    const painted = coloursOf(buildCarMesh('#E8442E', 'soft'))
    expect(painted).toContain(TYRE_BANDS.soft.toLowerCase())
    expect(painted).not.toContain(TYRE_BANDS.wet.toLowerCase())
  })
})

describe('the car\'s two-lobe paint', () => {
  /** Every material on the car, by the colour it wears. */
  const byColour = new Map<string, THREE.Material[]>()
  car.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const m = o.material as THREE.MeshStandardMaterial
    const key = `#${m.color.getHexString().toUpperCase()}`
    byColour.set(key, [...(byColour.get(key) ?? []), m])
  })

  it('lacquers the bodywork, which is what puts the sun streak down a sidepod', () => {
    const body = byColour.get('#E8442E') ?? []
    expect(body.length).toBeGreaterThan(0)
    for (const m of body) expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial)
  })

  it('does NOT lacquer rubber: a sidewall has no clear coat over it', () => {
    // A tyre wearing the bodywork's finish puts a hard reflected sun on the one surface out here
    // that should be swallowing the light.
    const band = byColour.get(TYRE_BANDS.medium.toUpperCase()) ?? []
    expect(band.length).toBeGreaterThan(0)
    for (const m of band) expect(m).not.toBeInstanceOf(THREE.MeshPhysicalMaterial)
  })

  it('leaves the metal finish alone: rims reflect, they are not painted', () => {
    for (const list of byColour.values()) {
      for (const m of list) {
        if ((m as THREE.MeshStandardMaterial).metalness === 1) {
          expect(m).not.toBeInstanceOf(THREE.MeshPhysicalMaterial)
        }
      }
    }
  })
})
