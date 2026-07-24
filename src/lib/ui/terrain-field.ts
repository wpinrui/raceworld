// Faux elevation for the 2D race view (#sim-2d). One deterministic height field drives relief,
// water siting and vegetation, so the landscape agrees with itself instead of being independent
// scatter. The impression of terrain is the goal, not survey accuracy.
//
// The field is rendered as TERRACED contour bands: for each level, the region above it is filled
// from an altitude ramp and given a dark offset copy underneath, so each step catches light from the
// top-left exactly like every other prop's drop shadow. Bands are a few dozen large paths, which is
// what makes them survive full zoom-out — the one place the old flat ground plane was most obvious.

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
  /** Local steepness, as the height delta over a short baseline. */
  slopeAt(p: Vec): number
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
  const step = 8 / metresPerUnit // an 8 m baseline
  return {
    at,
    slopeAt: (p) => {
      const dx = at({ x: p.x + step, y: p.y }) - at({ x: p.x - step, y: p.y })
      const dy = at({ x: p.x, y: p.y + step }) - at({ x: p.x, y: p.y - step })
      return Math.hypot(dx, dy) / (2 * 8)
    },
  }
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
  // Nearest profile height, found through the same index the clearance rules use.
  const profileAt = (p: Vec): number => {
    let best = Infinity
    let bi = 0
    for (let i = 0; i < n; i += 3) {
      const d = (centreline[i].x - p.x) ** 2 + (centreline[i].y - p.y) ** 2
      if (d < best) { best = d; bi = i }
    }
    return smooth[bi]
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
  const step = 4
  return {
    at,
    slopeAt: (p) => {
      const dx = at({ x: p.x + step, y: p.y }) - at({ x: p.x - step, y: p.y })
      const dy = at({ x: p.x, y: p.y + step }) - at({ x: p.x, y: p.y - step })
      return Math.hypot(dx, dy) / (2 * step)
    },
  }
}

const kx = (v: number) => Math.round(v * 100) / 100

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

  const segs: Array<[Vec, Vec]> = []
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
      const top = () => lerp(x0, y0, tl, x1, y0, tr)
      const right = () => lerp(x1, y0, tr, x1, y1, br)
      const bottom = () => lerp(x0, y1, bl, x1, y1, br)
      const left = () => lerp(x0, y0, tl, x0, y1, bl)
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

  // Chain segments end-to-start into loops.
  const byStart = new Map<string, number[]>()
  segs.forEach(([a], idx) => {
    const k = `${kx(a.x)},${kx(a.y)}`
    const b = byStart.get(k)
    if (b) b.push(idx)
    else byStart.set(k, [idx])
  })
  const used = new Uint8Array(segs.length)
  const loops: Vec[][] = []
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue
    const loop: Vec[] = [segs[s][0]]
    let cur = s
    used[cur] = 1
    for (let guard = 0; guard < segs.length + 2; guard++) {
      const end = segs[cur][1]
      loop.push(end)
      const cand = byStart.get(`${kx(end.x)},${kx(end.y)}`)
      const next = cand?.find((i) => !used[i])
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
}

/** Terraced bands over `box`, lowest first. `ramp` supplies the fill per level (0 = lowest). */
export function bandsFor(
  field: HeightField, box: FieldBox, ramp: string[],
  { nx = 104, ny = 96, reliefM = 55 }: { nx?: number; ny?: number; reliefM?: number } = {},
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
    const d = loops
      .map((l) => `M ${l.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} Z`)
      .join(' ')
    out.push({ d, fill: ramp[k] })
  }
  return out
}
