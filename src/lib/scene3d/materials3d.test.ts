import { describe, expect, it } from 'vitest'
import { DECAL_PULL, SceneMaterials } from './materials3d'

describe('SceneMaterials depth biases', () => {
  it('pulls every decal harder than the deepest opaque road layer, at any tilt', () => {
    const materials = new SceneMaterials()
    const decal = materials.get('#FFFFFF', 1, true)
    expect(decal.polygonOffset).toBe(true)
    // The opaque painter stack tops out at layer 13 (road marks); a decal that loses this race
    // vanishes from every camera angle but top-down, because the offset is slope-scaled.
    for (let layer = 1; layer <= 13; layer++) {
      const opaque = materials.get('#FFFFFF', 1, false, layer)
      expect(decal.polygonOffsetFactor).toBeLessThan(opaque.polygonOffsetFactor)
    }
    expect(decal.polygonOffsetFactor).toBe(-DECAL_PULL)
    expect(decal.depthWrite).toBe(false)
  })

  it('keeps the opaque layers graded and un-decaled paint untouched', () => {
    const materials = new SceneMaterials()
    expect(materials.get('#33383E', 1, false, 8).polygonOffsetFactor).toBe(-8)
    expect(materials.get('#33383E').polygonOffset).toBe(false)
  })
})
