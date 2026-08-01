import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DECAL_PULL, LACQUER, ROUGH, SceneMaterials, surface } from './materials3d'

describe('SceneMaterials depth biases', () => {
  it('grades a decal by its painter layer: over its own surface, under the paint above it', () => {
    const materials = new SceneMaterials()
    // Road ink lives at layer 9: it must beat the tarmac (8) it lies on at a tilted camera
    // without also beating the lane paint (10) and marks (12) painted over it.
    const ink = materials.get('#FFFFFF', { decal: true, layer: 9 })
    expect(ink.polygonOffset).toBe(true)
    expect(ink.polygonOffsetFactor).toBeLessThan(materials.get('#FFFFFF', { layer: 8 }).polygonOffsetFactor)
    expect(ink.polygonOffsetFactor).toBeGreaterThan(materials.get('#FFFFFF', { layer: 12 }).polygonOffsetFactor)
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

describe('the clear coat', () => {
  it('builds a physical material only where a second lobe was asked for', () => {
    // Every surface out here that is not car paint wants exactly one lobe, and the physical
    // material compiles a longer shader for the one it would not use.
    const plain = surface('#C81400', { roughness: ROUGH.paint })
    expect(plain).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(plain).not.toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(surface('#C81400', { roughness: ROUGH.paint, ...LACQUER }))
      .toBeInstanceOf(THREE.MeshPhysicalMaterial)
  })

  it('leaves the BASE roughness alone, so a livery still reads as its authored colour', () => {
    // The whole point of the second lobe: the sharp highlight comes from the lacquer, never from
    // dropping the colour coat toward a mirror.
    const paint = surface('#C81400', { roughness: ROUGH.paint, ...LACQUER }) as THREE.MeshPhysicalMaterial
    expect(paint.roughness).toBe(ROUGH.paint)
    expect(paint.clearcoat).toBe(1)
    expect(paint.clearcoatRoughness).toBeLessThan(ROUGH.gloss)
  })

  it('caches a lacquered surface apart from the bare one of the same colour', () => {
    // A shared key here hands the garage fascia the car's clear coat, or the reverse.
    const materials = new SceneMaterials()
    const bare = materials.get('#C81400', { roughness: ROUGH.paint })
    const coated = materials.get('#C81400', { roughness: ROUGH.paint, ...LACQUER })
    expect(coated).not.toBe(bare)
    expect(materials.get('#C81400', { roughness: ROUGH.paint, ...LACQUER })).toBe(coated)
  })
})
