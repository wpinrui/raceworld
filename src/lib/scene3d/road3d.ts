// Flat road geometry for the 3D race view (#3d-port increment 1): the polylines and rings the 2D
// renderer strokes and fills, turned into triangles on the ground plane. Everything here lies in the
// XZ plane at a caller-chosen lift; real height starts with the structures, not the road.
//
// Coordinates: world (u, v) viewBox units map to three as x = u, z = v, y up. The viewBox's y-down
// screen sense survives unchanged because the camera looks down -y with -z as screen-up.

import * as THREE from 'three'
import type { Vec } from '@/lib/ui/geom'
import { repairNormals } from './normals3d'

/** Segments in a rounded stroke cap. Matches nothing in 2D exactly: a canvas round cap is a true
 *  semicircle, and at road widths ten chords are within a pixel of one at every zoom the map has. */
const CAP_SEGS = 10

/** Per-vertex unit normals for a polyline: each vertex offsets along the average of its two segment
 *  directions, which is what keeps a dense polyline's ribbon edge smooth through corners. The mitre
 *  length correction is deliberately skipped: these polylines are sampled every few units, so the
 *  per-vertex turn is small and the width error is far below a pixel. */
function frames(pts: readonly Vec[], closed: boolean): { nx: Float64Array; ny: Float64Array } {
  const n = pts.length
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i + n - 1) % n] : pts[Math.max(0, i - 1)]
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    nx[i] = -dy / len
    ny[i] = dx / len
  }
  return { nx, ny }
}

function toGeometry(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  // Flat sheets still need real normals: a lit material reads the attribute, and an absent one is
  // whatever the driver defaults, not "up". Repaired straight after, because a dashed kerb or a
  // ribbon through a repeated sample leaves zero-area triangles whose normals come back zero.
  g.computeVertexNormals()
  return repairNormals(g)
}

export interface RibbonOpts {
  /** Half the stroke width, in world units. */
  halfW: number
  /** Lift off the ground plane, in world units. */
  y: number
  closed?: boolean
  /** Rounded end caps on an open ribbon, matching the 2D round stroke caps. */
  roundCaps?: boolean
}

/** A stroked polyline as a flat triangle strip: the circuit ribbon, the pit lane, a kerb's white base. */
export function ribbonGeometry(pts: readonly Vec[], o: RibbonOpts): THREE.BufferGeometry {
  const n = pts.length
  const { nx, ny } = frames(pts, !!o.closed)
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    positions.push(
      p.x + nx[i] * o.halfW, o.y, p.y + ny[i] * o.halfW,
      p.x - nx[i] * o.halfW, o.y, p.y - ny[i] * o.halfW,
    )
  }
  const quads = o.closed ? n : n - 1
  for (let i = 0; i < quads; i++) {
    const a = 2 * i
    const b = 2 * ((i + 1) % n)
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  if (!o.closed && o.roundCaps) {
    for (const end of [0, n - 1] as const) {
      const p = pts[end]
      const q = pts[end === 0 ? 1 : n - 2]
      const bl = Math.hypot(p.x - q.x, p.y - q.y) || 1
      // The cap bulges away from the ribbon: backwards at the start, forwards at the end.
      const bx = (p.x - q.x) / bl
      const by = (p.y - q.y) / bl
      const centre = positions.length / 3
      positions.push(p.x, o.y, p.y)
      for (let k = 0; k <= CAP_SEGS; k++) {
        const phi = (k / CAP_SEGS) * Math.PI
        const dx = nx[end] * Math.cos(phi) + bx * Math.sin(phi)
        const dy = ny[end] * Math.cos(phi) + by * Math.sin(phi)
        positions.push(p.x + dx * o.halfW, o.y, p.y + dy * o.halfW)
      }
      for (let k = 0; k < CAP_SEGS; k++) indices.push(centre, centre + 1 + k, centre + 2 + k)
    }
  }
  return toGeometry(positions, indices)
}

/** A filled closed ring (the working-lane apron): triangulated as authored, no offsetting. */
export function ringGeometry(ring: readonly Vec[], y: number): THREE.BufferGeometry {
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.y))
  const tris = THREE.ShapeUtils.triangulateShape(contour, [])
  const positions: number[] = []
  for (const p of ring) positions.push(p.x, y, p.y)
  return toGeometry(positions, tris.flat())
}

export interface DashPattern {
  /** Painted and gap lengths along the arc, in world units. Butt-ended, phase 0 at the first point,
   *  exactly as the 2D dashed stroke lays them. */
  on: number
  off: number
  /** Pattern shift, the 2D's `lineDashOffset`: stacked bands lay their blocks out of phase with it. */
  shift?: number
}

export interface DashOpts extends DashPattern {
  halfW: number
  y: number
}

/** One sample along a dashed polyline: where it is, which way across it points, how far along it
 *  sits, and whether the span STARTING here is painted (the last station's flag is never read). */
export interface DashStation {
  x: number
  y: number
  nx: number
  ny: number
  /** Arc length from the polyline's first point, in world units. */
  s: number
  painted: boolean
}

/** Arc slack, in world units, for deciding that a boundary has landed ON a polyline point rather
 *  than a hair either side of it. Coordinates out here run to the thousands, so this is still far
 *  beyond the double precision the walk carries and far below anything with a size. */
const ARC_EPS = 1e-9

/** Walk an open polyline, cutting it at every paint/gap boundary the pattern crosses.
 *
 *  Held apart from `dashGeometry` because the kerb needs the same walk without the flat quads: its
 *  red and white are two lofted solids that have to meet exactly, which they only do if both are
 *  cut at one set of stations, off one set of across-normals (`kerb3d`).
 *
 *  Boundaries are ADDRESSED, not accumulated: boundary k sits at a known arc, and the walk asks
 *  which ones a segment spans. The obvious alternative, carrying a running phase and subtracting the
 *  distance to the next boundary, cannot land on one exactly — the subtraction leaves a femtometre
 *  of residue, the next step reads it as "a boundary is a femtometre away", and every block emits a
 *  second station on top of its first. Harmless-looking (the quad between them has no area) and
 *  measured at a third of every dashed geometry in the world, which the kerb turned into a third of
 *  its triangles. */
export function dashStations(pts: readonly Vec[], o: DashPattern): DashStation[] {
  const n = pts.length
  const { nx, ny } = frames(pts, false)
  const period = o.on + o.off
  const shift = ((o.shift ?? 0) % period + period) % period
  // Even boundaries open a painted block, odd ones close it. So the span running from a station is
  // painted exactly when the boundary it is heading for closes one.
  const boundary = (k: number) => Math.floor(k / 2) * period + (k % 2 ? o.on : 0) - shift
  let k = 0
  while (boundary(k) <= ARC_EPS) k++
  const out: DashStation[] = []
  const emit = (x: number, y: number, fx: number, fy: number, s: number) => {
    out.push({ x, y, nx: fx, ny: fy, s, painted: k % 2 === 1 })
  }
  emit(pts[0].x, pts[0].y, nx[0], ny[0], 0)
  let arc = 0
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg === 0) continue
    const end = arc + seg
    // Cut the segment at every boundary strictly inside it, before emitting its far vertex.
    while (boundary(k) < end - ARC_EPS) {
      const cut = boundary(k)
      const f = (cut - arc) / seg
      const fx = nx[i - 1] + (nx[i] - nx[i - 1]) * f
      const fy = ny[i - 1] + (ny[i] - ny[i - 1]) * f
      const fl = Math.hypot(fx, fy) || 1
      k++
      emit(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, fx / fl, fy / fl, cut)
    }
    arc = end
    // A boundary landing on the far vertex is that station's, not a cut of its own.
    if (boundary(k) <= end + ARC_EPS) k++
    emit(b.x, b.y, nx[i], ny[i], arc)
  }
  return out
}

/** The painted blocks of a dashed stroke as flat quads along an open polyline. Block edges are cut
 *  exactly at their arc positions, so the 3D blocks land where the 2D dashes do. */
export function dashGeometry(pts: readonly Vec[], o: DashOpts): THREE.BufferGeometry {
  const stations = dashStations(pts, o)
  const positions: number[] = []
  const indices: number[] = []
  for (const st of stations) {
    positions.push(
      st.x + st.nx * o.halfW, o.y, st.y + st.ny * o.halfW,
      st.x - st.nx * o.halfW, o.y, st.y - st.ny * o.halfW,
    )
  }
  for (let i = 0; i + 1 < stations.length; i++) {
    if (!stations[i].painted) continue
    const a = 2 * i
    const b = 2 * (i + 1)
    indices.push(a, a + 1, b, a + 1, b + 1, b)
  }
  return toGeometry(positions, indices)
}

/** Axis-aligned rectangles in a local frame, baked into world space: the start-line chequer, and the
 *  grid boxes after it. The frame convention is road-marks.ts's `rectPath`, kept exactly. */
export function localRectsGeometry(
  at: { x: number; y: number; angle: number },
  rects: ReadonlyArray<readonly [number, number, number, number]>,
  y: number,
): THREE.BufferGeometry {
  const cos = Math.cos(at.angle)
  const sin = Math.sin(at.angle)
  const positions: number[] = []
  const indices: number[] = []
  for (const [x, y2, w, h] of rects) {
    const base = positions.length / 3
    for (const [lx, ly] of [[x, y2], [x + w, y2], [x + w, y2 + h], [x, y2 + h]] as const) {
      positions.push(at.x + lx * cos - ly * sin, y, at.y + lx * sin + ly * cos)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return toGeometry(positions, indices)
}
