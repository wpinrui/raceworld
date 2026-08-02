import { describe, expect, it } from 'vitest'
import { PROBE_HEIGHT_M, probePoint } from './env3d'

/** A unit square lap, 4 units round, corners at the axes. Every arc-length fraction on it has an
 *  answer that can be written down by hand, which is the point of using it. */
const SQUARE = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

describe('probePoint', () => {
  it('stands a couple of metres up, in the circuit\'s own units', () => {
    expect(probePoint(SQUARE, 2).y).toBeCloseTo(PROBE_HEIGHT_M / 2, 9)
    expect(probePoint(SQUARE, 0.5).y).toBeCloseTo(PROBE_HEIGHT_M / 0.5, 9)
  })

  it('lands a third of the way round the CLOSED lap, counting the leg back to the start', () => {
    // 0.35 of 4 units = 1.4: one full leg (0,0)->(1,0), then 0.4 up the second.
    const at = probePoint(SQUARE, 1)
    expect(at.x).toBeCloseTo(1, 9)
    expect(at.z).toBeCloseTo(0.4, 9)
  })

  it('walks by arc LENGTH, not by sample index', () => {
    // The same square, but with the first leg densely sampled and the rest left alone. Counting
    // samples would put the probe barely off the start line; counting length cannot tell the
    // difference between this lap and the plain one.
    const dense = [
      ...Array.from({ length: 40 }, (_, i) => ({ x: i / 40, y: 0 })),
      { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ]
    const at = probePoint(dense, 1)
    const plain = probePoint(SQUARE, 1)
    expect(at.x).toBeCloseTo(plain.x, 9)
    expect(at.z).toBeCloseTo(plain.z, 9)
  })

  it('keeps well clear of the start line, which is the whole reason it is not at zero', () => {
    // The S/F chequer, the grid boxes and the pit wall all live at progress 0, and a static bake
    // taken there paints them down every car's flank for the whole race.
    const at = probePoint(SQUARE, 1)
    expect(Math.hypot(at.x - SQUARE[0].x, at.z - SQUARE[0].y)).toBeGreaterThan(1)
  })

  it('survives a lap with no length in it rather than returning NaN', () => {
    // A degenerate trace must not put NaN into a camera position: three propagates that straight
    // into the cube's view matrices and every face renders empty.
    for (const lap of [[], [{ x: 3, y: 4 }], [{ x: 3, y: 4 }, { x: 3, y: 4 }]]) {
      const at = probePoint(lap, 1)
      expect(Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z)).toBe(true)
    }
  })
})
