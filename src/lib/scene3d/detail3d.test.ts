import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { faceUV, planarUV } from './detail3d'

/** A one-triangle geometry at the given world positions. */
function tri(...points: Array<[number, number, number]>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
  return g
}

describe('planarUV', () => {
  it('projects world XZ, ignoring height', () => {
    // Height is dropped on purpose: the road stack is thirteen coplanar sheets at millimetre lifts,
    // and a projection that read Y would give each of them its own slightly shifted grain.
    const g = tri([0, 0, 0], [8, 0, 0], [0, 0.4, 8])
    planarUV(g, 4)
    const uv = g.getAttribute('uv')
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0])
    expect([uv.getX(1), uv.getY(1)]).toEqual([2, 0])
    expect([uv.getX(2), uv.getY(2)]).toEqual([0, 2])
  })

  it('gives the same world point the same UV in unrelated geometry', () => {
    // THE invariant the whole approach exists for. Road, run-off, terrain patch and grass are
    // separate meshes sharing one piece of ground; projected from world space they share one grain,
    // so the joins between them carry no seam. Anything derived from a mesh's own local space or
    // vertex order would break exactly here.
    const road = tri([12, 0.02, -30], [13, 0.02, -30], [12, 0.02, -29])
    const grass = tri([40, 0, 40], [12, 0, -30], [41, 0, 41])
    planarUV(road, 2.5)
    planarUV(grass, 2.5)
    expect(road.getAttribute('uv').getX(0)).toBeCloseTo(grass.getAttribute('uv').getX(1), 6)
    expect(road.getAttribute('uv').getY(0)).toBeCloseTo(grass.getAttribute('uv').getY(1), 6)
  })

  it('tiles more often as the tile shrinks', () => {
    const coarse = tri([10, 0, 10])
    const fine = tri([10, 0, 10])
    planarUV(coarse, 10)
    planarUV(fine, 2)
    expect(coarse.getAttribute('uv').getX(0)).toBe(1)
    expect(fine.getAttribute('uv').getX(0)).toBe(5)
  })

  it('replaces a previous projection rather than accumulating one', () => {
    // Called once per geometry today, but a rebuild that ran it twice must not double the tiling.
    const g = tri([6, 0, 0])
    planarUV(g, 3)
    planarUV(g, 3)
    expect(g.getAttribute('uv').getX(0)).toBe(2)
    expect(g.getAttribute('uv').count).toBe(1)
  })
})

describe('faceUV', () => {
  /** A single triangle, non-indexed, as every wall builder here produces. */
  function face(...points: Array<[number, number, number]>): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
    return g
  }

  it('reads a floor from above', () => {
    const g = face([0, 5, 0], [4, 5, 0], [0, 5, 4])
    faceUV(g, 2)
    const uv = g.getAttribute('uv')
    // Y dominant, so the height is dropped and the two ground axes survive.
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0])
    expect([uv.getX(1), uv.getY(1)]).toEqual([2, 0])
    expect([uv.getX(2), uv.getY(2)]).toEqual([0, 2])
  })

  it('reads a wall from the side, keeping its height', () => {
    // A wall facing +x. Projected down Y this would collapse to a line and smear vertically; the
    // whole point of the per-face axis is that its height survives.
    const g = face([3, 0, 0], [3, 0, 6], [3, 6, 0])
    faceUV(g, 2)
    const uv = g.getAttribute('uv')
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0])
    expect([uv.getX(1), uv.getY(1)]).toEqual([3, 0])
    expect([uv.getX(2), uv.getY(2)]).toEqual([0, 3])
    // No two vertices share a UV: nothing has been collapsed.
    expect(new Set([0, 1, 2].map((i) => `${uv.getX(i)},${uv.getY(i)}`)).size).toBe(3)
  })

  it('keeps adjacent coplanar faces continuous', () => {
    // Two triangles of one wall quad. They must agree at the shared edge or the grain shows a seam
    // straight down the middle of a flat surface.
    const g = face([0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 0, 0], [4, 4, 0], [0, 4, 0])
    faceUV(g, 2)
    const uv = g.getAttribute('uv')
    expect([uv.getX(0), uv.getY(0)]).toEqual([uv.getX(3), uv.getY(3)])
    expect([uv.getX(2), uv.getY(2)]).toEqual([uv.getX(4), uv.getY(4)])
  })

  it('leaves indexed geometry alone', () => {
    // Sharing a vertex between faces that want different projections has no correct answer.
    const g = face([0, 0, 0], [1, 0, 0], [0, 1, 0])
    g.setIndex([0, 1, 2])
    faceUV(g, 1)
    expect(g.getAttribute('uv')).toBeUndefined()
  })
})
