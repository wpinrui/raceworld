import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bulgeNormals, repairNormals } from './normals3d'

function geometryWithNormals(normals: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    new Array(normals.length).fill(0), 3,
  ))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return g
}

const normalAt = (g: THREE.BufferGeometry, i: number) => {
  const n = g.getAttribute('normal')
  return [n.getX(i), n.getY(i), n.getZ(i)]
}

describe('repairNormals', () => {
  it('replaces a zero normal with world up', () => {
    const g = repairNormals(geometryWithNormals([0, 0, 0]))
    expect(normalAt(g, 0)).toEqual([0, 1, 0])
  })

  it('leaves usable normals untouched', () => {
    const g = repairNormals(geometryWithNormals([1, 0, 0, 0, 0, -1]))
    expect(normalAt(g, 0)).toEqual([1, 0, 0])
    expect(normalAt(g, 1)).toEqual([0, 0, -1])
  })

  it('repairs only the bad vertices of a mixed geometry', () => {
    const g = repairNormals(geometryWithNormals([1, 0, 0, 0, 0, 0, 0, 0, 1]))
    expect(normalAt(g, 0)).toEqual([1, 0, 0])
    expect(normalAt(g, 1)).toEqual([0, 1, 0])
    expect(normalAt(g, 2)).toEqual([0, 0, 1])
  })

  it('repairs NaN and infinite normals, which normalize no better than zero does', () => {
    const g = repairNormals(geometryWithNormals([NaN, 0, 0, 0, Infinity, 0]))
    expect(normalAt(g, 0)).toEqual([0, 1, 0])
    expect(normalAt(g, 1)).toEqual([0, 1, 0])
  })

  it('is a no-op on geometry that carries no normals at all', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    expect(() => repairNormals(g)).not.toThrow()
    expect(g.getAttribute('normal')).toBeUndefined()
  })

  it('returns the same geometry, so a builder can repair on its return line', () => {
    const g = geometryWithNormals([0, 0, 0])
    expect(repairNormals(g)).toBe(g)
  })

  // The fault this whole module exists for: a zero-area triangle. Both of three's normal
  // generators hand one back a zero normal, and `normalize` of that is NaN in the shader.
  it('repairs what computeVertexNormals leaves on a zero-area triangle', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      1, 0, 1, 1, 0, 1, 1, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 0, 1,
    ], 3))
    g.computeVertexNormals()
    const before = g.getAttribute('normal')
    expect([before.getX(0), before.getY(0), before.getZ(0)]).toEqual([0, 0, 0])

    repairNormals(g)
    for (let i = 0; i < 3; i++) expect(normalAt(g, i)).toEqual([0, 1, 0])
    // The real triangle beside it keeps the normal it earned.
    for (let i = 3; i < 6; i++) expect(Math.abs(normalAt(g, i)[1])).toBe(1)
  })
})

/** A geometry with explicit positions and normals, for the bulge tests. */
function geometryOf(positions: number[], normals: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return g
}

/** Six vertices on the axes of a unit cube's faces, each carrying the SAME normal. That shared
 *  normal is the point: it stands for a pile of cards that all happen to face one way, which is the
 *  degenerate case the bulge exists to break up. */
function star(normal: [number, number, number]): THREE.BufferGeometry {
  const positions = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]
  return geometryOf(positions, Array.from({ length: 6 }, () => normal).flat())
}

describe('bulgeNormals', () => {
  it('turns a vertex on the shell to face directly out of the centre', () => {
    const g = star([0, 0, 1])
    bulgeNormals(g, () => 1)
    // +X vertex faces +X, -Y vertex faces -Y, and so on: the shared card normal is gone entirely.
    expect(normalAt(g, 0).map(Math.round)).toEqual([1, 0, 0])
    expect(normalAt(g, 3).map(Math.round)).toEqual([0, -1, 0])
    expect(normalAt(g, 5).map(Math.round)).toEqual([0, 0, -1])
  })

  it('leaves the normals alone at zero weight', () => {
    const g = star([0, 0, 1])
    bulgeNormals(g, () => 0)
    for (let i = 0; i < 6; i++) expect(normalAt(g, i).map(Math.round)).toEqual([0, 0, 1])
  })

  it('gives a partial weight a direction between the card and the crown', () => {
    const g = geometryOf([1, 0, 0, -1, 0, 0], [0, 1, 0, 0, 1, 0])
    bulgeNormals(g, () => 0.5)
    const [x, y, z] = normalAt(g, 0)
    // Halfway between +Y (the card) and +X (outward), so both components are equal and positive.
    expect(x).toBeCloseTo(Math.SQRT1_2, 5)
    expect(y).toBeCloseTo(Math.SQRT1_2, 5)
    expect(z).toBeCloseTo(0, 5)
  })

  it('always returns unit-length normals, which is what the shader requires', () => {
    const g = star([0, 0, 1])
    bulgeNormals(g, (r) => r * 0.7)
    for (let i = 0; i < 6; i++) {
      expect(Math.hypot(...normalAt(g, i))).toBeCloseTo(1, 5)
    }
  })

  // The whole reason the weight is a function of radius rather than a constant: at the centre of a
  // crown there IS no outward direction, so the card keeps its own.
  it('reports 0 at the centre and 1 at the extreme, and leaves a centre vertex untouched', () => {
    const g = geometryOf([2, 0, 0, 0, 0, 0, -2, 0, 0], [0, 1, 0, 0, 1, 0, 0, 1, 0])
    const radii = bulgeNormals(g, (r) => r)
    expect(radii[0]).toBeCloseTo(1, 5)
    expect(radii[1]).toBeCloseTo(0, 5)
    expect(normalAt(g, 1)).toEqual([0, 1, 0])
    expect(normalAt(g, 0).map(Math.round)).toEqual([1, 0, 0])
  })

  it('measures the radius in the geometry\'s own proportions, not a shared sphere', () => {
    // A crown four times taller than it is wide: the tip and the flank are both at its extreme.
    const g = geometryOf([1, 0, 0, 0, 4, 0], [0, 0, 1, 0, 0, 1])
    const radii = bulgeNormals(g, (r) => r)
    expect(radii[0]).toBeCloseTo(1, 5)
    expect(radii[1]).toBeCloseTo(1, 5)
  })

  it('bulges outward from the geometry\'s own centre, not the world origin', () => {
    // A crown sitting well up a trunk, as every canopy in the pack does.
    const g = geometryOf([0, 11, 0, 0, 9, 0], [1, 0, 0, 1, 0, 0])
    bulgeNormals(g, () => 1)
    expect(normalAt(g, 0).map(Math.round)).toEqual([0, 1, 0])
    expect(normalAt(g, 1).map(Math.round)).toEqual([0, -1, 0])
  })

  it('is a no-op on geometry carrying no normals, and reports its radii anyway', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([1, 0, 0, -1, 0, 0], 3))
    expect(() => bulgeNormals(g, () => 1)).not.toThrow()
    expect(Array.from(bulgeNormals(g, () => 1))).toEqual([1, 1])
  })

  it('keeps the original normal when the blend cancels to nothing', () => {
    // A card facing exactly back down its own outward direction, at the one weight that cancels it.
    const g = geometryOf([1, 0, 0, -1, 0, 0], [-1, 0, 0, 1, 0, 0])
    bulgeNormals(g, () => 0.5)
    expect(normalAt(g, 0)).toEqual([-1, 0, 0])
  })
})
