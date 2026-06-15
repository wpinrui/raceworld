import { describe, it, expect } from 'vitest'
import { projectOverallByAge, overall } from './progression'

const base = { pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, consistency: 70, age: 20, peakPotential: 88, primeEnd: 30 }

describe('projectOverallByAge', () => {
  it('rises toward peak by prime, then declines past it', () => {
    const arc = projectOverallByAge(base, 40)
    expect(arc[0].age).toBe(20)
    expect(arc[0].overall).toBeCloseTo(overall(base), 1) // all-70 ratings → 70
    expect(arc[arc.length - 1].age).toBe(40)

    const atPrime = arc.find((p) => p.age === base.primeEnd)!.overall
    expect(atPrime).toBeGreaterThan(arc[0].overall) // developed up to prime
    expect(atPrime).toBeLessThanOrEqual(base.peakPotential + 0.5) // never overshoots potential
    expect(arc[arc.length - 1].overall).toBeLessThan(atPrime) // declined afterwards

    // Monotone rise up to prime, monotone fall after (small rounding tolerance).
    for (let i = 1; i < arc.length; i++) {
      if (arc[i].age <= base.primeEnd) expect(arc[i].overall).toBeGreaterThanOrEqual(arc[i - 1].overall - 0.01)
      else expect(arc[i].overall).toBeLessThanOrEqual(arc[i - 1].overall + 0.01)
    }
  })

  it('a lower declineRate keeps more overall into old age (a longer, gentler peak)', () => {
    const at38 = (arc: { age: number; overall: number }[]) => arc.find((p) => p.age === 38)!.overall
    expect(at38(projectOverallByAge({ ...base, declineRate: 0.3 }, 40))).toBeGreaterThan(at38(projectOverallByAge({ ...base, declineRate: 1 }, 40)))
  })

  it('is deterministic (no RNG)', () => {
    expect(projectOverallByAge(base, 40)).toEqual(projectOverallByAge(base, 40))
  })
})
