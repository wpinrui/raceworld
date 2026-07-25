// #sim-2d — the furniture and land-parcel builders. track-scenery.test.ts only asserts these return
// non-empty arrays across the circuits; these pin the actual rules with hand-built inputs, because
// each one encodes a specific past failure (fencing running across the pit mouths, fields laid as
// disconnected blobs, a keep-out so wide it stripped the landscape bare).

import { describe, it, expect } from 'vitest'
import { buildFences, buildFields, buildMarshalPosts, type TrackFrame } from './scenery-props'

/** A straight 1000-unit run along +x, with the outward normal pointing at -y. 1 unit = 1 metre. */
function straightFrame(total = 1000): TrackFrame {
  return {
    at: (s) => ({ x: ((s % total) + total) % total, y: 0 }),
    tangentAt: () => ({ x: 1, y: 0 }),
    normalAt: () => ({ x: 0, y: -1 }),
    total,
    u: (m) => m,
  }
}

const numsOf = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number)
const ysOf = (d: string) => numsOf(d).filter((_, i) => i % 2 === 1)

describe('buildFences', () => {
  const frame = straightFrame()

  it('runs a fence down both sides at its offset', () => {
    const out = buildFences(frame, { offsetM: 15, skip: () => false })
    expect(out).toHaveLength(2)
    // Outward normal is -y, so side +1 sits at y=-15 and side -1 at y=+15.
    expect(out.map((b) => Math.round(ysOf(b.d)[0])).sort((a, b) => a - b)).toEqual([-15, 15])
  })

  it('breaks a run into separate paths at a suppressed stretch instead of leaping across it', () => {
    // Suppress the middle third. Each side should come back as TWO paths, not one that jumps the gap.
    const out = buildFences(frame, { offsetM: 15, skip: (s) => s > 300 && s < 600 })
    expect(out).toHaveLength(4)
    for (const b of out) {
      // No emitted path may contain a point inside the suppressed stretch.
      const xs = numsOf(b.d).filter((_, i) => i % 2 === 0)
      expect(xs.some((x) => x > 305 && x < 595)).toBe(false)
    }
  })

  it('suppresses only the side it is asked to', () => {
    const out = buildFences(frame, { offsetM: 15, skip: (_s, side) => side === 1 })
    expect(out).toHaveLength(1)
    expect(Math.round(ysOf(out[0].d)[0])).toBe(15)
  })
})

describe('buildMarshalPosts', () => {
  it('spaces posts around the whole lap at the given offset', () => {
    const out = buildMarshalPosts(straightFrame(1000), { everyM: 250, offsetM: 18 })
    expect(out).toHaveLength(4)
    expect(out.map((m) => Math.round(m.x))).toEqual([0, 250, 500, 750])
    expect(out.every((m) => Math.round(m.y) === -18)).toBe(true)
  })
})

describe('buildFields', () => {
  const box = { x: 0, y: 0, w: 1000, h: 1000 }
  const seq = (start = 0.5) => {
    let n = start
    return () => { n = (n * 9301 + 49297) % 233280 / 233280; return n }
  }

  it('tessellates: neighbouring parcels share their corner points, leaving no gaps', () => {
    const out = buildFields(box, seq(), {
      cellU: 200, enclosure: 1, palette: ['#111111'], keepOut: () => false,
    })
    expect(out.length).toBeGreaterThan(10)
    // Every parcel is a closed quad, and its corners are drawn from a shared lattice — so across the
    // whole set the number of DISTINCT corner points is far smaller than 4 per parcel.
    const corners = new Set<string>()
    for (const f of out) {
      const n = numsOf(f.d)
      expect(n).toHaveLength(8) // four points
      for (let i = 0; i < 8; i += 2) corners.add(`${n[i]},${n[i + 1]}`)
    }
    expect(corners.size).toBeLessThan(out.length * 3)
  })

  it('honours the enclosure rate, so a desert is not quilted with farmland', () => {
    const none = buildFields(box, seq(), { cellU: 200, enclosure: 0, palette: ['#111'], keepOut: () => false })
    expect(none).toHaveLength(0)
    const all = buildFields(box, seq(), { cellU: 200, enclosure: 1, palette: ['#111'], keepOut: () => false })
    expect(all.length).toBeGreaterThan(10)
  })

  it('drops only the parcels the keep-out rejects', () => {
    const all = buildFields(box, seq(), { cellU: 200, enclosure: 1, palette: ['#111'], keepOut: () => false })
    const half = buildFields(box, seq(), {
      cellU: 200, enclosure: 1, palette: ['#111'], keepOut: (p) => p.x < 500,
    })
    expect(half.length).toBeGreaterThan(0)
    expect(half.length).toBeLessThan(all.length)
  })

  it('keeps the lattice deterministic for a given rng sequence', () => {
    const opts = { cellU: 200, enclosure: 1, palette: ['#111'], keepOut: () => false }
    expect(buildFields(box, seq(), opts).map((f) => f.d))
      .toEqual(buildFields(box, seq(), opts).map((f) => f.d))
  })
})
