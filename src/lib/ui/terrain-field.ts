// Faux elevation for the 2D race view (#sim-2d). One deterministic height field drives relief,
// water siting and vegetation, so the landscape agrees with itself instead of being independent
// scatter. The impression of terrain is the goal, not survey accuracy.
//
// The field is rendered as TERRACED contour bands: for each level, the region above it is filled
// from an altitude ramp and given a dark offset copy underneath, so each step catches light from the
// top-left exactly like every other prop's drop shadow. Bands are a few dozen large paths, which is
// what makes them survive full zoom-out — the one place the old flat ground plane was most obvious.

import { smoothClosed } from './scenery-shapes'

export type Vec = { x: number; y: number }

/** Sampling box in world (viewBox) units. */
export interface FieldBox { x: number; y: number; w: number; h: number }

/** Deterministic lattice hash in [0,1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** Value noise on a unit lattice, smoothstep-interpolated. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smoothstep(x - ix)
  const fy = smoothstep(y - iy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy
}

export interface HeightField {
  /** Height in metres at a world point. */
  at(p: Vec): number
}

/** Fractal height field. `featureM` is the size of the largest landform in METRES — keyed on real
 *  distance rather than viewBox units, because metresPerUnit varies 1.77-6.24 across the circuits
 *  and a unit-keyed field would give each track a different-sized landscape. */
export function makeHeightField(
  seedNum: number,
  { metresPerUnit, featureM = 900, reliefM = 55, octaves = 4 }:
  { metresPerUnit: number; featureM?: number; reliefM?: number; octaves?: number },
): HeightField {
  const scale = 1 / (featureM / metresPerUnit) // world units -> lattice units
  const at = (p: Vec): number => {
    let sum = 0
    let amp = 1
    let norm = 0
    let f = scale
    for (let o = 0; o < octaves; o++) {
      sum += valueNoise(p.x * f, p.y * f, seedNum + o * 7919) * amp
      norm += amp
      amp *= 0.5
      f *= 2
    }
    return (sum / norm) * reliefM
  }
  return { at }
}

/** Blend the field toward the circuit's own smoothed elevation profile near the track, so the
 *  circuit sits in a graded corridor. Where the land is higher than the corridor you get a cutting;
 *  where lower, an embankment. Real circuits are cut into the landscape, and this is the cue that
 *  reads hardest because it is right where the player is looking. */
export function gradeToTrack(
  field: HeightField,
  centreline: Vec[],
  { corridorU, distTo }: { corridorU: number; distTo: (p: Vec) => number },
): HeightField {
  // The track's own profile: the raw field along the centreline, smoothed along arc length so the
  // circuit rises and falls gently instead of following every lump.
  const raw = centreline.map((p) => field.at(p))
  const n = raw.length
  const win = Math.max(1, Math.round(n / 24))
  const smooth = new Float64Array(n)
  let acc = 0
  for (let i = -win; i <= win; i++) acc += raw[((i % n) + n) % n]
  for (let i = 0; i < n; i++) {
    smooth[i] = acc / (2 * win + 1)
    acc -= raw[((i - win) % n + n) % n]
    acc += raw[((i + win + 1) % n + n) % n]
  }
  // Corridor height at a point, interpolated CONTINUOUSLY along the centreline. A nearest-vertex
  // lookup is piecewise constant, so the graded height jumped as a sample crossed from one vertex's
  // territory to the next — and because the contour bands are level sets of this field, those jumps
  // came out as hard dark wedges radiating off the circuit. Projecting onto the segments and
  // interpolating between stations removes the discontinuity at its source.
  const profileAt = (p: Vec): number => {
    let best = Infinity
    let bestIdx = 0
    for (let i = 0; i < n; i++) {
      const a = centreline[i]
      const b = centreline[(i + 1) % n]
      const vx = b.x - a.x
      const vy = b.y - a.y
      const l2 = vx * vx + vy * vy
      let t = l2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const qx = a.x + t * vx - p.x
      const qy = a.y + t * vy - p.y
      const d = qx * qx + qy * qy
      if (d < best) { best = d; bestIdx = i + t }
    }
    const i0 = Math.floor(bestIdx) % n
    const frac = bestIdx - Math.floor(bestIdx)
    return smooth[i0] * (1 - frac) + smooth[(i0 + 1) % n] * frac
  }
  // Grading only matters within `corridorU` of the track, but the sampled world reaches ~1.5 km
  // past the circuit. Bounding the track first turns the overwhelming majority of samples into one
  // rectangle test instead of a spatial-index query.
  let bx0 = Infinity
  let by0 = Infinity
  let bx1 = -Infinity
  let by1 = -Infinity
  for (const p of centreline) {
    if (p.x < bx0) bx0 = p.x
    if (p.x > bx1) bx1 = p.x
    if (p.y < by0) by0 = p.y
    if (p.y > by1) by1 = p.y
  }
  const at = (p: Vec): number => {
    if (p.x < bx0 - corridorU || p.x > bx1 + corridorU || p.y < by0 - corridorU || p.y > by1 + corridorU) {
      return field.at(p)
    }
    const d = distTo(p)
    if (d >= corridorU) return field.at(p)
    const t = smoothstep(d / corridorU) // 0 at the track, 1 at the corridor edge
    return profileAt(p) * (1 - t) + field.at(p) * t
  }
  return { at }
}


/** Marching squares over `box`, returning the CLOSED loops bounding the region at or above `level`.
 *  The sampler is damped to below every level at the box edge (see `bandsFor`), so no contour runs
 *  off the edge and every loop closes — which is what lets each band be filled as one path. */
export function isoLoops(
  val: Float64Array, box: FieldBox, level: number, nx: number, ny: number,
): Vec[][] {
  const gw = box.w / nx
  const gh = box.h / ny
  const v = (i: number, j: number) => val[j * (nx + 1) + i]
  // Interpolated crossing on an edge between two lattice points.
  const lerp = (ax: number, ay: number, av: number, bx: number, by: number, bv: number): Vec => {
    const t = Math.abs(bv - av) < 1e-9 ? 0.5 : (level - av) / (bv - av)
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t }
  }

  // Crossings are keyed by EDGE IDENTITY, not by rounded coordinates. Two cells that meet on an
  // edge compute the same crossing there, so the shared edge index joins them exactly. Rounding the
  // coordinates instead is not collision-free: on the shipped circuits, near-degenerate cells emit
  // sub-micron segments whose two ends round to the SAME key, and the chainer could then take the
  // wrong continuation and leave a loop open — which `Z` would close with a chord straight across a
  // terrain band. Edge ids make the join exact regardless of the field's scale or seed.
  const hEdge = (i: number, j: number) => (j * (nx + 1) + i) * 2 // between (i,j) and (i+1,j)
  const vEdge = (i: number, j: number) => (j * (nx + 1) + i) * 2 + 1 // between (i,j) and (i,j+1)

  type Cross = { p: Vec; e: number }
  const segs: Array<[Cross, Cross]> = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = box.x + i * gw
      const y0 = box.y + j * gh
      const x1 = x0 + gw
      const y1 = y0 + gh
      const tl = v(i, j)
      const tr = v(i + 1, j)
      const br = v(i + 1, j + 1)
      const bl = v(i, j + 1)
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0)
      if (code === 0 || code === 15) continue
      const top = (): Cross => ({ p: lerp(x0, y0, tl, x1, y0, tr), e: hEdge(i, j) })
      const right = (): Cross => ({ p: lerp(x1, y0, tr, x1, y1, br), e: vEdge(i + 1, j) })
      const bottom = (): Cross => ({ p: lerp(x0, y1, bl, x1, y1, br), e: hEdge(i, j + 1) })
      const left = (): Cross => ({ p: lerp(x0, y0, tl, x0, y1, bl), e: vEdge(i, j) })
      // Segments are wound so the region ABOVE the level lies to the left of travel.
      switch (code) {
        case 1: segs.push([left(), bottom()]); break
        case 2: segs.push([bottom(), right()]); break
        case 3: segs.push([left(), right()]); break
        case 4: segs.push([right(), top()]); break
        case 5: segs.push([left(), top()], [right(), bottom()]); break
        case 6: segs.push([bottom(), top()]); break
        case 7: segs.push([left(), top()]); break
        case 8: segs.push([top(), left()]); break
        case 9: segs.push([top(), bottom()]); break
        case 10: segs.push([top(), right()], [bottom(), left()]); break
        case 11: segs.push([top(), right()]); break
        case 12: segs.push([right(), left()]); break
        case 13: segs.push([right(), bottom()]); break
        case 14: segs.push([bottom(), left()]); break
      }
    }
  }

  // Chain segments end-to-start into loops, joining on the shared edge id.
  const byStart = new Map<number, number[]>()
  segs.forEach(([a], idx) => {
    const b = byStart.get(a.e)
    if (b) b.push(idx)
    else byStart.set(a.e, [idx])
  })
  const used = new Uint8Array(segs.length)
  const loops: Vec[][] = []
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue
    const loop: Vec[] = [segs[s][0].p]
    let cur = s
    used[cur] = 1
    for (let guard = 0; guard < segs.length + 2; guard++) {
      const end = segs[cur][1]
      loop.push(end.p)
      const next = byStart.get(end.e)?.find((i) => !used[i])
      if (next === undefined) break
      used[next] = 1
      cur = next
    }
    if (loop.length >= 4) loops.push(loop)
  }
  return loops
}

export interface TerrainBand {
  /** All loops of this level as one even-odd path, so nested hills and basins fill correctly. */
  d: string
  fill: string
  /** Drawn as a faint wash rather than a distinct terrace. What read as noise was the STEPPING —
   *  hard-edged levels each with a dark offset edge beneath it, which is a topographic map, not
   *  ground. A few levels at low opacity with no step shadow is just gentle large-scale variation. */
  soft?: boolean
}

/** The alpha a soft band is washed on at. Here rather than at the renderer, so the drawing
 *  description and the generator cannot disagree about it. */
export const SOFT_BAND_ALPHA = 0.3

/** Terraced bands over `box`, lowest first. `ramp` supplies the fill per level (0 = lowest). */
export function bandsFor(
  field: HeightField, box: FieldBox, ramp: string[],
  { nx = 104, ny = 96, reliefM = 55, soft = false }:
  { nx?: number; ny?: number; reliefM?: number; soft?: boolean } = {},
): TerrainBand[] {
  // Damp toward the box edge so every contour closes inside it. Without this, contours run off the
  // edge as open curves and cannot be filled as a region.
  const damped = (p: Vec): number => {
    const fx = Math.min(1, (2 * Math.min(p.x - box.x, box.x + box.w - p.x)) / box.w)
    const fy = Math.min(1, (2 * Math.min(p.y - box.y, box.y + box.h - p.y)) / box.h)
    const edge = Math.max(0, Math.min(fx, fy))
    return field.at(p) * smoothstep(Math.min(1, edge * 6)) - (1 - smoothstep(Math.min(1, edge * 6))) * reliefM
  }
  // Sample the grid ONCE and reuse it for every level: the field is the expensive part, and
  // re-sampling it per band multiplied that cost by the number of bands.
  const gw = box.w / nx
  const gh = box.h / ny
  const val = new Float64Array((nx + 1) * (ny + 1))
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      val[j * (nx + 1) + i] = damped({ x: box.x + i * gw, y: box.y + j * gh })
    }
  }

  const out: TerrainBand[] = []
  for (let k = 0; k < ramp.length; k++) {
    // Levels span the middle of the relief range; the extremes carry no readable area.
    const level = ((k + 1) / (ramp.length + 1)) * reliefM
    const loops = isoLoops(val, box, level, nx, ny)
    if (!loops.length) continue
    // Smooth each ring rather than emitting the raw marching-squares polygon. The grid is ~40 m per
    // cell over a kilometre-wide box, so straight contour segments are clearly visible once the
    // camera is anywhere near the track, and terrain reads as faceted wedges instead of landform.
    // Quadratics through the midpoints cost the same node count as the line segments they replace.
    const d = loops.map((l) => (l.length >= 4 ? smoothClosed(l) : '')).filter(Boolean).join(' ')
    if (!d) continue
    out.push({ d, fill: ramp[k], soft })
  }
  return out
}
