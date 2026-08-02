// #elevation — the world's one height. Everything that renders reads this, so what is pinned here
// is the set of properties the rest of the scene is allowed to assume: the racing surface is level
// across its width, the ground is continuous everywhere, the paddock rides the same shelf as the
// circuit, and open land is left as the raw field.

import { describe, it, expect } from 'vitest'
import { buildElevation, FLAT_ELEVATION, type ElevationInput } from './elevation'
import { makeHeightField, type Vec } from './terrain-field'

const P = (x: number, y: number): Vec => ({ x, y })
const FIELD_OPTS = { metresPerUnit: 3, featureM: 900, reliefM: 60 }

/** A circuit as a closed rectangle of densified centreline, in world units. */
function ring(w: number, h: number, step: number): Vec[] {
  const out: Vec[] = []
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay)
    const count = Math.max(1, Math.round(len / step))
    for (let i = 0; i < count; i++) {
      out.push(P(ax + ((bx - ax) * i) / count, ay + ((by - ay) * i) / count))
    }
  }
  edge(0, 0, w, 0)
  edge(w, 0, w, h)
  edge(w, h, 0, h)
  edge(0, h, 0, 0)
  return out
}

const CENTRELINE = ring(900, 600, 6)

function build(over: Partial<ElevationInput> = {}) {
  return buildElevation({
    field: makeHeightField(11, FIELD_OPTS),
    centreline: CENTRELINE,
    metresPerUnit: FIELD_OPTS.metresPerUnit,
    trackShelfM: 10,
    pitShelfM: 30,
    corridorM: 210,
    ...over,
  })
}

describe('buildElevation', () => {
  it('is level ACROSS the track, at every point of the lap', () => {
    const e = build()
    // The bottom edge of the ring runs along y = 0, so its cross-section is the y axis. Sample the
    // full tarmac width plus its kerbs, which is what the shelf is sized to hold.
    for (let x = 60; x < 840; x += 30) {
      const centre = e.at(x, 0)
      for (const off of [-3, -1.5, 1.5, 3]) {
        expect(e.at(x, off)).toBeCloseTo(centre, 10)
      }
    }
  })

  it('gives the circuit real gradient along its length', () => {
    const e = build()
    const hs: number[] = []
    for (const p of CENTRELINE) hs.push(e.at(p.x, p.y))
    const span = Math.max(...hs) - Math.min(...hs)
    // In world units on a 3 m/unit circuit: a metre of rise and fall at the very least, or the
    // whole feature is invisible.
    expect(span).toBeGreaterThan(1 / FIELD_OPTS.metresPerUnit)
  })

  it('straddles zero, so a flat-world camera still finds the ground', () => {
    const e = build()
    const hs = CENTRELINE.map((p) => e.at(p.x, p.y))
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length
    expect(mean).toBeCloseTo(0, 9)
    expect(e.trackRange.min).toBeLessThan(0)
    expect(e.trackRange.max).toBeGreaterThan(0)
  })

  it('smooths the lap relative to the raw field it was sampled from', () => {
    const field = makeHeightField(11, FIELD_OPTS)
    const e = build({ field })
    const spread = (hs: number[]) => Math.max(...hs) - Math.min(...hs)
    const graded = spread(CENTRELINE.map((p) => e.at(p.x, p.y) * FIELD_OPTS.metresPerUnit))
    const rawSpread = spread(CENTRELINE.map((p) => field.at(p)))
    expect(graded).toBeLessThan(rawSpread)
  })

  it('leaves open land as the raw field', () => {
    const field = makeHeightField(11, FIELD_OPTS)
    const e = build({ field })
    // Far outside the circuit's bounding box plus its corridor.
    for (const p of [P(-2000, -2000), P(4000, 3000), P(-1500, 2500)]) {
      expect(e.at(p.x, p.y) * FIELD_OPTS.metresPerUnit).toBeCloseTo(field.at(p) - rawDatum(field), 6)
    }
  })

  it('is continuous — no step anywhere across the corridor', () => {
    const e = build()
    // A transect from the track out past the corridor and into open land, crossing every regime
    // boundary the blend has.
    let previous = e.at(450, 0)
    for (let d = 0.5; d < 400; d += 0.5) {
      const h = e.at(450, -d)
      expect(Math.abs(h - previous)).toBeLessThan(0.5 / FIELD_OPTS.metresPerUnit)
      previous = h
    }
  })

  it('holds the paddock on the shelf beside the straight', () => {
    // A pit lane 25 m off the bottom straight: far enough out to be a quarter into the raw field
    // without its own anchor, which is exactly the case the second index exists for.
    const offU = 25 / FIELD_OPTS.metresPerUnit
    const pitPath = CENTRELINE.filter((p) => p.y === 0 && p.x > 150 && p.x < 700)
      .map((p) => P(p.x, -offU))
    const anchored = build({ pitPath })
    const alone = build()
    const spread = (e: { at: (x: number, y: number) => number }) => {
      // Across the lane, at each station: a paddock has to be level across itself.
      const errors = pitPath.map((p) => Math.abs(e.at(p.x, p.y - 1) - e.at(p.x, p.y + 1)))
      return Math.max(...errors)
    }
    expect(spread(anchored)).toBeLessThan(spread(alone))
    expect(spread(anchored)).toBeCloseTo(0, 10)
  })

  it('is deterministic', () => {
    const a = build()
    const b = build()
    for (const p of [P(10, 10), P(450, -80), P(-900, 400)]) {
      expect(a.at(p.x, p.y)).toBeCloseTo(b.at(p.x, p.y), 12)
    }
  })
})

/** The datum `buildElevation` subtracts: the mean of the smoothed profile along the centreline.
 *  Recomputed here rather than exported, so the test proves the far field is untouched WITHOUT the
 *  module being able to hide a mistake behind a number it also chose. */
function rawDatum(field: { at: (p: Vec) => number }): number {
  const n = CENTRELINE.length
  const raw = CENTRELINE.map((p) => field.at(p))
  const win = Math.max(1, Math.round(n / 24))
  let total = 0
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = -win; k <= win; k++) acc += raw[((i + k) % n + n) % n]
    total += acc / (2 * win + 1)
  }
  return total / n
}

describe('FLAT_ELEVATION', () => {
  it('answers zero everywhere', () => {
    expect(FLAT_ELEVATION.at(0, 0)).toBe(0)
    expect(FLAT_ELEVATION.at(1e5, -1e5)).toBe(0)
    expect(FLAT_ELEVATION.trackRange).toEqual({ min: 0, max: 0 })
  })
})
