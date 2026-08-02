import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { conform } from './treepack3d'

/** A material as the broadleaf pack ships its bark: a dark tint multiplied over the map, and the
 *  half-metallic half-rough default both packs default to. */
function barkAsShipped(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.617, 0.604, 0.515, THREE.LinearSRGBColorSpace),
    metalness: 0.5,
    roughness: 0.5,
  })
}

describe('conform', () => {
  it('throws away the tint the pack multiplies over its bark map', () => {
    // The regression: the factor is a 0.60 darkening over a map already at the bottom of what bark
    // is, and it rendered the trunks at 28% of lit grass. `conform` overrode the pack's metalness
    // and roughness for the same reason and left this one in place.
    const m = barkAsShipped()
    conform(m, false)
    expect(m.color.r).toBe(1)
    expect(m.color.g).toBe(1)
    expect(m.color.b).toBe(1)
  })

  it('leaves a pack that authored its colour honestly exactly where it was', () => {
    // Every conifer material, and the broadleaf canopy, ship (1,1,1,1). The rule has to be a no-op
    // for them or it is not a correction, it is a second tint.
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 1 })
    conform(m, false)
    expect(m.color.getHex()).toBe(0xffffff)
  })

  it('takes vegetation off the packs half-metallic default', () => {
    const bark = barkAsShipped()
    const leaf = barkAsShipped()
    conform(bark, false)
    conform(leaf, true)
    expect(bark.metalness).toBe(0)
    expect(leaf.metalness).toBe(0)
  })

  it('puts foliage in the opaque pass as a cutout, lit and shadowed on both faces', () => {
    const m = barkAsShipped()
    m.transparent = true
    conform(m, true)
    expect(m.transparent).toBe(false)
    expect(m.alphaTest).toBeGreaterThan(0)
    expect(m.depthWrite).toBe(true)
    expect(m.side).toBe(THREE.DoubleSide)
    expect(m.shadowSide).toBe(THREE.DoubleSide)
    // The canopy carries its occlusion in the vertex colours (`shapeCanopy`).
    expect(m.vertexColors).toBe(true)
  })

  it('floors a canopys roughness without dulling one that is already matte', () => {
    // Half-rough foliage under a baked sky env carries a broad specular lobe: leaves catching the
    // sun blow toward white while the crown behind them stays near black.
    const shiny = barkAsShipped()
    conform(shiny, true)
    expect(shiny.roughness).toBeGreaterThanOrEqual(0.9)
    const matte = new THREE.MeshStandardMaterial({ roughness: 1 })
    conform(matte, true)
    expect(matte.roughness).toBe(1)
  })

  it('leaves bark opaque, untinted by the canopy bake and single-sided as it arrived', () => {
    const m = barkAsShipped()
    conform(m, false)
    expect(m.alphaTest).toBe(0)
    expect(m.vertexColors).toBe(false)
    expect(m.transparent).toBe(false)
  })
})
