// Probe: scenery placement checks across every track layout.
// Clearance blind spot per circuit, then real overlap counts (tree-on-track, tree-on-structure,
// structure-on-structure, structure-on-track) measured with exact point-to-segment geometry.
// Run: npx tsx scripts/scenery-check.ts

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { densifyTrace } from '../src/lib/ui/track-path'

const TRACK_HALF_M = 13.3 / 2

type Vec = { x: number; y: number }

// Exact point-to-segment distance — the thing the generator's sampled scan approximates badly.
function distPointToSegment(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const L2 = vx * vx + vy * vy
  if (L2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

function distToPolyline(p: Vec, pts: Vec[]): number {
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = distPointToSegment(p, pts[i], pts[(i + 1) % pts.length])
    if (d < best) best = d
  }
  return best
}

// Corners of a rotated rectangle, world space.
function corners(r: { x: number; y: number; w: number; h: number; rot: number }): Vec[] {
  const c = Math.cos(r.rot)
  const s = Math.sin(r.rot)
  const hw = r.w / 2
  const hh = r.h / 2
  return [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ].map(([lx, ly]) => ({ x: r.x + lx * c - ly * s, y: r.y + lx * s + ly * c }))
}

// Separating-axis test between two rotated rectangles.
function obbOverlap(a: Parameters<typeof corners>[0], b: Parameters<typeof corners>[0]): boolean {
  const ca = corners(a)
  const cb = corners(b)
  for (const [p, q] of [[ca, cb], [cb, ca]] as const) {
    for (let i = 0; i < 4; i++) {
      const ax = p[(i + 1) % 4].x - p[i].x
      const ay = p[(i + 1) % 4].y - p[i].y
      const nx = -ay
      const ny = ax
      let minP = Infinity; let maxP = -Infinity; let minQ = Infinity; let maxQ = -Infinity
      for (const v of p) { const d = v.x * nx + v.y * ny; if (d < minP) minP = d; if (d > maxP) maxP = d }
      for (const v of q) { const d = v.x * nx + v.y * ny; if (d < minQ) minQ = d; if (d > maxQ) maxQ = d }
      if (maxP < minQ || maxQ < minP) return false
    }
  }
  return true
}

// Distance from a point to a rotated rect (0 when inside) — for canopy-vs-structure.
function distPointToObb(p: Vec, r: Parameters<typeof corners>[0]): number {
  const c = Math.cos(-r.rot)
  const s = Math.sin(-r.rot)
  const dx = p.x - r.x
  const dy = p.y - r.y
  const lx = dx * c - dy * s
  const ly = dx * s + dy * c
  const ox = Math.abs(lx) - r.w / 2
  const oy = Math.abs(ly) - r.h / 2
  if (ox <= 0 && oy <= 0) return 0
  return Math.hypot(Math.max(ox, 0), Math.max(oy, 0))
}

// The generator emits tree canopies as SVG blob paths; recover centre + radius from the extents.
function blobBounds(d: string): { c: Vec; r: number } {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (n[i] < minX) minX = n[i]
    if (n[i] > maxX) maxX = n[i]
    if (n[i + 1] < minY) minY = n[i + 1]
    if (n[i + 1] > maxY) maxY = n[i + 1]
  }
  return { c: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, r: Math.max(maxX - minX, maxY - minY) / 2 }
}

const ids = Object.keys(TRACK_LAYOUTS).sort()
let flagged = 0
const totals = { onTrack: 0, treeStruct: 0, structStruct: 0, structTrack: 0 }

console.log(`Scenery checks over ${ids.length} layouts\n`)
console.log('circuit            mpu   blind  trees  onTrack  treeXstr  strXstr  strXtrack')
console.log('-'.repeat(80))

for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  const mpu = layout.metresPerUnit
  const u = (m: number) => m / mpu
  // distToTrack strides 2 over samples spaced STEP=4 units => 8 units between tested points, so the
  // smallest value it can return near the centreline is 4 units. Anything needing less is undetectable.
  const blindM = 4 * mpu

  const scenery = buildScenery(layout.trace, layout.pit.box, {
    circuitId: layout.circuitId,
    metresPerUnit: mpu,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
  })

  const centre: Vec[] = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  const structures = [...scenery.stands, ...scenery.buildings]

  let onTrack = 0
  let treeStruct = 0
  let worstOnTrack = 0
  for (const t of scenery.trees) {
    const { c, r } = blobBounds(t.d)
    const dTrack = distToPolyline(c, centre)
    if (dTrack - r < u(TRACK_HALF_M)) {
      onTrack++
      const depth = (u(TRACK_HALF_M) - (dTrack - r)) * mpu
      if (depth > worstOnTrack) worstOnTrack = depth
    }
    for (const s of structures) {
      if (distPointToObb(c, s) < r) { treeStruct++; break }
    }
  }

  let structStruct = 0
  for (let i = 0; i < structures.length; i++) {
    for (let j = i + 1; j < structures.length; j++) {
      if (obbOverlap(structures[i], structures[j])) structStruct++
    }
  }

  let structTrack = 0
  for (const s of structures) {
    if (corners(s).some((c) => distToPolyline(c, centre) < u(TRACK_HALF_M))) structTrack++
  }

  totals.onTrack += onTrack
  totals.treeStruct += treeStruct
  totals.structStruct += structStruct
  totals.structTrack += structTrack

  const bad = onTrack + treeStruct + structStruct + structTrack
  if (bad > 0) flagged++
  const mark = bad > 0 ? '  <<<' : ''
  const deep = worstOnTrack > 0 ? ` (${worstOnTrack.toFixed(0)}m deep)` : ''
  console.log(
    `${id.padEnd(18)} ${mpu.toFixed(2).padStart(4)}  ${blindM.toFixed(0).padStart(4)}m ` +
    `${String(scenery.trees.length).padStart(6)} ${String(onTrack).padStart(8)} ` +
    `${String(treeStruct).padStart(9)} ${String(structStruct).padStart(8)} ${String(structTrack).padStart(10)}${mark}${deep}`,
  )
}

console.log('-'.repeat(80))
console.log(
  `TOTALS  trees on track ${totals.onTrack} | trees on structures ${totals.treeStruct} | ` +
  `structure overlaps ${totals.structStruct} | structures on track ${totals.structTrack}`,
)
console.log(flagged === 0 ? 'ALL SCENERY CHECKS PASS' : `${flagged}/${ids.length} CIRCUITS FLAGGED`)
