// #elevation — putting flat geometry onto the landform. What is pinned here is the contract the
// whole ground stack depends on: a sheet keeps its LIFT above the ground rather than its height, it
// gets the ground's own normal whatever its tessellation, and it is cut fine enough first that the
// chords between its vertices do not sink through what is laid on top of them.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Elevation } from '@/lib/ui/elevation'
import {
  GROUND_SINK_M, axisLines, drape, levelTo, lowestOn, refine, subdivide, terrainSheet,
} from './terrain3d'

/** A ground that ramps along x and is level along z: a slope with a known gradient. */
const SLOPE: Elevation = {
  at: (x) => x / 10,
  trackRange: { min: 0, max: 1 },
}

/** A ground with curvature, so a chord across it is measurably not the surface. */
const DOME: Elevation = {
  at: (x, y) => -(x * x + y * y) / 400,
  trackRange: { min: -1, max: 0 },
}

const FLAT: Elevation = { at: () => 0, trackRange: { min: 0, max: 0 } }

/** A flat sheet of one quad, at a lift, non-indexed the way the ground builders emit. */
function sheet(lift: number, size = 10): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const quad = [
    0, lift, 0, size, lift, 0, size, lift, size,
    0, lift, 0, size, lift, size, 0, lift, size,
  ]
  g.setAttribute('position', new THREE.Float32BufferAttribute(quad, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(quad.length), 3))
  return g
}

const ys = (g: THREE.BufferGeometry) => {
  const p = g.getAttribute('position')
  return Array.from({ length: p.count }, (_, i) => p.getY(i))
}

describe('drape', () => {
  it('keeps the builder\'s lift as height ABOVE the ground, not as height', () => {
    const lift = 0.25
    const g = sheet(lift)
    drape(g, SLOPE, 1)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i) - SLOPE.at(p.getX(i), p.getZ(i))).toBeCloseTo(lift, 6)
    }
  })

  it('takes the normal from the ground, so the same surface shades the same at any tessellation', () => {
    const coarse = sheet(0)
    const fine = subdivide(sheet(0), 1)
    drape(coarse, SLOPE, 1)
    drape(fine, SLOPE, 1)
    // A 1-in-10 slope: the normal leans by exactly that much, whatever mesh carries it.
    const expected = new THREE.Vector3(-0.1, 1, 0).normalize()
    for (const g of [coarse, fine]) {
      const n = g.getAttribute('normal')
      for (let i = 0; i < n.count; i++) {
        expect(n.getX(i)).toBeCloseTo(expected.x, 5)
        expect(n.getY(i)).toBeCloseTo(expected.y, 5)
        expect(n.getZ(i)).toBeCloseTo(expected.z, 5)
      }
    }
  })

  it('leaves a flat world exactly where it was', () => {
    const g = sheet(0.5)
    drape(g, FLAT, 1)
    expect(ys(g).every((y) => Math.abs(y - 0.5) < 1e-9)).toBe(true)
  })
})

describe('subdivide', () => {
  it('cuts until no edge is longer than asked, and covers the same ground', () => {
    const g = subdivide(sheet(0, 10), 2)
    const p = g.getAttribute('position')
    let longest = 0
    for (let i = 0; i < p.count; i += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
        longest = Math.max(longest, Math.hypot(
          p.getX(i + a) - p.getX(i + b), p.getZ(i + a) - p.getZ(i + b),
        ))
      }
    }
    expect(longest).toBeLessThanOrEqual(2 + 1e-6)
    // Still the same 10x10 patch, not a shrunken or shifted one.
    const g2 = new THREE.BufferGeometry()
    g2.setAttribute('position', p)
    g2.computeBoundingBox()
    expect(g2.boundingBox!.min.x).toBeCloseTo(0, 6)
    expect(g2.boundingBox!.max.x).toBeCloseTo(10, 6)
  })

  it('closes the gap a chord leaves across curved ground', () => {
    const gap = (g: THREE.BufferGeometry) => {
      drape(g, DOME, 1)
      const p = g.getAttribute('position')
      let worst = 0
      // Compare each triangle's centroid against the surface it is meant to lie on.
      for (let i = 0; i < p.count; i += 3) {
        let cx = 0
        let cy = 0
        let cz = 0
        for (let k = 0; k < 3; k++) {
          cx += p.getX(i + k) / 3
          cy += p.getY(i + k) / 3
          cz += p.getZ(i + k) / 3
        }
        worst = Math.max(worst, Math.abs(cy - DOME.at(cx, cz)))
      }
      return worst
    }
    expect(gap(subdivide(sheet(0, 20), 2))).toBeLessThan(gap(sheet(0, 20)) / 10)
  })

  it('emits the same attributes it was given, so a merge cannot silently drop it', () => {
    // `mergeGeometries` returns null when its inputs disagree about attributes, which took a whole
    // ink run to nothing the first time this returned position alone.
    const cut = subdivide(sheet(0), 2)
    expect(cut.getAttribute('normal')).toBeTruthy()
    expect(cut.getAttribute('normal').count).toBe(cut.getAttribute('position').count)
  })

  it('leaves indexed geometry alone rather than corrupting it', () => {
    const indexed = new THREE.PlaneGeometry(10, 10)
    expect(subdivide(indexed, 1)).toBe(indexed)
  })

  it('stops at its budget rather than quartering forever', () => {
    const g = subdivide(sheet(0, 100_000), 0.001, 5_000)
    expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(5_000 * 4)
  })
})

describe('refine', () => {
  it('inserts points until no gap is longer than asked, keeping the ends', () => {
    const out = refine([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[out.length - 1]).toEqual({ x: 10, y: 0 })
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)).toBeLessThanOrEqual(2 + 1e-9)
    }
  })

  it('adds resolution without adding shape', () => {
    const out = refine([{ x: 0, y: 0 }, { x: 9, y: 0 }], 1)
    expect(out.every((p) => Math.abs(p.y) < 1e-9)).toBe(true)
  })

  it('wraps a closed run and does not repeat its first point', () => {
    const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
    const out = refine(square, 2, true)
    expect(out).toHaveLength(8)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[out.length - 1]).toEqual({ x: 0, y: 2 })
  })
})

describe('axisLines', () => {
  it('holds the asked pitch across the inner span and grows outside it', () => {
    const lines = axisLines(0, 100, -1000, 1000, 10)
    const inner = lines.filter((x) => x >= 0 && x <= 100)
    for (let i = 1; i < inner.length; i++) expect(inner[i] - inner[i - 1]).toBeCloseTo(10, 6)
    // Ascending throughout, and reaching the outer edge at both ends.
    for (let i = 1; i < lines.length; i++) expect(lines[i]).toBeGreaterThan(lines[i - 1])
    expect(lines[0]).toBeCloseTo(-1000, 6)
    expect(lines[lines.length - 1]).toBeCloseTo(1000, 6)
  })

  it('spends few lines on the far field, which is the point of growing them', () => {
    const lines = axisLines(0, 100, -20_000, 20_000, 10)
    expect(lines.filter((x) => x < 0 || x > 100).length).toBeLessThan(80)
  })
})

describe('terrainSheet', () => {
  const build = (elevation: Elevation) => terrainSheet(elevation, {
    inner: { x0: 0, y0: 0, x1: 40, y1: 40 },
    outer: { x0: -200, y0: -200, x1: 240, y1: 240 },
    cell: 5,
    sink: GROUND_SINK_M,
  })

  it('stands on the elevation, set below it by the sink', () => {
    const g = build(SLOPE)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeCloseTo(SLOPE.at(p.getX(i), p.getZ(i)) - GROUND_SINK_M, 4)
    }
  })

  it('carries the ground\'s own normal', () => {
    const g = build(SLOPE)
    const n = g.getAttribute('normal')
    const expected = new THREE.Vector3(-0.1, 1, 0).normalize()
    // Away from the rim, where the differences are central.
    const p = g.getAttribute('position')
    let checked = 0
    for (let i = 0; i < n.count; i++) {
      if (p.getX(i) <= 0 || p.getX(i) >= 40 || p.getZ(i) <= 0 || p.getZ(i) >= 40) continue
      expect(n.getX(i)).toBeCloseTo(expected.x, 4)
      expect(n.getY(i)).toBeCloseTo(expected.y, 4)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('has no unusable normal anywhere, which a lit shader turns into NaN', () => {
    const n = build(DOME).getAttribute('normal')
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5)
    }
  })
})

describe('levelTo and lowestOn', () => {
  it('finds the lowest ground a fill stands on', () => {
    // The patch spans x 0..10 on a 1-in-10 slope, so its lowest ground is at x = 0.
    expect(lowestOn(sheet(0), SLOPE)).toBeCloseTo(0, 6)
  })

  it('sets a whole fill to one height, which is what water does', () => {
    const g = sheet(0)
    levelTo(g, 3)
    expect(ys(g).every((y) => Math.abs(y - 3) < 1e-9)).toBe(true)
  })
})
