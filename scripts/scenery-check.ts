// Probe: scenery placement checks across every track layout.
// Clearance blind spot per circuit, then real overlap counts (tree-on-track, tree-on-structure,
// structure-on-structure, structure-on-track) measured with exact point-to-segment geometry.
// Run: npx tsx scripts/scenery-check.ts

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { densifyTrace, TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { distToPolyline, distPointToObb, obbOverlap, obbCorners, type Vec } from '../src/lib/ui/geom'
import { FENCE_OFFSET_M } from '../src/lib/ui/scenery-props'

const TRACK_HALF_M = TRACK_WIDTH_M / 2

const ids = Object.keys(TRACK_LAYOUTS).sort()
let flagged = 0
const totals = { onTrack: 0, treeStruct: 0, structStruct: 0, structTrack: 0, fenceFold: 0, badPath: 0, badNum: 0 }

console.log(`Scenery checks over ${ids.length} layouts\n`)
console.log('circuit            mpu  trees  stand  bldg   ms  onTrack  treeXstr  strXstr  strXtrack')
console.log('-'.repeat(92))

for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  const mpu = layout.metresPerUnit
  const u = (m: number) => m / mpu
  const t0 = Date.now()
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: mpu,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
  })
  const buildMs = Date.now() - t0

  const centre: Vec[] = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  const structures = [...scenery.stands, ...scenery.buildings]

  let onTrack = 0
  let treeStruct = 0
  let worstOnTrack = 0
  for (const t of scenery.trees) {
    const c: Vec = { x: t.x, y: t.y }
    const dTrack = distToPolyline(c, centre)
    if (dTrack - t.r < u(TRACK_HALF_M)) {
      onTrack++
      const depth = (u(TRACK_HALF_M) - (dTrack - t.r)) * mpu
      if (depth > worstOnTrack) worstOnTrack = depth
    }
    for (const s of structures) {
      if (distPointToObb(c, s) < t.r) { treeStruct++; break }
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
    if (obbCorners(s).some((c) => distToPolyline(c, centre) < u(TRACK_HALF_M))) structTrack++
  }

  totals.onTrack += onTrack
  totals.treeStruct += treeStruct
  totals.structStruct += structStruct
  totals.structTrack += structTrack

  // A single NaN in a path string makes SVG drop the whole element silently, so geometry that is
  // "correct" by every overlap test can still render as nothing at all.
  const paths = [
    ...scenery.bands.map((b) => b.d), ...scenery.fields.map((f) => f.d),
    ...scenery.terrain.map((t) => t.d), ...scenery.runoffs.map((r) => r.d),
    ...scenery.kerbs.map((k) => k.d), ...scenery.fences.map((b) => b.d),
    ...scenery.trees.map((t) => t.d),
  ]
  // A fence offset further than a corner's radius folds through the apex and crosses itself, which
  // is what Hockenheim's hairpin used to show. Every point must sit out at its own offset.
  // A folded fence crosses the one coming the other way. Measured the same way the builder rejects
  // it: every point must still be its full offset clear of whatever centreline is nearest it.
  const fenceOff = FENCE_OFFSET_M / layout.metresPerUnit
  const fenceFold = scenery.fences.reduce(
    (n, f) => n + f.pts.filter((p) => distToPolyline(p, centre) < fenceOff * 0.8).length,
    0,
  )
  const badPath = paths.filter((d) => !d || /NaN|Infinity|undefined/.test(d)).length
  const badNum = [...scenery.stands, ...scenery.buildings].filter((r) => (
    !Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.w)
    || !Number.isFinite(r.h) || !Number.isFinite(r.rot)
  )).length + scenery.marshals.filter((m) => !Number.isFinite(m.x) || !Number.isFinite(m.rot)).length
  totals.fenceFold += fenceFold
  totals.badPath += badPath
  totals.badNum += badNum

  const bad = onTrack + treeStruct + structStruct + structTrack + fenceFold + badPath + badNum
  if (bad > 0) flagged++
  const mark = bad > 0 ? '  <<<' : ''
  const deep = worstOnTrack > 0 ? ` (${worstOnTrack.toFixed(0)}m deep)` : ''
  console.log(
    `${id.padEnd(18)} ${mpu.toFixed(2).padStart(4)} ${String(scenery.trees.length).padStart(6)} ` +
    `${String(scenery.stands.length).padStart(6)} ${String(scenery.buildings.length).padStart(5)} ` +
    `${String(buildMs).padStart(4)} ${String(onTrack).padStart(8)} ` +
    `${String(treeStruct).padStart(9)} ${String(structStruct).padStart(8)} ${String(structTrack).padStart(10)}${mark}${deep}`,
  )
}

console.log('-'.repeat(80))
console.log(
  `TOTALS  trees on track ${totals.onTrack} | trees on structures ${totals.treeStruct} | ` +
  `structure overlaps ${totals.structStruct} | structures on track ${totals.structTrack} | ` +
  `fence folds ${totals.fenceFold} | malformed paths ${totals.badPath} | non-finite props ${totals.badNum}`,
)
console.log(flagged === 0 ? 'ALL SCENERY CHECKS PASS' : `${flagged}/${ids.length} CIRCUITS FLAGGED`)
