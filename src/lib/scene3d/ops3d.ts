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
import { ROUGH, type SceneMaterials } from './materials3d'
import { planarUV, type SurfaceDetail } from './detail3d'
import { drape, refine, subdivide } from './terrain3d'
import type { Elevation } from '@/lib/ui/elevation'

export interface OpsDecalOpts {
  /** The one height the whole stack renders at. */
  y: number
  /** First renderOrder; each material run takes the next, and `nextOrder` reports where it ended. */
  order: number
  /** The painter layer this stack lives at, as a depth bias: the ink must beat the tarmac it lies
   *  on at a tilted camera without also beating the kerbs and marks painted above it. */
  bias: number
  /** The road's grain, and the scale to project it at.
   *
   *  The ink has to carry it. These decals ARE the road surface, just a driven-in, rubbered-in,
   *  brake-marked version of it, and they cover most of its width: leaving them smooth put the
   *  aggregate on the strips of bare tarmac between them and nowhere else, so the grain read as
   *  patches rather than as a surface. */
  detail?: SurfaceDetail | null
  /** Metres per world unit, to turn the grain's tile size into UV scale. */
  metresPerUnit?: number
  /** How much dielectric reflection this stack's paint returns, 1 by default. The road's ink IS the
   *  road, so it takes the road's own specular or the racing line renders as a bluer, glossier
   *  stripe down the middle of the surface it belongs to. Overlay paint keeps the default. */
  specular?: number
  /** The ground this ink lies on. The ink IS the road surface, so it has to ride exactly what the
   *  road rides or it floats off the tarmac on every gradient. */
  elevation: Elevation
  /** Grid pitch to cut the ink down to before draping, and the step its normals are differenced
   *  over, both in world units. */
  cell: number
  normalStep: number
}

/** One op's geometry: the fill, then the stroke, as flat sheets, at the resolution the ground under
 *  them is built at. Every stroke is refined along its length and every fill cut down after
 *  triangulation, for the same reason the road itself is: an unrefined chord across a graded surface
 *  sinks below the tarmac it is painted on. */
function opGeometries(op: DrawOp, y: number, cell: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  if (op.fill && !refName(op.fill)) {
    const fill = pathFillGeometry(op.d, y)
    if (fill) out.push(subdivide(fill, cell))
  }
  if (op.stroke && !refName(op.stroke)) {
    const halfW = (op.width ?? 1) / 2
    for (const poly of samplePathPolys(op.d)) {
      const pts = refine(poly.pts, cell, poly.closed)
      const g = op.dash
        ? dashGeometry(pts, {
          halfW, y, on: op.dash.on, off: op.dash.off, shift: op.dash.shift,
        })
        : ribbonGeometry(pts, {
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
      drape(merged, o.elevation, o.normalStep)
      if (o.detail) planarUV(merged, o.detail.tileM / (o.metresPerUnit ?? 1))
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
      runMaterial = materials.get(colour, {
        alpha: op.alpha ?? 1,
        decal: true,
        layer: o.bias,
        roughness: ROUGH.matte,
        detail: o.detail,
        specular: o.specular,
      })
    }
    runGeometries.push(...opGeometries(op, o.y, o.cell))
  }
  flush()
  return { group, nextOrder: order }
}
