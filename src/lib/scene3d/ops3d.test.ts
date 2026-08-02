import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { DrawOp } from '@/lib/ui/scenery-draw'
import { SceneMaterials } from './materials3d'
import { buildOpsDecals } from './ops3d'

const line = (colour: string, alpha?: number, extra: Partial<DrawOp> = {}): DrawOp => ({
  d: 'M 0 0 L 10 0', stroke: colour, width: 2, cap: 'butt', ...(alpha != null ? { alpha } : {}), ...extra,
})

const meshes = (g: THREE.Group) => g.children as THREE.Mesh[]

describe('buildOpsDecals', () => {
  const materials = new SceneMaterials()

  it('merges consecutive ops and breaks the run when the shade moves band', () => {
    const { group, nextOrder } = buildOpsDecals(
      [line('#111111'), line('#111111'), line('#DDDDDD')], { y: 0.1, order: 5, bias: 9 }, materials,
    )
    expect(meshes(group)).toHaveLength(2)
    expect(meshes(group).map((m) => m.renderOrder)).toEqual([5, 6])
    expect(nextOrder).toBe(7)
    // Two merged strokes carry twice one stroke's vertices.
    const [both, one] = meshes(group)
    expect(both.geometry.attributes.position.count).toBe(2 * one.geometry.attributes.position.count)
  })

  it('merges neighbouring shades, which is what the driven-in ink is made of', () => {
    // The rubber band and the marbles are a continuum: every arc of every layer is the tarmac blended
    // a little further toward its mark. Breaking the run on an exact colour was a run per op.
    const { group } = buildOpsDecals(
      [line('#303030'), line('#313131'), line('#2F2F2F')], { y: 0.1, order: 1, bias: 9 }, materials,
    )
    expect(meshes(group)).toHaveLength(1)
    const colour = meshes(group)[0].geometry.attributes.color
    const at = (i: number) => new THREE.Color().fromBufferAttribute(colour, i).getHexString()
    // Merged, and still three distinct shades: the band decides batching, never the pixel.
    expect(at(0)).toBe('303030')
    expect(at(colour.count / 3)).toBe('313131')
    expect(at((2 * colour.count) / 3)).toBe('2f2f2f')
  })

  it('paints every run through one shared material, colour carried on the vertices', () => {
    const { group } = buildOpsDecals(
      [line('#111111'), line('#DDDDDD')], { y: 0.1, order: 5, bias: 9 }, materials,
    )
    const [first, second] = meshes(group)
    // ONE material for the whole road surface. The ink is a continuum of blended shades, and a
    // material per shade was eight hundred programs and uniform blocks for one surface.
    expect(first.material).toBe(second.material)
    expect((first.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ffffff')
    expect((first.material as THREE.MeshStandardMaterial).vertexColors).toBe(true)
    // Each op's own paint survives on its buffer, or one material would mean one colour.
    const at = (m: THREE.Mesh) => new THREE.Color()
      .fromBufferAttribute(m.geometry.attributes.color, 0).getHexString()
    expect(at(first)).toBe('111111')
    expect(at(second)).toBe('dddddd')
  })

  it('keeps alpha apart from opaque runs of the same colour, as decal materials', () => {
    const { group } = buildOpsDecals(
      [line('#333333'), line('#333333', 0.4)], { y: 0, order: 1, bias: 9 }, materials,
    )
    expect(meshes(group)).toHaveLength(2)
    const soft = meshes(group)[1].material as THREE.MeshLambertMaterial
    expect(soft.opacity).toBeCloseTo(0.4, 6)
    expect(soft.transparent).toBe(true)
    expect(soft.depthWrite).toBe(false)
  })

  it('lays every sheet at the one lift', () => {
    const { group } = buildOpsDecals(
      [line('#444444'), { d: 'M 0 0 L 4 0 L 4 4 Z', fill: '#444444' }], { y: 0.25, order: 1, bias: 9 }, materials,
    )
    for (const mesh of meshes(group)) {
      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(0.25, 5)
    }
  })

  it('honours a dash shift, the phase the stacked ink bands are laid out of', () => {
    const dash = { on: 1, off: 1 }
    // One op per call, because the two would now share a buffer: the subject here is the phase of
    // one dashed stroke, which is a property of its geometry and not of how it was batched.
    const laid = (shift: number) => {
      const { group } = buildOpsDecals(
        [line('#555555', undefined, { dash: { ...dash, shift } })], { y: 0, order: 1, bias: 9 },
        materials,
      )
      const pos = meshes(group)[0].geometry.attributes.position
      const out: number[] = []
      for (let i = 0; i < pos.count; i++) out.push(pos.getX(i))
      return out
    }
    // Phase 0 paints from the start; phase `on` starts one block in and runs to the end.
    expect(Math.min(...laid(0))).toBe(0)
    expect(Math.max(...laid(0))).toBe(9)
    expect(Math.min(...laid(1))).toBe(1)
    expect(Math.max(...laid(1))).toBe(10)
  })

  it('skips ref paints rather than guessing a colour for them', () => {
    const { group, nextOrder } = buildOpsDecals(
      [{ d: 'M 0 0 L 4 0 L 4 4 Z', fill: 'ref:tm-crowd' }], { y: 0, order: 3, bias: 9 }, materials,
    )
    expect(meshes(group)).toHaveLength(0)
    expect(nextOrder).toBe(3)
  })
})
