import { describe, it, expect } from 'vitest'
import { planStrategy, truthBelief } from './pit-ai'
import { buildCandidates, shouldEvaluatePit } from './strategy-forecast'

describe('buildCandidates by weather', () => {
  const pitCompounds = (m: number) => buildCandidates(m, 'racing').flatMap((c) => (c.kind === 'pit' ? [c.compound] : []))

  it('offers slicks and a hold in the dry, no wets', () => {
    const c = buildCandidates(0, 'racing')
    expect(pitCompounds(0)).toEqual(['soft', 'medium', 'hard'])
    expect(c.some((x) => x.kind === 'hold')).toBe(true)
  })

  it('switches to intermediates/wets once it is wet and drops slicks', () => {
    expect(pitCompounds(0.3)).toContain('intermediate')
    expect(pitCompounds(0.3)).not.toContain('soft')
    expect(pitCompounds(0.6)).toContain('wet')
    expect(pitCompounds(0.6)).not.toContain('soft')
  })

  it('pre-race offers the grid tyres as start options', () => {
    const c = buildCandidates(0, 'pre-race')
    expect(c.every((x) => x.kind === 'start')).toBe(true)
    expect(c.flatMap((x) => (x.kind === 'start' ? [x.compound] : []))).toEqual(['soft', 'medium', 'hard'])
  })
})

describe('planStrategy fast mode (forecast skips the 2-stop search)', () => {
  const laps = 60
  const weather = Array.from({ length: laps + 1 }, (_, i) => ({ lap: i + 1, moisture: 0 }))
  // High-deg, long race: with the full search a 2-stop (3 stints) wins; fast mode must never consider it.
  const belief = truthBelief(
    { soft: 0, medium: 0.7, hard: 1.5, intermediate: 2.5, wet: 4 },
    { soft: 0.15, medium: 0.18, hard: 0.22, intermediate: 0.3, wet: 0.45 },
    laps,
  )

  it('finds a 2-stop with the full search but only a 1-stop in fast mode', () => {
    const full = planStrategy(1, laps, 100, 'soft', 50, belief, weather, weather, 25, true)
    const fast = planStrategy(1, laps, 100, 'soft', 50, belief, weather, weather, 25, false)
    expect(full.stints.length).toBe(3) // two stops
    expect(fast.stints.length).toBeLessThanOrEqual(2) // at most one stop — the cubic search was skipped
  })
})

describe('shouldEvaluatePit (zero-sim guard)', () => {
  it('skips a healthy, in-window tyre', () => {
    expect(shouldEvaluatePit({ compound: 'medium', condition: 90, maxLifeLaps: 30 }, 0)).toBe(false)
    expect(shouldEvaluatePit({ compound: 'medium', condition: 70, maxLifeLaps: 30 }, 0)).toBe(false) // at the threshold
  })

  it('evaluates once the tyre is worn below the threshold', () => {
    expect(shouldEvaluatePit({ compound: 'medium', condition: 69, maxLifeLaps: 30 }, 0)).toBe(true)
    expect(shouldEvaluatePit({ compound: 'soft', condition: 20, maxLifeLaps: 20 }, 0)).toBe(true)
  })

  it('always evaluates a tyre wrong for the weather, however fresh', () => {
    expect(shouldEvaluatePit({ compound: 'medium', condition: 100, maxLifeLaps: 30 }, 0.6)).toBe(true) // slicks in the wet
    expect(shouldEvaluatePit({ compound: 'wet', condition: 100, maxLifeLaps: 30 }, 0)).toBe(true) // wets in the dry
  })
})
