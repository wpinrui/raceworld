// The world's one height (#elevation). Every renderer, every geometry builder and every prop asks
// this and nothing else how high the ground is at a point, so the circuit, the grass it runs
// through, the trees beside it and the cars on it can never disagree about where the surface is.
//
// The device it replaces was a colour STEP: terraced contour bands painted a lighter green for
// higher ground, which is the only thing a top-down orthographic view can do, and which a lit scene
// renders as a dead-straight seam sweeping across flat grass. Height is geometry here.
//
// ONE ANCHOR, and that is the whole design. The circuit carries a smoothed elevation profile along
// its own arc, and every point near the circuit takes the profile of the station it stands beside:
//
//  - ACROSS the track that profile is constant, because a lateral offset projects onto the same
//    station. So the racing surface is dead level across its width at every point of the lap, with
//    no camber and no cross-fall, and gradient only ever runs ALONG the direction of travel. This
//    falls out of the projection rather than being enforced anywhere.
//  - the PIT LANE is anchored the same way, off its own distance rather than the circuit's, so the
//    paddock is level across itself and grades gently along with the straight it parallels, the way
//    a real pit lane does. It is not a separate flat platform: a platform has to meet the circuit
//    somewhere, and every join is a discontinuity waiting to be seen.
//  - AWAY from both, the profile gives way to the open fractal field over a corridor, which is what
//    puts the circuit in a cutting where the land is higher and on an embankment where it is lower.
//
// Continuous everywhere by construction, and that word is load-bearing: the ground is a tessellated
// sheet with the road lying two millimetres above it, so a step in this function is grass rendering
// through tarmac. The corridor blend is a smoothstep of distance and the two anchors compose with
// `min`, both continuous. The projection onto the circuit is the part that had to be earned, below.

import { makePolylineIndex, type Vec } from './geom'
import type { HeightField } from './terrain-field'

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** How much of the lap the profile's smoothing window spans, as a fraction. A circuit rises and
 *  falls a few times a lap; it does not follow every lump in the noise it was sampled from. */
const PROFILE_WINDOW = 1 / 24

/** Cell size of the polyline indexes, in metres. The grid only has to be coarse enough that a query
 *  reaches its answer in a ring or two, and fine enough that a cell holds few segments. */
const INDEX_CELL_M = 40

/** Spacing of the anchors the projection reads the profile through, in metres. The profile is a
 *  quarter-kilometre moving average by the time it gets here, so sampling it every twenty metres
 *  loses nothing and keeps the kernel's neighbour lists short. */
const ANCHOR_SPACING_M = 20

/** Reach of the projection kernel, as a multiple of the corridor. Must exceed 1 so that every point
 *  the corridor can reach has anchors to read, and the surplus is what softens the crossover where
 *  two stretches of circuit compete. */
const KERNEL_REACH = 1.5

export interface Elevation {
  /** Height at a world point, in WORLD UNITS, ready to be used as a `y` with no conversion.
   *
   *  Two scalars rather than a `Vec`, deliberately: this is called once per vertex of every piece of
   *  ground geometry in the scene, and an object per call is an allocation per vertex. */
  at(x: number, y: number): number
  /** Vertical span of the graded circuit itself, world units: what the shadow box and the haze have
   *  to cover beyond the flat world they used to assume. */
  trackRange: { min: number; max: number }
}

export interface ElevationInput {
  /** The raw fractal land, in metres. */
  field: HeightField
  /** The circuit's densified centreline, closed. */
  centreline: Vec[]
  /** The pit lane's own path, so the paddock rides the shelf too. Absent, only the circuit anchors. */
  pitPath?: Vec[] | null
  metresPerUnit: number
  /** Half-width of the level shelf around each anchor, in metres: the surface itself plus its
   *  verges. Inside this the ground is exactly the profile, with none of the raw field in it. */
  trackShelfM: number
  pitShelfM: number
  /** Where the graded corridor has fully given way to open land, in metres from the anchor. */
  corridorM: number
}

/** Build the world's height. */
export function buildElevation({
  field, centreline, pitPath, metresPerUnit, trackShelfM, pitShelfM, corridorM,
}: ElevationInput): Elevation {
  const u = (m: number) => m / metresPerUnit
  const n = centreline.length

  // The circuit's own profile: the raw field read along the centreline, then smoothed along arc so
  // the lap rises and falls gently instead of inheriting the noise's every wrinkle.
  const raw = centreline.map((p) => field.at(p))
  const win = Math.max(1, Math.round(n * PROFILE_WINDOW))
  const smooth = new Float64Array(n)
  let acc = 0
  for (let i = -win; i <= win; i++) acc += raw[((i % n) + n) % n]
  for (let i = 0; i < n; i++) {
    smooth[i] = acc / (2 * win + 1)
    acc -= raw[((i - win) % n + n) % n]
    acc += raw[((i + win + 1) % n + n) % n]
  }

  // Re-zero on the circuit's mean, so the lap straddles y = 0 and everything calibrated against a
  // flat world (the camera's target plane, the haze's floor, the shadow box) still finds the ground
  // roughly where it left it. The datum is arbitrary; keeping it near the old one is not.
  let datum = 0
  for (let i = 0; i < n; i++) datum += smooth[i]
  datum /= n
  for (let i = 0; i < n; i++) smooth[i] -= datum

  const trackIndex = makePolylineIndex(centreline, u(INDEX_CELL_M))
  const pitIndex = pitPath && pitPath.length >= 2
    ? makePolylineIndex(pitPath, u(INDEX_CELL_M), false)
    : null

  // The projection onto the circuit, and the one piece of this that is not obvious.
  //
  // The natural way to write it is "read the profile at the NEAREST station", and that is what this
  // was. It is discontinuous, and not subtly: wherever a point is equidistant from two stretches of
  // circuit — the inside of a hairpin, the grass between the pit straight and the back straight, the
  // whole medial axis of the layout — the nearest station flips from one stretch to the other and
  // the height jumps by whatever those two stretches disagree about. MEASURED on Belgium before this
  // was fixed: a 2.79 m step across two centimetres of ground, which is a cliff drawn through a
  // field. No grid resolves it; it is in the surface, not in the sampling.
  //
  // So the projection is SOFT: a distance-weighted read of every anchor in reach, rather than the
  // winner of an argmin. Continuous because the weights are.
  //
  // What it costs is exactness of the level cross-section. The kernel is symmetric about the foot of
  // the perpendicular, so along an isolated stretch the weighted answer is the foot's own value at
  // any lateral offset and the surface is level across; asymmetry only appears where ANOTHER stretch
  // of circuit is within reach and pulls one edge harder than the other. That is the same
  // phenomenon as the medial-axis smoothing, seen from the other side, and the reach trades one
  // against the other: shorten it and the cross-section flattens while the cliff comes back.
  //
  // MEASURED as the worst cross-fall over the 13.3 m surface, a full lap (`scripts/elevation-grid.ts`):
  // Monaco 114 mm (0.86%), Britain 137 mm (1.03%), Bahrain 360 mm (2.71%), Belgium 444 mm (3.33%).
  // A real road is built with about 2% camber, so the typical circuit sits under what a surveyor
  // would put there deliberately. The two that exceed it only do so at their worst point, and that
  // point is always where the layout doubles back on itself — a hairpin or a chicane, where a road
  // reads as banked rather than as broken.
  const spacingU = u(ANCHOR_SPACING_M)
  const anchors: Array<{ x: number; y: number; h: number }> = []
  for (let i = 0; i < n; i++) {
    const p = centreline[i]
    const last = anchors[anchors.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= spacingU) {
      anchors.push({ x: p.x, y: p.y, h: smooth[i] })
    }
  }
  const reachU = u(corridorM) * KERNEL_REACH
  // Bucketed on the kernel's own reach, so a query reads the nine cells around it and no more. The
  // bias keeps negative coordinates off each other's keys, exactly as `geom`'s indexes do.
  const KEY_BIAS = 32768
  const anchorCells = new Map<number, number[]>()
  const cellKey = (cx: number, cy: number) => (cx + KEY_BIAS) * 65536 + (cy + KEY_BIAS)
  anchors.forEach((a, i) => {
    const k = cellKey(Math.floor(a.x / reachU), Math.floor(a.y / reachU))
    const b = anchorCells.get(k)
    if (b) b.push(i)
    else anchorCells.set(k, [i])
  })

  const profileAt = (p: Vec): number => {
    const cx = Math.floor(p.x / reachU)
    const cy = Math.floor(p.y / reachU)
    let total = 0
    let weight = 0
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = anchorCells.get(cellKey(gx, gy))
        if (!bucket) continue
        for (const i of bucket) {
          const a = anchors[i]
          const d = Math.hypot(a.x - p.x, a.y - p.y)
          if (d >= reachU) continue
          // Cubic falloff: zero value AND zero slope at the edge, so an anchor entering or leaving
          // reach does not put a crease in the ground where its influence starts.
          const w = (1 - d / reachU) ** 3
          total += w * a.h
          weight += w
        }
      }
    }
    // Only ever called inside the corridor, where the reach guarantees anchors; the guard is for the
    // degenerate layout with none at all rather than for any reachable case.
    return weight > 0 ? total / weight : 0
  }

  // 0 on the shelf, 1 past the corridor: how much of the OPEN field a point gets instead of the
  // circuit's own surface.
  const shelfU = u(trackShelfM)
  const pitShelfU = u(pitShelfM)
  const corridorU = u(corridorM)
  const blend = (d: number, shelf: number) => {
    if (d <= shelf) return 0
    if (d >= corridorU) return 1
    return smoothstep((d - shelf) / (corridorU - shelf))
  }

  // Grading only matters within the corridor of an anchor, and the sampled world reaches kilometres
  // past the circuit. Bounding the track first turns the overwhelming majority of samples into one
  // rectangle test instead of two spatial-index queries.
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

  // `smooth` was re-zeroed in place; the raw field was not, so the datum is subtracted from IT
  // wherever it appears. Taking it off both is the same mistake twice and sinks the whole world.
  const probe: Vec = { x: 0, y: 0 }
  const open = (): number => field.at(probe) - datum
  const at = (x: number, y: number): number => {
    probe.x = x
    probe.y = y
    if (x < bx0 - corridorU || x > bx1 + corridorU || y < by0 - corridorU || y > by1 + corridorU) {
      return u(open())
    }
    // Capped at the corridor, which is the whole distance either query has to resolve: past it the
    // blend is 1 whatever the exact number, and an uncapped walk from the middle of an infield costs
    // hundreds of times what a capped one does.
    let t = blend(trackIndex.dist(probe, corridorU), shelfU)
    // Near EITHER anchor the ground is the circuit's surface, so the nearer one wins: a pit lane
    // twenty-five metres off the straight is otherwise a quarter of the way into the raw field, and
    // a paddock built on a quarter of a fractal is a paddock that undulates.
    if (t > 0 && pitIndex) t = Math.min(t, blend(pitIndex.dist(probe, corridorU), pitShelfU))
    if (t === 0) return u(profileAt(probe))
    return u(profileAt(probe) * (1 - t) + open() * t)
  }

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    if (smooth[i] < min) min = smooth[i]
    if (smooth[i] > max) max = smooth[i]
  }

  return { at, trackRange: { min: u(min), max: u(max) } }
}

/** A world with no relief in it: every query answers zero.
 *
 *  Not a null check spread over every call site. Half the builders in the scene take an elevation,
 *  and a nullable one would mean a `?? 0` at every vertex in the codebase, each of which is a place
 *  the day's next builder forgets. Tests and any caller that genuinely wants a flat world take this
 *  and the geometry path stays single. */
export const FLAT_ELEVATION: Elevation = {
  at: () => 0,
  trackRange: { min: 0, max: 0 },
}
