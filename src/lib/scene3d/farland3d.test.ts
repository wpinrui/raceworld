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

const townOf = (land: { group: THREE.Group }): THREE.InstancedMesh => {
  const mesh = land.group.children.find((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
  if (!mesh) throw new Error('far land has no town')
  return mesh
}

/** Where each of the town's blocks stands, and how tall it is. */
function blocks(land: { group: THREE.Group }): Array<{ x: number; y: number; z: number; h: number }> {
  const mesh = townOf(land)
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3()
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m)
    pos.setFromMatrixPosition(m)
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)
    return { x: pos.x, y: pos.y, z: pos.z, h: scale.y }
  })
}

/** The belt's vertices gathered back into the rings they were laid in, nearest first. */
function rings(land: { group: THREE.Group }): Array<{ r: number; colour: THREE.Color[] }> {
  const geo = meshOf(land).geometry
  const pos = geo.getAttribute('position')
  const col = geo.getAttribute('color')
  const cx = VIEW.x + VIEW.w / 2
  const cz = VIEW.y + VIEW.h / 2
  const byRadius = new Map<string, { r: number; colour: THREE.Color[] }>()
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz)
    const key = r.toFixed(3)
    const ring = byRadius.get(key) ?? { r, colour: [] }
    ring.colour.push(new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)))
    byRadius.set(key, ring)
  }
  return [...byRadius.values()].sort((a, b) => a.r - b.r)
}

const mean = (cs: THREE.Color[], ch: 'r' | 'g' | 'b') => cs.reduce((s, c) => s + c[ch], 0) / cs.length

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

  it('raises hills tall enough to close a horizon', () => {
    const land = buildFarLand3D(input())
    const peak = Math.max(...vertices(land).map((v) => v.y))
    // Temperate relief is 55 m at a gain of 9. The floor is what the job needs rather than what the
    // arithmetic gives: a hill under 250 m at the two kilometres this land starts at subtends about
    // seven degrees, and anything shallower is a swell on the skyline rather than a landform
    // closing it.
    expect(peak * MPU).toBeGreaterThan(250)
    expect(peak * MPU).toBeLessThanOrEqual(55 * 9)
  })

  it('takes the land through dirty olive to blue-grey with distance', () => {
    const all = rings(buildFarLand3D(input()))
    const rim = all[0]
    const edge = all[all.length - 1]
    // Untouched where it meets the flat plane: the two share a scan, and haze on one and not the
    // other draws a line across the field at the join.
    expect(rim.colour.some((c) => c.r === 1 && c.g === 1 && c.b === 1)).toBe(true)
    // The middle stop is warm: land loses its saturation before it goes blue.
    const knee = all.find((ring) => ring.r > rim.r + (0.35 * 7000) / MPU)!
    expect(mean(knee.colour, 'r')).toBeGreaterThan(mean(knee.colour, 'b'))
    // ...and the far edge is cool, and much darker than the rim.
    expect(mean(edge.colour, 'b')).toBeGreaterThan(mean(edge.colour, 'r'))
    expect(mean(edge.colour, 'g')).toBeLessThan(mean(rim.colour, 'g') * 0.6)
  })

  it('does not begin at the same distance on every bearing', () => {
    const land = buildFarLand3D(input())
    // The radius at which the ground first stands above the plane, per bearing. A constant here is
    // the crater rim the bearing swing exists to break.
    const risen = vertices(land).filter((v) => v.y > 0).map((v) => v.r)
    expect(Math.max(...risen) / Math.min(...risen)).toBeGreaterThan(1.1)
  })

  it('darkens the hillsides it stands wood on', () => {
    // Read at the rim, where the aerial ramp is still zero and the only thing moving the colour is
    // the wood. A wooded slope is greener than the open ground beside it: the tint takes red down
    // hardest, so the ratio is what separates them rather than the level.
    const rim = rings(buildFarLand3D(input()))[0].colour
    const wooded = rim.filter((c) => c.r < 0.999)
    const open = rim.filter((c) => c.r >= 0.999)
    expect(wooded.length).toBeGreaterThan(0)
    expect(open.length).toBeGreaterThan(0)
    expect(mean(wooded, 'g') / mean(wooded, 'r')).toBeGreaterThan(mean(open, 'g') / mean(open, 'r'))
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

  it('stands a town on the far land, clear of everything built', () => {
    const land = buildFarLand3D(input())
    const cx = VIEW.x + VIEW.w / 2
    const cz = VIEW.y + VIEW.h / 2
    const town = blocks(land)
    expect(town.length).toBeGreaterThan(0)
    for (const b of town) {
      expect(Math.hypot(b.x - cx, b.z - cz)).toBeGreaterThanOrEqual(BUILT_R)
      // Standing ON the ground: the box is modelled with its base at the origin, so the instance's
      // own Y is the ground height and never below the plane.
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.h * MPU).toBeGreaterThanOrEqual(11)
    }
  })

  it('gives the town a middle, rather than one height across the sprawl', () => {
    const heights = blocks(buildFarLand3D(input())).map((b) => b.h * MPU).sort((a, b) => b - a)
    // The mass's core carries the towers. Without the depth term every block is drawn from one
    // distribution and the tallest is a couple of standard deviations off the median, not a
    // multiple of it.
    expect(heights[0]).toBeGreaterThan(heights[Math.floor(heights.length / 2)] * 2.5)
  })

  it('builds a city where the biome is urban and a village where it is forest', () => {
    const urban = townOf(buildFarLand3D(input({ biome: 'urban' }))).count
    const forest = townOf(buildFarLand3D(input({ biome: 'forest' }))).count
    expect(urban).toBeGreaterThan(forest * 1.5)
  })

  it('puts the town behind the same air as the ground it stands on', () => {
    const land = buildFarLand3D(input())
    const town = townOf(land)
    const cx = VIEW.x + VIEW.w / 2
    const cz = VIEW.y + VIEW.h / 2
    const m = new THREE.Matrix4()
    const colour = new THREE.Color()
    let nearest = { r: Infinity, blueness: 0 }
    let furthest = { r: 0, blueness: 0 }
    for (let i = 0; i < town.count; i++) {
      town.getMatrixAt(i, m)
      const p = new THREE.Vector3().setFromMatrixPosition(m)
      const r = Math.hypot(p.x - cx, p.z - cz)
      town.getColorAt(i, colour)
      const blueness = colour.b / colour.r
      if (r < nearest.r) nearest = { r, blueness }
      if (r > furthest.r) furthest = { r, blueness }
    }
    // The far end of the town has gone blue the way the far end of the land has.
    expect(furthest.blueness).toBeGreaterThan(nearest.blueness)
  })

  it('keeps the town out of the shadow and occlusion passes', () => {
    const town = townOf(buildFarLand3D(input()))
    expect(town.castShadow).toBe(false)
    expect(town.receiveShadow).toBe(false)
    expect(town.userData.noAO).toBe(true)
  })

  it('takes the flat fill when the ground scans have not landed', () => {
    const material = meshOf(buildFarLand3D(input())).material as THREE.MeshStandardMaterial
    expect(material.map).toBeNull()
    expect(material.vertexColors).toBe(true)
    expect(material.color.getHexString()).toBe('4a7a3a')
  })
})
