import { describe, it, expect } from 'vitest'
import { overtakingRating } from './overtaking-rating'

describe('overtakingRating', () => {
  it('buckets straightness into hard→easy tiers', () => {
    expect(overtakingRating(0.05).label).toBe('Very hard') // Monaco
    expect(overtakingRating(0.2).label).toBe('Hard')        // Hungary / Singapore
    expect(overtakingRating(0.5).label).toBe('Moderate')    // mid grid
    expect(overtakingRating(0.7).label).toBe('Easy')        // Austria / Vegas
    expect(overtakingRating(0.95).label).toBe('Very easy')  // Monza
  })

  it('defaults a missing straightness to the moderate middle', () => {
    expect(overtakingRating(undefined).tier).toBe(2)
  })

  it('estimates a larger pace delta to pass on harder (corner-heavy) tracks', () => {
    expect(overtakingRating(0.05).paceEdge).toBeGreaterThan(overtakingRating(0.95).paceEdge)
    expect(overtakingRating(0.05).paceEdge).toBeCloseTo(2.0, 1) // ~2.0 s/lap at Monaco
    expect(overtakingRating(0.95).paceEdge).toBeLessThan(0.5)   // ~0.3 s/lap at Monza
  })

  it('clamps out-of-range straightness', () => {
    expect(overtakingRating(-1).tier).toBe(0)
    expect(overtakingRating(2).tier).toBe(4)
  })
})
