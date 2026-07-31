import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildScenery } from '@/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '@/lib/ui/pit-zone'
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
const pitZone = buildPitZone(layout, buildPitSlots(layout, 10))
const world = buildWorld3D({ layout, scenery, pitZone })

describe('buildWorld3D', () => {
  it('builds the full increment-1 inventory: ground, two road layers, apron, kerbs, chequer', () => {
    // ground + 2x(circuit, lane) + apron (casing fill, edge ribbon, tarmac fill) + chequer = 9,
    // plus a white base and a red dash per kerb. A miscount here means a layer silently vanished.
    expect(world.stats.meshes).toBe(9 + 2 * scenery.kerbs.length)
    expect(world.stats.triangles).toBeGreaterThan(0)
    expect(scenery.kerbs.length).toBeGreaterThan(0)
  })

  it('keeps the painter order as lifts: ground, casing, tarmac, kerbs, marks', () => {
    const ys = new Map<string, number>()
    world.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const mat = o.material as THREE.MeshBasicMaterial
      const y = (o.geometry as THREE.BufferGeometry).attributes.position.getY(0)
      const seen = ys.get(mat.color.getHexString())
      ys.set(mat.color.getHexString(), Math.max(seen ?? -Infinity, y))
    })
    const ground = ys.get(new THREE.Color(scenery.base).getHexString())!
    const casing = ys.get('d8d8d2')!
    const tarmac = ys.get('33383e')!
    const marks = ys.get('f2f2f2')!
    expect(ground).toBeCloseTo(0, 10)
    expect(casing).toBeGreaterThan(ground)
    expect(tarmac).toBeGreaterThan(casing)
    expect(marks).toBeGreaterThan(tarmac)
  })

  it('renders every sheet double-sided, because a ribbon has no interior', () => {
    world.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        expect((o.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide)
      }
    })
  })
})
