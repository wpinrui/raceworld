import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { KERB_RED, KERB_WHITE, KERB_WIDTH_M, type SceneryKerb } from '@/lib/ui/track-scenery'
import { SceneMaterials } from './materials3d'
import { dashStations } from './road3d'
import { buildKerbs3D, loftKerb } from './kerb3d'

// A straight kerb 12 m long, at one metre per unit so every number below reads in metres. The track
// lies on the +z side of it: the polyline runs along +x, whose across-normal is +z, and `inward` is
// the sign along that normal pointing at the tarmac.
const u = (m: number) => m
const BASE = 0.02
const TILE = 1.2
const line = [{ x: 0, y: 0 }, { x: 12, y: 0 }]
const stations = dashStations(line, { on: 3, off: 3 })
const opts = { u, base: BASE, inward: 1 as const, tile: TILE }

const attr = (g: THREE.BufferGeometry, name: string) => g.getAttribute(name)
const each = (g: THREE.BufferGeometry, name: string, f: (v: THREE.Vector3, i: number) => void) => {
  const a = attr(g, name)
  const v = new THREE.Vector3()
  for (let i = 0; i < a.count; i++) f(v.fromBufferAttribute(a, i), i)
}

describe('loftKerb', () => {
  const red = loftKerb(stations, true, opts)!
  const white = loftKerb(stations, false, opts)!

  it('stands a section up from the road: a lip at the tarmac, a ramp, a skirt below', () => {
    let low = Infinity
    let high = -Infinity
    each(red, 'position', (p) => {
      low = Math.min(low, p.y)
      high = Math.max(high, p.y)
    })
    // The ramp's crown, 62 mm over the road it stands on. Flat paint had one y and nothing else.
    expect(high).toBeCloseTo(BASE + 0.062, 6)
    // And the skirt drops below the road surface, so no low angle finds daylight under the kerb.
    expect(low).toBeCloseTo(BASE - 0.03, 6)
  })

  /** The tallest vertex standing on one edge of the strip. */
  const edgeHigh = (g: THREE.BufferGeometry, z: number) => {
    let high = -Infinity
    each(g, 'position', (p) => {
      if (Math.abs(p.z - z) < 1e-6) high = Math.max(high, p.y)
    })
    return high
  }

  it('rises AWAY from the track, so the edge a car climbs is the low one', () => {
    // Inward +1 puts the tarmac on the +z side, so the section's own inner edge is its highest z.
    const half = KERB_WIDTH_M / 2
    expect(edgeHigh(red, half)).toBeCloseTo(BASE + 0.015, 6)
    expect(edgeHigh(red, -half)).toBeCloseTo(BASE + 0.062, 6)
    // The strip is its painted width, centred on the polyline exactly as the flat ribbon was.
    let zLow = Infinity
    let zHigh = -Infinity
    each(red, 'position', (p) => {
      zLow = Math.min(zLow, p.z)
      zHigh = Math.max(zHigh, p.z)
    })
    expect(zHigh - zLow).toBeCloseTo(KERB_WIDTH_M, 6)
  })

  it('mirrors the section when the track is on the other side', () => {
    const flipped = loftKerb(stations, true, { ...opts, inward: -1 })!
    const half = KERB_WIDTH_M / 2
    expect(edgeHigh(flipped, -half)).toBeCloseTo(BASE + 0.015, 6)
    expect(edgeHigh(flipped, half)).toBeCloseTo(BASE + 0.062, 6)
  })

  it('cuts red and white at the same block boundaries, with no strip left unbuilt', () => {
    const span = (g: THREE.BufferGeometry) => {
      let lo = Infinity
      let hi = -Infinity
      each(g, 'position', (p) => {
        lo = Math.min(lo, p.x)
        hi = Math.max(hi, p.x)
      })
      return [lo, hi]
    }
    // Phase 0 is painted, so red owns [0,3] and [6,9] and white owns what is left over.
    expect(span(red)).toEqual([0, 9])
    expect(span(white)).toEqual([3, 12])
  })

  it('tapers both ends into the road, which is also what closes the loft', () => {
    // Every vertex at the very start of the run sits on the road surface: nothing to see end-on, so
    // the solid needs no cap.
    const ends = { start: [] as number[], mid: [] as number[] }
    each(red, 'position', (p) => {
      if (p.x === 0) ends.start.push(p.y)
      if (p.x === 3) ends.mid.push(p.y)
    })
    expect(ends.start.length).toBeGreaterThan(0)
    expect(Math.max(...ends.start)).toBeCloseTo(BASE, 6)
    expect(Math.min(...ends.start)).toBeCloseTo(BASE, 6)
    expect(Math.max(...ends.mid)).toBeCloseTo(BASE + 0.062, 6)
    // The white run at the far end tapers the same way.
    const last: number[] = []
    each(white, 'position', (p) => {
      if (p.x === 12) last.push(p.y)
    })
    expect(Math.max(...last)).toBeCloseTo(BASE, 6)
  })

  it('lofts UVs along the strip, so the ridges cross a kerb whichever way it points', () => {
    // V is arc, U is width. A world projection would run the corrugation one fixed way across the
    // whole circuit instead, which is the reason these are authored rather than projected.
    const uv = attr(red, 'uv')
    const pos = attr(red, 'position')
    let across = -Infinity
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getY(i)).toBeCloseTo(pos.getX(i) / TILE, 6)
      across = Math.max(across, uv.getX(i))
    }
    expect(across).toBeCloseTo(KERB_WIDTH_M / TILE, 6)
  })

  it('carries analytic unit normals, upward over the ramp and outward off the back', () => {
    let up = 0
    let out = 0
    each(red, 'normal', (n) => {
      expect(n.length()).toBeCloseTo(1, 5)
      if (n.y > 0.99) up++
      // Inward +1 means the back of the kerb faces -z.
      if (n.z < -0.99) out++
    })
    expect(up).toBeGreaterThan(0)
    expect(out).toBeGreaterThan(0)
  })

  it('emits no zero-area triangles, tapered ends included', () => {
    const pos = attr(red, 'position')
    const index = red.index!
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    let degenerate = 0
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(pos, index.getX(t))
      b.fromBufferAttribute(pos, index.getX(t + 1))
      c.fromBufferAttribute(pos, index.getX(t + 2))
      if (b.sub(a).cross(c.sub(a)).lengthSq() === 0) degenerate++
    }
    expect(degenerate).toBe(0)
  })

  it('builds nothing from a run with no block of its colour', () => {
    // One short block, all painted: there is no white to build, and an empty geometry would be a
    // mesh drawing nothing.
    const short = dashStations([{ x: 0, y: 0 }, { x: 2, y: 0 }], { on: 3, off: 3 })
    expect(loftKerb(short, false, opts)).toBeNull()
    expect(loftKerb(short, true, opts)).not.toBeNull()
  })
})

describe('buildKerbs3D', () => {
  const kerb: SceneryKerb = {
    d: '', pts: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 12, y: 0 }], inward: 1, cx: 6, cy: 0, r: 6,
  }

  it('gives every kerb its two paints, as shadow-casting solids', () => {
    const group = buildKerbs3D([kerb], u, BASE, new SceneMaterials())
    const meshes = group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
    expect(meshes).toHaveLength(2)
    const colours = meshes.map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString())
    expect(colours).toEqual([KERB_WHITE, KERB_RED].map((c) => new THREE.Color(c).getHexString()))
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.receiveShadow).toBe(true)
      // No polygonOffset: the depth buffer separates a solid from the road honestly, and a
      // slope-scaled bias on a near-vertical face would pull the kerb through whatever parks beside it.
      expect((mesh.material as THREE.MeshStandardMaterial).polygonOffset).toBe(false)
    }
  })
})
