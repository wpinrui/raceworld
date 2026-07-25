// #sim-2d — the drawing description. These pin the contract the SVG layer and the canvas both rely
// on, so a change that would make the two renderers disagree fails here rather than on screen.

import { describe, it, expect } from 'vitest'
import { MOODS } from './lighting'
import {
  REF, buildingRoofGroups, buildingWallGroups, depthSorted, partsOf, refName, standGroups, toLocal,
  treeShadowOp, treeShadowRatio, treeSolidOps,
} from './scenery-draw'
import type { SceneryRect } from './track-scenery'
import { partsPath } from './extrude'
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

describe('partsOf', () => {
  it('falls back to the single box a footprint width and height describe', () => {
    expect(partsOf({ w: 10, h: 6 })).toEqual([{ dx: 0, dy: 0, w: 10, h: 6 }])
  })

  it('prefers an articulated footprint when there is one', () => {
    const parts = [{ dx: 1, dy: 2, w: 3, h: 4 }]
    expect(partsOf({ w: 10, h: 6, parts })).toBe(parts)
  })
})

describe('toLocal', () => {
  it('is the inverse of the rotation a group applies', () => {
    for (const rot of [0, 0.7, -2.2, Math.PI]) {
      const v = toLocal(3, -5, rot)
      // Rotating back by the same angle has to land on the original vector.
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      expect(v.x * c - v.y * s).toBeCloseTo(3, 9)
      expect(v.x * s + v.y * c).toBeCloseTo(-5, 9)
    }
  })
})

describe('buildingWallGroups', () => {
  const solidOpts = { ...opts, storeyM: 4.6, bayM: 5.4 }
  const building = (over: Partial<SceneryRect> = {}): SceneryRect => ({
    x: 100, y: 60, w: 30, h: 20, rot: 0.4, fill: '#59616E', storeys: 2, ...over,
  } as SceneryRect)

  it('places each building by its group rather than baking the rotation into every path', () => {
    const [g] = buildingWallGroups([building()], solidOpts)
    expect(g.x).toBe(100)
    expect(g.y).toBe(60)
    expect(g.rot).toBe(0.4)
    // Geometry is built around the origin, so it must not carry the placement.
    const xs = g.ops[0].d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(60)
  })

  it('emits silhouette, side faces and glazing, in paint order', () => {
    const [g] = buildingWallGroups([building()], solidOpts)
    expect(g.ops).toHaveLength(3)
    expect(g.ops[0].fill).toBeTruthy()
    expect(g.ops[2].alpha).toBeCloseTo(0.42, 9)
  })

  it('leans a taller building further, since height is what the extrusion measures', () => {
    // Compared as path data rather than as a bounding box: `partsPath` emits relative h/v commands,
    // so pulling numbers out of the string gives widths, not coordinates.
    const low = buildingWallGroups([building({ storeys: 1 })], solidOpts)[0]
    const high = buildingWallGroups([building({ storeys: 5 })], solidOpts)[0]
    expect(high.ops[0].d).not.toBe(low.ops[0].d)
    // A taller solid shows more wall, so it needs more of it drawn.
    expect(high.ops[0].d.length).toBeGreaterThan(low.ops[0].d.length - 1)
    expect(high.ops[1].d).not.toBe(low.ops[1].d)
  })

  it('collapses to the flat footprint when nothing is extruded', () => {
    // The sweep IS the height: with none, the silhouette is the roof outline and there are no faces.
    const [g] = buildingWallGroups([building()], { ...solidOpts, extrude: 0 })
    expect(g.ops[1].d).toBe('')
    expect(g.ops[0].d).toBe(partsPath(partsOf(building())))
  })

  it('emits nothing for no buildings', () => {
    expect(buildingWallGroups([], solidOpts)).toEqual([])
  })
})

describe('standGroups', () => {
  const standOpts = { ...opts, frontM: 1, rearM: 5.5, roofFrac: 0.3 }
  const stand = (facing: boolean) => ({ x: 10, y: 20, w: 40, h: 16, rot: 0.2, fill: '#4A515C', facing })

  it('rakes AWAY from the circuit, so the two facings are mirror images', () => {
    const [a] = standGroups([stand(true)] as never, standOpts, true)
    const [b] = standGroups([stand(false)] as never, standOpts, true)
    expect(a.ops[0].d).not.toBe(b.ops[0].d)
    // The rake gradient flips with the facing; that is what makes which way it points legible.
    expect(refName(a.ops[3].fill!)).toBe('tm-rake')
    expect(refName(b.ops[3].fill!)).toBe('tm-rake-flip')
  })

  it('drops the crowd, rake and bevel at the cheap tier but keeps the structure', () => {
    const [full] = standGroups([stand(true)] as never, standOpts, true)
    const [low] = standGroups([stand(true)] as never, standOpts, false)
    expect(low.ops.length).toBeLessThan(full.ops.length)
    // Whatever comes off, the bank, its seating and its roof stay.
    expect(low.ops.map((op) => op.fill)).toContain(full.ops[0].fill)
    expect(low.ops.some((op) => refName(op.fill!) === 'tm-seats')).toBe(true)
    expect(low.ops.some((op) => op.fill === '#7B8494')).toBe(true)
  })
})

describe('buildingRoofGroups', () => {
  const b = { x: 5, y: 6, w: 20, h: 12, rot: 0.3, fill: '#59616E' } as SceneryRect

  it('paints the bevel over the WHOLE union, never per part', () => {
    // Per part, every sub-rect got its own light-to-dark ramp and seamed at each internal edge.
    const [g] = buildingRoofGroups([{ ...b, parts: [
      { dx: -4, dy: 0, w: 10, h: 12 }, { dx: 5, dy: 0, w: 8, h: 6 },
    ] } as SceneryRect], true)
    expect(g.ops).toHaveLength(3)
    expect(g.ops[0].d).toBe(g.ops[2].d)
    expect(refName(g.ops[2].fill!)).toBe('tm-bevel')
  })

  it('keeps only the flat roof at the cheap tier', () => {
    expect(buildingRoofGroups([b], false)[0].ops).toHaveLength(1)
  })
})
