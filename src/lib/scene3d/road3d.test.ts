import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { dashGeometry, dashStations, localRectsGeometry, ribbonGeometry, ringGeometry } from './road3d'

const pos = (g: THREE.BufferGeometry, i: number) => ({
  x: g.attributes.position.getX(i), y: g.attributes.position.getY(i), z: g.attributes.position.getZ(i),
})
const vertexCount = (g: THREE.BufferGeometry) => g.attributes.position.count
const indexCount = (g: THREE.BufferGeometry) => g.index!.count

describe('ribbonGeometry', () => {
  it('offsets a straight ribbon symmetrically about the line, at the lift', () => {
    // A line along +x with the viewBox's y mapping to z: the offset must land across it, in z.
    const g = ribbonGeometry([{ x: 0, y: 0 }, { x: 10, y: 0 }], { halfW: 2, y: 0.5 })
    expect(vertexCount(g)).toBe(4)
    expect(indexCount(g)).toBe(6)
    expect(pos(g, 0)).toEqual({ x: 0, y: 0.5, z: 2 })
    expect(pos(g, 1)).toEqual({ x: 0, y: 0.5, z: -2 })
    expect(pos(g, 2)).toEqual({ x: 10, y: 0.5, z: 2 })
  })

  it('closes a ring with as many quads as points, wrapping to the start', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const g = ribbonGeometry(square, { halfW: 1, y: 0, closed: true })
    expect(vertexCount(g)).toBe(8)
    expect(indexCount(g)).toBe(4 * 6)
  })

  it('caps an open ribbon with semicircle fans that bulge past the endpoints', () => {
    const bare = ribbonGeometry([{ x: 0, y: 0 }, { x: 10, y: 0 }], { halfW: 2, y: 0 })
    const capped = ribbonGeometry([{ x: 0, y: 0 }, { x: 10, y: 0 }], { halfW: 2, y: 0, roundCaps: true })
    expect(indexCount(capped)).toBeGreaterThan(indexCount(bare))
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < vertexCount(capped); i++) {
      minX = Math.min(minX, pos(capped, i).x)
      maxX = Math.max(maxX, pos(capped, i).x)
    }
    // A round cap reaches half a stroke width beyond the line's ends, exactly like the 2D stroke.
    expect(minX).toBeCloseTo(-2, 5)
    expect(maxX).toBeCloseTo(12, 5)
  })
})

describe('dashGeometry', () => {
  it('paints the on-phases only, cut exactly at the block boundaries, phase 0 painted', () => {
    const g = dashGeometry([{ x: 0, y: 0 }, { x: 10, y: 0 }], { halfW: 0.5, y: 0, on: 1, off: 1 })
    // [0,1) [2,3) [4,5) [6,7) [8,9) painted: five quads.
    expect(indexCount(g)).toBe(5 * 6)
    // A vertex pair is cut at every whole-unit boundary plus both ends.
    expect(vertexCount(g)).toBe(11 * 2)
    // Nothing painted reaches past the last block's end at x=9.
    const used = new Set<number>()
    for (let i = 0; i < indexCount(g); i++) used.add(g.index!.getX(i))
    const maxX = Math.max(...[...used].map((i) => pos(g, i).x))
    expect(maxX).toBe(9)
  })
})

describe('dashStations', () => {
  it('cuts at every boundary, carrying the arc and whether the span starting there is painted', () => {
    const st = dashStations([{ x: 0, y: 0 }, { x: 10, y: 0 }], { on: 1, off: 1 })
    expect(st.map((s) => s.s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // Phase 0 is painted, exactly as the 2D dashed stroke starts.
    expect(st.map((s) => s.painted)).toEqual(
      [true, false, true, false, true, false, true, false, true, false, true],
    )
    // The across-normal is the ribbon's: unit, and square to the line.
    expect(st[0].nx).toBeCloseTo(0, 10)
    expect(st[0].ny).toBeCloseTo(1, 10)
  })

  it('lands every boundary once, however awkwardly the blocks divide the segments', () => {
    // A walk that carries a running phase and subtracts its way to the next boundary leaves residue
    // there, reads it as "another boundary, a femtometre away", and stations the polyline twice at
    // every block edge. Invisible in the picture (the quad between the pair has no area) and a third
    // of every dashed geometry in the world.
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 0.37, y: 0 }))
    const st = dashStations(pts, { on: 0.768, off: 0.768 })
    const steps = st.slice(1).map((s, i) => s.s - st[i].s)
    expect(Math.min(...steps)).toBeGreaterThan(1e-6)
    // And the blocks still land where the pattern says: every boundary is present, exactly once.
    const cuts = st.map((s) => s.s)
      .filter((s) => s > 0 && Math.abs((s / 0.768) - Math.round(s / 0.768)) < 1e-9)
    expect(cuts).toHaveLength(Math.floor((39 * 0.37) / 0.768))
  })

  it('offsets the pattern by the shift, so stacked bands lay their blocks out of phase', () => {
    const st = dashStations([{ x: 0, y: 0 }, { x: 4, y: 0 }], { on: 1, off: 1, shift: 1 })
    expect(st[0].painted).toBe(false)
    expect(st[1].s).toBe(1)
    expect(st[1].painted).toBe(true)
  })
})

describe('ringGeometry', () => {
  it('fills a closed ring in place, at the lift', () => {
    const g = ringGeometry([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], 0.2)
    expect(vertexCount(g)).toBe(4)
    expect(indexCount(g)).toBe(2 * 3)
    const p = pos(g, 2)
    expect(p.x).toBe(4)
    expect(p.z).toBe(4)
    expect(p.y).toBeCloseTo(0.2, 6)
  })
})

describe('localRectsGeometry', () => {
  it('bakes a local rect into world space exactly as road-marks rectPath does', () => {
    const g = localRectsGeometry({ x: 0, y: 0, angle: 0 }, [[0, 0, 2, 3]], 0.1)
    expect(vertexCount(g)).toBe(4)
    for (const [i, [x, z]] of ([[0, [0, 0]], [1, [2, 0]], [2, [2, 3]]] as const)) {
      expect(pos(g, i).x).toBe(x)
      expect(pos(g, i).z).toBe(z)
      expect(pos(g, i).y).toBeCloseTo(0.1, 6)
    }
  })

  it('turns with the frame', () => {
    const g = localRectsGeometry({ x: 5, y: 5, angle: Math.PI / 2 }, [[1, 0, 1, 1]], 0)
    // Local +x maps to world +v (z) at a quarter turn.
    expect(pos(g, 0).x).toBeCloseTo(5, 10)
    expect(pos(g, 0).z).toBeCloseTo(6, 10)
  })
})
