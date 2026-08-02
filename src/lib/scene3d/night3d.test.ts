import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildNightLights3D } from './night3d'

describe('buildNightLights3D', () => {
  it('strides towers down the whole circuit, glowing heads on lit-from-within material', () => {
    const group = buildNightLights3D(TRACK_LAYOUTS.singapore, null)
    const meshes = group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
    // One merged mast mesh (shadow-casting) and one merged heads mesh (emissive, uncast).
    expect(meshes).toHaveLength(2)
    const masts = meshes.find((m) => m.castShadow)!
    const heads = meshes.find((m) => !m.castShadow)!
    expect(heads.material).toBeInstanceOf(THREE.MeshBasicMaterial)
    // A ~5km lap at 130m spacing is dozens of towers; each mast is two crossed quads.
    expect(masts.geometry.attributes.position.count).toBeGreaterThan(30 * 12)
  })

  it('pools light on the tarmac only when given the glow texture, as additive paint', () => {
    const bare = buildNightLights3D(TRACK_LAYOUTS.singapore, null)
    expect(bare.children).toHaveLength(2)
    const tex = new THREE.Texture()
    const lit = buildNightLights3D(TRACK_LAYOUTS.singapore, tex)
    const pools = lit.children.filter((o) =>
      o instanceof THREE.Mesh && (o.material as THREE.Material).blending === THREE.AdditiveBlending)
    expect(pools.length).toBeGreaterThan(25)
    expect(pools[0].renderOrder).toBe(950)
  })
})
