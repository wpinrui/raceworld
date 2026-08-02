// #sim-2d — the height field behind the faux elevation. What matters here is that the field is
// deterministic, bounded, continuous, and that its contours come out as CLOSED loops: bands are
// filled as regions, so an open contour would paint a smear across the map.

import { describe, it, expect } from 'vitest'
import { makeHeightField, gradeToTrack, isoLoops, bandsFor, type Vec } from './terrain-field'

const P = (x: number, y: number) => ({ x, y })
const OPTS = { metresPerUnit: 3, featureM: 900, reliefM: 60 }

describe('makeHeightField', () => {
  it('is deterministic for a seed', () => {
    const a = makeHeightField(42, OPTS)
    const b = makeHeightField(42, OPTS)
    for (const p of [P(0, 0), P(120, 90), P(-400, 250)]) {
      expect(a.at(p)).toBeCloseTo(b.at(p), 12)
    }
  })

  it('differs between seeds', () => {
    const a = makeHeightField(1, OPTS)
    const b = makeHeightField(2, OPTS)
    const same = [P(10, 10), P(80, 40), P(200, 130)].every((p) => Math.abs(a.at(p) - b.at(p)) < 1e-9)
    expect(same).toBe(false)
  })

  it('stays inside the relief range', () => {
    const f = makeHeightField(7, OPTS)
    for (let i = 0; i < 400; i++) {
      const h = f.at(P((i * 37) % 900, (i * 53) % 900))
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(OPTS.reliefM)
    }
  })

  it('is continuous — neighbouring samples do not jump', () => {
    const f = makeHeightField(3, OPTS)
    for (let i = 0; i < 100; i++) {
      const p = P(i * 7.5, i * 3.25)
      expect(Math.abs(f.at(p) - f.at(P(p.x + 0.5, p.y)))).toBeLessThan(2)
    }
  })
})

describe('gradeToTrack', () => {
  // A straight run of centreline, with the corridor reaching 20 units either side.
  const centreline: Vec[] = Array.from({ length: 60 }, (_, i) => P(i * 10, 0))
  const distTo = (p: Vec) => Math.abs(p.y)

  it('flattens the corridor relative to the raw field', () => {
    const raw = makeHeightField(11, OPTS)
    const graded = gradeToTrack(raw, centreline, { corridorU: 40, distTo })
    // Variation ALONG the track is smoothed out by the corridor; sample the same run in both.
    const spread = (f: { at: (p: Vec) => number }) => {
      const hs = centreline.map((p) => f.at(p))
      return Math.max(...hs) - Math.min(...hs)
    }
    expect(spread(graded)).toBeLessThan(spread(raw))
  })

  it('leaves the field untouched beyond the corridor', () => {
    const raw = makeHeightField(11, OPTS)
    const graded = gradeToTrack(raw, centreline, { corridorU: 40, distTo })
    const far = P(300, 500)
    expect(graded.at(far)).toBeCloseTo(raw.at(far), 12)
  })
})

describe('isoLoops', () => {
  // A single cone peaking in the middle of the grid; its contour must be one closed ring.
  const nx = 24
  const ny = 24
  const box = { x: 0, y: 0, w: 240, h: 240 }
  const val = new Float64Array((nx + 1) * (ny + 1))
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const dx = i - nx / 2
      const dy = j - ny / 2
      val[j * (nx + 1) + i] = Math.max(0, 100 - Math.hypot(dx, dy) * 10)
    }
  }

  it('returns a closed ring around a peak', () => {
    const loops = isoLoops(val, box, 40, nx, ny)
    expect(loops.length).toBe(1)
    const ring = loops[0]
    const first = ring[0]
    const last = ring[ring.length - 1]
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(1e-6)
  })

  it('gives a smaller ring for a higher level', () => {
    const area = (ring: Vec[]) => {
      let a = 0
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        const q = ring[(i + 1) % ring.length]
        a += p.x * q.y - q.x * p.y
      }
      return Math.abs(a) / 2
    }
    const low = isoLoops(val, box, 20, nx, ny)[0]
    const high = isoLoops(val, box, 70, nx, ny)[0]
    expect(area(high)).toBeLessThan(area(low))
  })

  it('returns nothing when the whole grid is below the level', () => {
    expect(isoLoops(val, box, 500, nx, ny)).toHaveLength(0)
  })
})

describe('bandsFor', () => {
  const field = makeHeightField(5, OPTS)
  const box = { x: -300, y: -300, w: 1200, h: 1200 }
  const ramp = ['#111111', '#222222', '#333333', '#444444']

  it('emits bands in ramp order with closed even-odd paths', () => {
    const bands = bandsFor(field, box, ramp, { reliefM: OPTS.reliefM })
    expect(bands.length).toBeGreaterThan(1)
    bands.forEach((b) => {
      expect(b.d.startsWith('M ')).toBe(true)
      expect(b.d.trimEnd().endsWith('Z')).toBe(true)
    })
    // Fills follow the ramp, so the terraces read as ascending altitude.
    expect(ramp.indexOf(bands[0].fill)).toBeLessThan(ramp.indexOf(bands[bands.length - 1].fill))
  })

  it('is deterministic', () => {
    const a = bandsFor(field, box, ramp, { reliefM: OPTS.reliefM })
    const b = bandsFor(field, box, ramp, { reliefM: OPTS.reliefM })
    expect(a.map((x) => x.d)).toEqual(b.map((x) => x.d))
  })
})
