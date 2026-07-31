// Solid geometry for the 3D world (#3d-port increment 2): the un-flattening of `extrude.ts`. Where
// the 2D sweeps a footprint along the view bearing and paints the connecting parallelograms, these
// builders give the same footprints real height and let the light do the rest. Everything is
// non-indexed with face normals: a box's whole read here is flat planes under one sun.

import * as THREE from 'three'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Vec } from '@/lib/ui/geom'
import type { SceneryPart } from '@/lib/ui/scenery-shapes'

/** Edges turning less than this shade as one continuous surface; sharper ones keep their crease.
 *  What lets a loft read as a curve instead of a count of flat facets, without blunting a box. */
const CREASE = 0.6

export interface V3 { x: number; y: number; z: number }
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })

/** Accumulates triangles and builds one non-indexed geometry. Unshared vertices on purpose:
 *  `computeVertexNormals` then yields per-face normals, which is the flat shading everything here
 *  wants. Materials stay double-sided, so winding never decides whether a face lights. */
export class GeometrySink {
  private positions: number[] = []

  tri(a: V3, b: V3, c: V3): void {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }

  quad(a: V3, b: V3, c: V3, d: V3): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  get empty(): boolean {
    return this.positions.length === 0
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    // Creased rather than per-face normals: consecutive shallow facets smooth into one surface,
    // right angles stay sharp.
    return toCreasedNormals(g, CREASE)
  }
}

/** Vertical walls along a closed ring, between two heights. */
export function addRingWalls(s: GeometrySink, ring: readonly Vec[], y0: number, y1: number): void {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    s.quad(v3(p.x, y0, p.y), v3(q.x, y0, q.y), v3(q.x, y1, q.y), v3(p.x, y1, p.y))
  }
}

/** A flat horizontal fill of a contour with holes, at a height. */
export function addPolyCap(s: GeometrySink, contour: readonly Vec[], holes: readonly Vec[][], y: number): void {
  const c = contour.map((p) => new THREE.Vector2(p.x, p.y))
  const hs = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)))
  const all = [...contour, ...holes.flat()]
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(c, hs)) {
    s.tri(v3(all[i].x, y, all[i].y), v3(all[j].x, y, all[j].y), v3(all[k].x, y, all[k].y))
  }
}

/** Walls of a closed ring plus an optional roof: the pit building's storeys, the plant boxes. */
export function ringSolidGeometry(ring: readonly Vec[], y0: number, y1: number, capTop = true): THREE.BufferGeometry {
  const s = new GeometrySink()
  addRingWalls(s, ring, y0, y1)
  if (capTop) addPolyCap(s, ring, [], y1)
  return s.build()
}

/** A vertical ribbon along an OPEN run: a debris fence's cage face, a parapet. */
export function wallStripGeometry(pts: readonly Vec[], y0: number, y1: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    s.quad(v3(p.x, y0, p.y), v3(q.x, y0, q.y), v3(q.x, y1, q.y), v3(p.x, y1, p.y))
  }
  return s.build()
}

const partEdges = (p: SceneryPart) => {
  const x0 = p.dx - p.w / 2
  const x1 = p.dx + p.w / 2
  const z0 = p.dy - p.h / 2
  const z1 = p.dy + p.h / 2
  return { x0, x1, z0, z1 }
}

/** A rect-union solid in its footprint's local frame: four walls and a roof per part. Overlapping
 *  part roofs share a height, so each takes a millimetre of its own — far under anything visible,
 *  enough that coplanar tops stop fighting in the depth buffer. */
export function partsSolidGeometry(parts: readonly SceneryPart[], y0: number, y1: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  parts.forEach((p, i) => {
    const { x0, x1, z0, z1 } = partEdges(p)
    const top = y1 + i * 1e-3
    s.quad(v3(x0, top, z0), v3(x1, top, z0), v3(x1, top, z1), v3(x0, top, z1))
    s.quad(v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, top, z0), v3(x0, top, z0))
    s.quad(v3(x1, y0, z0), v3(x1, y0, z1), v3(x1, top, z1), v3(x1, top, z0))
    s.quad(v3(x1, y0, z1), v3(x0, y0, z1), v3(x0, top, z1), v3(x1, top, z1))
    s.quad(v3(x0, y0, z1), v3(x0, y0, z0), v3(x0, top, z0), v3(x0, top, z1))
  })
  return s.build()
}

/** The four outward edges of a part, with normals, for anything laid in a wall's plane. */
interface WallEdge { a: Vec; b: Vec; nx: number; nz: number }
const wallEdges = (p: SceneryPart): WallEdge[] => {
  const { x0, x1, z0, z1 } = partEdges(p)
  return [
    { a: { x: x0, y: z0 }, b: { x: x1, y: z0 }, nx: 0, nz: -1 },
    { a: { x: x1, y: z0 }, b: { x: x1, y: z1 }, nx: 1, nz: 0 },
    { a: { x: x1, y: z1 }, b: { x: x0, y: z1 }, nx: 0, nz: 1 },
    { a: { x: x0, y: z1 }, b: { x: x0, y: z0 }, nx: -1, nz: 0 },
  ]
}

/** Glazing for a rect-union solid: the same bay-and-storey grid `wallWindows` laid, on every outward
 *  wall, floated just off the surface. Edges buried inside the union carry none, by the same probe
 *  the 2D uses: three points just outside the edge, covered everywhere means interior. */
export function partsWindowsGeometry(
  parts: readonly SceneryPart[], y0: number, y1: number, cell: number, rows: number,
  out = 0.06, wFrac = 0.42, hFrac = 0.46,
): THREE.BufferGeometry | null {
  if (rows < 1 || cell <= 0) return null
  const s = new GeometrySink()
  for (const p of parts) {
    for (const e of wallEdges(p)) {
      const eps = 1e-3
      const buried = [0.15, 0.5, 0.85].every((t) => {
        const px = e.a.x + (e.b.x - e.a.x) * t + e.nx * eps
        const pz = e.a.y + (e.b.y - e.a.y) * t + e.nz * eps
        return parts.some((q) => q !== p
          && Math.abs(px - q.dx) < q.w / 2 && Math.abs(pz - q.dy) < q.h / 2)
      })
      if (buried) continue
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)
      const cols = Math.floor(len / cell)
      if (cols < 1) continue
      const pad = (1 - (cols * cell) / len) / 2
      const bay = cell / len
      const at = (u: number, y: number): V3 => v3(
        e.a.x + (e.b.x - e.a.x) * u + e.nx * out, y, e.a.y + (e.b.y - e.a.y) * u + e.nz * out,
      )
      for (let c = 0; c < cols; c++) {
        const u0 = pad + (c + (1 - wFrac) / 2) * bay
        const u1 = u0 + wFrac * bay
        for (let r = 0; r < rows; r++) {
          const f0 = (r + (1 - hFrac) / 2) / rows
          const f1 = f0 + hFrac / rows
          s.quad(
            at(u0, y0 + (y1 - y0) * f0), at(u1, y0 + (y1 - y0) * f0),
            at(u1, y0 + (y1 - y0) * f1), at(u0, y0 + (y1 - y0) * f1),
          )
        }
      }
    }
  }
  return s.empty ? null : s.build()
}
