// #sim-2d — pit-complex geometry. Pure since it was lifted out of the renderer, so the shapes the map
// draws can be measured rather than eyeballed. Each case here pins a defect that was VISIBLE:
// a stray triangle on the end wall, and a garage bay that no car could fit inside.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildPitSlots, buildPitZone } from './pit-zone'

const IDS = Object.keys(TRACK_LAYOUTS)

/** Signed shoelace: a bay whose vertices invert comes back with the opposite sign to its neighbours. */
const area = (r: Array<{ x: number; y: number }>) => {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

describe('buildPitZone', () => {
  it('builds a zone for every layout, at any team count', () => {
    for (const id of IDS) {
      for (const teams of [2, 6, 11, 13]) {
        const layout = TRACK_LAYOUTS[id]
        const zone = buildPitZone(layout, buildPitSlots(layout, teams))
        expect(zone, `${id} @ ${teams}`).not.toBeNull()
        expect(zone!.garageFloors, `${id} @ ${teams}`).toHaveLength(teams)
      }
    }
  })

  it('never inverts a garage bay, however many teams share the zone', () => {
    // The pier between bays is a fixed width in metres; unclamped it exceeds half a bay on a short
    // pit zone with a full grid, and the bay's start runs past its end into a bow tie.
    for (const id of IDS) {
      for (const teams of [8, 11, 13, 16]) {
        const layout = TRACK_LAYOUTS[id]
        const zone = buildPitZone(layout, buildPitSlots(layout, teams))!
        const signs = new Set(zone.garageFloors.map((r) => Math.sign(area(r))))
        expect(signs.size, `${id} @ ${teams}: bays disagree on winding`).toBe(1)
        for (const r of zone.garageFloors) {
          expect(Math.abs(area(r)), `${id} @ ${teams}: degenerate bay`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('keeps every ring finite', () => {
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const zone = buildPitZone(layout, buildPitSlots(layout, 11))!
      const pts = [...zone.buildingPts, ...zone.upperPts, ...zone.roofRail, ...zone.plant.flat(), ...zone.garageFloors.flat()]
      for (const p of pts) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), id).toBe(true)
      }
    }
  })

  it('gives a garage enough depth to hold a car', () => {
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const zone = buildPitZone(layout, buildPitSlots(layout, 11))!
      for (const r of zone.garageFloors) {
        const depth = Math.hypot(r[3].x - r[0].x, r[3].y - r[0].y) * layout.metresPerUnit
        expect(depth, `${id}: garage only ${depth.toFixed(1)}m deep`).toBeGreaterThan(5.6)
      }
    }
  })
})
