// #sim-2d — pit-complex geometry. Pure since it was lifted out of the renderer, so the shapes the map
// draws can be measured rather than eyeballed. Each case here pins a defect that was VISIBLE:
// a stray triangle on the end wall, and a garage bay that no car could fit inside.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildPitSlots, buildPitZone, pitCameraRotation, pitViewAzimuth } from './pit-zone'
import { screenUpAzimuth } from './lighting'

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

describe('pitViewAzimuth', () => {
  it('faces the garages on every layout, not a fixed compass bearing', () => {
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const az = pitViewAzimuth(layout)
      expect(az, id).not.toBeNull()
      const dir = { x: Math.cos(az!), y: Math.sin(az!) }
      const zone = buildPitZone(layout, buildPitSlots(layout, 11))!
      for (const r of zone.garageFloors) {
        // Outward normal of the garage's front face runs from the back of the bay to its opening.
        const ox = r[0].x - r[3].x
        const oy = r[0].y - r[3].y
        const len = Math.hypot(ox, oy)
        // A visible face is one whose outward normal agrees with the sweep, so this must be positive
        // — and near 1, since the view is set square to the complex rather than merely on its side.
        expect((ox / len) * dir.x + (oy / len) * dir.y, `${id}: looking at the back of the garages`)
          .toBeGreaterThan(0.9)
      }
    }
  })

  it('gives a direction the shadow and the wall faces both agree on', () => {
    // One vector drives both, so a layout may never produce a non-finite or non-unit one.
    for (const id of IDS) {
      const az = pitViewAzimuth(TRACK_LAYOUTS[id])!
      expect(Number.isFinite(az), id).toBe(true)
      expect(Math.hypot(Math.cos(az), Math.sin(az))).toBeCloseTo(1, 9)
    }
  })
})

describe('pitCameraRotation', () => {
  it('lands the pit lane across the screen with the garages along the top', () => {
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const rot = pitCameraRotation(layout)
      expect(rot, id).not.toBeNull()
      const c = Math.cos(rot!)
      const sn = Math.sin(rot!)
      const st = layout.pit.slotStations
      let nx = 0
      let ny = 0
      for (const q of st) {
        nx += q.nx
        ny += q.ny
      }
      const len = Math.hypot(nx, ny)
      // Rotate the garage-side normal into screen space; y is DOWN, so up the screen is -1.
      const sy = ((nx / len) * sn + (ny / len) * c)
      const sx = ((nx / len) * c - (ny / len) * sn)
      expect(sy, `${id}: garages are not at the top`).toBeCloseTo(-1, 6)
      expect(sx, `${id}: pit lane is not horizontal`).toBeCloseTo(0, 6)
    }
  })
})

describe('screenUpAzimuth', () => {
  it('is its own inverse, which is what ties the camera to the bearing', () => {
    for (const r of [-3, -1.1, 0, 0.4, 2.7]) expect(screenUpAzimuth(screenUpAzimuth(r))).toBeCloseTo(r, 12)
  })

  it('reproduces the pit-standardised bearing at the default camera rotation', () => {
    // The map derives its bearing from wherever the camera is; opening at `pitCameraRotation` has to
    // land exactly on `pitViewAzimuth`, or the default view would not be the standardised one.
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      expect(screenUpAzimuth(pitCameraRotation(layout)!), id).toBeCloseTo(pitViewAzimuth(layout)!, 12)
    }
  })

  it('leans solids up the screen at any rotation', () => {
    for (const rot of [-2.4, -0.7, 0, 0.9, 1.6, 3.0]) {
      const az = screenUpAzimuth(rot)
      // World bearing, then through the camera's own rotation, must come out pointing down-screen —
      // solids displace by MINUS this, so down here means leaning up there.
      const d = { x: Math.cos(az), y: Math.sin(az) }
      const sx = d.x * Math.cos(rot) - d.y * Math.sin(rot)
      const sy = d.x * Math.sin(rot) + d.y * Math.cos(rot)
      expect(sx).toBeCloseTo(0, 12)
      expect(sy).toBeCloseTo(1, 12)
    }
  })
})
