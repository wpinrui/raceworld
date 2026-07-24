// #sim-2d — placement invariants for the procedural world, asserted across EVERY circuit rather
// than a sample, because the bugs these pin were all circuit-dependent: the old clearance scan
// failed only above ~2.6 metres/unit, so a single-track test would have passed while trees were
// being planted on the racing line at Monza, Montreal and Jeddah.
//
// These use geom.ts to measure, which geom.test.ts independently pins against hand-computed values;
// that keeps this file about placement rules and that one about the maths.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { densifyTrace } from './track-path'
import { buildScenery, type Scenery } from './track-scenery'
import { distToPolyline, distPointToObb, obbOverlap, obbCorners, type Vec, type Obb } from './geom'

const TRACK_HALF_M = 13.3 / 2 // the drawn ribbon's casing, from RaceTrackMap's TRACK_WIDTH_M
const ids = Object.keys(TRACK_LAYOUTS)

function sceneryFor(id: string) {
  const layout = TRACK_LAYOUTS[id]
  const scenery = buildScenery(layout.trace, layout.pit.box, {
    circuitId: layout.circuitId,
    metresPerUnit: layout.metresPerUnit,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
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

  it('still fills the world', () => {
    // Guards the opposite failure: clearance rules strict enough to empty the map.
    expect(scenery.trees.length).toBeGreaterThan(600)
    expect(scenery.buildings.length).toBeGreaterThan(40)
    expect(scenery.stands.length).toBeGreaterThan(5)
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
