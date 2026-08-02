// Procedural scenery for the 2D race view (#sim-overhaul phase 6): terrain patches, corner runoffs and
// red/white kerbs, grandstands along the track, building clusters, a pit complex, and tree groves.
// Deterministic per circuit (seeded by circuit id) and placed with geometry rules — offset from the
// racing line, inside/outside the loop, grandstands and kerbs seeking corners — so every venue gets its
// own plausible world. Densities are per-track tunables (some venues are forests, some are cities).
// All coordinates are viewBox units; real-world sizes convert through metresPerUnit.

import { seededRng } from '@/lib/sim/rng-utils'
import {
  PIT_ENTRY_FRAC, PIT_EXIT_FRAC, smoothOpenPath, type PitLane, type TrackTrace,
} from './track-path'
import { closestPointOnPolyline, makeOccupancy, type Obb } from './geom'
import { makeSceneryFrame, STEP } from './scenery-frame'
import { blobPath, buildingParts, pickArchetype, type SceneryPart } from './scenery-shapes'
import { biomeOf, type Biome } from './biomes'
import {
  bandsFor, gradeToTrack, makeHeightField, type TerrainBand,
} from './terrain-field'
import {
  FENCE_OFFSET_M, buildFences, buildFields, buildMarshalPosts,
  type SceneryFence, type SceneryField, type SceneryMarshal,
} from './scenery-props'

export type { SceneryPart } from './scenery-shapes'

export interface SceneryBlob { d: string; fill: string; water?: boolean }
export interface SceneryRect {
  x: number; y: number; w: number; h: number; rot: number // centre, overall size, radians
  fill: string
  /** Footprint as a union of rects in local coords; absent = a single w×h slab. */
  parts?: SceneryPart[]
  /** Storey count, driving the fake extrusion depth and the drop-shadow length. */
  storeys?: number
}
export interface SceneryStand extends SceneryRect {
  /** True when the edge LOOKING AT the track is the local +y edge.
   *  The roof and back wall go on the other edge: a real grandstand is roofed at the rear with the
   *  seating raked down toward the circuit. Drawing the roof band on the trackside edge put a wall
   *  between the crowd and the race, which read as the spectators facing backwards. */
  facing: boolean
}
export interface SceneryTree {
  d: string; variant: 0 | 1
  /** Height in metres. A tree is scaled as a whole, so a big canopy stands on a tall trunk — with a
   *  single global height every tree was the same height regardless of how wide it was. */
  h: number
  /** Canopy centre, and the radius that BOUNDS the drawn blob (its jittered lobes reach past the
   *  nominal radius). Carried on the data so clearance rules — and the tests pinning them — read the
   *  real footprint instead of re-deriving it from the path string. */
  x: number; y: number; r: number
}
/** Painted width of a kerb and the pitch of its red blocks, in metres. */
export const KERB_WIDTH_M = 1.3
export const KERB_BLOCK_M = 3
/** A kerb's two paints, owned beside its dimensions so every renderer lays the same colours. */
export const KERB_WHITE = '#E6E3DC'
export const KERB_RED = '#C8352F'

export interface SceneryKerb {
  d: string
  /** The control points `d` is smoothed through: the 3D renderer samples the same curve back out of
   *  them with `densifyOpen`, so both renderers draw one kerb (#3d-port). */
  pts: Array<{ x: number; y: number }>
  /** Which side of `pts` the track is on, as the sign of the polyline's left normal `(-dy, dx)`.
   *  Flat paint did not care; a lofted section does, because a kerb is not symmetric — it starts
   *  flush at the tarmac and rises away from it. Carried on the data rather than re-derived, since
   *  this is the one place that knows the offset it was pushed out by. */
  inward: 1 | -1
  /** Bounding disc, so a kerb far from the camera can be skipped outright. */
  cx: number; cy: number; r: number
}

export interface SceneryDensity { trees?: number; buildings?: number }

export interface Scenery {
  /** Terraced relief bands, lowest first — drawn under everything as the ground itself. */
  bands: TerrainBand[]
  /** Ground plane colour, taken from the biome ramp so the bands read as steps out of it. */
  base: string
  fields: SceneryField[]
  fences: SceneryFence[]
  marshals: SceneryMarshal[]
  terrain: SceneryBlob[]
  runoffs: SceneryBlob[]
  kerbs: SceneryKerb[]
  stands: SceneryStand[]
  buildings: SceneryRect[]
  trees: SceneryTree[]
}

type Vec = { x: number; y: number }

// Canopy lobe jitter, as a fraction of the nominal radius: the drawn blob spans [BASE, BASE+SPAN].
const TREE_JITTER_BASE = 0.8
const TREE_JITTER_SPAN = 0.35
/** Trees are scaled as a whole rather than having their canopy and height drawn independently, so
 *  proportions hold from sapling to mature tree. The exponent still skews the population small, but
 *  only mildly: a real treeline is mature trees with the occasional big one, not saplings.
 *
 *  Retuned when the trees stopped being painted blobs and became models. The old spread ran a 9.8 m
 *  median with two thirds of the wood under 12 m, which read fine as a lollipop and reads as a
 *  nursery bed once the thing has a trunk and a crown: a mature roadside broadleaf is 15-20 m.
 *  Now a 16.4 m median, a floor at 11 m, and one tree in seven under 12 m.
 *
 *  The base radius moves WITH the base height, on purpose. It is what every clearance test measures
 *  (track edge, pit, structures, other trunks), so leaving it behind would let canopies half again
 *  as wide overhang the circuit and grow through each other. */
const TREE_MIN_SCALE = 0.85
const TREE_MAX_SCALE = 1.9
const TREE_SCALE_SKEW = 1.35
const TREE_BASE_R_M = 5.0
const TREE_BASE_H_M = 13
/** Trees per unit of biome density. */
export const TREE_TARGET_BASE = 520

/** FNV-1a over a string — the noise lattice needs a numeric seed, seededRng takes a string. */
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function buildScenery(
  rawTrace: TrackTrace,
  pit: PitLane,
  {
    circuitId, metresPerUnit, viewBox, density = {}, pitOutside = false, biome,
    terrainDetail = false,
  }: {
    circuitId: string; metresPerUnit: number; viewBox: string
    density?: SceneryDensity; pitOutside?: boolean; biome?: Biome
    /** Draw the ground's faux relief: terraced contour bands and the enclosed-field quilt. Off by
     *  default — both read as arbitrary polygons and pinstriped noise rather than landscape. Kept
     *  behind a flag rather than deleted so the two looks can still be compared. */
    terrainDetail?: boolean
  },
): Scenery {
  const rng = seededRng(`scenery:${circuitId}`)
  const u = (m: number) => m / metresPerUnit
  // Densities come from the circuit's biome (Spa is forest, Monaco is city), with the explicit
  // density prop still winning when one is passed.
  const bio = biomeOf(biome)
  const treeMult = density.trees ?? bio.trees
  const buildingMult = density.buildings ?? bio.buildings

  const {
    centreline, at, total, samples, theta, outSign, trackDist, pitDist, obbClearsTrack, bounds: tb, frame,
  } = makeSceneryFrame(rawTrace, pit, metresPerUnit)
  const S = samples.length

  const PIT_CLEAR_M = 55 // paddock side: garages, transporters, hospitality — nothing planted
  const PIT_CLEAR_STAND_M = 35

  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number)
  const M = u(260)
  const randPoint = (): Vec => ({ x: vx - M + rng() * (vw + 2 * M), y: vy - M + rng() * (vh + 2 * M) })

  // ── Relief ──
  // The ground plane extends ~9 km beyond the viewBox while the built world only ever reached
  // 260 m past it, so at any zoom-out over 95% of what you saw was one flat fill — the "runway that
  // extends forever". Bands and fields are a few dozen large paths, so they can cover a far wider
  // area than the per-instance props without costing anything like as much.
  const FAR = u(1500)
  const farBox = { x: vx - FAR, y: vy - FAR, w: vw + 2 * FAR, h: vh + 2 * FAR }
  const rawField = makeHeightField(hashSeed(`terrain:${circuitId}`), {
    metresPerUnit, featureM: bio.featureM, reliefM: bio.reliefM,
  })
  // Grade the land to the circuit's own smoothed profile, so the track sits in a corridor of
  // cuttings and embankments rather than on a shelf laid over the noise.
  const field = gradeToTrack(rawField, centreline, { corridorU: u(70), distTo: trackDist })
  // Off the flag, NONE. The soft wash that used to stand here was a 2D device: a top-down
  // orthographic view has no light, so the only way to say "this ground is higher" was to paint it
  // a lighter green, and the contour between two levels was the edge of that paint. In a lit scene
  // that device cannot work. The shading says the ground is flat because it IS flat, the colour
  // says it is not, and at a low camera the colour edge stops reading as relief and reads as a
  // seam: a dead-straight line across the grass, eight grey levels deep, sweeping over the field
  // as the camera tilts (`scripts/scene3d-grass-band.ts`). Relief in a lit renderer has to be
  // geometry or nothing.
  const bands = terrainDetail ? bandsFor(field, farBox, bio.ramp, { reliefM: bio.reliefM }) : []

  // ── Water bodies ──
  // Lakes only: the relief bands carry ground tone now, so the old translucent tint patches just
  // washed the terracing out. Water and gravel take part in the occupancy rules — they used to be
  // outside the collision system entirely, so lakes had buildings in them and trees growing out.
  // Blobs are elongated ellipses; a bounding RECTANGLE over-excludes badly at the corners (a lake
  // 600 m across would sterilise its whole bounding box). Approximate each as a run of discs along
  // its major axis instead — a capsule that tracks the drawn shape closely.
  const noBuild: Array<{ x: number; y: number; r: number }> = []
  const addBlobExclusion = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
    const long = Math.max(rx, ry)
    const short = Math.min(rx, ry)
    const ang = rx >= ry ? rot : rot + Math.PI / 2
    const span = long - short
    const count = Math.max(1, Math.ceil((2 * span) / Math.max(short, 1e-6)) + 1)
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : -span + (2 * span * i) / (count - 1)
      noBuild.push({ x: cx + Math.cos(ang) * t, y: cy + Math.sin(ang) * t, r: short })
    }
  }
  const terrain: SceneryBlob[] = []
  const terrainCount = 12 + Math.floor(rng() * 5)
  for (let i = 0; i < terrainCount; i++) {
    const c = randPoint()
    const r = u(70 + rng() * 190)
    if (rng() >= bio.water) continue // ground variation is the relief bands' job now
    const ry = r * (0.55 + rng() * 0.5)
    const rot = rng() * Math.PI
    // A lake lapping the fencing is implausible, and because water excludes everything it was
    // squeezing the grandstands off the circuit at the wettest venues.
    if (trackDist(c) - Math.max(r, ry) * 1.15 < u(60)) continue
    terrain.push({
      d: blobPath(c.x, c.y, r, ry, rot, rng, 10, 0.8, 0.35),
      fill: '#3E6E86',
      water: true,
    })
    addBlobExclusion(c.x, c.y, r * 1.15, ry * 1.15, rot)
  }

  // ── Corner regions (for runoffs and kerbs) ──
  const CORNER_TH = 0.15
  const runs: Array<[number, number]> = []
  let runStart: number | null = null
  for (let i = 0; i < S; i++) {
    if (theta[i] > CORNER_TH) {
      if (runStart === null) runStart = i
    } else if (runStart !== null) {
      if (i - runStart >= 2) runs.push([runStart, i - 1])
      runStart = null
    }
  }
  if (runStart !== null) runs.push([runStart, S - 1])

  // Kerbs: strips hugging both track edges through every corner. Sampled densely (every ~2 units) at
  // the exact edge offset and smoothed like the track itself, so they track the ribbon's boundary.
  const kerbs: SceneryKerb[] = []
  const kerbOffset = u(7.0)
  // The pit lane occupies the inside edge around the S/F line — no kerbs across its mouth.
  const inPitZone = (s: number) => {
    const f = (((s % total) + total) % total) / total
    return f > PIT_ENTRY_FRAC - 0.02 || f < PIT_EXIT_FRAC + 0.02
  }
  for (const [a, b] of runs) {
    const sa = a * STEP - u(5)
    const sb = b * STEP + u(5)
    for (const side of [1, -1]) {
      // No kerbs across the pit mouths — on whichever side the lane actually lives.
      const pitKerbSide = pitOutside ? 1 : -1
      if (side === pitKerbSide && (inPitZone(sa) || inPitZone(sb) || inPitZone((sa + sb) / 2))) continue
      const pts: Vec[] = []
      for (let s = sa; s <= sb; s += 2) {
        const p = at(s)
        const q0 = at(s - 2)
        const q1 = at(s + 2)
        const len = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1
        const t = { x: (q1.x - q0.x) / len, y: (q1.y - q0.y) / len }
        pts.push({
          x: p.x + outSign * -t.y * kerbOffset * side,
          y: p.y + outSign * t.x * kerbOffset * side,
        })
      }
      if (pts.length >= 2) {
        const xs = pts.map((p) => p.x)
        const ys = pts.map((p) => p.y)
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2
        kerbs.push({
          d: smoothOpenPath(pts),
          pts,
          // The strip was pushed out along `outSign * side * (-t.y, t.x)`, and it runs the same way
          // round the lap as the trace, so the track lies back down the negative of that.
          inward: (outSign * side > 0 ? -1 : 1),
          cx,
          cy,
          r: Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))),
        })
      }
    }
  }

  // ── Fencing, tyre walls and marshal posts ──
  const pitSide = pitOutside ? 1 : -1
  const fences = buildFences(frame, {
    offsetM: FENCE_OFFSET_M,
    // No fence across either pit mouth on the side the lane actually lives.
    skip: (s, side) => side === pitSide && inPitZone(s),
  })

  // ── Runoff aprons on the outside of the sharpest corners ──
  const runoffs: SceneryBlob[] = []
  const peaks = [...theta.keys()].sort((a, b) => theta[b] - theta[a])
  const cornerIdx: number[] = []
  for (const i of peaks) {
    if (cornerIdx.length >= 6) break
    if (cornerIdx.every((j) => Math.min(Math.abs(j - i), S - Math.abs(j - i)) > 14)) cornerIdx.push(i)
  }
  for (const i of cornerIdx) {
    const { p, t, nOut } = samples[i]
    const off = u(10 + rng() * 5)
    const cx = p.x + nOut.x * off
    const cy = p.y + nOut.y * off
    const rx = u(20 + rng() * 12)
    const ry = u(8 + rng() * 4)
    const rot = Math.atan2(t.y, t.x)
    runoffs.push({
      d: blobPath(cx, cy, rx, ry, rot, rng),
      fill: bio.runoff[Math.floor(rng() * bio.runoff.length)],
    })
    // Gravel and tarmac run-off is the car's escape road; nothing gets planted or built on it.
    addBlobExclusion(cx, cy, rx * 1.25, ry * 1.25, rot)
  }

  // Tyre walls face the same corners the run-off aprons do, sitting just beyond the barrier line.
  // Furniture offsets derive from the wall line too, so the trackside cross-section stays coherent:
  // tyres are stacked AGAINST the front of the barrier they protect (at 13 m they sat behind it),
  // and the marshal post stands well back of the debris fence rather than straddling it.
  // Both are offset along the outward normal from ONE point on the circuit, which is not the same as
  // being clear of the whole circuit: at a hairpin the outward normal from one side lands on the
  // track coming back the other way. Monaco put a marshal post at 6.8 m and a tyre wall at 6.4 m,
  // i.e. on the racing surface. Drop anything the exact distance test rejects.
  const MARSHAL_HALF_DEPTH_M = 1.6
  const marshals = buildMarshalPosts(frame, { everyM: 240, offsetM: FENCE_OFFSET_M + 5 })
    .filter((m) => trackDist({ x: m.x, y: m.y }) > u(FENCE_OFFSET_M + MARSHAL_HALF_DEPTH_M + 0.5))

  // Occupancy. Structures and canopies are tracked separately: a tree must clear a building's TRUE
  // footprint completely, but trees are allowed to crowd each other, which is what makes a grove
  // read as woodland instead of a dot grid. The old single registry used a CIRCUMSCRIBED circle,
  // so a 95x17 m grandstand claimed a 48 m radius and carved a hole in the building field, while
  // simultaneously letting rotated footprints through because the tree test ignored rotation.
  const structOcc = makeOccupancy(u(60))
  const treeOcc = makeOccupancy(u(20))
  const STRUCT_GAP = u(5) // clearance between neighbouring structures
  // Clearances are measured from the DEBRIS FENCE, not the tarmac. Anything nearer than that is
  // drawn on top of the barrier and fencing that are supposed to be protecting it. The extra margin
  // on stands covers the deck's rake, which shears a couple of metres trackward when the light
  // happens to point that way.
  const TREE_TRACK_CLEAR_M = FENCE_OFFSET_M + 3 // canopy EDGE, not centre, from the centreline
  const STAND_TRACK_CLEAR_M = FENCE_OFFSET_M + 3.5
  const BUILDING_TRACK_CLEAR_M = FENCE_OFFSET_M + 8
  const MIN_PART_M = 8 // narrowest a building wing may be before it stops reading as architecture
  // Lakes and run-off join the registry before anything is sited, so they exclude like a structure.
  noBuild.forEach((o) => structOcc.addDisc(o.x, o.y, o.r))

  // ── Field patchwork over the rural surround ──
  // Covers the far box, well outside the built world, since that emptiness is what read as a runway.
  const fieldRng = seededRng(`scenery:${circuitId}:fields`)
  // tb is the circuit's bounding box: far-field cells settle with one rectangle test instead of
  // two spatial-index queries from 1.5 km away.
  const fields = terrainDetail ? buildFields(farBox, fieldRng, {
    cellU: u(230),
    enclosure: bio.fields,
    palette: bio.ramp,
    // Fields stop at the circuit itself; the venue is not farmland.
    keepOut: (p) => {
      // Measured from the field's CENTRE with a modest margin. Subtracting the cell radius here
      // pushed the exclusion out to a quarter-kilometre and stripped the landscape bare anywhere
      // near the circuit — farmland runs right up to the fencing in reality.
      const m = u(120)
      if (p.x < tb.x0 - m || p.x > tb.x1 + m || p.y < tb.y0 - m || p.y > tb.y1 + m) return false
      return trackDist(p) < u(55) || pitDist(p) < u(80)
    },
  }) : []

  // ── Grandstands: seek the track, prefer corners, mostly outside ──
  const stands: SceneryStand[] = []
  let arc = rng() * u(80)
  while (arc < total) {
    // Denser candidate walk than the arc spacing alone would suggest: real clearance rules reject
    // far more sites than the old approximate ones did, so more places have to be tried to keep the
    // circuit ringed with stands.
    arc += u(55 + rng() * 70)
    if (rng() > 0.86) continue
    const i = Math.floor((arc % total) / STEP) % S
    const { p, nOut } = samples[i]
    const outside = rng() < 0.8
    const dir = outside ? nOut : { x: -nOut.x, y: -nOut.y }
    const w = u(45 + rng() * 50)
    const h = u(12 + rng() * 5)
    // Offer the stand at a distance derived from its own DEPTH and the clearance rule, so its near
    // edge lands just behind the debris fence. Offering a fixed 16-25 m from the centreline while
    // requiring the footprint to clear 19 m is unsatisfiable for a stand 12-17 m deep — every
    // candidate is rejected and the circuit ends up with no grandstands at all.
    const off = h / 2 + u(STAND_TRACK_CLEAR_M + 1.5 + rng() * 9)
    const cx = p.x + dir.x * off
    const cy = p.y + dir.y * off
    if (pitDist({ x: cx, y: cy }) < u(PIT_CLEAR_STAND_M)) continue
    // Align to the CHORD the stand actually spans, not the tangent at its midpoint. A 45-95 m stand
    // beside a corner took the tangent's angle and sat askew to the track it faces.
    const half = w / 2
    const a0 = samples[(i - Math.round(half / STEP) + S * 2) % S].p
    const a1 = samples[(i + Math.round(half / STEP)) % S].p
    const chord = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1
    const ct = { x: (a1.x - a0.x) / chord, y: (a1.y - a0.y) / chord }
    const rot = Math.atan2(ct.y, ct.x)
    // A stand faces the section it was anchored to. Where the circuit folds back, some OTHER section
    // can be the nearest one and the stand reads as facing away from the closest piece of track.
    //
    // The test has to be POSITIONAL, not a distance comparison: on the inside of a corner the curve
    // wraps around and the true nearest distance is legitimately shorter than the offset, so no
    // distance margin separates "inside a corner" from "a different straight is closer". Ask
    // directly whether the nearest point on the centreline is the one this stand was placed against.
    const near = closestPointOnPolyline({ x: cx, y: cy }, centreline)
    if (Math.hypot(near.x - p.x, near.y - p.y) > u(18)) continue
    const obb: Obb = { x: cx, y: cy, w, h, rot }
    // A long stand beside a curving track can reach the ribbon with its ENDS, so clearance is
    // measured around the whole footprint rather than at three sampled points.
    if (!obbClearsTrack(obb, STAND_TRACK_CLEAR_M)) continue
    if (structOcc.hitsObb(obb, STRUCT_GAP)) continue
    // Local +y in world space is (-ct.y, ct.x); `facing` marks the edge that looks AT the track.
    // The roof and back wall belong on the opposite edge — see SceneryStand.facing.
    const facing = -dir.x * -ct.y + -dir.y * ct.x > 0
    stands.push({
      x: cx, y: cy, w, h, rot, fill: '#4A5260', facing,
      storeys: 2 + Math.floor(rng() * 3),
    })
    structOcc.addObb(obb)
  }

  // ── Building clusters, clear of the track ──
  const buildings: SceneryRect[] = []
  const clusterTarget = Math.round((13 + rng() * 5) * buildingMult)
  for (let c = 0, tries = 0; c < clusterTarget && tries < clusterTarget * 3; tries++) {
    const seed = randPoint()
    if (trackDist(seed) < u(40)) continue
    c++
    const rot = rng() * Math.PI
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const cols = 2 + Math.floor(rng() * 3)
    const rows = 2 + Math.floor(rng() * 2)
    // One size band per cluster, with the grid pitch derived FROM it. The pitch used to be drawn
    // independently of the footprints, so neighbours in the same block routinely overlapped and
    // were rejected — every cluster collapsed to one or two lone boxes.
    const baseW = u(18 + rng() * 22)
    const baseH = u(15 + rng() * 18)
    const cell = Math.max(baseW, baseH) * (1.3 + rng() * 0.4)
    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        if (rng() > 0.78) continue
        const lx = (gx - (cols - 1) / 2) * cell
        const ly = (gy - (rows - 1) / 2) * cell
        const bx = seed.x + lx * cos - ly * sin
        const by = seed.y + lx * sin + ly * cos
        if (pitDist({ x: bx, y: by }) < u(PIT_CLEAR_M)) continue
        const w = baseW * (0.82 + rng() * 0.36)
        const h = baseH * (0.82 + rng() * 0.36)
        const brot = rot + (rng() - 0.5) * 0.12
        const obb: Obb = { x: bx, y: by, w, h, rot: brot }
        // Corner-aware, like the stands: a centre-only test let a 36 m building sit 26 m from the
        // centreline with a corner on the tarmac.
        if (!obbClearsTrack(obb, BUILDING_TRACK_CLEAR_M)) continue
        if (structOcc.hitsObb(obb, STRUCT_GAP)) continue
        structOcc.addObb(obb)
        // Reject articulated archetypes that would come out as slivers at this size.
        const type = pickArchetype(w, h, MIN_PART_M, metresPerUnit, rng())
        const parts = buildingParts(type, w, h)
        const big = w * metresPerUnit > 22
        buildings.push({
          x: bx, y: by, w, h, rot: brot,
          fill: bio.roofs[Math.floor(rng() * bio.roofs.length)],
          parts,
          // Skewed low: most of a venue is two or three storeys, but the tail runs to a genuine
          // tower. A flat 1-5 gave every cluster the same monotonous mid-rise silhouette. Only the
          // larger footprints can carry height, and how far the tail reaches is the biome's call.
          storeys: 1 + Math.floor(Math.pow(rng(), 2.3) * (big ? 15 : 5) * bio.towers),
        })
      }
    }
  }

  // ── Trees: lobed canopies with a lit side, in groves plus scatter ──
  const trees: SceneryTree[] = []
  const treeTarget = Math.round(TREE_TARGET_BASE * treeMult)
  const groves = Array.from({ length: 7 }, randPoint)
  for (let i = 0; i < treeTarget * 2.4 && trees.length < treeTarget; i++) {
    let p: Vec
    const roll = rng()
    if (roll < 0.35) {
      // Trackside band: lining the circuit is where density is felt most.
      const s = rng() * total
      const q = at(s)
      const q0 = at(s - 2)
      const q1 = at(s + 2)
      const len = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1
      const t = { x: (q1.x - q0.x) / len, y: (q1.y - q0.y) / len }
      const side = rng() < 0.6 ? 1 : -1
      const off = u(16 + rng() * 28)
      p = { x: q.x + outSign * -t.y * off * side, y: q.y + outSign * t.x * off * side }
    } else if (roll < 0.7) {
      const g = groves[Math.floor(rng() * groves.length)]
      p = { x: g.x + (rng() - 0.5) * u(95), y: g.y + (rng() - 0.5) * u(95) }
    } else {
      p = randPoint()
    }
    // The canopy radius is drawn BEFORE the clearance tests, because every one of them needs it.
    // Drawing it afterwards meant a tree cleared as a point then grew up to 6.8 m of canopy over
    // whatever it had just cleared.
    const scale = TREE_MIN_SCALE + (TREE_MAX_SCALE - TREE_MIN_SCALE) * Math.pow(rng(), TREE_SCALE_SKEW)
    const rNom = u(TREE_BASE_R_M * scale)
    // blobPath jitters each lobe to (jBase + jSpan) of the nominal radius, so the drawn canopy
    // reaches further than rNom; clearance must be measured against the bounding radius.
    const r = rNom * (TREE_JITTER_BASE + TREE_JITTER_SPAN)
    if (trackDist(p) - r < u(TREE_TRACK_CLEAR_M)) continue
    if (pitDist(p) - r < u(PIT_CLEAR_M)) continue // the pit complex is built, not planted
    if (structOcc.hitsDisc(p.x, p.y, r, u(1.5))) continue
    // Canopies may crowd, but not coincide: testing a reduced radius lets a grove close up into
    // woodland while still keeping the trunks apart.
    // Canopies may crowd closely: a treeline is dense, and overlapping crowns are what makes it
    // read as woodland rather than a dot grid.
    if (treeOcc.hitsDisc(p.x, p.y, r * 0.38)) continue
    treeOcc.addDisc(p.x, p.y, r * 0.38)
    trees.push({
      d: blobPath(p.x, p.y, rNom, rNom * 0.92, rng() * Math.PI, rng, 7, TREE_JITTER_BASE, TREE_JITTER_SPAN),
      variant: rng() < 0.75 ? 0 : 1,
      x: p.x, y: p.y, r, h: TREE_BASE_H_M * scale,
    })
  }

  return {
    bands, base: bio.base, fields, fences, marshals,
    terrain, runoffs, kerbs, stands, buildings, trees,
  }
}
