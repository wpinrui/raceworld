import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MeshBatch } from './batch3d'

const tri = (x = 0): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    x, 0, 0, x + 1, 0, 0, x, 1, 0,
  ]), 3))
  g.computeVertexNormals()
  return g
}

const countTriangles = (mesh: THREE.Mesh): number => {
  const g = mesh.geometry as THREE.BufferGeometry
  return (g.index ? g.index.count : g.attributes.position.count) / 3
}

describe('MeshBatch', () => {
  it('gathers everything sharing a material into a single mesh', () => {
    const material = new THREE.MeshStandardMaterial()
    const batch = new MeshBatch()
    for (let i = 0; i < 5; i++) batch.add(tri(i), material)
    const built = batch.build()
    expect(built).toHaveLength(1)
    expect(countTriangles(built[0])).toBe(5)
    expect(built[0].material).toBe(material)
  })

  it('keeps distinct materials in distinct meshes', () => {
    const batch = new MeshBatch()
    const red = new THREE.MeshStandardMaterial()
    const blue = new THREE.MeshStandardMaterial()
    batch.add(tri(0), red)
    batch.add(tri(1), blue)
    batch.add(tri(2), red)
    const built = batch.build()
    expect(built).toHaveLength(2)
    expect(built.map((m) => m.material)).toEqual([red, blue])
    // The two reds merged; the blue between them did not join them.
    expect(countTriangles(built[0])).toBe(2)
    expect(countTriangles(built[1])).toBe(1)
  })

  // Materials are matched by IDENTITY, not by looking the same. Two materials with the same settings
  // still compile and bind separately, so batching them together would be merging things the
  // renderer is going to submit apart anyway.
  it('does not merge across two materials that merely look alike', () => {
    const batch = new MeshBatch()
    batch.add(tri(0), new THREE.MeshStandardMaterial({ color: '#FFFFFF' }))
    batch.add(tri(1), new THREE.MeshStandardMaterial({ color: '#FFFFFF' }))
    expect(batch.build()).toHaveLength(2)
  })

  it('bakes a placement into the buffer, leaving the mesh at the origin', () => {
    const material = new THREE.MeshStandardMaterial()
    const batch = new MeshBatch()
    const at = new THREE.Matrix4().makeTranslation(10, 0, 4)
    batch.add(tri(0), material, at)
    const [mesh] = batch.build()
    expect(mesh.position.toArray()).toEqual([0, 0, 0])
    const pos = (mesh.geometry as THREE.BufferGeometry).attributes.position
    expect(pos.getX(0)).toBeCloseTo(10)
    expect(pos.getZ(0)).toBeCloseTo(4)
  })

  it('leaves the source geometry alone when a placement is baked', () => {
    const source = tri(0)
    const batch = new MeshBatch()
    batch.add(source, new THREE.MeshStandardMaterial(), new THREE.Matrix4().makeTranslation(5, 0, 0))
    batch.build()
    // The caller may be holding this to place again, or to dispose itself.
    expect(source.attributes.position.getX(0)).toBeCloseTo(0)
  })

  it('ignores nothing where there is nothing to add', () => {
    const batch = new MeshBatch()
    batch.add(null, new THREE.MeshStandardMaterial())
    batch.add(undefined, new THREE.MeshStandardMaterial())
    expect(batch.build()).toHaveLength(0)
  })

  it('dresses every mesh it emits', () => {
    const batch = new MeshBatch()
    batch.add(tri(0), new THREE.MeshStandardMaterial())
    batch.add(tri(1), new THREE.MeshStandardMaterial())
    const built = batch.build((mesh) => {
      mesh.castShadow = true
    })
    expect(built).toHaveLength(2)
    expect(built.every((m) => m.castShadow)).toBe(true)
  })

  it('adds straight into a group', () => {
    const group = new THREE.Group()
    const batch = new MeshBatch()
    batch.add(tri(0), new THREE.MeshStandardMaterial())
    batch.into(group)
    expect(group.children).toHaveLength(1)
  })

  // A merge refuses when the pieces disagree on attributes. The surface has to still be THERE, at
  // the cost it always had, rather than disappear because it could not be made cheaper.
  it('emits a run unmerged rather than dropping it when the merge refuses', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const material = new THREE.MeshStandardMaterial()
    const withUv = tri(0)
    withUv.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
    const batch = new MeshBatch()
    batch.add(withUv, material)
    batch.add(tri(1), material)
    const built = batch.build()
    expect(built).toHaveLength(2)
    expect(built.reduce((n, m) => n + countTriangles(m), 0)).toBe(2)
    quiet.mockRestore()
  })
})
