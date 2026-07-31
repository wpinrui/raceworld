// Faux elevation for the 2D race view (#sim-2d). One deterministic height field drives relief,
// water siting and vegetation, so the landscape agrees with itself instead of being independent
// scatter. The impression of terrain is the goal, not survey accuracy.
//
// The field is rendered as TERRACED contour bands: for each level, the region above it is filled
// from an altitude ramp and given a dark offset copy underneath, so each step catches light from the
// top-left exactly like every other prop's drop shadow. Bands are a few dozen large paths, which is
// what makes them survive full zoom-out — the one place the old flat ground plane was most obvious.

import { smoothClosed } from './scenery-shapes'
import { blend } from './surface-ink'

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

/** The alpha a soft band is washed on at.
 *
 *  Here rather than at the renderer that applies it, because anything folding a stack of bands into
 *  one colour has to composite them at exactly the alpha they would otherwise have been drawn with,
 *  and a second copy of this number is how that quietly stops being true. */
export const SOFT_BAND_ALPHA = 0.3

/** The sampled grid the contours were traced out of, kept alongside them.
 *
 *  A band is a REGION, not an outline: where no contour of it runs through the shot, every pixel of
 *  that shot takes the same stack of band fills, and a stack of fills that is constant over the whole
 *  surface is a colour the surface could have been cleared to instead. Deciding that needs one
 *  question answered per shot — does the shot hold a contour — and asking it of the paths means
 *  walking tens of thousands of points a compose. Asked of this grid it is a min and a max over the
 *  cells the shot touches, and because it is the same grid the contours were traced from, the answer
 *  cannot disagree with the picture. */
export interface BandField {
  /** Row-major corner samples, `(nx + 1) * (ny + 1)` of them. */
  val: Float64Array
  box: FieldBox
  nx: number
  ny: number
  /** The level each RETURNED band was traced at, ascending, one per band. Levels that produced no
   *  loops are not in the band list and are not here either, so the two stay index-aligned. */
  levels: number[]
}

/** How many bands cover a whole disc, or null when a contour runs through it.
 *
 *  Bands NEST: each is the region at or above its own level and the levels ascend, so a point is
 *  covered by the first n of them for some n, and "how many" is the whole answer.
 *
 *  A cell holds a contour of level L exactly when its corners straddle L, which is the same test
 *  `isoLoops` marched on. So over the corners the disc reaches: a level in `(min, max]` is crossed
 *  and there is nothing constant to fold, and otherwise the levels at or below the min are the ones
 *  covering the disc.
 *
 *  The reach is the disc plus one and a half cell diagonals, which is derived rather than padded. A
 *  straddling cell has to be scanned WHOLE, since it is the spread across its corners that reveals the
 *  level. Take a drawn contour point inside the disc: it is a point of a `smoothClosed` quadratic
 *  whose control triangle is one raw vertex and the midpoints either side, so it lies within half a
 *  segment of that vertex, and a marching-squares segment runs inside one cell (at most a diagonal).
 *  The vertex itself sits on an edge of the straddling cell, so every corner of that cell is within a
 *  further diagonal. Half plus one, on top of the disc.
 *
 *  Against the DISC rather than its bounding square, which sounds like a detail and is not: at the
 *  close shot the square's corners reach half as far again as the disc does, and every corner that
 *  reaches a contour the shot cannot see is a fold refused for nothing.
 *
 *  A disc reaching outside the box counts as reaching ground below every level, since that is what is
 *  drawn out there: no band paths exist beyond the box. */
export function bandsCovering(
  f: BandField, disc: { cx: number; cy: number; r: number } | null,
): number | null {
  // No disc is the whole world, which always holds a contour.
  if (!disc || f.levels.length === 0) return null
  const gw = f.box.w / f.nx
  const gh = f.box.h / f.ny
  const reach = disc.r + 1.5 * Math.hypot(gw, gh)
  const i0 = Math.max(0, Math.floor((disc.cx - reach - f.box.x) / gw))
  const i1 = Math.min(f.nx, Math.ceil((disc.cx + reach - f.box.x) / gw))
  const j0 = Math.max(0, Math.floor((disc.cy - reach - f.box.y) / gh))
  const j1 = Math.min(f.ny, Math.ceil((disc.cy + reach - f.box.y) / gh))
  // Reaching past the sampled box is ground below every level, so the minimum goes with it. Asked of
  // the DISC and not of the scanned indices, or a shot a cell short of the edge would read as
  // straddling ground that is not out there.
  const beyond = disc.cx - disc.r < f.box.x || disc.cx + disc.r > f.box.x + f.box.w
    || disc.cy - disc.r < f.box.y || disc.cy + disc.r > f.box.y + f.box.h
  let min = beyond ? -Infinity : Infinity
  let max = -Infinity
  const r2 = reach * reach
  for (let j = j0; j <= j1; j++) {
    const row = j * (f.nx + 1)
    const dy = f.box.y + j * gh - disc.cy
    for (let i = i0; i <= i1; i++) {
      const dx = f.box.x + i * gw - disc.cx
      if (dx * dx + dy * dy > r2) continue
      const v = f.val[row + i]
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  // The disc is entirely off the sampled box: bare ground, no bands, nothing to draw.
  if (max === -Infinity) return 0
  let covering = 0
  for (const level of f.levels) {
    if (level > min && level <= max) return null
    if (level <= min) covering++
  }
  return covering
}

/** What a shot's bands resolve to when they resolve to one colour, or null when they have to be drawn.
 *
 *  Composited in DRAW order at the alpha each band would have been drawn with, through the same sRGB
 *  byte lerp the renderer's own opaque pre-blending uses, which is what `globalAlpha` source-over
 *  does to two opaque colours. */
export function bandWash(
  bands: readonly TerrainBand[], f: BandField, base: string,
  disc: { cx: number; cy: number; r: number } | null,
): string | null {
  const n = bandsCovering(f, disc)
  if (n === null) return null
  let c = base
  for (let i = 0; i < n; i++) c = blend(c, bands[i].fill, bands[i].soft ? SOFT_BAND_ALPHA : 1)
  return c
}

/** Terraced bands over `box`, lowest first, with the grid they were traced out of. `ramp` supplies the
 *  fill per level (0 = lowest).
 *
 *  The grid comes back rather than being thrown away because a renderer needs to ask, per shot,
 *  whether a contour is in it (see `BandField`), and the only answer that cannot disagree with the
 *  drawn picture is one taken from the samples the picture was traced from. */
export function bandsFor(
  field: HeightField, box: FieldBox, ramp: string[],
  { nx = 104, ny = 96, reliefM = 55, soft = false }:
  { nx?: number; ny?: number; reliefM?: number; soft?: boolean } = {},
): { bands: TerrainBand[]; field: BandField } {
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
  const levels: number[] = []
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
    // Pushed WITH the band, never per ramp entry: a level that traced no loops is not a band, and a
    // levels list that counted it would put every later band's level against the wrong one.
    levels.push(level)
  }
  return { bands: out, field: { val, box, nx, ny, levels } }
}
