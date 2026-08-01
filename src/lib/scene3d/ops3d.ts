// The 2D's ink, compiled to decals (#3d-port increment 3). A `DrawOp` list is strokes and fills in
// paint order; this walks one and emits flat geometry at a SINGLE lift, ordered by renderOrder
// rather than by height, so a thousand stacked soft strokes stay parallax-free under a tilted
// camera and can never fight a depth buffer they do not write to.
//
// The plan called for baking this into the road's albedo texture. Geometry is strictly better here:
// the ink is already authored as polyline strokes, a texture caps its resolution at some chosen
// texel while merged ribbons are exact at every zoom, and there is no bake pass to schedule. What
// the texture idea was protecting against — per-frame replay cost — a static buffer never pays.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { refName, type DrawOp } from '@/lib/ui/scenery-draw'
import { samplePathPolys } from './paths3d'
import { pathFillGeometry } from './ground3d'
import { dashGeometry, ribbonGeometry } from './road3d'
import type { SceneMaterials } from './materials3d'

export interface OpsDecalOpts {
  /** The one height the whole stack renders at. */
  y: number
  /** First renderOrder; each material run takes the next, and `nextOrder` reports where it ended. */
  order: number
  /** The painter layer this stack lives at, as a depth bias: the ink must beat the tarmac it lies
   *  on at a tilted camera without also beating the kerbs and marks painted above it. */
  bias: number
}

/** One op's geometry: the fill, then the stroke, as flat sheets. */
function opGeometries(op: DrawOp, y: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  if (op.fill && !refName(op.fill)) {
    const fill = pathFillGeometry(op.d, y)
    if (fill) out.push(fill)
  }
  if (op.stroke && !refName(op.stroke)) {
    const halfW = (op.width ?? 1) / 2
    for (const poly of samplePathPolys(op.d)) {
      const g = op.dash
        ? dashGeometry(poly.pts, {
          halfW, y, on: op.dash.on, off: op.dash.off, shift: op.dash.shift,
        })
        : ribbonGeometry(poly.pts, {
          halfW, y, closed: poly.closed, roundCaps: op.cap !== 'butt',
        })
      if (g.attributes.position.count > 0) out.push(g.toNonIndexed())
    }
  }
  return out.filter((g) => g.attributes.position.count > 0)
}

/** Compile a paint-ordered op list into decal meshes, merging CONSECUTIVE ops that share a paint so
 *  a few hundred soft strokes land as a handful of draws without ever reordering the painter. */
export function buildOpsDecals(
  ops: readonly DrawOp[], o: OpsDecalOpts, materials: SceneMaterials,
): { group: THREE.Group; nextOrder: number } {
  const group = new THREE.Group()
  let order = o.order
  let runKey: string | null = null
  let runMaterial: THREE.MeshStandardMaterial | null = null
  let runGeometries: THREE.BufferGeometry[] = []
  const flush = () => {
    if (runMaterial && runGeometries.length > 0) {
      const merged = runGeometries.length === 1 ? runGeometries[0] : mergeGeometries(runGeometries)
      const mesh = new THREE.Mesh(merged, runMaterial)
      mesh.receiveShadow = true
      mesh.renderOrder = order++
      group.add(mesh)
    }
    runGeometries = []
  }
  for (const op of ops) {
    const colour = (op.fill && !refName(op.fill) ? op.fill : undefined)
      ?? (op.stroke && !refName(op.stroke) ? op.stroke : undefined)
    if (!colour) continue
    // An op painting fill and stroke in two colours would need two runs; nothing on the road does,
    // and the guard keeps the day one does from silently merging them.
    if (op.fill && op.stroke && op.fill !== op.stroke && !refName(op.fill)) {
      throw new Error('buildOpsDecals: an op with distinct fill and stroke colours is not mergeable')
    }
    const key = `${colour}@${op.alpha ?? 1}`
    if (key !== runKey) {
      flush()
      runKey = key
      runMaterial = materials.get(colour, { alpha: op.alpha ?? 1, decal: true, layer: o.bias })
    }
    runGeometries.push(...opGeometries(op, o.y))
  }
  flush()
  return { group, nextOrder: order }
}
