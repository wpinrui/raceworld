import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MeshBatch, collapseByFinish } from './batch3d'

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

describe('collapseByFinish', () => {
  const part = (colour: string, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const mesh = new THREE.Mesh(tri(), new THREE.MeshStandardMaterial({ color: colour, ...opts }))
    mesh.castShadow = true
    return mesh
  }
  const drawsIn = (root: THREE.Object3D) => {
    let n = 0
    root.traverse((o) => { if (o instanceof THREE.Mesh) n++ })
    return n
  }

  it('folds parts of different colours but one finish into a single draw', () => {
    const root = new THREE.Group()
    root.add(part('#FF0000'), part('#00FF00'), part('#0000FF'))
    collapseByFinish(root)
    expect(drawsIn(root)).toBe(1)
  })

  it('carries each part\'s colour onto its vertices, over a white material', () => {
    const root = new THREE.Group()
    root.add(part('#FF0000'), part('#0000FF'))
    collapseByFinish(root)
    const mesh = root.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh)!
    const mat = mesh.material as THREE.MeshStandardMaterial
    expect(mat.color.getHexString()).toBe('ffffff')
    expect(mat.vertexColors).toBe(true)
    const tint = mesh.geometry.getAttribute('color')
    const seen = new Set<string>()
    for (let i = 0; i < tint.count; i++) {
      seen.add(new THREE.Color().fromBufferAttribute(tint as THREE.BufferAttribute, i).getHexString())
    }
    expect(seen).toEqual(new Set(['ff0000', '0000ff']))
  })

  it('keeps two finishes apart even where they share a colour', () => {
    // A property left out of the key is a part silently taking another's finish: a tyre tread
    // wearing the sidewall's polish, a stand's glazing wearing its concrete.
    const root = new THREE.Group()
    root.add(part('#888888', { roughness: 0.1 }), part('#888888', { roughness: 0.9 }))
    collapseByFinish(root)
    expect(drawsIn(root)).toBe(2)
  })

  it('splits casters from non-casters, which is a difference the shadow map can see', () => {
    const root = new THREE.Group()
    const quiet = part('#888888')
    quiet.castShadow = false
    root.add(part('#888888'), quiet)
    collapseByFinish(root)
    expect(drawsIn(root)).toBe(2)
  })

  it('leaves a detail ladder alone, or every rung would draw at once', () => {
    const root = new THREE.Group()
    const ladder = new THREE.LOD()
    ladder.addLevel(part('#FF0000'), 0)
    ladder.addLevel(part('#FF0000'), 50)
    root.add(ladder, part('#FF0000'))
    collapseByFinish(root)
    expect(root.children).toContain(ladder)
    expect(ladder.children).toHaveLength(2)
  })

  it('leaves an instanced draw alone, since merging it would lose its transforms', () => {
    const root = new THREE.Group()
    const crowd = new THREE.InstancedMesh(tri(), new THREE.MeshStandardMaterial(), 4)
    root.add(crowd, part('#FF0000'), part('#00FF00'))
    collapseByFinish(root)
    expect(root.children).toContain(crowd)
    expect(crowd.count).toBe(4)
  })

  it('skips a named boundary and everything under it', () => {
    const root = new THREE.Group()
    const moving = new THREE.Group()
    moving.add(part('#FF0000'))
    root.add(moving, part('#FF0000'), part('#00FF00'))
    collapseByFinish(root, new Set([moving]))
    expect(moving.children).toHaveLength(1)
    expect(drawsIn(root)).toBe(2)
  })

  it('bakes a part\'s placement, so the merged buffer stands where the parts did', () => {
    const root = new THREE.Group()
    const moved = part('#FF0000')
    moved.position.set(0, 7, 0)
    root.add(moved, part('#FF0000'))
    collapseByFinish(root)
    const mesh = root.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh)!
    const box = new THREE.Box3().setFromBufferAttribute(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute)
    expect(box.max.y).toBeCloseTo(8)
    expect(box.min.y).toBeCloseTo(0)
  })
})
