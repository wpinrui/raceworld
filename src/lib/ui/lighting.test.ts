// #sim-2d — the fake light. Every 3D cue on the map is an agreement between objects about where the
// sun is, so these pin the agreement itself: shadows point one way, lengthen as the sun drops, are
// never pure black, and fade under overcast.

import { describe, it, expect } from 'vitest'
import {
  MOODS, shadowReach, shadowOffset, lightDir, shadowFill, shadowOpacity,
  litFace, shadeFace, edgeFace, tintFace, type Lighting,
} from './lighting'
import { hexToRgb } from '@/lib/color'

const lum = (hex: string) => {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('shadowReach', () => {
  it('lengthens as the sun drops', () => {
    const low = shadowReach({ ...MOODS.afternoon, elevation: 0.2 })
    const mid = shadowReach({ ...MOODS.afternoon, elevation: 0.5 })
    const high = shadowReach({ ...MOODS.afternoon, elevation: 0.9 })
    expect(low).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(high)
  })

  it('is cot(altitude), so a 45-degree sun casts a shadow the height of the object', () => {
    expect(shadowReach({ ...MOODS.afternoon, elevation: 0.5 })).toBeCloseTo(1, 6)
  })

  it('clamps a near-horizon sun instead of throwing a shadow across the circuit', () => {
    expect(shadowReach({ ...MOODS.afternoon, elevation: 0 })).toBeLessThanOrEqual(3)
    expect(shadowReach({ ...MOODS.afternoon, elevation: 0.001 })).toBeLessThanOrEqual(3)
    expect(Number.isFinite(shadowReach({ ...MOODS.afternoon, elevation: 1 }))).toBe(true)
  })
})

describe('shadowOffset', () => {
  const l: Lighting = { azimuth: 0, elevation: 0.5, warmth: 0, ambient: 0 }

  it('points along the azimuth and scales with height', () => {
    const short = shadowOffset(l, 5)
    const tall = shadowOffset(l, 20)
    expect(short.y).toBeCloseTo(0, 9)
    expect(short.x).toBeCloseTo(5, 6) // 45-degree sun: reach 1 per metre
    expect(tall.x).toBeCloseTo(20, 6)
  })

  it('rotates with the azimuth', () => {
    const east = shadowOffset({ ...l, azimuth: 0 }, 10)
    const south = shadowOffset({ ...l, azimuth: Math.PI / 2 }, 10)
    expect(east.x).toBeGreaterThan(9)
    expect(Math.abs(east.y)).toBeLessThan(1e-6)
    expect(south.y).toBeGreaterThan(9)
    expect(Math.abs(south.x)).toBeLessThan(1e-6)
  })

  it('agrees with lightDir', () => {
    const d = lightDir({ ...l, azimuth: 1.1 })
    const o = shadowOffset({ ...l, azimuth: 1.1 }, 10)
    expect(Math.atan2(o.y, o.x)).toBeCloseTo(Math.atan2(d.y, d.x), 9)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9)
  })

  it('casts nothing for a zero-height object', () => {
    const o = shadowOffset(l, 0)
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(0, 9)
  })
})

describe('shadowFill', () => {
  it('is never pure black — shadows are lit by the sky', () => {
    for (const mood of Object.values(MOODS)) {
      const [r, g, b] = hexToRgb(shadowFill(mood))
      expect(r + g + b).toBeGreaterThan(0)
      // Cool: the blue channel leads, which is what stops it reading as a hole in the image.
      expect(b).toBeGreaterThan(r)
      expect(b).toBeGreaterThan(g)
    }
  })

  it('goes bluer as the light warms', () => {
    const warm = hexToRgb(shadowFill({ ...MOODS.afternoon, warmth: 1 }))
    const cool = hexToRgb(shadowFill({ ...MOODS.afternoon, warmth: -1 }))
    expect(warm[2] - warm[0]).toBeGreaterThan(cool[2] - cool[0])
  })
})

describe('shadowOpacity', () => {
  it('fades directional shadows as ambient rises', () => {
    expect(shadowOpacity({ ...MOODS.afternoon, ambient: 0 }))
      .toBeGreaterThan(shadowOpacity({ ...MOODS.afternoon, ambient: 1 }))
    expect(shadowOpacity(MOODS.overcast)).toBeLessThan(shadowOpacity(MOODS.afternoon))
  })


  it('stays inside 0..1 for every mood', () => {
    for (const mood of Object.values(MOODS)) {
      expect(shadowOpacity(mood)).toBeGreaterThan(0)
      expect(shadowOpacity(mood)).toBeLessThanOrEqual(1)
    }
  })
})

describe('face tinting', () => {
  const base = '#808080'

  it('orders faces lit > shaded > edge', () => {
    const l = MOODS.afternoon
    expect(lum(litFace(base, l))).toBeGreaterThan(lum(base) * 0.98)
    expect(lum(shadeFace(base, l))).toBeLessThan(lum(base))
    expect(lum(edgeFace(base, l))).toBeLessThan(lum(shadeFace(base, l)))
  })

  it('warms lit faces and cools shaded ones', () => {
    const warm = { ...MOODS.afternoon, warmth: 1 }
    const lit = hexToRgb(litFace(base, warm))
    expect(lit[0]).toBeGreaterThan(lit[2]) // red over blue = golden
    const shaded = hexToRgb(shadeFace(base, warm))
    expect(shaded[2]).toBeGreaterThan(shaded[0]) // blue over red = cool shade
  })

  it('flattens the range under overcast', () => {
    const spread = (l: Lighting) => lum(litFace(base, l)) - lum(shadeFace(base, l))
    expect(spread(MOODS.overcast)).toBeLessThan(spread(MOODS.afternoon))
  })

  it('never produces an out-of-range channel', () => {
    for (const mood of Object.values(MOODS)) {
      for (const hex of ['#000000', '#FFFFFF', '#59616E', '#7A5147']) {
        for (const exposure of [-1, -0.5, 0, 0.5, 1]) {
          const out = tintFace(hex, mood, exposure)
          expect(out).toMatch(/^#[0-9a-f]{6}$/)
          for (const c of hexToRgb(out)) {
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThanOrEqual(255)
          }
        }
      }
    }
  })
})

describe('MOODS', () => {
  it('keeps every scalar in its documented range', () => {
    for (const [name, m] of Object.entries(MOODS)) {
      expect(m.elevation, name).toBeGreaterThan(0)
      expect(m.elevation, name).toBeLessThanOrEqual(1)
      expect(m.warmth, name).toBeGreaterThanOrEqual(-1)
      expect(m.warmth, name).toBeLessThanOrEqual(1)
      expect(m.ambient, name).toBeGreaterThanOrEqual(0)
      expect(m.ambient, name).toBeLessThanOrEqual(1)
    }
  })

  it('makes afternoon the warm, high-contrast default', () => {
    expect(shadowReach(MOODS.afternoon)).toBeGreaterThan(shadowReach(MOODS.midday))
    expect(shadowOpacity(MOODS.afternoon)).toBeGreaterThan(shadowOpacity(MOODS.overcast))
    expect(MOODS.afternoon.warmth).toBeGreaterThan(0)
  })
})
