// Path sampling for the 3D world (#3d-port increment 2). The 2D describes every organic shape as an
// SVG path string — M/L/Q/H/V/Z is the whole vocabulary `smoothClosed`, `blobPath` and `partsPath`
// emit, the same set `mapPathPoints` speaks — and the 3D needs polygons. One tokeniser, quadratics
// sampled at a fixed subdivision, rings out.

import type { Vec } from '@/lib/ui/geom'

/** Chords per quadratic. The blobs' lobes span metres; six chords keep the sampled ring within a
 *  few centimetres of the drawn curve, far under a pixel at any zoom the map has. */
const QUAD_SEGS = 6

/** Sample a path's subpaths into rings of points. Closing Z points are not duplicated: a ring's last
 *  point never repeats its first. Degenerate subpaths (under 3 points) are dropped. */
export function samplePathRings(d: string, quadSegs = QUAD_SEGS): Vec[][] {
  const toks = d.match(/[MLQZzHhVv]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const rings: Vec[][] = []
  let ring: Vec[] = []
  let cx = 0
  let cy = 0
  const close = () => {
    if (ring.length >= 2) {
      const a = ring[0]
      const b = ring[ring.length - 1]
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) ring.pop()
    }
    if (ring.length >= 3) rings.push(ring)
    ring = []
  }
  const push = (x: number, y: number) => {
    ring.push({ x, y })
    cx = x
    cy = y
  }
  for (let i = 0; i < toks.length;) {
    const tok = toks[i]
    switch (tok) {
      case 'Z':
      case 'z':
        close()
        i += 1
        break
      case 'M':
        close()
        push(Number(toks[i + 1]), Number(toks[i + 2]))
        i += 3
        break
      case 'L':
        push(Number(toks[i + 1]), Number(toks[i + 2]))
        i += 3
        break
      case 'Q': {
        const qx = Number(toks[i + 1])
        const qy = Number(toks[i + 2])
        const ex = Number(toks[i + 3])
        const ey = Number(toks[i + 4])
        const ax = cx
        const ay = cy
        for (let k = 1; k <= quadSegs; k++) {
          const t = k / quadSegs
          const s = 1 - t
          push(s * s * ax + 2 * s * t * qx + t * t * ex, s * s * ay + 2 * s * t * qy + t * t * ey)
        }
        i += 5
        break
      }
      case 'H':
        push(Number(toks[i + 1]), cy)
        i += 2
        break
      case 'h':
        push(cx + Number(toks[i + 1]), cy)
        i += 2
        break
      case 'V':
        push(cx, Number(toks[i + 1]))
        i += 2
        break
      case 'v':
        push(cx, cy + Number(toks[i + 1]))
        i += 2
        break
      default:
        throw new Error(`samplePathRings: unsupported command "${tok}"`)
    }
  }
  close()
  return rings
}

/** Is the point inside the ring, by ray cast? On-edge behaviour is unspecified, which is fine for
 *  containment-depth grouping: representative points are taken from ring vertices, never on another
 *  ring's edge. */
export function pointInRing(p: Vec, ring: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export interface PolyWithHoles { contour: Vec[]; holes: Vec[][] }

/** Group rings into outer contours and their holes, matching the even-odd fill the 2D uses for the
 *  relief bands: a ring inside an odd number of others is a hole in the innermost of them. */
export function ringsToPolys(rings: Vec[][]): PolyWithHoles[] {
  const area = (r: Vec[]) => {
    let a = 0
    for (let i = 0; i < r.length; i++) {
      const p = r[i]
      const q = r[(i + 1) % r.length]
      a += p.x * q.y - q.x * p.y
    }
    return Math.abs(a / 2)
  }
  const meta = rings.map((ring) => {
    const parents = rings.filter((other) => other !== ring && pointInRing(ring[0], other))
    return { ring, area: area(ring), depth: parents.length, parents }
  })
  const polys = new Map<Vec[], PolyWithHoles>()
  for (const m of meta) {
    if (m.depth % 2 === 0) polys.set(m.ring, { contour: m.ring, holes: [] })
  }
  for (const m of meta) {
    if (m.depth % 2 === 0) continue
    // The hole belongs to the smallest even-depth ring that contains it.
    const owner = m.parents
      .filter((p) => polys.has(p))
      .sort((a, b) => area(a) - area(b))[0]
    if (owner) polys.get(owner)!.holes.push(m.ring)
  }
  return [...polys.values()]
}
