import { describe, expect, it } from 'vitest'
import { ROAD_CASING, ROAD_TARMAC } from '@/lib/ui/road-ops'
import * as THREE from 'three'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { MOODS } from '@/lib/ui/lighting'
import { buildScenery } from '@/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '@/lib/ui/pit-zone'
import { roadLap, solveLap } from '@/lib/ui/lap-solve'
import { buildWorld3D } from './world3d'

const layout = TRACK_LAYOUTS.britain
const scenery = buildScenery(layout.trace, layout.pit, {
  circuitId: layout.circuitId,
  metresPerUnit: layout.metresPerUnit,
  viewBox: layout.viewBox,
  pitOutside: layout.pitOutside,
  biome: layout.biome,
  terrainDetail: false,
})
const pitSlots = buildPitSlots(layout, 10)
const pitZone = buildPitZone(layout, pitSlots)
const world = buildWorld3D({
  layout, scenery, pitZone, pitSlots, lap: roadLap(solveLap(layout)), lighting: MOODS.afternoon,
})

describe('buildWorld3D', () => {
  it('keeps the painter order as lifts: ground, casing, tarmac, marks', () => {
    const ys = new Map<string, number>()
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return
      const mat = o.material as THREE.MeshLambertMaterial
      const g = o.geometry as THREE.BufferGeometry
      const y = g.attributes.position.getY(0)
      // Flat layers only: anything with real height reports its lowest vertex, which is not a lift.
      let flat = true
      for (let i = 1; i < g.attributes.position.count; i++) {
        if (Math.abs(g.attributes.position.getY(i) - y) > 1e-4) { flat = false; break }
      }
      if (!flat) return
      const seen = ys.get(mat.color.getHexString())
      ys.set(mat.color.getHexString(), Math.max(seen ?? -Infinity, y))
    })
    const ground = ys.get(new THREE.Color(scenery.base).getHexString())!
    // Derived from the constants, not typed out: a literal copy of the road's colour here is what
    // made a retune of the tarmac fail this test for a reason that had nothing to do with painter
    // order.
    const casing = ys.get(new THREE.Color(ROAD_CASING).getHexString())!
    const tarmac = ys.get(new THREE.Color(ROAD_TARMAC).getHexString())!
    const marks = ys.get('f2f2f2')!
    expect(ground).toBeCloseTo(0, 10)
    expect(casing).toBeGreaterThan(ground)
    expect(tarmac).toBeGreaterThan(casing)
    expect(marks).toBeGreaterThan(tarmac)
  })

  it('plants every tree as an instance and lights the world with one shadowed sun and one sky', () => {
    let canopies = 0
    let suns = 0
    let skies = 0
    world.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && (o.geometry as THREE.BufferGeometry).type === 'SphereGeometry') {
        canopies += o.count
      }
      if (o instanceof THREE.DirectionalLight) {
        suns++
        expect(o.castShadow).toBe(true)
      }
      if (o instanceof THREE.HemisphereLight) skies++
    })
    expect(canopies).toBe(scenery.trees.length)
    expect(suns).toBe(1)
    expect(skies).toBe(1)
  })

  it('stands the world up: structures and trees put real triangles above the ground stack', () => {
    expect(scenery.buildings.length).toBeGreaterThan(40)
    expect(scenery.stands.length).toBeGreaterThan(10)
    let standing = 0
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const g = o.geometry as THREE.BufferGeometry
      let maxY = -Infinity
      for (let i = 0; i < g.attributes.position.count; i++) {
        maxY = Math.max(maxY, g.attributes.position.getY(i))
      }
      // Anything reaching above two metres is a solid, not a paint layer.
      if (maxY > 2 / layout.metresPerUnit) standing++
    })
    expect(standing).toBeGreaterThan(scenery.buildings.length)
    expect(world.stats.triangles).toBeGreaterThan(50_000)
  })

  it('hands the rig sun out for live shadow refits', () => {
    expect(world.sun.castShadow).toBe(true)
  })

  it('paints the grid overlay and the teams onto their garages', () => {
    const overlay = [{ d: 'M 0 0 L 4 0 L 4 4 Z', fill: '#E8C33A' }]
    const teamed = buildWorld3D({
      layout, scenery, pitZone, pitSlots, lap: null, lighting: MOODS.afternoon,
      overlay, garageColors: () => '#123456',
    })
    const colours = new Set<string>()
    teamed.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) {
        colours.add((o.material as THREE.MeshLambertMaterial).color.getHexString())
      }
    })
    expect(colours).toContain('e8c33a')
    // The lintel wears the team colour raw; the floor wears it in the building's shade.
    expect(colours).toContain('123456')
    expect(colours).not.toContain('2a2f38')
  })

  it('gives every invocation its own extras, so a double-invoked build cannot steal them', () => {
    // StrictMode double-invokes memo factories and keeps the FIRST result; extras must therefore
    // be built per call, or the discarded second world re-parents the shared group out of the
    // kept one. The regression that emptied the garage boards from every dev session.
    const built: THREE.Group[] = []
    const extras = () => {
      const g = new THREE.Group()
      built.push(g)
      return [g]
    }
    const first = buildWorld3D({
      layout, scenery, pitZone, pitSlots, lap: null, lighting: MOODS.afternoon, extras,
    })
    buildWorld3D({
      layout, scenery, pitZone, pitSlots, lap: null, lighting: MOODS.afternoon, extras,
    })
    expect(built).toHaveLength(2)
    expect(built[0].parent).toBe(first.group)
  })

  it('lays the driven-in ink as ordered decals that never write depth', () => {
    let decals = 0
    let maxOrder = 0
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.renderOrder === 0 || o.renderOrder >= 1000) return
      decals++
      maxOrder = Math.max(maxOrder, o.renderOrder)
      const mat = o.material as THREE.MeshLambertMaterial
      expect(mat.transparent).toBe(true)
      expect(mat.depthWrite).toBe(false)
    })
    // The surface story is hundreds of ops but only dozens of paints: runs merged, order kept.
    expect(decals).toBeGreaterThan(10)
    expect(maxOrder).toBe(decals)
    // The pit box pad and markings paint at 900, over the whole ink range: an ink stack that grew
    // past it would silently paint the grime over the pad again. The regression that hid them.
    expect(maxOrder).toBeLessThan(900)
  })
})
