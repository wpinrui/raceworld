import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { repairNormals } from './normals3d'

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
