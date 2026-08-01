import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { RUBBER, grainTile, radialShade, treadSurface, wallSurface } from './rubber3d'

/** Every vertex's shade, paired with the radius it was measured at. */
const shadesOf = (geometry: THREE.BufferGeometry): Array<[number, number]> => {
  const position = geometry.getAttribute('position')
  const colour = geometry.getAttribute('color')
  return Array.from({ length: position.count }, (_, i) => [
    Math.hypot(position.getX(i), position.getZ(i)), colour.getX(i),
  ])
}

describe('the two rubbers', () => {
  it('polishes the tread and leaves the sidewall dead matte', () => {
    // The split IS the feature: one roughness for the whole torus averages the two into a finish
    // neither zone has, and that average is what reads as plastic.
    expect(treadSurface().roughness).toBe(RUBBER.treadRough)
    expect(wallSurface().roughness).toBe(RUBBER.wallRough)
    expect(RUBBER.treadRough).toBeLessThan(RUBBER.wallRough / 2)
  })

  it('is warm dark grey on both zones, never a near-black', () => {
    for (const hex of [RUBBER.tread, RUBBER.wall]) {
      const { r, g, b } = new THREE.Color(hex)
      // Warm: red leads, blue trails. A rubber whose blue leads is a plastic.
      expect(r).toBeGreaterThan(g)
      expect(g).toBeGreaterThan(b)
    }
    // The wall carries a film of track dust the scrubbed tread does not, so it sits lighter.
    expect(new THREE.Color(RUBBER.wall).r).toBeGreaterThan(new THREE.Color(RUBBER.tread).r)
  })

  it('gives the wall vertex colours to read and the tread none', () => {
    expect(wallSurface().vertexColors).toBe(true)
    expect(treadSurface().vertexColors).toBe(false)
  })
})

describe('radialShade', () => {
  const ring = (rInner: number, rOuter: number) => {
    const geometry = new THREE.RingGeometry(rInner, rOuter, 16, 4)
    // Lay the ring flat, so its radius is measured about Y like a lathe's is.
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }

  it('ramps a sidewall from the bead out to its own widest point', () => {
    const geometry = ring(10, 20)
    radialShade(geometry, 10)
    const shades = shadesOf(geometry)
    const bead = shades.filter(([r]) => r < 10.01)
    const shoulder = shades.filter(([r]) => r > 19.99)
    expect(bead.length).toBeGreaterThan(0)
    expect(shoulder.length).toBeGreaterThan(0)
    for (const [, shade] of bead) expect(shade).toBeCloseTo(RUBBER.beadShade, 5)
    for (const [, shade] of shoulder) expect(shade).toBeCloseTo(1, 5)
  })

  it('reads the outer end off the GEOMETRY, not off the rolling radius', () => {
    // A filleted tyre's wall stops short of the radius it rolls on. Aiming the ramp at that radius
    // spends its last third on a shoulder that does not exist, and the wall you can actually see
    // gets a fraction of the depth it was authored with.
    const shades = shadesOf((() => {
      const geometry = ring(10, 15)
      radialShade(geometry, 10)
      return geometry
    })())
    const outer = shades.filter(([r]) => r > 14.99).map(([, shade]) => shade)
    expect(Math.min(...outer)).toBeCloseTo(1, 5)
  })

  it('rises monotonically, and grey on every channel: this shades, it does not tint', () => {
    const geometry = ring(10, 20)
    radialShade(geometry, 10)
    const colour = geometry.getAttribute('color')
    expect(colour.itemSize).toBe(3)
    for (let i = 0; i < colour.count; i++) {
      expect(colour.getY(i)).toBe(colour.getX(i))
      expect(colour.getZ(i)).toBe(colour.getX(i))
    }
    const sorted = [...shadesOf(geometry)].sort((a, b) => a[0] - b[0])
    for (let i = 1; i < sorted.length; i++) expect(sorted[i][1]).toBeGreaterThanOrEqual(sorted[i - 1][1] - 1e-6)
  })

  it('leaves anything already at full radius unshaded, so a whole wheel can come through it', () => {
    // The crew's props are one cylinder: barrel and caps together, shaded in a single pass.
    const geometry = new THREE.CylinderGeometry(20, 20, 8, 12)
    radialShade(geometry, 20 * 0.58)
    for (const [radius, shade] of shadesOf(geometry)) {
      if (radius > 19.99) expect(shade).toBeCloseTo(1, 5)
    }
  })
})

describe('grainTile', () => {
  it('reports nothing to tile where the grain could not be rasterised', () => {
    // jsdom has no 2D context, which is the same answer node gives: every caller falls back to the
    // flat material it had before, and none of them touch their UVs.
    expect(grainTile(100)).toBe(0)
  })
})
