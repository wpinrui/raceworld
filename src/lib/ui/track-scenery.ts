// Procedural scenery for the 2D race view (#sim-overhaul phase 6): terrain patches, corner runoffs and
// red/white kerbs, grandstands along the track, building clusters, a pit complex, and tree groves.
// Deterministic per circuit (seeded by circuit id) and placed with geometry rules — offset from the
// racing line, inside/outside the loop, grandstands and kerbs seeking corners — so every venue gets its
// own plausible world. Densities are per-track tunables (some venues are forests, some are cities).
// All coordinates are viewBox units; real-world sizes convert through metresPerUnit.

import { seededRng } from '@/lib/sim/rng-utils'
import {
  densifyTrace, PIT_ENTRY_FRAC, PIT_EXIT_FRAC, smoothOpenPath, type PitLane, type TrackTrace,
} from './track-path'
import { makeOccupancy, makePolylineIndex, obbCorners, type Obb } from './geom'
import { blobPath, buildingParts, pickArchetype, pointOnParts, type SceneryPart } from './scenery-shapes'

export type { SceneryPart } from './scenery-shapes'

export interface SceneryBlob { d: string; fill: string; water?: boolean }
export interface SceneryRect {
  x: number; y: number; w: number; h: number; rot: number // centre, overall size, radians
  fill: string
  /** Footprint as a union of rects in local coords; absent = a single w×h slab. */
  parts?: SceneryPart[]
  vents?: Array<{ dx: number; dy: number; s: number }>
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
  d: string; hd: string; variant: 0 | 1
  /** Canopy centre, and the radius that BOUNDS the drawn blob (its jittered lobes reach past the
   *  nominal radius). Carried on the data so clearance rules — and the tests pinning them — read the
   *  real footprint instead of re-deriving it from the path string. */
  x: number; y: number; r: number
}
export interface SceneryKerb { d: string }

export interface SceneryDensity { trees?: number; buildings?: number }

export interface Scenery {
  terrain: SceneryBlob[]
  runoffs: SceneryBlob[]
  kerbs: SceneryKerb[]
  stands: SceneryStand[]
  buildings: SceneryRect[]
  trees: SceneryTree[]
}

type Vec = { x: number; y: number }

// Daylight palette: grass and dirt terrain, gravel/asphalt runoffs, urban rooftops.
const TERRAIN_FILLS = ['#2E4826', '#33502B', '#2A421F', '#514336', '#3A5730']
const RUNOFF_FILLS = ['#8F8568', '#565C66']
// Canopy lobe jitter, as a fraction of the nominal radius: the drawn blob spans [BASE, BASE+SPAN].
const TREE_JITTER_BASE = 0.8
const TREE_JITTER_SPAN = 0.35
const BUILDING_FILLS = ['#59616E', '#4E5663', '#665D52', '#57504A', '#7A5147']

export function buildScenery(
  rawTrace: TrackTrace,
  pit: PitLane,
  {
    circuitId, metresPerUnit, viewBox, density = {}, pitOutside = false,
  }: { circuitId: string; metresPerUnit: number; viewBox: string; density?: SceneryDensity; pitOutside?: boolean },
): Scenery {
  const rng = seededRng(`scenery:${circuitId}`)
  // Work on the SMOOTHED geometry the ribbon is actually drawn with — offsets from the raw polyline
  // (kerbs especially) drift off the ribbon's edge in corners.
  const trace = densifyTrace(rawTrace)
  const u = (m: number) => m / metresPerUnit
  // Default density is deliberately rich (the old tuning slider's ceiling and change).
  const treeMult = density.trees ?? 3
  const buildingMult = density.buildings ?? 3

  // ── Track sampling: points, tangents, outward normals ──
  const n = trace.length
  const pt = (i: number): Vec => ({ x: trace[i % n][0], y: trace[i % n][1] })
  const cum: number[] = [0]
  for (let i = 1; i <= n; i++) {
    const a = pt(i - 1)
    const b = pt(i)
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = cum[n]
  const at = (s: number): Vec => {
    const w = ((s % total) + total) % total
    let i = 1
    while (i <= n && cum[i] < w) i++
    const a = pt(i - 1)
    const b = pt(i)
    const f = (w - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }

  // The interior side follows the loop's ORIENTATION (shoelace sign), which is exact at every point —
  // a centroid heuristic flips on non-convex circuits where sections fold back near each other.
  const area = trace.reduce((s, p, i) => {
    const q = trace[(i + 1) % n]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0)
  const outSign = area > 0 ? -1 : 1 // clockwise (y-down): interior = (-t.y, t.x), so outward is its negation

  const STEP = 4
  const samples: Array<{ p: Vec; t: Vec; nOut: Vec }> = []
  for (let s = 0; s < total; s += STEP) {
    const p = at(s)
    const a = at(s - 3)
    const b = at(s + 3)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    samples.push({ p, t, nOut: { x: outSign * -t.y, y: outSign * t.x } })
  }
  const S = samples.length

  const theta = samples.map((_, i) => {
    const a = samples[(i - 3 + S) % S].t
    const b = samples[(i + 3) % S].t
    let th = Math.abs(Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x))
    if (th > Math.PI) th = 2 * Math.PI - th
    return th
  })

  // Exact distance to the drawn centreline. The old version scanned every SECOND sample of a
  // 4-unit sampling and took the nearest VERTEX, so the smallest value it could return near the
  // track was 4 units — on circuits above ~2.6 metres/unit that is more than the clearance trees
  // are asked for, and they were planted on the racing line. Indexing the polyline once makes the
  // exact test cheaper than the broken approximation was.
  const centreline = trace.map(([x, y]) => ({ x, y }))
  const trackIndex = makePolylineIndex(centreline, u(40))
  const trackDist = (p: Vec): number => trackIndex.dist(p)

  /** Does this footprint keep `clearM` metres between its whole outline and the centreline?
   *  Corner-only checks miss a track that cuts through the middle of a long stand beside a curve,
   *  so the perimeter is walked — but only after two cheap tests have failed to settle it. */
  const obbClearsTrack = (o: Obb, clearM: number, stepM = 6): boolean => {
    const need = u(clearM)
    const dc = trackDist({ x: o.x, y: o.y })
    const rad = Math.hypot(o.w, o.h) / 2
    if (dc - rad >= need) return true // every point of the footprint is within `rad` of the centre
    if (dc < need) return false // the centre alone is already too close
    const cs = obbCorners(o)
    for (let i = 0; i < 4; i++) {
      const a = cs[i]
      const b = cs[(i + 1) % 4]
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / u(stepM)))
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        if (trackDist({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) < need) return false
      }
    }
    return true
  }

  // The pit complex is a ~250 m ribbon of garages, boxes and tapers, but scenery only ever got its
  // MIDPOINT and excluded a circle around it. A 120 m radius does not cover +/-125 m of arc, so
  // props were generated on the ends of the pit building. Measure to the lane itself instead.
  const pitPath = pit.slotStations.length >= 2
    ? pit.slotStations.map((st) => ({ x: st.x, y: st.y }))
    : [pit.box, pit.box]
  const pitIndex = makePolylineIndex(pitPath, u(40), false)
  const pitDist = (p: Vec): number => pitIndex.dist(p)
  const PIT_CLEAR_M = 55 // paddock side: garages, transporters, hospitality — nothing planted
  const PIT_CLEAR_STAND_M = 35

  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number)
  const M = u(260)
  const randPoint = (): Vec => ({ x: vx - M + rng() * (vw + 2 * M), y: vy - M + rng() * (vh + 2 * M) })

  // ── Terrain: large soft patches, drawn under everything; some are water ──
  // Water and gravel take part in the occupancy rules. They used to be outside the collision system
  // entirely, so lakes had buildings standing in them and trees growing out of them.
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
    const water = rng() < 0.18
    const ry = r * (0.55 + rng() * 0.5)
    const rot = rng() * Math.PI
    terrain.push({
      d: blobPath(c.x, c.y, r, ry, rot, rng, 10, water ? 0.8 : 0.65, water ? 0.35 : 0.6),
      fill: water ? '#3E6E86' : TERRAIN_FILLS[Math.floor(rng() * TERRAIN_FILLS.length)],
      water,
    })
    // Only water excludes; grass patches are just tint.
    if (water) addBlobExclusion(c.x, c.y, r * 1.15, ry * 1.15, rot)
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
      if (pts.length >= 2) kerbs.push({ d: smoothOpenPath(pts) })
    }
  }

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
      fill: RUNOFF_FILLS[Math.floor(rng() * RUNOFF_FILLS.length)],
    })
    // Gravel and tarmac run-off is the car's escape road; nothing gets planted or built on it.
    addBlobExclusion(cx, cy, rx * 1.25, ry * 1.25, rot)
  }

  // Occupancy. Structures and canopies are tracked separately: a tree must clear a building's TRUE
  // footprint completely, but trees are allowed to crowd each other, which is what makes a grove
  // read as woodland instead of a dot grid. The old single registry used a CIRCUMSCRIBED circle,
  // so a 95x17 m grandstand claimed a 48 m radius and carved a hole in the building field, while
  // simultaneously letting rotated footprints through because the tree test ignored rotation.
  const structOcc = makeOccupancy(u(60))
  const treeOcc = makeOccupancy(u(20))
  const STRUCT_GAP = u(5) // clearance between neighbouring structures
  const TREE_TRACK_CLEAR_M = 13 // canopy EDGE, not centre, from the centreline
  const STAND_TRACK_CLEAR_M = 9
  const BUILDING_TRACK_CLEAR_M = 18
  const MIN_PART_M = 8 // narrowest a building wing may be before it stops reading as architecture
  // Lakes and run-off join the registry before anything is sited, so they exclude like a structure.
  noBuild.forEach((o) => structOcc.addDisc(o.x, o.y, o.r))

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
    const off = u(6) + u(10 + rng() * 9)
    const cx = p.x + dir.x * off
    const cy = p.y + dir.y * off
    if (pitDist({ x: cx, y: cy }) < u(PIT_CLEAR_STAND_M)) continue
    const w = u(45 + rng() * 50)
    const h = u(12 + rng() * 5)
    // Align to the CHORD the stand actually spans, not the tangent at its midpoint. A 45-95 m stand
    // beside a corner took the tangent's angle and sat askew to the track it faces.
    const half = w / 2
    const a0 = samples[(i - Math.round(half / STEP) + S * 2) % S].p
    const a1 = samples[(i + Math.round(half / STEP)) % S].p
    const chord = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1
    const ct = { x: (a1.x - a0.x) / chord, y: (a1.y - a0.y) / chord }
    const rot = Math.atan2(ct.y, ct.x)
    // A stand faces the section it was anchored to. Where the circuit folds back on itself, some
    // OTHER section can end up closer, and the stand then reads as facing away from the nearest
    // piece of track. Those spots are ambiguous whichever way it points, so skip them.
    if (trackDist({ x: cx, y: cy }) < Math.hypot(cx - p.x, cy - p.y) - u(2)) continue
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
          fill: BUILDING_FILLS[Math.floor(rng() * BUILDING_FILLS.length)],
          parts,
          storeys: 1 + Math.floor(rng() * (big ? 5 : 3)),
          // Rooftop clutter has to sit ON a roof: scattering it over the bounding box left vents
          // floating in the holes of the cross and courtyard footprints.
          vents: big
            ? Array.from({ length: 1 + Math.floor(rng() * 2) }, () => {
                const s = u(1.6 + rng() * 1.4)
                const at = pointOnParts(parts, rng, s)
                return { dx: at.x, dy: at.y, s }
              })
            : undefined,
        })
      }
    }
  }

  // ── Trees: lobed canopies with a lit side, in groves plus scatter ──
  const trees: SceneryTree[] = []
  const treeTarget = Math.round(380 * treeMult)
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
    const rNom = u(3.2 + rng() * 3.6)
    // blobPath jitters each lobe to (jBase + jSpan) of the nominal radius, so the drawn canopy
    // reaches further than rNom; clearance must be measured against the bounding radius.
    const r = rNom * (TREE_JITTER_BASE + TREE_JITTER_SPAN)
    if (trackDist(p) - r < u(TREE_TRACK_CLEAR_M)) continue
    if (pitDist(p) - r < u(PIT_CLEAR_M)) continue // the pit complex is built, not planted
    if (structOcc.hitsDisc(p.x, p.y, r, u(1.5))) continue
    // Canopies may crowd, but not coincide: testing a reduced radius lets a grove close up into
    // woodland while still keeping the trunks apart.
    if (treeOcc.hitsDisc(p.x, p.y, r * 0.5)) continue
    treeOcc.addDisc(p.x, p.y, r * 0.5)
    trees.push({
      d: blobPath(p.x, p.y, rNom, rNom * 0.92, rng() * Math.PI, rng, 7, TREE_JITTER_BASE, TREE_JITTER_SPAN),
      hd: blobPath(p.x - rNom * 0.28, p.y - rNom * 0.32, rNom * 0.5, rNom * 0.42, rng() * Math.PI, rng, 6, 0.8, 0.3),
      variant: rng() < 0.75 ? 0 : 1,
      x: p.x, y: p.y, r,
    })
  }

  return { terrain, runoffs, kerbs, stands, buildings, trees }
}
