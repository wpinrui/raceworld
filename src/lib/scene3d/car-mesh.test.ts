import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SPRITE, UNITS_PER_M } from '@/lib/ui/car-sprite'
import { CAR_HEIGHT_SCALE, TYRE_BANDS, asPaint, buildCarMesh } from './car-mesh'
import { RUBBER } from './rubber3d'

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

describe('the tyre\'s two rubbers', () => {
  /** The baked meshes of one rolling wheel, after `collapseByPaint` has been over them. */
  const rolling = (tag: 'fl' | 'rr'): THREE.Mesh[] =>
    car.spin[tag].children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
  const rubbers = (tag: 'fl' | 'rr') => rolling(tag)
    .map((m) => m.material as THREE.MeshStandardMaterial)
    .filter((m) => m.roughness === RUBBER.treadRough || m.roughness === RUBBER.wallRough)

  it('keeps the polished band and the matte wall APART through the bake', () => {
    // The bake batches a car down from ~270 parts to ten buffers, and every part in a batch renders
    // as ONE of the materials that fell into it. Batched on colour alone the tread and the sidewall
    // land together and one of them silently takes the other's finish, which is exactly the single
    // averaged rubber this split exists to get rid of.
    for (const tag of ['fl', 'rr'] as const) {
      const found = rubbers(tag)
      expect(found.filter((m) => m.roughness === RUBBER.treadRough)).toHaveLength(1)
      expect(found.filter((m) => m.roughness === RUBBER.wallRough)).toHaveLength(1)
    }
  })

  it('merges the two sidewalls together, though: they are the same rubber', () => {
    // The other half of the same bar. A key that splits what it should merge costs draw calls on
    // every wheel of every car in the field.
    expect(rolling('fl').filter((m) =>
      (m.material as THREE.MeshStandardMaterial).roughness === RUBBER.wallRough)).toHaveLength(1)
  })

  it('carries the wall\'s radial shade through a bake that strips what it is not told to keep', () => {
    const wall = rolling('fl').find((m) =>
      (m.material as THREE.MeshStandardMaterial).vertexColors)!
    const colour = wall.geometry.getAttribute('color')
    expect(colour).toBeDefined()
    const shades = Array.from({ length: colour.count }, (_, i) => colour.getX(i))
    // Both ends of the ramp survived: the bead in the rim's shadow, the shoulder in full light.
    expect(Math.min(...shades)).toBeCloseTo(RUBBER.beadShade, 4)
    expect(Math.max(...shades)).toBeCloseTo(1, 4)
  })

  it('leaves no crack at the shoulder: the three lathes share their seam rings exactly', () => {
    // One profile, sliced. Were the pieces lathed from tables of their own, a seam a fraction of a
    // unit wide would open at the split and catch the light all the way round the tyre.
    const box = (m: THREE.Mesh) => new THREE.Box3().setFromBufferAttribute(
      m.geometry.getAttribute('position') as THREE.BufferAttribute)
    const parts = rolling('fl')
    const tread = box(parts.find((m) =>
      (m.material as THREE.MeshStandardMaterial).roughness === RUBBER.treadRough)!)
    const wall = box(parts.find((m) =>
      (m.material as THREE.MeshStandardMaterial).roughness === RUBBER.wallRough)!)
    // The walls reach outboard of the tread's own span and stop short of its radius: a filleted
    // shoulder, with the seam partway round the curve rather than on an edge.
    expect(wall.max.x).toBeGreaterThan(tread.max.x)
    expect(wall.max.y).toBeLessThan(tread.max.y)
    expect(wall.max.y).toBeGreaterThan(tread.max.y * 0.9)
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
