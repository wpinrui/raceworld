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

  it('merges consecutive same-paint ops and breaks the run when the paint changes', () => {
    const { group, nextOrder } = buildOpsDecals(
      [line('#111111'), line('#111111'), line('#222222')], { y: 0.1, order: 5, bias: 9 }, materials,
    )
    expect(meshes(group)).toHaveLength(2)
    expect(meshes(group).map((m) => m.renderOrder)).toEqual([5, 6])
    expect(nextOrder).toBe(7)
    // Two merged strokes carry twice one stroke's vertices.
    const [both, one] = meshes(group)
    expect(both.geometry.attributes.position.count).toBe(2 * one.geometry.attributes.position.count)
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
    const { group } = buildOpsDecals([
      line('#555555', undefined, { dash: { ...dash, shift: 0 } }),
      line('#666666', undefined, { dash: { ...dash, shift: 1 } }),
    ], { y: 0, order: 1, bias: 9 }, materials)
    const xs = (m: THREE.Mesh) => {
      const pos = m.geometry.attributes.position
      const out: number[] = []
      for (let i = 0; i < pos.count; i++) out.push(pos.getX(i))
      return out
    }
    // Phase 0 paints from the start; phase `on` starts one block in and runs to the end.
    expect(Math.min(...xs(meshes(group)[0]))).toBe(0)
    expect(Math.max(...xs(meshes(group)[0]))).toBe(9)
    expect(Math.min(...xs(meshes(group)[1]))).toBe(1)
    expect(Math.max(...xs(meshes(group)[1]))).toBe(10)
  })

  it('skips ref paints rather than guessing a colour for them', () => {
    const { group, nextOrder } = buildOpsDecals(
      [{ d: 'M 0 0 L 4 0 L 4 4 Z', fill: 'ref:tm-crowd' }], { y: 0, order: 3, bias: 9 }, materials,
    )
    expect(meshes(group)).toHaveLength(0)
    expect(nextOrder).toBe(3)
  })
})
