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
import { repairNormals } from './normals3d'

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

/** ONE DRAW CALL PER FINISH, not per part, for anything authored as a pile of separate solids.
 *
 *  A car is sculpted as ~270 pieces and a grandstand as a couple of dozen, because that is how you
 *  build them, but neither must SHIP that way. Measured on the grid at Britain: twenty cars were 1036
 *  meshes and the circuit's stands another 512, and the frame was spending more time issuing draws
 *  than drawing.
 *
 *  Colour is folded onto the VERTICES so that parts sharing a finish in different paints still share
 *  a buffer, and the key keeps everything else that makes one material look unlike another. Safe for
 *  solids: they write depth, so overlap is settled by the depth buffer and submission order never
 *  enters into it. NOT safe for coplanar decals that do not write depth, where order is the picture
 *  (see the shade band in `ops3d`).
 *
 *  Anything that has to move on its own is a BOUNDARY: the walk skips it and leaves it whole. Detail
 *  ladders and instanced draws are boundaries automatically, since merging a `LOD`'s rungs together
 *  would draw every rung at once and merging instances would throw away their transforms.
 *
 *  MERGE ACROSS SIBLINGS ONLY WHERE THEY ARE ONE OBJECT. Collapsing a whole circuit's stands into one
 *  buffer would cut the draw count further and cost more than it saved: a merged buffer has one
 *  bounding volume, so a stand on the far side of the lap could never be culled again. Per stand is
 *  the unit here, and per car. */
/** One array from many, in merge order, so it lines up with the merged buffer vertex for vertex. */
function joinPlain(parts: readonly Float32Array[]): Float32Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Float32Array(n)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** What a collapsed buffer needs to be repainted in another palette without being rebuilt. */
export interface Repaint {
  /** Untinted modulation, three floats a vertex, in the merged buffer's own order. */
  plain: Float32Array
  /** Runs of vertices and the paint each was folded with, in the same order. */
  parts: readonly { count: number; paint: string }[]
}

export function collapseByFinish(
  node: THREE.Object3D, boundaries: ReadonlySet<THREE.Object3D> = new Set(),
  /** Finishes already minted, to reuse across everything that shares this cache.
   *
   *  Folding colour onto the vertices is what makes this possible: two cars' carbon differs only in
   *  paint, so once the paint is off the material they are the SAME material and three can bind one
   *  uniform block for both. Without it, twenty cars minted 520 distinct materials for 520 meshes,
   *  one apiece, and the renderer rebound state on every single draw.
   *
   *  The cache OWNS what it holds: anything tearing a car down has to leave shared materials alone
   *  and let the cache's owner dispose them, or dropping one car takes the paint off the other
   *  nineteen. Marked `userData.shared` so a disposal walk can tell. */
  cache?: Map<string, THREE.Material>,
): void {
  interface Batch {
    geos: THREE.BufferGeometry[]
    sources: THREE.Mesh[]
    material: THREE.Material
    cast: boolean
    /** The finish signature, so a shared cache can be keyed on the same thing the batch was. */
    key: string
    /** Each source part's untinted modulation, in the order they are merged. */
    plain: Float32Array[]
    /** Each source part's vertex count and the paint folded into it, same order. */
    parts: { count: number; paint: string }[]
  }
  const batches = new Map<string, Batch>()
  node.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(node.matrixWorld).invert()
  // Merging is all-or-nothing on attribute layout, and these sources disagree: hand-built sinks are
  // non-indexed position+normal, three's own primitives arrive indexed and carrying UVs. Everything
  // is flattened to ONE layout first, or the merge quietly refuses and parts vanish.
  //
  // Which layout is decided by the batch's MATERIAL, not by what happens to be on the geometry.
  // Anything a material reads is kept and, where a part in that batch does not have it, synthesised
  // at its neutral value: zero UVs sample one texel, white vertex colours multiply to nothing.
  const bakeable = (
    source: THREE.BufferGeometry, matrix: THREE.Matrix4, needs: ReadonlySet<string>,
  ): THREE.BufferGeometry => {
    const geo = source.index ? source.toNonIndexed() : source.clone()
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && !needs.has(name)) geo.deleteAttribute(name)
    }
    for (const name of needs) {
      if (geo.attributes[name]) continue
      const size = name === 'uv' ? 2 : 3
      const fill = new Float32Array(geo.attributes.position.count * size)
      if (name === 'color') fill.fill(1)
      geo.setAttribute(name, new THREE.Float32BufferAttribute(fill, size))
    }
    if (!geo.attributes.normal) geo.computeVertexNormals()
    // Whichever source it came from: a sink's own normals and three's primitives alike come back
    // zero on a zero-area triangle, and a zero normal is a NaN pixel once a shader normalizes it.
    repairNormals(geo)
    geo.applyMatrix4(matrix)
    return geo
  }
  const skip = (o: THREE.Object3D) =>
    boundaries.has(o) || o instanceof THREE.LOD || o instanceof THREE.InstancedMesh
  const walk = (o: THREE.Object3D) => {
    for (const child of o.children) {
      if (skip(child)) continue
      walk(child)
    }
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return
    const material = o.material as THREE.MeshStandardMaterial
    // Everything that makes one material LOOK different from another EXCEPT its colour, which goes
    // onto the vertices below. A batch keeps ONE of the materials that fell into it and every part
    // in it renders as that, so a property left out of this key is a part silently taking another's
    // finish: the tyre tread wearing the sidewall's polish, a stand's glazing wearing its concrete.
    const physical = material as THREE.MeshPhysicalMaterial
    const key = [
      material.type, material.roughness, material.metalness,
      material.map?.uuid ?? '', material.normalMap?.uuid ?? '', material.roughnessMap?.uuid ?? '',
      material.emissive?.getHexString() ?? '', material.emissiveIntensity ?? '',
      physical.clearcoat ?? '', physical.clearcoatRoughness ?? '', physical.specularIntensity ?? '',
      material.side, material.transparent ? material.opacity : 'opaque',
      o.castShadow ? 'cast' : '',
    ].join('|')
    const needs = new Set<string>(['color'])
    if (material.map || material.normalMap || material.roughnessMap) needs.add('uv')
    const batch = batches.get(key)
      ?? { geos: [], sources: [], material, cast: o.castShadow, key, plain: [], parts: [] }
    const geo = bakeable(
      o.geometry as THREE.BufferGeometry, toLocal.clone().multiply(o.matrixWorld), needs,
    )
    // The paint, onto the vertices. MULTIPLIED rather than written, because a part may already carry
    // a vertex shade of its own (the tyre sidewall does) and that shade is a modulation of whatever
    // colour the material is painted, not a replacement for it. Both sides are linear here, which is
    // the space three consumes vertex colour in, so the product is the colour the part was authored.
    const tint = geo.attributes.color as THREE.BufferAttribute
    // The MODULATION on its own is kept beside the folded result. It is what a part's colour is
    // multiplied INTO, so holding it lets a caller repaint this buffer later without rebuilding the
    // geometry: twenty cars are the same solids in different liveries, and one of them is worth
    // building. See `paintOf` in car-mesh.
    const plain = new Float32Array(tint.count * 3)
    for (let i = 0; i < tint.count; i++) {
      plain[i * 3] = tint.getX(i)
      plain[i * 3 + 1] = tint.getY(i)
      plain[i * 3 + 2] = tint.getZ(i)
      tint.setXYZ(
        i, tint.getX(i) * material.color.r,
        tint.getY(i) * material.color.g, tint.getZ(i) * material.color.b,
      )
    }
    batch.plain.push(plain)
    batch.parts.push({ count: tint.count, paint: `#${material.color.getHexString().toUpperCase()}` })
    batch.geos.push(geo)
    batch.sources.push(o)
    batches.set(key, batch)
  }
  walk(node)
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geos, false)
    for (const g of batch.geos) g.dispose()
    // A refused merge keeps its parts rather than losing them: a silently missing wing is a far
    // worse outcome than a car that is briefly a few draw calls fatter than it should be.
    if (!merged) continue
    for (const source of batch.sources) {
      source.removeFromParent()
      ;(source.geometry as THREE.BufferGeometry).dispose()
    }
    // A CLONE painted white, reading its colour off the vertices. The batch holds parts that were
    // several different colours, so keeping one of their materials would paint the lot in whichever
    // the walk happened to reach first. Cloned rather than mutated because the source material is
    // shared with whatever else wears the same paint.
    const mint = () => {
      const made = batch.material.clone() as THREE.MeshStandardMaterial
      made.color.setRGB(1, 1, 1)
      made.vertexColors = true
      return made
    }
    let painted = cache?.get(batch.key)
    if (!painted) {
      painted = mint()
      if (cache) {
        painted.userData.shared = true
        cache.set(batch.key, painted)
      }
    }
    const m = new THREE.Mesh(merged, painted)
    // The recipe this buffer was painted by, for anything that wants to repaint it: the untinted
    // modulation vertex by vertex, and which paint each run of vertices took.
    merged.userData.repaint = { plain: joinPlain(batch.plain), parts: batch.parts }
    m.castShadow = batch.cast
    m.receiveShadow = true
    node.add(m)
  }
}
