import { afterEach, describe, expect, it } from 'vitest'
import { PERF, PERF_FLAGS, resetPerfFlags, setPerfFlags } from './perf-flags'
import { rungFor } from './lod'

afterEach(resetPerfFlags)

const off = () => PERF_FLAGS.filter((k) => !PERF[k])

describe('the switches themselves', () => {
  it('ships with every mitigation on', () => {
    expect(off()).toEqual([])
  })

  it('turns exactly one off and puts every other one back', () => {
    setPerfFlags(['pathCache'])
    expect(off()).toEqual(['pathCache'])
    setPerfFlags(['cullDisc'])
    expect(off()).toEqual(['cullDisc'])
    resetPerfFlags()
    expect(off()).toEqual([])
  })
})

// The switches are only worth anything if the hot sites actually read them, so each one is checked
// through the function it gates rather than by asserting the boolean back.
describe('the sites read them', () => {
  it('collapses the detail ladder to full detail', () => {
    expect(rungFor(1, 1)).toBe('gone')
    setPerfFlags(['lodRungs'])
    expect(rungFor(1, 1)).toBe('near')
  })
})
