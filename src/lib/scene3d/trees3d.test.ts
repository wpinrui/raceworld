import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SceneryTree } from '@/lib/ui/track-scenery'
import { buildTrees3D, type TreeStance } from './trees3d'
import type { PackKind, TreeKind, TreePack } from './treepack3d'

const kindAt = (name: string, tris: number): PackKind => ({
  name,
  pieces: [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial(), tinted: true }],
  height: 10,
  radius: 3,
  tris,
})

/** A one-species pack, which is all the tier logic needs: the species draw is weighted and tested
 *  nowhere here, and one kind makes the instance counts readable. */
function pack(): TreePack {
  const kinds: TreeKind[] = [{
    near: kindAt('oak', 18000), far: kindAt('oak-impostor', 6), family: 'broadleaf', weight: 1,
  }]
  return { kinds, dispose: () => {} }
}

const scenery = (n: number): SceneryTree[] => (
  Array.from({ length: n }, (_, i) => ({ d: '', variant: 0 as const, h: 15, x: i * 40, y: 0, r: 5 }))
)

const far = (n: number, y = 12): TreeStance[] => (
  Array.from({ length: n }, (_, i) => ({ x: 4000 + i * 40, z: 2000, y, h: 17 }))
)

describe('buildTrees3D far tier', () => {
  it('sizes the hero tier for the scenery alone and the impostor tier for both', () => {
    const wood = buildTrees3D(scenery(6), (m) => m, { pack: pack(), metresPerUnit: 1, far: far(50) })
    const meshes = wood.group.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
    const sizes = meshes.map((m) => m.instanceMatrix.count).sort((a, b) => a - b)
    // Hero buffer holds only the six scenery trees; the impostor buffer holds all fifty-six. A far
    // tree can never earn a hero slot, so allocating it one is a buffer that can never fill.
    expect(sizes).toEqual([6, 56])
  })

  it('stands a far tree at the height of the ground under it', () => {
    const wood = buildTrees3D([], (m) => m, { pack: pack(), metresPerUnit: 1, far: far(1, 37) })
    const mesh = wood.group.children[0] as THREE.InstancedMesh
    const m = new THREE.Matrix4()
    mesh.getMatrixAt(0, m)
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(37, 5)
  })

  it('keeps the far wood drawn however the camera moves', () => {
    const wood = buildTrees3D(scenery(4), (m) => m, { pack: pack(), metresPerUnit: 1, far: far(20) })
    const counts = () => wood.group.children
      .filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
      .map((m) => m.count).sort((a, b) => a - b)
    // Parked among the scenery trees: those go hero, the far wood stays exactly where it was.
    wood.update(new THREE.Vector3(0, 1, 0))
    expect(counts()).toEqual([4, 20])
    // ...and from far overhead, where every scenery tree drops to a card and joins them.
    wood.update(new THREE.Vector3(0, 100_000, 0))
    expect(counts()).toEqual([0, 24])
  })

  it('never moves a far tree once it is written', () => {
    const wood = buildTrees3D(scenery(4), (m) => m, { pack: pack(), metresPerUnit: 1, far: far(20) })
    const impostors = wood.group.children
      .find((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && o.instanceMatrix.count === 24)!
    wood.update(new THREE.Vector3(0, 1, 0))
    const before = Array.from(impostors.instanceMatrix.array.slice(0, 20 * 16))
    // A repack that sends four more trees into this buffer must not renumber the twenty already in
    // it: they are written once at build and the cursor starts above them.
    wood.update(new THREE.Vector3(0, 100_000, 0))
    expect(Array.from(impostors.instanceMatrix.array.slice(0, 20 * 16))).toEqual(before)
  })

  it('builds a wood from the far land alone', () => {
    const wood = buildTrees3D([], (m) => m, { pack: pack(), metresPerUnit: 1, far: far(9) })
    const meshes = wood.group.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
    expect(meshes).toHaveLength(1)
    expect(meshes[0].count).toBe(9)
  })

  it('builds nothing without a pack', () => {
    const wood = buildTrees3D(scenery(3), (m) => m, { pack: null, far: far(5) })
    expect(wood.group.children).toHaveLength(0)
  })
})
