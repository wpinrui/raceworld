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

/** Distance from a point to the nearest edge of a ring, for the points a crossing test calls a
 *  boundary case. */
const edgeDist = (p: { x: number; y: number }, r: Array<{ x: number; y: number }>) => {
  let best = Infinity
  for (let i = 0; i < r.length; i++) {
    const a = r[i]
    const b = r[(i + 1) % r.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)))
  }
  return best
}

/** Crossing-number point-in-polygon, for comparing the whole complex against its stretches. */
const inside = (p: { x: number; y: number }, r: Array<{ x: number; y: number }>) => {
  let hit = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]
    const b = r[j]
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
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

  it('covers exactly the same ground in stretches as it does whole', () => {
    // The canvas draws the stretches and the SVG layer draws the whole ring. If those two regions ever
    // differ the map draws a different building depending on which renderer is up, which is the one
    // thing the shared geometry exists to prevent. Sampled rather than reasoned: point-in-polygon over
    // a grid across the complex, whole against the union of the stretches.
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const zone = buildPitZone(layout, buildPitSlots(layout, 11))!
      for (const [name, whole, spans] of [
        ['ground floor', zone.buildingPts, zone.spans.map((s) => s.lowerPts)],
        ['upper storey', zone.upperPts, zone.spans.map((s) => s.upperPts)],
      ] as const) {
        const xs = whole.map((p) => p.x)
        const ys = whole.map((p) => p.y)
        const x0 = Math.min(...xs)
        const x1 = Math.max(...xs)
        const y0 = Math.min(...ys)
        const y1 = Math.max(...ys)
        let missed = 0
        let extra = 0
        for (let i = 0; i <= 120; i++) {
          for (let j = 0; j <= 120; j++) {
            const p = { x: x0 + ((x1 - x0) * i) / 120, y: y0 + ((y1 - y0) * j) / 120 }
            const inWhole = inside(p, whole)
            const inAny = spans.some((r) => inside(p, r))
            if (inWhole && !inAny) missed++
            if (!inWhole && inAny) extra++
          }
        }
        // Zero, not a tolerance: the stretches are cut from the same outline, so a single disagreeing
        // sample means a vertex went somewhere the whole ring does not have one.
        expect(missed, `${id} ${name}: ${missed} samples the stretches do not cover`).toBe(0)
        expect(extra, `${id} ${name}: ${extra} samples the stretches cover and the whole does not`).toBe(0)
      }
    }
  })

  it('marks a stretch\'s cut edges as cuts and its end walls as walls', () => {
    // A cut is not a wall: shaded as one it paints a second tone straight down the middle of a wall
    // that carries on into the next stretch.
    for (const id of IDS) {
      const zone = buildPitZone(TRACK_LAYOUTS[id], buildPitSlots(TRACK_LAYOUTS[id], 11))!
      expect(zone.spans.length).toBeGreaterThan(1)
      for (const [i, s] of zone.spans.entries()) {
        expect(s.lowerSeam, `${id} stretch ${i}`).toHaveLength(s.lowerPts.length)
        expect(s.upperSeam, `${id} stretch ${i}`).toHaveLength(s.upperPts.length)
        // Every interior stretch has exactly two cuts; the two on the ends have one each, since the
        // complex's own end wall is a wall.
        const want = i === 0 || i === zone.spans.length - 1 ? 1 : 2
        expect(s.lowerSeam.filter(Boolean), `${id} stretch ${i} ground floor`).toHaveLength(want)
        expect(s.upperSeam.filter(Boolean), `${id} stretch ${i} upper storey`).toHaveLength(want)
      }
      expect(zone.spans[0].lowerSeam.filter(Boolean).length
        + zone.spans[zone.spans.length - 1].lowerSeam.filter(Boolean).length).toBe(2)
    }
  })

  it('keeps every stretch a real ring, at any team count', () => {
    for (const id of IDS) {
      for (const teams of [2, 6, 11, 16]) {
        const layout = TRACK_LAYOUTS[id]
        const zone = buildPitZone(layout, buildPitSlots(layout, teams))!
        expect(zone.spans, `${id} @ ${teams}`).toHaveLength(teams)
        for (const [i, s] of zone.spans.entries()) {
          const pts = [...s.lowerPts, ...s.upperPts, ...s.deck, ...s.rail, ...s.sep, ...s.plant.flat()]
          for (const p of pts) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${id} @ ${teams} stretch ${i}`).toBe(true)
          }
          expect(Math.abs(area(s.lowerPts)), `${id} @ ${teams}: flat stretch ${i}`).toBeGreaterThan(0)
          expect(Math.abs(area(s.upperPts)), `${id} @ ${teams}: flat stretch ${i} above`).toBeGreaterThan(0)
        }
        // Each seam and each plant unit belongs to exactly one stretch, so nothing is drawn twice and
        // nothing is dropped.
        expect(zone.spans.reduce((n, s) => n + s.plant.length, 0)).toBe(zone.plant.length)
        expect(zone.spans.map((s) => s.seams).join('')).toBe(zone.roofSeams)
      }
    }
  })

  it('keeps the roof under the storey that carries it, however hard the lane curves', () => {
    // The upper storey used to be two front vertices and a handful of rear ones, so on a curving pit
    // lane its front face was a CHORD across the whole complex while the terrace, the rail and the
    // plant standing on it all followed the curve. At Monaco that put 33 of the roof's 53 furniture
    // points off the building, with the garage floors showing through the gap. The stretches gave the
    // storey a vertex at every cut, which is what closed it.
    for (const id of IDS) {
      const layout = TRACK_LAYOUTS[id]
      const zone = buildPitZone(layout, buildPitSlots(layout, 11))!
      // A point ON the ring's edge counts: the rail runs to the complex's own ends, so its last
      // station lands exactly on the boundary and a crossing test may call that either way.
      for (const p of [...zone.roofRail, ...zone.plant.flat()]) {
        if (inside(p, zone.upperPts)) continue
        expect(edgeDist(p, zone.upperPts) * layout.metresPerUnit,
          `${id}: roof furniture stands off the building`).toBeLessThan(0.05)
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
