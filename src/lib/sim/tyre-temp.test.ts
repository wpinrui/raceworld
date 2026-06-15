import { describe, it, expect } from 'vitest'
import { pacePush, pushWearMult, coldPenalty, overheatWearMult, tempDrift, nextTyreTemp, tyreWearRatingMult, TEMP } from './tyre-temp'

describe('push curve', () => {
  it('pace: pushing is quicker, backing off slower, monotonic in intensity', () => {
    expect(pacePush(2)).toBeLessThan(pacePush(1))
    expect(pacePush(1)).toBeLessThan(0)
    expect(pacePush(0)).toBeCloseTo(0, 10)
    expect(pacePush(-1)).toBeGreaterThan(0)
  })
  it('wear: pushing wears more, backing off less, clamped', () => {
    expect(pushWearMult(0)).toBe(1)
    expect(pushWearMult(2)).toBeGreaterThan(pushWearMult(1))
    expect(pushWearMult(-2)).toBeLessThan(1)
    expect(pushWearMult(10)).toBeLessThanOrEqual(1.6)
    expect(pushWearMult(-10)).toBeGreaterThanOrEqual(0.5)
  })
})

describe('window penalties', () => {
  it('cold (under window) costs pace, none inside/over', () => {
    expect(coldPenalty(0.5)).toBe(0)
    expect(coldPenalty(1.2)).toBe(0)
    expect(coldPenalty(-0.3)).toBeGreaterThan(0)
    expect(coldPenalty(-0.4)).toBeGreaterThan(coldPenalty(-0.2))
  })
  it('hot (over window) costs wear, 1.0 inside/under', () => {
    expect(overheatWearMult(0.5)).toBe(1)
    expect(overheatWearMult(-0.2)).toBe(1)
    expect(overheatWearMult(1.3)).toBeGreaterThan(1)
    expect(overheatWearMult(1.5)).toBeGreaterThan(overheatWearMult(1.2))
  })
})

describe('tempDrift', () => {
  it('pushing raises temp, conserving lowers it, normal holds in-window', () => {
    expect(tempDrift(1, 0.5, 60)).toBeGreaterThan(0)
    expect(tempDrift(-1, 0.5, 60)).toBeLessThan(0)
    expect(tempDrift(0, 0.5, 60)).toBe(0)
  })

  it('(b) a better-warming car warms FASTER when too cold', () => {
    expect(tempDrift(0, -0.3, 90)).toBeGreaterThan(tempDrift(0, -0.3, 30))
  })
  it('(d) a better-warming car cools FASTER when too hot', () => {
    // both negative (cooling); the better car cools more (more negative)
    expect(tempDrift(0, 1.3, 90)).toBeLessThan(tempDrift(0, 1.3, 30))
  })
  it('(a) a better-warming car rises SLOWER when pushing near the ceiling', () => {
    expect(tempDrift(1, 0.95, 90)).toBeLessThan(tempDrift(1, 0.95, 30))
  })
  it('(c) a better-warming car cools SLOWER when conserving near the basement', () => {
    // both negative (cooling); the better car cools less (closer to 0)
    expect(tempDrift(-1, 0.05, 90)).toBeGreaterThan(tempDrift(-1, 0.05, 30))
  })

  it('nextTyreTemp clamps to the hard limits', () => {
    expect(nextTyreTemp(TEMP.MAX, 2, 0)).toBeLessThanOrEqual(TEMP.MAX)
    expect(nextTyreTemp(TEMP.MIN, -2, 0)).toBeGreaterThanOrEqual(TEMP.MIN)
  })
})

describe('tyreWearRatingMult', () => {
  it('higher rating = slower wear, monotonic, clamped', () => {
    expect(tyreWearRatingMult(90)).toBeLessThan(tyreWearRatingMult(40))
    expect(tyreWearRatingMult(60)).toBeCloseTo(1, 5)
    expect(tyreWearRatingMult(100)).toBeGreaterThanOrEqual(0.7)
    expect(tyreWearRatingMult(0)).toBeLessThanOrEqual(1.4)
  })
})
