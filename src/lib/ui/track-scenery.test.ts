// #sim-2d — placement invariants for the procedural world, asserted across EVERY circuit rather
// than a sample, because the bugs these pin were all circuit-dependent: the old clearance scan
// failed only above ~2.6 metres/unit, so a single-track test would have passed while trees were
// being planted on the racing line at Monza, Montreal and Jeddah.
//
// These use geom.ts to measure, which geom.test.ts independently pins against hand-computed values;
// that keeps this file about placement rules and that one about the maths.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { densifyTrace, TRACK_WIDTH_M } from './track-path'
import { buildScenery, TREE_TARGET_BASE, type Scenery } from './track-scenery'
import { biomeOf } from './biomes'
import { BARRIER_OFFSET_M, FENCE_OFFSET_M } from './scenery-props'
import {
  distToPolyline, distPointToObb, obbOverlap, obbCorners, closestPointOnPolyline,
  type Vec, type Obb,
} from './geom'

const TRACK_HALF_M = TRACK_WIDTH_M / 2
const ids = Object.keys(TRACK_LAYOUTS)

function sceneryFor(id: string) {
  const layout = TRACK_LAYOUTS[id]
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: layout.metresPerUnit,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
  })
  const centre: Vec[] = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  return { layout, scenery, centre, u: (m: number) => m / layout.metresPerUnit }
}

const structuresOf = (s: Scenery): Obb[] => [...s.stands, ...s.buildings]

it('covers every registered circuit', () => {
  expect(ids.length).toBeGreaterThanOrEqual(37)
})

describe.each(ids)('%s', (id) => {
  const { scenery, centre, u } = sceneryFor(id)

  it('plants no tree on the track', () => {
    // The canopy EDGE must stay off the ribbon, not just the trunk.
    const worst = scenery.trees.reduce((acc, t) => {
      const clear = distToPolyline({ x: t.x, y: t.y }, centre) - t.r
      return clear < acc ? clear : acc
    }, Infinity)
    expect(worst).toBeGreaterThan(u(TRACK_HALF_M))
  })

  it('keeps every tree canopy clear of every structure', () => {
    const structs = structuresOf(scenery)
    const offenders = scenery.trees.filter((t) => (
      structs.some((s) => distPointToObb({ x: t.x, y: t.y }, s) < t.r)
    ))
    expect(offenders).toHaveLength(0)
  })

  it('keeps structures from overlapping each other', () => {
    const structs = structuresOf(scenery)
    const hits: string[] = []
    for (let i = 0; i < structs.length; i++) {
      for (let j = i + 1; j < structs.length; j++) {
        if (obbOverlap(structs[i], structs[j])) hits.push(`${i}x${j}`)
      }
    }
    expect(hits).toHaveLength(0)
  })

  it('keeps every structure footprint off the track', () => {
    const offenders = structuresOf(scenery).filter((s) => (
      obbCorners(s).some((c) => distToPolyline(c, centre) < u(TRACK_HALF_M))
    ))
    expect(offenders).toHaveLength(0)
  })

  it('roofs every grandstand on the edge away from the track', () => {
    // A real stand is roofed at the rear with the seating raked down toward the circuit. Drawing
    // the roof on the trackside edge put a wall between the crowd and the race.
    const backwards = scenery.stands.filter((s) => {
      const t = { x: Math.cos(s.rot), y: Math.sin(s.rot) }
      // Local +y maps to world (-t.y, t.x); the roof sits opposite the `facing` edge.
      const roofOut = s.facing ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x }
      const near = closestPointOnPolyline({ x: s.x, y: s.y }, centre)
      // The roof must point away from the track, i.e. oppose the direction toward it.
      return roofOut.x * (near.x - s.x) + roofOut.y * (near.y - s.y) > 0
    })
    expect(backwards).toHaveLength(0)
  })


  it('still fills the world', () => {
    // Guards the opposite failure: clearance rules strict enough to empty the map. The tree floor is
    // relative to the biome's own target, because a desert circuit is SUPPOSED to be nearly bare —
    // an absolute floor would either pass Bahrain trivially or fail it wrongly.
    const target = TREE_TARGET_BASE * biomeOf(TRACK_LAYOUTS[id].biome).trees
    expect(scenery.trees.length).toBeGreaterThan(target * 0.8)
    expect(scenery.buildings.length).toBeGreaterThan(40)
    expect(scenery.stands.length).toBeGreaterThan(10)
  })



  it('keeps the trackside cross-section in order', () => {
    // Every one of these was a hand-picked offset that silently disagreed with the barrier geometry:
    // stands sited inside their own fence, marshal posts straddling it, tyre walls stacked BEHIND
    // the wall they exist to protect. The whole cross-section is derived now, and this pins it.
    const MARSHAL_HALF_DEPTH_M = 1.6
    for (const m of scenery.marshals) {
      const d = distToPolyline({ x: m.x, y: m.y }, centre) * TRACK_LAYOUTS[id].metresPerUnit
      expect(d - MARSHAL_HALF_DEPTH_M).toBeGreaterThan(FENCE_OFFSET_M)
    }
    for (const s of structuresOf(scenery)) {
      const near = Math.min(...obbCorners(s).map((c) => distToPolyline(c, centre)))
      expect(near * TRACK_LAYOUTS[id].metresPerUnit).toBeGreaterThan(FENCE_OFFSET_M)
    }
  })

  it('stacks the tyre walls in FRONT of the barrier they protect', () => {
    for (const t of scenery.tyreWalls) {
      const d = Math.min(...t.pts.map((p) => distToPolyline(p, centre))) * TRACK_LAYOUTS[id].metresPerUnit
      expect(d).toBeLessThan(BARRIER_OFFSET_M)
      expect(d).toBeGreaterThan(TRACK_HALF_M) // but never on the racing surface
    }
  })

  it('leaves the ground plain unless terrain detail is asked for', () => {
    expect(scenery.bands).toEqual([])
    expect(scenery.fields).toEqual([])
  })

  it('rings the circuit with barriers and furniture', () => {
    expect(scenery.barriers.some((b) => b.kind === 'wall')).toBe(true)
    expect(scenery.barriers.some((b) => b.kind === 'fence')).toBe(true)
    expect(scenery.tyreWalls.length).toBeGreaterThan(0)
    expect(scenery.marshals.length).toBeGreaterThan(3)
  })
})

describe('terrainDetail', () => {
  // Kept behind a flag rather than deleted: the terraced bands and the enclosed-field quilt read as
  // arbitrary polygons and pinstripes rather than landscape, but the two looks are still comparable.
  const layout = TRACK_LAYOUTS.britain
  const build = (terrainDetail: boolean) => buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: layout.metresPerUnit,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
    terrainDetail,
  })

  it('draws relief and fields when switched on', () => {
    const on = build(true)
    expect(on.bands.length).toBeGreaterThan(2)
    expect(on.fields.length).toBeGreaterThan(40)
  })

  it('leaves both out by default, and changes nothing else', () => {
    const off = build(false)
    expect(off.bands).toEqual([])
    expect(off.fields).toEqual([])
    // The flag must not disturb placement: same trees, stands and buildings either way.
    const on = build(true)
    expect(off.trees.length).toBe(on.trees.length)
    expect(off.buildings.length).toBe(on.buildings.length)
    expect(off.stands.length).toBe(on.stands.length)
  })
})

describe('determinism', () => {
  it('rebuilds an identical world from the same circuit', () => {
    const a = sceneryFor('monaco').scenery
    const b = sceneryFor('monaco').scenery
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it('gives different circuits different worlds', () => {
    const a = sceneryFor('monaco').scenery
    const b = sceneryFor('italy').scenery
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b))
  })
})
