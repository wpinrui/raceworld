import { describe, it, expect } from 'vitest'
import type { Team } from './types'
import { effectiveCarPace, overallCarPace, ratingsFromCarPace, applyCarForm, addUpgradePace } from './car-rating'

const team = (over: Partial<Team>): Team => ({
  id: 't', name: 't', shortName: 'T', nationality: 'GB', color: '#fff', carPace: 60, ...over,
})

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
