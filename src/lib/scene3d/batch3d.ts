// Static geometry, gathered per material and submitted once.
//
// A draw call costs the same whether it delivers a hundred triangles or a hundred thousand. Measured
// on the grid at Britain, the world was submitting 898 meshes to deliver 101k triangles of ground
// paint and kerbing: 112 triangles apiece, which is nearly all overhead and no picture. The frame was
// spending two thirds of itself issuing draws rather than drawing.
//
// So anything that never moves and shares a material is merged into one buffer at build time. It is
// the same thing `ops3d` does to the compiled ink and `collapseByPaint` does to a car, applied to the
// rest of the static world.
//
// WHAT THIS IS SAFE TO DO TO, and what it is not:
//
//  - The material must be SHARED, not merely equal. `SceneMaterials.get` returns one instance per
//    (colour, finish, layer), which is what makes a batch key out of object identity.
//  - The geometry must never move independently. A merged buffer has one transform for everything
//    in it, so anything posed per frame (a car, a crew) stays out.
//  - Order within a batch cannot matter, and between batches it already does not: three sorts opaque
//    draws by renderOrder, then by program, and never by the order they were added to a group. What
//    keeps this world's coplanar paint apart is the per-layer polygonOffset in `materials3d`, not
//    submission order, so merging cannot disturb a stack that was never relying on it.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export class MeshBatch {
  private readonly runs = new Map<THREE.Material, THREE.BufferGeometry[]>()

  /** Take one piece. `matrix` bakes a placement into the buffer, for geometry authored in its own
   *  local frame and stood up by its mesh: a merged batch has no per-piece transform left to carry
   *  it. Absent, the geometry is taken as already being in the group's frame. */
  add(
    geometry: THREE.BufferGeometry | null | undefined, material: THREE.Material,
    matrix?: THREE.Matrix4,
  ): void {
    if (!geometry) return
    const piece = matrix ? geometry.clone().applyMatrix4(matrix) : geometry
    const run = this.runs.get(material)
    if (run) run.push(piece)
    else this.runs.set(material, [piece])
  }

  /** One mesh per material, `dress` applied to each before it goes out.
   *
   *  A merge REFUSES when the pieces disagree on attributes, and returns null rather than throwing.
   *  That has to be survivable: the fallback emits the run unmerged, so a surface that cannot be
   *  batched is a surface that costs what it always did rather than a surface that vanishes. */
  build(dress?: (mesh: THREE.Mesh) => void): THREE.Mesh[] {
    const out: THREE.Mesh[] = []
    for (const [material, geos] of this.runs) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)
      const pieces = merged ? [merged] : geos
      // Only the sources that were actually consumed: on a refused merge they are still in use.
      if (merged && geos.length > 1) for (const g of geos) g.dispose()
      for (const geometry of pieces) {
        const mesh = new THREE.Mesh(geometry, material)
        dress?.(mesh)
        out.push(mesh)
      }
    }
    return out
  }

  /** Build straight into a group, which is what every caller here wants. */
  into(group: THREE.Group, dress?: (mesh: THREE.Mesh) => void): void {
    for (const mesh of this.build(dress)) group.add(mesh)
  }
}
