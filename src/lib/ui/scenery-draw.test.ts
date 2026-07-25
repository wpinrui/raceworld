// #sim-2d — the drawing description. These pin the contract the SVG layer and the canvas both rely
// on, so a change that would make the two renderers disagree fails here rather than on screen.

import { describe, it, expect } from 'vitest'
import { MOODS } from './lighting'
import { REF, depthSorted, refName, treeShadowOp, treeShadowRatio, treeSolidOps } from './scenery-draw'
import type { SceneryTree } from './track-scenery'

const tree = (x: number, y: number, r = 4): SceneryTree => ({
  d: `M ${x - r} ${y} L ${x + r} ${y} L ${x} ${y - r} Z`, variant: 0, h: 9, x, y, r,
})
const opts = { u: (m: number) => m / 3, extrude: 0.62, lighting: MOODS.afternoon, view: 0.4 }

describe('refName', () => {
  it('separates a shared gradient from a plain colour', () => {
    expect(refName(`${REF}tm-tree0`)).toBe('tm-tree0')
    expect(refName('#8FB35F')).toBeNull()
  })
})

describe('treeShadowRatio', () => {
  it('stays tied to the trunk however low the sun gets', () => {
    // Unclamped, a low sun throws a shadow several tree-lengths long and the tree reads as huge.
    expect(treeShadowRatio(0.01)).toBe(0.3)
    expect(treeShadowRatio(3)).toBe(0.8)
    expect(treeShadowRatio(0.55)).toBeCloseTo(0.55, 9)
  })
})

describe('treeSolidOps', () => {
  const trees = [tree(0, 0), tree(50, 50), tree(-30, 10)]

  it('emits a trunk and a canopy for each tree, in that order', () => {
    const ops = treeSolidOps(trees, opts)
    expect(ops).toHaveLength(trees.length * 2)
    for (let i = 0; i < ops.length; i += 2) {
      expect(ops[i].stroke, 'trunk is stroked').toBeTruthy()
      expect(ops[i].fill).toBeUndefined()
      expect(refName(ops[i + 1].fill!), 'canopy takes a shared gradient').toBe('tm-tree0')
    }
  })

  it('keeps each trunk with its OWN canopy, so a far canopy cannot bury a near trunk', () => {
    const ops = treeSolidOps(trees, opts)
    for (let i = 0; i < ops.length; i += 2) {
      // The trunk's start point must be the centre of the canopy drawn immediately after it.
      const [tx, ty] = ops[i].d.match(/-?\d+(\.\d+)?/g)!.slice(0, 2).map(Number)
      const src = trees.find((t) => Math.abs(t.x - tx) < 0.1 && Math.abs(t.y - ty) < 0.1)
      expect(src, 'trunk starts at a real tree').toBeTruthy()
      expect(ops[i + 1].d).toBe(src!.d)
    }
  })

  it('scales trunk width with the canopy, never a constant lollipop stick', () => {
    const [thin] = treeSolidOps([tree(0, 0, 2)], opts)
    const [thick] = treeSolidOps([tree(0, 0, 20)], opts)
    expect(thick.width!).toBeGreaterThan(thin.width!)
  })

  it('emits nothing for no trees', () => {
    expect(treeSolidOps([], opts)).toEqual([])
  })
})

describe('treeShadowOp', () => {
  it('collapses a whole grove into ONE op', () => {
    const op = treeShadowOp([tree(0, 0), tree(40, 20), tree(-10, 60)], opts)!
    expect(op).toBeTruthy()
    expect((op.d.match(/M /g) ?? []).length).toBe(3)
    expect(op.alpha!).toBeGreaterThan(0)
    expect(op.alpha!).toBeLessThan(1)
  })

  it('is null when there is nothing to shade', () => {
    expect(treeShadowOp([], opts)).toBeNull()
  })

  it('runs the shadow along the SUN, not along the camera', () => {
    // The two bearings are independent; a shadow that followed the view would swing as the player
    // turned, which is the bug that split them apart in the first place.
    const east = treeShadowOp([tree(0, 0)], { ...opts, lighting: { ...MOODS.afternoon, azimuth: 0 } })!
    const south = treeShadowOp([tree(0, 0)], { ...opts, lighting: { ...MOODS.afternoon, azimuth: Math.PI / 2 } })!
    expect(east.d).not.toBe(south.d)
    const sameViewDifferentCamera = treeShadowOp([tree(0, 0)], { ...opts, view: opts.view + 1 })!
    const base = treeShadowOp([tree(0, 0)], opts)!
    // Changing the camera moves where the shadow STARTS (the trunk base) but not which way it runs.
    expect(sameViewDifferentCamera.d).not.toBe(base.d)
  })
})

describe('depthSorted', () => {
  it('puts the furthest first, so nearer things paint last', () => {
    const dir = { x: 1, y: 0 }
    expect(depthSorted([{ x: 5, y: 0 }, { x: -3, y: 0 }, { x: 1, y: 0 }], dir).map((p) => p.x))
      .toEqual([-3, 1, 5])
  })

  it('does not mutate its input', () => {
    const src = [{ x: 5, y: 0 }, { x: -3, y: 0 }]
    depthSorted(src, { x: 1, y: 0 })
    expect(src[0].x).toBe(5)
  })
})
