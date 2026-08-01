import { describe, expect, it } from 'vitest'
import { DECAL_PULL, SceneMaterials } from './materials3d'

describe('SceneMaterials depth biases', () => {
  it('grades a decal by its painter layer: over its own surface, under the paint above it', () => {
    const materials = new SceneMaterials()
    // Road ink lives at layer 9: it must beat the tarmac (8) it lies on at a tilted camera
    // without also beating the kerbs (11, 12) and marks (13) painted over it.
    const ink = materials.get('#FFFFFF', { decal: true, layer: 9 })
    expect(ink.polygonOffset).toBe(true)
    expect(ink.polygonOffsetFactor).toBeLessThan(materials.get('#FFFFFF', { layer: 8 }).polygonOffsetFactor)
    expect(ink.polygonOffsetFactor).toBeGreaterThan(materials.get('#FFFFFF', { layer: 11 }).polygonOffsetFactor)
    expect(ink.depthWrite).toBe(false)
  })

  it('pulls top-of-stack paint past the deepest opaque layer', () => {
    const materials = new SceneMaterials()
    const top = materials.get('#FFFFFF', { decal: true, layer: DECAL_PULL })
    for (let layer = 1; layer <= 13; layer++) {
      expect(top.polygonOffsetFactor).toBeLessThan(materials.get('#FFFFFF', { layer: layer }).polygonOffsetFactor)
    }
  })

  it('keeps the opaque layers graded and un-layered paint untouched', () => {
    const materials = new SceneMaterials()
    expect(materials.get('#33383E', { layer: 8 }).polygonOffsetFactor).toBe(-8)
    expect(materials.get('#33383E').polygonOffset).toBe(false)
  })
})
