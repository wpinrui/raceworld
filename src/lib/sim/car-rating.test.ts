import { describe, it, expect } from 'vitest'
import type { Team } from './types'
import { effectiveCarPace, overallCarPace, ratingsFromCarPace, applyCarForm, addUpgradePace, addUpgradeFocused, aiFocusSplit, splitOverallIntoRatings, randomiseRatingsByRank, DEFAULT_FOCUS } from './car-rating'

const team = (over: Partial<Team>): Team => ({
  id: 't', name: 't', shortName: 'T', nationality: 'GB', color: '#fff', carPace: 60, ...over,
})

// A tiny deterministic LCG for the randomised helpers.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
}

describe('effectiveCarPace', () => {
  it('blends straight-line and cornering by the track straightness', () => {
    const t = team({ straightLine: 80, cornering: 40 })
    expect(effectiveCarPace(t, 1)).toBe(80)   // pure straights → straight-line
    expect(effectiveCarPace(t, 0)).toBe(40)   // pure corners → cornering
    expect(effectiveCarPace(t, 0.5)).toBe(60) // even blend → mean
    expect(effectiveCarPace(t, 0.75)).toBe(70)
  })

  it('falls back to carPace when ratings are absent (legacy saves), and straightness defaults to 0.5', () => {
    const legacy = team({ carPace: 55 })
    expect(effectiveCarPace(legacy, 0.9)).toBe(55)
    expect(effectiveCarPace(team({ straightLine: 70, cornering: 50 }), undefined)).toBe(60)
  })
})

describe('overallCarPace', () => {
  it('is the mean of the two pace ratings, carPace fallback', () => {
    expect(overallCarPace(team({ straightLine: 80, cornering: 40 }))).toBe(60)
    expect(overallCarPace(team({ carPace: 45 }))).toBe(45)
  })
})

describe('applyCarForm', () => {
  it('shifts both pace ratings (and carPace) by the form delta, so effective pace moves on every track', () => {
    const t = applyCarForm(team({ straightLine: 80, cornering: 40 }), 5)
    expect(t.straightLine).toBe(85)
    expect(t.cornering).toBe(45)
    expect(effectiveCarPace(t, 1)).toBe(85)
    expect(effectiveCarPace(t, 0)).toBe(45)
    expect(applyCarForm(team({}), 0).carPace).toBe(60) // no-op at 0
  })
})

describe('addUpgradePace', () => {
  it('adds the gain to both pace ratings and keeps carPace as their mean', () => {
    const t = addUpgradePace(team({ straightLine: 70, cornering: 50, carPace: 60 }), 3)
    expect(t.straightLine).toBe(73)
    expect(t.cornering).toBe(53)
    expect(t.carPace).toBe(63)
    expect(overallCarPace(t)).toBe(63)
  })
})

describe('ratingsFromCarPace', () => {
  it('initialises all four ratings equal to carPace (behaviour-neutral)', () => {
    expect(ratingsFromCarPace(72)).toEqual({ straightLine: 72, cornering: 72, tyreWarming: 72, tyreWear: 72 })
  })
})

describe('addUpgradeFocused', () => {
  it('a pure-pace focus reproduces addUpgradePace exactly', () => {
    const base = team({ straightLine: 70, cornering: 50, tyreWarming: 65, tyreWear: 55, carPace: 60 })
    const focused = addUpgradeFocused(base, 3, DEFAULT_FOCUS)
    const legacy = addUpgradePace(base, 3)
    expect(focused.straightLine).toBe(legacy.straightLine)
    expect(focused.cornering).toBe(legacy.cornering)
    expect(focused.carPace).toBe(legacy.carPace)
    expect(focused.tyreWarming).toBe(65) // tyres untouched by a pure-pace focus
    expect(focused.tyreWear).toBe(55)
  })
  it('allocates the gain (worth 2×delta points) across the four ratings by the split', () => {
    const base = team({ straightLine: 60, cornering: 60, tyreWarming: 60, tyreWear: 60, carPace: 60 })
    const t = addUpgradeFocused(base, 4, { straightLine: 0.25, cornering: 0.25, tyreWarming: 0.25, tyreWear: 0.25 })
    // budget 2·4 = 8, evenly split = +2 each
    expect(t.straightLine).toBe(62)
    expect(t.cornering).toBe(62)
    expect(t.tyreWarming).toBe(62)
    expect(t.tyreWear).toBe(62)
    expect(t.carPace).toBe(62)
  })
  it('clamps tyre ratings to 100', () => {
    const t = addUpgradeFocused(team({ tyreWear: 99, carPace: 60 }), 5, { straightLine: 0, cornering: 0, tyreWarming: 0, tyreWear: 1 })
    expect(t.tyreWear).toBe(100)
  })
})

describe('aiFocusSplit', () => {
  it('returns four positive shares summing to 1', () => {
    const f = aiFocusSplit(lcg(7))
    const sum = f.straightLine + f.cornering + f.tyreWarming + f.tyreWear
    expect(sum).toBeCloseTo(1, 10)
    for (const v of Object.values(f)) expect(v).toBeGreaterThan(0)
  })
})

describe('splitOverallIntoRatings', () => {
  it('keeps the four-stat average ≈ the overall, all within [0,100]', () => {
    for (const overall of [75, 60, 45]) {
      const r = splitOverallIntoRatings(overall, lcg(overall))
      const avg = (r.straightLine + r.cornering + r.tyreWarming + r.tyreWear) / 4
      expect(avg).toBeGreaterThanOrEqual(overall - 3)
      expect(avg).toBeLessThanOrEqual(overall + 3)
      for (const v of Object.values(r)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100) }
    }
  })
})

describe('randomiseRatingsByRank', () => {
  it('pins the top team near 75 and bands each rank below the last', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const m = randomiseRatingsByRank(ids, lcg(3))
    const avg = (id: string) => { const r = m.get(id)!; return (r.straightLine + r.cornering + r.tyreWarming + r.tyreWear) / 4 }
    expect(avg('a')).toBeGreaterThanOrEqual(70) // top pinned at 75 (split + clamp keep the avg close)
    expect(avg('a')).toBeLessThanOrEqual(76)
    expect(avg('e')).toBeLessThan(avg('a')) // the back of the grid is clearly slower than the front
    // each rank sits in its own ~5-wide band, capped below the previous: team i overall < 80 − 5i
    for (let i = 1; i < ids.length; i++) expect(avg(ids[i])).toBeLessThanOrEqual(80 - 5 * i + 3)
  })
})
