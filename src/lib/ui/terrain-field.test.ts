// #sim-2d — the height field behind the faux elevation. What matters here is that the field is
// deterministic, bounded, continuous, and that its contours come out as CLOSED loops: bands are
// filled as regions, so an open contour would paint a smear across the map.

import { describe, it, expect } from 'vitest'
import {
  makeHeightField, gradeToTrack, isoLoops, bandsFor, bandsCovering, bandWash,
  SOFT_BAND_ALPHA, type BandField, type TerrainBand, type Vec,
} from './terrain-field'
import { BIOMES } from './biomes'
import { hexToRgb, rgbToHex } from '@/lib/color'

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
    const { bands } = bandsFor(field, box, ramp, { reliefM: OPTS.reliefM })
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
    expect(a.bands.map((x) => x.d)).toEqual(b.bands.map((x) => x.d))
  })

  it('hands back a level per BAND, never one per ramp entry', () => {
    // A level that traced no loops is not a band. Counted per ramp entry instead, every later band
    // would be scored against the wrong level and the fold would pick the wrong wash.
    const { bands, field: grid } = bandsFor(field, box, ramp, { reliefM: OPTS.reliefM })
    expect(grid.levels).toHaveLength(bands.length)
    expect([...grid.levels].sort((a, b) => a - b)).toEqual(grid.levels)
    expect(grid.val).toHaveLength((grid.nx + 1) * (grid.ny + 1))
  })
})

// A grid rising left to right across a 2000-unit box, so the contours of levels 15 and 35 are vertical
// lines at x = 750 and x = 1750 and every answer below is arithmetic rather than a reading off noise.
//
// 200 cells across, because the CELL SIZE is part of the question: `bandsCovering` reaches two cell
// diagonals past the disc, so a fixture with cells as big as its discs would refuse every fold and
// prove nothing. The shipped grid is 104 cells over a box about 1.6 km wide, which is ~46 m a cell
// against a 222 m disc at the close shot; 10 units against a 90-100 unit disc here is that ratio.
const NX = 200
const NY = 200
const GRID: BandField = (() => {
  const val = new Float64Array((NX + 1) * (NY + 1))
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) val[j * (NX + 1) + i] = i * 0.2
  return { val, box: { x: 0, y: 0, w: 2000, h: 2000 }, nx: NX, ny: NY, levels: [15, 35] }
})()

describe('bandsCovering', () => {
  it('counts the bands over a disc that straddles no contour', () => {
    // Below both levels, between them, and above both.
    expect(bandsCovering(GRID, { cx: 300, cy: 1000, r: 100 })).toBe(0)
    expect(bandsCovering(GRID, { cx: 1200, cy: 1000, r: 100 })).toBe(1)
    expect(bandsCovering(GRID, { cx: 1900, cy: 1000, r: 90 })).toBe(2)
  })

  it('refuses a disc a contour runs through', () => {
    // Sitting on the level-15 contour and on the level-35 one. Folding either would replace a drawn
    // terrain step with a flat wash, which is the one thing this may never do.
    expect(bandsCovering(GRID, { cx: 750, cy: 1000, r: 100 })).toBeNull()
    expect(bandsCovering(GRID, { cx: 1750, cy: 1000, r: 100 })).toBeNull()
  })

  it('reads the disc and not its bounding square', () => {
    // The contour at x = 750 is 150 away, inside the square's corner reach and outside the disc's.
    // Squared off, a fold would be refused here for a contour the shot cannot see.
    expect(bandsCovering(GRID, { cx: 900, cy: 1000, r: 100 })).toBe(1)
  })

  it('treats ground past the sampled box as below every level', () => {
    // No band path exists out there, so a disc holding both that and banded ground is not constant.
    expect(bandsCovering(GRID, { cx: 50, cy: 1000, r: 100 })).toBe(0)
    expect(bandsCovering(GRID, { cx: 1980, cy: 1000, r: 100 })).toBeNull()
    // Entirely off the box is bare ground, which is a fold to the base colour and no bands at all.
    expect(bandsCovering(GRID, { cx: -500, cy: -500, r: 100 })).toBe(0)
  })

  it('refuses a shot with no disc, which is the whole world', () => {
    expect(bandsCovering(GRID, null)).toBeNull()
  })
})

describe('bandWash', () => {
  /** Source-over of an opaque colour onto an opaque one at `alpha`, in 8-bit sRGB: what a canvas does
   *  for a fill under `globalAlpha`. Written out here rather than imported, so the assertion is
   *  against the compositing rule and not against the same helper twice. */
  const over = (dst: string, src: string, alpha: number): string => {
    const [dr, dg, db] = hexToRgb(dst)
    const [sr, sg, sb] = hexToRgb(src)
    const c = (d: number, s: number) => Math.round(s * alpha + d * (1 - alpha))
    return rgbToHex(c(dr, sr), c(dg, sg), c(db, sb))
  }

  // Every wash the shipped configuration can produce. Off the `terrainDetail` flag `buildScenery`
  // traces two SOFT bands, from ramp[2] and ramp[4], so a shot takes the base, the base plus the low
  // band, or the base plus both — three per biome, over the six biomes every circuit maps to.
  const stacks = Object.values(BIOMES).map((b) => ({
    base: b.base,
    bands: [
      { d: '', fill: b.ramp[2], soft: true },
      { d: '', fill: b.ramp[4], soft: true },
    ] as TerrainBand[],
  }))
  // Discs chosen off GRID above to cover 0, 1 and 2 bands.
  const discs = [
    { cx: 300, cy: 1000, r: 100 },
    { cx: 1200, cy: 1000, r: 100 },
    { cx: 1900, cy: 1000, r: 90 },
  ]

  it('folds to exactly what globalAlpha compositing would have produced', () => {
    const seen = new Set<string>()
    for (const { base, bands } of stacks) {
      for (let n = 0; n < discs.length; n++) {
        // Composited independently, in DRAW order, at the alpha each band is drawn with. Order is the
        // real risk here rather than the arithmetic: the bands stack lowest first.
        let want = base
        for (let i = 0; i < n; i++) want = over(want, bands[i].fill, bands[i].soft ? SOFT_BAND_ALPHA : 1)
        const got = bandWash(bands, GRID, base, discs[n])
        expect(got, `${base} under ${n} band(s)`).toBe(want)
        seen.add(got!)
      }
    }
    // Every wash the shipped configuration reaches, not a sample of them.
    expect(seen.size).toBe(stacks.length * discs.length)
  })

  it('is null wherever the bands have to be drawn', () => {
    const { base, bands } = stacks[0]
    expect(bandWash(bands, GRID, base, { cx: 750, cy: 1000, r: 100 })).toBeNull()
    expect(bandWash(bands, GRID, base, null)).toBeNull()
  })
})
