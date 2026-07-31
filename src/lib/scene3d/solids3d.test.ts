import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import {
  GeometrySink, partsSolidGeometry, partsWindowsGeometry, ringSolidGeometry, v3, wallStripGeometry,
} from './solids3d'

const verts = (g: THREE.BufferGeometry) => g.attributes.position.count

describe('GeometrySink', () => {
  it('emits unshared vertices with face normals', () => {
    const s = new GeometrySink()
    s.quad(v3(0, 0, 0), v3(1, 0, 0), v3(1, 0, 1), v3(0, 0, 1))
    const g = s.build()
    expect(verts(g)).toBe(6)
    // An XZ-plane quad's every normal points along y.
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(g.attributes.normal.getY(i))).toBeCloseTo(1, 6)
    }
  })
})

describe('partsSolidGeometry', () => {
  it('builds four walls and a roof per part, roof at the top height', () => {
    const g = partsSolidGeometry([{ dx: 0, dy: 0, w: 10, h: 6 }], 0, 4)
    expect(verts(g)).toBe(5 * 6)
    let maxY = -Infinity
    for (let i = 0; i < verts(g); i++) maxY = Math.max(maxY, g.attributes.position.getY(i))
    expect(maxY).toBeCloseTo(4, 3)
  })

  it('lifts overlapping part roofs apart so coplanar tops cannot depth-fight', () => {
    const g = partsSolidGeometry([
      { dx: 0, dy: 0, w: 10, h: 10 }, { dx: 0, dy: 0, w: 4, h: 4 },
    ], 0, 4)
    const tops = new Set<number>()
    for (let i = 0; i < verts(g); i++) {
      const y = g.attributes.position.getY(i)
      if (y > 3.9) tops.add(Math.round(y * 1e5))
    }
    expect(tops.size).toBe(2)
  })
})

describe('ringSolidGeometry and wallStripGeometry', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]

  it('walls a ring and caps it', () => {
    const capped = ringSolidGeometry(square, 0, 5, true)
    const open = ringSolidGeometry(square, 0, 5, false)
    expect(verts(open)).toBe(4 * 6)
    expect(verts(capped)).toBe(4 * 6 + 2 * 3)
  })

  it('strips an open run without closing it', () => {
    const g = wallStripGeometry([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], 0, 2)
    expect(verts(g)).toBe(2 * 6)
  })
})

describe('partsWindowsGeometry', () => {
  it('grids every outward wall by bay and storey', () => {
    // 20 and 10 long walls at cell 5: (4 + 2) bays twice over, 2 storeys each.
    const g = partsWindowsGeometry([{ dx: 0, dy: 0, w: 20, h: 10 }], 0, 8, 5, 2)!
    expect(verts(g)).toBe((4 + 4 + 2 + 2) * 2 * 6)
  })

  it('skips walls buried inside the union, as the 2D probe does', () => {
    const tower = { dx: 0, dy: 0, w: 6, h: 6 }
    const podium = { dx: 0, dy: 0, w: 20, h: 20 }
    const together = partsWindowsGeometry([podium, tower], 0, 8, 5, 2)!
    const alone = partsWindowsGeometry([podium], 0, 8, 5, 2)!
    // The tower's edges sit strictly inside the podium: they carry no glass.
    expect(verts(together)).toBe(verts(alone))
  })

  it('returns nothing rather than an empty mesh when no bay fits', () => {
    expect(partsWindowsGeometry([{ dx: 0, dy: 0, w: 2, h: 2 }], 0, 4, 5, 1)).toBeNull()
  })
})
