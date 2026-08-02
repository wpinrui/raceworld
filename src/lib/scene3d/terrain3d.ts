// The ground as a surface rather than a plane (#elevation): the sheet the whole world stands on,
// and the one operation that puts anything else onto it.
//
// Two things live here and they are the same idea from both ends. `drape` takes geometry that was
// built flat — every ribbon, ring, fill and decal in the scene is authored in the XZ plane at a
// chosen lift — and lifts each vertex onto the ground under it, so a builder never has to know the
// world has height. `terrainSheet` builds the ground it is being lifted onto.

import * as THREE from 'three'
import type { Elevation } from '@/lib/ui/elevation'
import { repairNormals } from './normals3d'

/** How far the ground sheet is set below the true surface, in metres.
 *
 *  The sheet is tessellated, so between its vertices it is a CHORD across the surface rather than
 *  the surface itself, and where the ground is convex that chord rides ABOVE what everything else
 *  samples exactly. The road lies two millimetres over the ground and the whole painter stack is
 *  millimetres deep, so a chord error of centimetres is grass rendering through tarmac.
 *
 *  MEASURED (`scripts/elevation-grid.ts`) at the `GROUND_CELL_M` below, as the worst gap between the
 *  exact surface and the sheet within the shelf the road sits on: 3.5 mm at Britain, 3.5 mm at
 *  Monaco, 20 mm at Bahrain, 18 mm at Belgium. Thirty covers all four with room, and it is not a
 *  fudge factor: a road really does stand a little proud of the verge beside it, and three
 *  centimetres is less than the kerb's own 30 mm skirt so nothing opens up under a kerb either. */
export const GROUND_SINK_M = 0.03

/** Grid pitch of the sheet across the circuit and its corridor, in metres. Held in metres rather
 *  than world units because the error it controls is a real distance, and `metresPerUnit` runs from
 *  1.77 to 6.24 across the circuits: a unit-keyed pitch would give each venue a different ground. */
export const GROUND_CELL_M = 6

/** How fast cells grow once past the circuit, per step. The sheet reaches kilometres past anything
 *  built, where the land is smooth open field and one cell can be a hundred metres across; carrying
 *  the fine pitch all the way out would be millions of triangles of empty grass. */
const GROWTH = 1.25

/** The step the surface normal is differenced over, in metres. Small enough to follow a bank, large
 *  enough not to chase the raw field's finest octave into noise. */
export const NORMAL_STEP_M = 1

/** Write the ground's own normal at every vertex, from the elevation's gradient.
 *
 *  ANALYTIC rather than `computeVertexNormals`, and this is the difference between the ground
 *  reading as a landform and reading as the triangles it is made of. Differenced normals are a
 *  property of the MESH: a merged decal soup is non-indexed, so every triangle would get its own
 *  face normal and the racing line would band down the road; the ground sheet is indexed, so it
 *  would average at its vertices and shade slightly differently from the very same surface beside
 *  it. Taking the normal from the surface instead gives every sheet on this ground one answer, at
 *  any tessellation, so the road, its ink and the grass either side of it shade as one piece.
 *
 *  `step` is in world units: pass `u(NORMAL_STEP_M)`. */
function surfaceNormals(
  geometry: THREE.BufferGeometry, elevation: Elevation, step: number,
): void {
  const position = geometry.getAttribute('position')
  const normals = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const dx = (elevation.at(x + step, z) - elevation.at(x - step, z)) / (2 * step)
    const dz = (elevation.at(x, z + step) - elevation.at(x, z - step)) / (2 * step)
    const len = Math.hypot(dx, 1, dz)
    normals[i * 3] = -dx / len
    normals[i * 3 + 1] = 1 / len
    normals[i * 3 + 2] = -dz / len
  }
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
}

/** Lift flat geometry onto the ground, and give it the ground's own normal.
 *
 *  Adds rather than assigns, so whatever lift the builder chose (its painter layer, a decal's hair
 *  of clearance) is preserved as height ABOVE the ground rather than overwritten by it.
 *
 *  The normals are not optional. Every one of these builders computed normals for a flat sheet and
 *  got (0, 1, 0) throughout; on a graded surface that is a lie the lighting reads directly, and a
 *  road running down a hill would shade as though it were still level. */
export function drape(geometry: THREE.BufferGeometry, elevation: Elevation, step: number): void {
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    position.setY(i, position.getY(i) + elevation.at(position.getX(i), position.getZ(i)))
  }
  position.needsUpdate = true
  surfaceNormals(geometry, elevation, step)
  repairNormals(geometry)
}

/** Most passes a fill will be quartered through. Eight takes a kilometre-wide parcel down to four
 *  metres, which is past anything the ground cell asks for. */
const MAX_SUBDIVISIONS = 8

/** Split a flat fill until no edge is longer than `maxEdge`, so it has vertices to be draped BY.
 *
 *  Without this a run-off apron is three or four triangles spanning forty metres: draping moves only
 *  its outline and the sheet stays a flat plate cutting through the hillside it is supposed to lie
 *  on. The ground sheet has a grid for this reason and every fill laid on the ground needs the same.
 *
 *  Quartered on the edge MIDPOINTS rather than bisected on the longest edge, which matters for a
 *  non-indexed soup: two triangles sharing an edge see it as (a, b) and (b, a), and floating-point
 *  addition is commutative, so both compute bit-identical midpoints and the seam cannot crack.
 *
 *  Budgeted, because the same call has to survive a 12 m apron and a 1.5 km field parcel. */
export function subdivide(
  geometry: THREE.BufferGeometry, maxEdge: number, maxTriangles = 60_000,
): THREE.BufferGeometry {
  const source = geometry.getAttribute('position')
  // Soup only. Everything laid on the ground comes off `GeometrySink`, which is non-indexed by
  // design; an indexed geometry would need its index rebuilt and nothing here produces one.
  if (!source || geometry.index) return geometry
  let tris = Array.from(source.array as Float32Array)
  const max2 = maxEdge * maxEdge
  const mid = (o: number[], p: number, q: number) => {
    o.push((tris[p] + tris[q]) / 2, (tris[p + 1] + tris[q + 1]) / 2, (tris[p + 2] + tris[q + 2]) / 2)
  }
  for (let pass = 0; pass < MAX_SUBDIVISIONS; pass++) {
    if (tris.length / 9 * 4 > maxTriangles) break
    const next: number[] = []
    let any = false
    for (let i = 0; i < tris.length; i += 9) {
      const a = i
      const b = i + 3
      const c = i + 6
      const longest = Math.max(
        (tris[a] - tris[b]) ** 2 + (tris[a + 2] - tris[b + 2]) ** 2,
        (tris[b] - tris[c]) ** 2 + (tris[b + 2] - tris[c + 2]) ** 2,
        (tris[c] - tris[a]) ** 2 + (tris[c + 2] - tris[a + 2]) ** 2,
      )
      if (longest <= max2) {
        for (let k = 0; k < 9; k++) next.push(tris[i + k])
        continue
      }
      any = true
      const ab: number[] = []
      const bc: number[] = []
      const ca: number[] = []
      mid(ab, a, b)
      mid(bc, b, c)
      mid(ca, c, a)
      const at = (o: number) => [tris[o], tris[o + 1], tris[o + 2]]
      for (const t of [
        [at(a), ab, ca], [ab, at(b), bc], [ca, bc, at(c)], [ab, bc, ca],
      ]) next.push(...t.flat())
    }
    tris = next
    if (!any) break
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3))
  // Flat-up normals, which `drape` immediately overwrites with the ground's own. They are here so
  // the attribute SET matches what the flat builders emit: `mergeGeometries` requires every input to
  // carry the same attributes and returns null rather than throwing when one does not, so a fill
  // arriving with position alone silently collapses a whole ink run to nothing.
  const up = new Float32Array(tris.length)
  for (let i = 1; i < up.length; i += 3) up[i] = 1
  out.setAttribute('normal', new THREE.Float32BufferAttribute(up, 3))
  return out
}

/** Insert points along a polyline until no gap is longer than `maxGap`.
 *
 *  The ribbon builders offset a polyline sideways, so a ribbon has exactly the resolution ALONG its
 *  length that its polyline had: the circuit is sampled every six units, which on the wider-scaled
 *  circuits is nearly thirty metres of straight chord across a surface that is curving underneath
 *  it. That chord dips below the ground sheet, which is built at a six metre pitch and follows the
 *  curve far more closely, and the grass comes up through the tarmac. Straight-line insertion, so
 *  this adds resolution without adding any shape the polyline did not already have.
 *
 *  `subdivide` cannot do this job: the ribbons are indexed geometry with smooth normals, and the
 *  fix belongs before the triangles exist rather than after. */
export function refine<T extends { x: number; y: number }>(
  pts: readonly T[], maxGap: number, closed = false,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  const last = closed ? pts.length : pts.length - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxGap))
    for (let k = 0; k < steps; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps })
    }
  }
  if (!closed && pts.length > 0) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y })
  return out
}

/** The lowest ground any of a fill's vertices stands on. */
export function lowestOn(geometry: THREE.BufferGeometry, elevation: Elevation): number {
  const position = geometry.getAttribute('position')
  let lowest = Infinity
  for (let i = 0; i < position.count; i++) {
    const h = elevation.at(position.getX(i), position.getZ(i))
    if (h < lowest) lowest = h
  }
  return Number.isFinite(lowest) ? lowest : 0
}

/** Set a whole fill to one height: what water does, and nothing else on this ground. */
export function levelTo(geometry: THREE.BufferGeometry, y: number): void {
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) position.setY(i, y + position.getY(i))
  position.needsUpdate = true
  geometry.computeVertexNormals()
  repairNormals(geometry)
}

/** Grid lines along one axis: an even pitch across the circuit, then cells growing geometrically out
 *  to the sheet's edge. Returned as the actual coordinates, so the caller builds one plain tensor
 *  grid and never has to know the spacing was not uniform. */
export function axisLines(
  inner0: number, inner1: number, outer0: number, outer1: number, cell: number,
): number[] {
  const out: number[] = []
  // Outward from the fine region to the near edge, then reversed so the whole run is ascending.
  const leading: number[] = []
  let step = cell
  for (let x = inner0; x > outer0;) {
    step *= GROWTH
    x -= step
    leading.push(Math.max(x, outer0))
  }
  out.push(...leading.reverse())
  const count = Math.max(1, Math.round((inner1 - inner0) / cell))
  for (let i = 0; i <= count; i++) out.push(inner0 + ((inner1 - inner0) * i) / count)
  step = cell
  for (let x = inner1; x < outer1;) {
    step *= GROWTH
    x += step
    out.push(Math.min(x, outer1))
  }
  return out
}

export interface TerrainSheetOpts {
  /** The fine region: the circuit and everything graded around it, in world units. */
  inner: { x0: number; y0: number; x1: number; y1: number }
  /** Where the ground stops, in world units. */
  outer: { x0: number; y0: number; x1: number; y1: number }
  /** Grid pitch across the fine region, in world units. */
  cell: number
  /** How far to set the sheet below the true surface, in world units. */
  sink: number
}

/** The ground itself: one graded sheet over the whole world, standing on the elevation. */
export function terrainSheet(elevation: Elevation, o: TerrainSheetOpts): THREE.BufferGeometry {
  const xs = axisLines(o.inner.x0, o.inner.x1, o.outer.x0, o.outer.x1, o.cell)
  const zs = axisLines(o.inner.y0, o.inner.y1, o.outer.y0, o.outer.y1, o.cell)
  const w = xs.length
  const heights = new Float64Array(w * zs.length)
  const positions = new Float32Array(w * zs.length * 3)
  let k = 0
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < w; i++) {
      const h = elevation.at(xs[i], zs[j])
      heights[j * w + i] = h
      positions[k++] = xs[i]
      positions[k++] = h - o.sink
      positions[k++] = zs[j]
    }
  }
  // Normals off the GRID's own heights rather than by re-sampling the elevation around every vertex.
  // The heights are already in hand, and asking for four more per vertex was four fifths of the cost
  // of the whole sheet: MEASURED at 1087 ms for Britain's 109k vertices, against 245 ms this way.
  // Central differences where there is a neighbour on both sides, one-sided at the rim.
  const normals = new Float32Array(w * zs.length * 3)
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < w; i++) {
      const i0 = Math.max(0, i - 1)
      const i1 = Math.min(w - 1, i + 1)
      const j0 = Math.max(0, j - 1)
      const j1 = Math.min(zs.length - 1, j + 1)
      const dx = (heights[j * w + i1] - heights[j * w + i0]) / (xs[i1] - xs[i0] || 1)
      const dz = (heights[j1 * w + i] - heights[j0 * w + i]) / (zs[j1] - zs[j0] || 1)
      const len = Math.hypot(dx, 1, dz)
      const n = (j * w + i) * 3
      normals[n] = -dx / len
      normals[n + 1] = 1 / len
      normals[n + 2] = -dz / len
    }
  }
  const indices: number[] = []
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < w; i++) {
      const a = j * w + i
      const b = a + 1
      const c = a + w
      indices.push(a, c, b, b, c, c + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return repairNormals(geometry)
}
