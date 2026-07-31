import { afterEach, describe, expect, it } from 'vitest'
import { PERF, PERF_FLAGS, perfFlagsOff, resetPerfFlags, setPerfFlags } from './perf-flags'
import { mergeByPaint, rungFor } from './lod'
import type { DrawOp } from './scenery-draw'

afterEach(resetPerfFlags)

describe('the switches themselves', () => {
  it('ships with every mitigation on', () => {
    expect(PERF_FLAGS.every((k) => PERF[k])).toBe(true)
    expect(perfFlagsOff()).toEqual([])
  })

  it('turns exactly one off and puts every other one back', () => {
    setPerfFlags(['pathCache'])
    expect(perfFlagsOff()).toEqual(['pathCache'])
    setPerfFlags(['mergePaint'])
    expect(perfFlagsOff()).toEqual(['mergePaint'])
    resetPerfFlags()
    expect(perfFlagsOff()).toEqual([])
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

  it('stops paint batching, so identical ops cost a draw call each', () => {
    const ops: DrawOp[] = [
      { d: 'M0 0 L1 1', fill: '#123456' },
      { d: 'M2 2 L3 3', fill: '#123456' },
    ]
    expect(mergeByPaint(ops)).toHaveLength(1)
    setPerfFlags(['mergePaint'])
    expect(mergeByPaint(ops)).toHaveLength(2)
  })
})
