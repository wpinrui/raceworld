import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildFarLand3D, type FarLand3DInput } from './farland3d'

/** Britain's shape and scale, which is the framing the far land was built against: a tall viewBox
 *  at four metres to the unit. */
const VIEW = { x: 0, y: 0, w: 263, h: 440 }
const PAD = 4000
const MPU = 4

const input = (over: Partial<FarLand3DInput> = {}): FarLand3DInput => ({
  view: VIEW,
  pad: PAD,
  metresPerUnit: MPU,
  circuitId: 'britain',
  biome: 'temperate',
  base: '#4A7A3A',
  ...over,
})

const meshOf = (land: { group: THREE.Group }): THREE.Mesh => {
  const mesh = land.group.children[0]
  if (!(mesh instanceof THREE.Mesh)) throw new Error('far land has no mesh')
  return mesh
}

/** Every belt vertex, as (distance from the circuit's centre, height). */
function vertices(land: { group: THREE.Group }): Array<{ r: number; y: number }> {
  const pos = meshOf(land).geometry.getAttribute('position')
  const cx = VIEW.x + VIEW.w / 2
  const cz = VIEW.y + VIEW.h / 2
  const out: Array<{ r: number; y: number }> = []
  for (let i = 0; i < pos.count; i++) {
    out.push({ r: Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz), y: pos.getY(i) })
  }
  return out
}

/** The tightest circle enclosing everything the scenery builds: the viewBox grown by its own 260 m
 *  planting margin. Nothing the far land does may reach inside this. */
const BUILT_R = Math.hypot(VIEW.w + (2 * 260) / MPU, VIEW.h + (2 * 260) / MPU) / 2

describe('buildFarLand3D', () => {
  it('keeps the whole rise outside the built world', () => {
    const land = buildFarLand3D(input())
    const inside = vertices(land).filter((v) => v.r <= BUILT_R)
    // The belt may not even reach in this far, let alone stand up in here.
    expect(inside).toHaveLength(0)
  })

  it('tucks its inner rim under the ground plane rather than fighting it', () => {
    const vs = vertices(buildFarLand3D(input()))
    const innermost = Math.min(...vs.map((v) => v.r))
    // Clear of everything built, with the clearance band on top of that.
    expect(innermost).toBeGreaterThan(BUILT_R)
    const rim = vs.filter((v) => v.r < innermost * 1.001)
    expect(rim.length).toBeGreaterThan(0)
    // ...and below y=0 all the way round, so the seam sits inside opaque ground.
    for (const v of rim) expect(v.y).toBeLessThan(0)
  })

  it('covers the flat plane out to its far corner, so the plane edge is never the skyline', () => {
    const land = buildFarLand3D(input())
    const reach = Math.max(...vertices(land).map((v) => v.r))
    expect(reach).toBeGreaterThanOrEqual(Math.hypot(VIEW.w + 2 * PAD, VIEW.h + 2 * PAD) / 2 - 1e-6)
  })

  it('raises real hills, at a height the biome asks for', () => {
    const land = buildFarLand3D(input())
    const peak = Math.max(...vertices(land).map((v) => v.y))
    // Temperate relief is 55 m at a gain of 3, so the tallest ground stands well up but not past
    // the ceiling that sets. In world units at four metres each.
    expect(peak * MPU).toBeGreaterThan(60)
    expect(peak * MPU).toBeLessThanOrEqual(55 * 3)
  })

  it('does not begin at the same distance on every bearing', () => {
    const land = buildFarLand3D(input())
    // The radius at which the ground first stands above the plane, per bearing. A constant here is
    // the crater rim the bearing swing exists to break.
    const risen = vertices(land).filter((v) => v.y > 0).map((v) => v.r)
    expect(Math.max(...risen) / Math.min(...risen)).toBeGreaterThan(1.1)
  })

  it('shades the surface it stands wood on, and leaves open ground alone', () => {
    const colour = meshOf(buildFarLand3D(input())).geometry.getAttribute('color')
    let tinted = 0
    let open = 0
    for (let i = 0; i < colour.count; i++) {
      if (colour.getX(i) < 0.999) tinted++
      else open++
    }
    expect(tinted).toBeGreaterThan(0)
    expect(open).toBeGreaterThan(0)
  })

  it('stands every tree on the ground under it, never inside the built world', () => {
    const land = buildFarLand3D(input())
    const mesh = meshOf(land)
    const cx = VIEW.x + VIEW.w / 2
    const cz = VIEW.y + VIEW.h / 2
    expect(land.trees.length).toBeGreaterThan(0)
    for (const t of land.trees) {
      expect(Math.hypot(t.x - cx, t.z - cz)).toBeGreaterThanOrEqual(BUILT_R)
      // Never below the flat plane: a tree in the level band stands on it, not in it.
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.h).toBeGreaterThanOrEqual(11)
    }
    expect(mesh.userData.noAO).toBe(true)
  })

  it('plants trees on the hills at the height the hills are', () => {
    const land = buildFarLand3D(input())
    const uphill = land.trees.filter((t) => t.y > 0)
    // Some of the wood is on raised ground rather than all of it sitting on the level band.
    expect(uphill.length).toBeGreaterThan(0)
  })

  it('grows a bare landscape where the biome has no trees and a thick one where it does', () => {
    const arid = buildFarLand3D(input({ biome: 'arid' })).trees.length
    const forest = buildFarLand3D(input({ biome: 'forest' })).trees.length
    expect(arid).toBeLessThan(forest)
  })

  it('grows the same land and the same wood for a circuit every time', () => {
    const a = buildFarLand3D(input())
    const b = buildFarLand3D(input())
    expect(b.trees).toEqual(a.trees)
    expect(Array.from(meshOf(b).geometry.getAttribute('position').array))
      .toEqual(Array.from(meshOf(a).geometry.getAttribute('position').array))
  })

  it('grows a different land for a different circuit', () => {
    const a = buildFarLand3D(input())
    const b = buildFarLand3D(input({ circuitId: 'monza' }))
    expect(b.trees).not.toEqual(a.trees)
  })

  it('faces its ground upward', () => {
    const normal = meshOf(buildFarLand3D(input())).geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0)
  })

  it('stays out of both shadow passes', () => {
    const mesh = meshOf(buildFarLand3D(input()))
    expect(mesh.castShadow).toBe(false)
    expect(mesh.receiveShadow).toBe(false)
  })

  it('takes the flat fill when the ground scans have not landed', () => {
    const material = meshOf(buildFarLand3D(input())).material as THREE.MeshStandardMaterial
    expect(material.map).toBeNull()
    expect(material.vertexColors).toBe(true)
    expect(material.color.getHexString()).toBe('4a7a3a')
  })
})
