import { describe, expect, it } from 'vitest'
import { ROAD_CASING, ROAD_TARMAC } from '@/lib/ui/road-ops'
import * as THREE from 'three'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { MOODS } from '@/lib/ui/lighting'
import { KERB_RED, buildScenery } from '@/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '@/lib/ui/pit-zone'
import { roadLap, solveLap } from '@/lib/ui/lap-solve'
import type { SurfaceDetail, WorldDetail } from './detail3d'
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

/** A stand-in for the generated grain. `buildWorldDetail` rasterises canvases and cannot run here,
 *  and the question this file asks of it is only WHICH grain a surface was handed, which the map's
 *  identity answers on its own. */
function stubDetail(): WorldDetail {
  const grain = (tileM: number): SurfaceDetail => ({
    normalMap: new THREE.Texture(),
    albedoMap: new THREE.Texture(),
    roughnessMap: null,
    normalScale: 1,
    tileM,
  })
  return {
    tarmac: grain(0.8), paint: grain(0.8), ground: grain(9), wall: grain(4.5), kerb: grain(1.2),
    dispose: () => {},
  }
}

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

  it('lights the world with one shadowed sun and one sky', () => {
    let suns = 0
    let skies = 0
    world.group.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) {
        suns++
        expect(o.castShadow).toBe(true)
      }
      if (o instanceof THREE.HemisphereLight) skies++
    })
    expect(suns).toBe(1)
    expect(skies).toBe(1)
  })

  it('plants no wood at all without the imported pack', () => {
    // This used to assert a sphere per tree, from when a pack-less world stood lollipops instead.
    // Nothing is the right answer now: a circuit that is briefly bare reads as one still loading,
    // where one full of placeholder greenery reads as the finished thing.
    let instances = 0
    world.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh
        && (o.geometry as THREE.BufferGeometry).type === 'SphereGeometry') {
        instances += o.count
      }
    })
    expect(instances).toBe(0)
    expect(scenery.trees.length).toBeGreaterThan(0)
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

  it('stands the kerbs up as solids, batched to one draw per paint, casting their own shadow', () => {
    const red = new THREE.Color(KERB_RED).getHexString()
    const kerbs: THREE.Mesh[] = []
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      if ((o.material as THREE.MeshStandardMaterial).color.getHexString() === red) kerbs.push(o)
    })
    // ONE mesh for every red kerb on the circuit, not one per kerb: a draw call costs the same
    // whatever it delivers, and the circuit's kerbing was two of them per kerb.
    expect(kerbs).toHaveLength(1)
    expect(scenery.kerbs.length).toBeGreaterThan(1)
    for (const mesh of kerbs) {
      expect(mesh.castShadow).toBe(true)
      const g = mesh.geometry as THREE.BufferGeometry
      let low = Infinity
      let high = -Infinity
      for (let i = 0; i < g.attributes.position.count; i++) {
        low = Math.min(low, g.attributes.position.getY(i))
        high = Math.max(high, g.attributes.position.getY(i))
      }
      // Paint has one height. A kerb has a section: a skirt under the road and a crown over it.
      expect(high - low).toBeGreaterThan(0.09 / layout.metresPerUnit)
    }
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
    const painted = new THREE.Color()
    teamed.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return
      colours.add((o.material as THREE.MeshLambertMaterial).color.getHexString())
      // Decals carry their paint on the VERTICES, over a white material, so a colour laid on the
      // road is found there rather than on the material it was drawn with.
      const vertex = o.geometry.attributes.color
      if (!vertex) return
      for (let i = 0; i < vertex.count; i++) {
        colours.add(painted.fromBufferAttribute(vertex, i).getHexString())
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

  it('grains the road paint as paint, never as the aggregate or the grass around it', () => {
    const detail = stubDetail()
    const grained = buildWorld3D({
      layout, scenery, pitZone, pitSlots, lap: roadLap(solveLap(layout)),
      lighting: MOODS.afternoon, detail,
    })
    const maps = new Map<string, Set<THREE.Texture | null>>()
    grained.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return
      const mat = o.material as THREE.MeshStandardMaterial
      if (!mat.color) return
      const key = mat.color.getHexString()
      if (!maps.has(key)) maps.set(key, new Set())
      maps.get(key)!.add(mat.normalMap)
    })
    // The boundary line and the tarmac each take their own grain. Handed the road's maps, the line
    // came out mottled from a fifth brightness to full and corrugated with chippings, which is a
    // strip of aggregate where the circuit's edge is meant to be.
    expect([...maps.get(new THREE.Color(ROAD_CASING).getHexString())!])
      .toEqual([detail.paint.normalMap])
    expect([...maps.get(new THREE.Color(ROAD_TARMAC).getHexString())!])
      .toEqual([detail.tarmac.normalMap])
    // The start line is paint too, and it used to take `add`'s default: the GROUND's clump grain,
    // at a nine metre tile, on the white blocks the grid forms up against.
    const white = maps.get('f2f2f2')!
    expect(white.has(detail.paint.normalMap)).toBe(true)
    expect(white.has(detail.ground.normalMap)).toBe(false)
  })

  it('damps the tarmac reflection and only the tarmac, ink included', () => {
    // The road returns a quarter of the dielectric reflection every other surface returns, because
    // at full strength the sky it reflects was doing four fifths of its brightness and the road
    // rendered blue. The white lines beside it keep the full one: paint IS a sealed surface.
    const specular = new Map<string, Set<number>>()
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return
      const mat = o.material as THREE.MeshPhysicalMaterial
      if (!mat.color) return
      const key = mat.color.getHexString()
      if (!specular.has(key)) specular.set(key, new Set())
      // A standard material has no such field at all, which IS the full-strength answer.
      specular.get(key)!.add(mat.specularIntensity ?? 1)
    })
    expect([...specular.get(new THREE.Color(ROAD_TARMAC).getHexString())!]).toEqual([0.25])
    expect([...specular.get(new THREE.Color(ROAD_CASING).getHexString())!]).toEqual([1])
    // The ink is the road wearing a lap's worth of rubber, and it is a separate stack of materials
    // built through `buildOpsDecals`: left at full it would be a glossier, bluer racing line drawn
    // down the middle of the surface it belongs to.
    let inkTriangles = 0
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.renderOrder === 0 || o.renderOrder >= 1000) return
      const g = o.geometry as THREE.BufferGeometry
      inkTriangles += (g.index ? g.index.count : g.attributes.position.count) / 3
      expect((o.material as THREE.MeshPhysicalMaterial).specularIntensity).toBe(0.25)
    })
    // Counted in TRIANGLES rather than in meshes: the ink is hundreds of ops merged down to a draw
    // per alpha, so a mesh count now says how well it batched and nothing about whether it is there.
    expect(inkTriangles).toBeGreaterThan(1000)
  })

  it('lays the driven-in ink as ordered decals that never write depth', () => {
    let decals = 0
    let maxOrder = 0
    let triangles = 0
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.renderOrder === 0 || o.renderOrder >= 1000) return
      decals++
      maxOrder = Math.max(maxOrder, o.renderOrder)
      const g = o.geometry as THREE.BufferGeometry
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
      const mat = o.material as THREE.MeshLambertMaterial
      expect(mat.transparent).toBe(true)
      expect(mat.depthWrite).toBe(false)
    })
    // The surface story is hundreds of ops and a continuum of shades, landing as a draw per alpha
    // with the paint on the vertices. What has to survive is the INK, not the mesh count.
    expect(triangles).toBeGreaterThan(1000)
    expect(decals).toBeGreaterThan(0)
    expect(maxOrder).toBe(decals)
    // The pit box pad and markings paint at 900, over the whole ink range: an ink stack that grew
    // past it would silently paint the grime over the pad again. The regression that hid them.
    expect(maxOrder).toBeLessThan(900)
  })
})
