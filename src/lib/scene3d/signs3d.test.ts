import { describe, expect, it } from 'vitest'
import { boardFrame } from './signs3d'

// A bay rectangle is [front-s0, front-s1, back-s1, back-s0]; out = front minus back.
describe('boardFrame', () => {
  it('runs the text along the lane viewer\'s screen-right for a mouth facing +x', () => {
    const r = [{ x: 1, y: 0 }, { x: 1, y: 4 }, { x: -8, y: 4 }, { x: -8, y: 0 }]
    const f = boardFrame(r)!
    expect(f.out).toEqual({ x: 1, y: 0 })
    // Viewer stands at +x looking -x: screen-right is -z, so the edge must run 4 -> 0.
    expect(f.a).toEqual({ x: 1, y: 4 })
    expect(f.b).toEqual({ x: 1, y: 0 })
  })

  it('flips for the opposite mouth, so the lane on the other side still reads forward', () => {
    const r = [{ x: -1, y: 0 }, { x: -1, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 0 }]
    const f = boardFrame(r)!
    expect(f.out).toEqual({ x: -1, y: 0 })
    expect(f.a).toEqual({ x: -1, y: 0 })
    expect(f.b).toEqual({ x: -1, y: 4 })
  })

  it('rejects a degenerate bay', () => {
    expect(boardFrame([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBeNull()
    expect(boardFrame([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }])).toBeNull()
  })
})
