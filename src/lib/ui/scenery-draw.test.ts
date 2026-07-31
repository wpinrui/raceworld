// #sim-2d — the drawing description. These pin the contract the SVG layer and the canvas both rely
// on, so a change that would make the two renderers disagree fails here rather than on screen.

import { describe, it, expect } from 'vitest'
import { MOODS } from './lighting'
import {
  REF, buildingRoofGroups, buildingWallGroups, depthSorted, isGroup, partsOf, refName, standGroups,
  toLocal, fenceOps, groundOps, marshalGroups, runShadowOp, sceneryScene, structureShadowGroups,
  treeShadowOp, treeShadowRatio, treeSolidOps, type DrawOp,
} from './scenery-draw'
import type { SceneryRect } from './track-scenery'
import { mapPathPoints, partsPath } from './extrude'
import type { SceneryTree } from './track-scenery'
import type { Vec } from './geom'

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
  const first = (o: typeof opts & { pxPerM?: number }) => treeShadowOp([tree(0, 0)], o)!

  it('has nothing to draw when there is nothing to shade', () => {
    expect(treeShadowOp([], opts)).toBeNull()
  })

  it('runs the shadow along the SUN, not along the camera', () => {
    // The two bearings are independent; a shadow that followed the view would swing as the player
    // turned, which is the bug that split them apart in the first place.
    const east = first({ ...opts, lighting: { ...MOODS.afternoon, azimuth: 0 } })
    const south = first({ ...opts, lighting: { ...MOODS.afternoon, azimuth: Math.PI / 2 } })
    expect(east.d).not.toBe(south.d)
    const sameViewDifferentCamera = first({ ...opts, view: opts.view + 1 })
    // Changing the camera moves where the shadow STARTS (the trunk base) but not which way it runs.
    expect(sameViewDifferentCamera.d).not.toBe(first(opts).d)
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
    const [a] = standGroups([stand(true)] as never, standOpts)
    const [b] = standGroups([stand(false)] as never, standOpts)
    expect(a.ops[0].d).not.toBe(b.ops[0].d)
    // The rake gradient flips with the facing; that is what makes which way it points legible.
    expect(refName(a.ops[3].fill!)).toBe('tm-rake')
    expect(refName(b.ops[3].fill!)).toBe('tm-rake-flip')
  })

  it('drops the crowd, rake and bevel at the cheap tier but keeps the structure', () => {
    const [full] = standGroups([stand(true)] as never, standOpts)
    const [low] = standGroups([stand(true)] as never, { ...standOpts, pxPerM: 0.4 })
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
    ] } as SceneryRect], opts)
    expect(g.ops).toHaveLength(3)
    expect(g.ops[0].d).toBe(g.ops[2].d)
    expect(refName(g.ops[2].fill!)).toBe('tm-bevel')
  })

  it('keeps only the flat roof at the cheap tier', () => {
    expect(buildingRoofGroups([b], { ...opts, pxPerM: 0.5 })[0].ops).toHaveLength(1)
  })
})

describe('structureShadowGroups', () => {
  const shadowOpts = { ...opts, heightM: () => 9 }
  const rect = { x: 40, y: 30, w: 20, h: 14, rot: 0, fill: '#59616E' } as SceneryRect

  it('starts the shadow at the BASE the camera drew, not at the footprint', () => {
    // Anchored at the footprint instead, the shadow detaches and the solid reads as levitating.
    const [g] = structureShadowGroups([rect], shadowOpts)
    expect(Math.hypot(g.x - rect.x, g.y - rect.y)).toBeGreaterThan(0)
  })

  it('moves its origin with the CAMERA and its sweep with the SUN', () => {
    const base = structureShadowGroups([rect], shadowOpts)[0]
    const turned = structureShadowGroups([rect], { ...shadowOpts, view: opts.view + 1 })[0]
    const relit = structureShadowGroups([rect], {
      ...shadowOpts, lighting: { ...opts.lighting, azimuth: opts.lighting.azimuth + 1 },
    })[0]
    // Turning the camera slides where it starts but not the shape it sweeps.
    expect(turned.x).not.toBeCloseTo(base.x, 6)
    expect(turned.ops[0].d).toBe(base.ops[0].d)
    // Moving the sun does the opposite.
    expect(relit.x).toBeCloseTo(base.x, 9)
    expect(relit.ops[0].d).not.toBe(base.ops[0].d)
  })

  it('casts longer from a taller solid', () => {
    const short = structureShadowGroups([rect], { ...shadowOpts, heightM: () => 3 })[0]
    const tall = structureShadowGroups([rect], { ...shadowOpts, heightM: () => 30 })[0]
    expect(tall.ops[0].d.length).toBeGreaterThanOrEqual(short.ops[0].d.length)
    expect(tall.ops[0].d).not.toBe(short.ops[0].d)
  })

  /** Every point the group's hull draws, carried out through the group's own placement. */
  const placedPts = (g: { x: number; y: number; rot: number; ops: DrawOp[] }): Vec[] => {
    const cos = Math.cos(g.rot)
    const sin = Math.sin(g.rot)
    const out: Vec[] = []
    for (const op of g.ops) {
      mapPathPoints(op.d, (x, y) => {
        out.push({ x: g.x + x * cos - y * sin, y: g.y + x * sin + y * cos })
        return { x, y }
      })
    }
    return out
  }

  it('measures its disc off the hull it draws, not off the footprint', () => {
    const [g] = structureShadowGroups([rect], shadowOpts)
    // Conservative FIRST, because the failure the other way is invisible in a test and obvious on
    // screen: a disc that misses part of its own hull makes the canvas skip a shadow that has pixels.
    for (const p of placedPts(g)) {
      expect(Math.hypot(p.x - g.clip!.cx, p.y - g.clip!.cy)).toBeLessThanOrEqual(g.clip!.r + 1e-6)
    }
    // And tighter than the padded footprint disc it used to carry. That pad has to cover the lean and
    // the cast at every bearing and every sun, so it is as big as the worst of them wherever the
    // shadow actually landed: 80m of it, which is 480 screen pixels an edge at the close shot's scale.
    expect(g.clip!.r).toBeLessThan(Math.hypot(rect.w, rect.h) / 2 + opts.u(80))
  })

  it('follows the hull when the sun moves it, rather than staying on the solid', () => {
    // The whole reason a footprint disc is wrong here: a shadow's ink is thrown AWAY from its caster,
    // so the disc has to travel with the sun. One that did not would be padded to hold both ends.
    const a = structureShadowGroups([rect], shadowOpts)[0]
    const b = structureShadowGroups([rect], {
      ...shadowOpts, heightM: () => 40, lighting: { ...opts.lighting, azimuth: opts.lighting.azimuth + 2 },
    })[0]
    expect(Math.hypot(a.clip!.cx - b.clip!.cx, a.clip!.cy - b.clip!.cy)).toBeGreaterThan(0)
    for (const p of placedPts(b)) {
      expect(Math.hypot(p.x - b.clip!.cx, p.y - b.clip!.cy)).toBeLessThanOrEqual(b.clip!.r + 1e-6)
    }
  })

  it('still carries a disc once the ladder has retired it', () => {
    // Nothing is drawn, so there is no hull to measure: the footprint's own disc is what is left, and
    // a group with no disc at all would be submitted on every frame forever.
    const [g] = structureShadowGroups([rect], { ...shadowOpts, pxPerM: 0.001 })
    expect(g.ops).toHaveLength(0)
    expect(g.clip).toBeTruthy()
  })
})

describe('fenceOps', () => {
  const run = { d: 'M 0 0 L 10 0 L 20 5', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }] }

  it('draws a cage, not a wall: a face you can see through, plus its posts', () => {
    const [ops] = fenceOps([run], { ...opts, fenceM: 4 })
    expect(ops).toHaveLength(3)
    expect(ops[0].alpha!).toBeLessThan(0.2)
    expect(ops[1].stroke, 'posts are stroked verticals').toBeTruthy()
    expect(ops[2].d, 'top line is the run itself').toBe(run.d)
  })

  it('puts a whole circuit of posts in ONE path', () => {
    const [ops] = fenceOps([run], { ...opts, fenceM: 4 })
    expect((ops[1].d.match(/M /g) ?? []).length).toBeGreaterThan(1)
  })
})

describe('runShadowOp', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 4 }]

  it('sweeps from the base rather than offsetting a copy', () => {
    // An offset copy leaves a gap between the object and its shadow, which reads as levitation.
    const op = runShadowOp(pts, 4, opts)
    expect(op.d.startsWith('M ')).toBe(true)
    // A ribbon closes back on itself: twice the points of the run it was built from.
    expect((op.d.match(/L /g) ?? []).length).toBe(pts.length * 2 - 1)
  })

  it('lengthens with height', () => {
    expect(runShadowOp(pts, 12, opts).d).not.toBe(runShadowOp(pts, 2, opts).d)
  })
})

describe('marshalGroups', () => {
  const mOpts = { ...opts, hutM: 2.8, hutW: 4.4, hutH: 3.2 }
  const post = [{ x: 70, y: 15, rot: 0.9 }]

  it('gives the hut a real height face rather than a displaced copy of itself', () => {
    // A copy is the mistake the buildings started with: it reads as the same shape drawn twice.
    const [g] = marshalGroups(post as never, mOpts)
    expect(g.ops[0].d).not.toBe(g.shadow.d)
    expect(g.ops[0].fill).toBeTruthy()
  })

  it('anchors the shadow at the drawn base, and sweeps it along the sun', () => {
    const [g] = marshalGroups(post as never, mOpts)
    const relit = marshalGroups(post as never, {
      ...mOpts, lighting: { ...opts.lighting, azimuth: opts.lighting.azimuth + 1 },
    })[0]
    // Moving the sun changes the sweep but not where the hut stands.
    expect(relit.shadow.d).not.toBe(g.shadow.d)
    expect(relit.x).toBe(g.x)
    // Turning the camera moves the drawn base the shadow is anchored to.
    const turned = marshalGroups(post as never, { ...mOpts, view: opts.view + 1 })[0]
    expect(turned.shadow.d).not.toBe(g.shadow.d)
  })

  it('carries its roof and orange panel as shared ops, so both renderers draw the whole hut', () => {
    // They used to be markup in the SVG furniture layer, which is why canvas huts had no roofs.
    const [g] = marshalGroups(post as never, mOpts)
    expect(g.ops).toHaveLength(3)
    expect(g.ops[2].fill).toBe('#E8952B')
  })

  it('carries the post placement on the group, not baked into the hut', () => {
    const [g] = marshalGroups(post as never, mOpts)
    expect(g.x).toBe(70)
    expect(g.y).toBe(15)
    expect(g.rot).toBe(0.9)
  })
})

describe('groundOps', () => {
  const ground = {
    bands: [{ d: 'M 0 0 L 1 0 L 1 1 Z', fill: '#3F602C', soft: true }],
    fields: [{ d: 'M 2 2 L 3 2 L 3 3 Z', fill: '#4A6B31', crop: true }],
    terrain: [{ d: 'M 4 4 L 5 4 L 5 5 Z', fill: '#2E4A6B', water: true }],
    runoffs: [{ d: 'M 6 6 L 7 6 L 7 7 Z', fill: '#7A6A55' }],
  } as never as Parameters<typeof groundOps>[0]
  const u = (m: number) => m / 3

  it('draws relief with the even-odd rule, since bands are nested rings', () => {
    // Filled nonzero, a band's hole fills in and the terracing disappears.
    const [band] = groundOps(ground, u, { ground: true })
    expect(band.evenOdd).toBe(true)
    expect(band.alpha).toBeCloseTo(0.3, 9)
  })

  it('sheds per-field detail at the cheap tier but keeps the tint', () => {
    const full = groundOps(ground, u, { ground: true })
    const low = groundOps(ground, u, { ground: true, pxPerM: 1 })
    expect(low.length).toBeLessThan(full.length)
    expect(low.some((op) => op.fill === '#4A6B31')).toBe(true)
    expect(low.some((op) => refName(op.fill ?? '') === 'tm-crop')).toBe(false)
  })

  it('keeps terrain and run-off when the ground itself is switched off', () => {
    // Those are placed features, not the surround; hiding the surround must not take them with it.
    const ops = groundOps(ground, u, { ground: false })
    expect(ops.some((op) => op.fill === '#2E4A6B')).toBe(true)
    expect(ops.some((op) => op.fill === '#7A6A55')).toBe(true)
    expect(ops.some((op) => op.fill === '#3F602C')).toBe(false)
  })

  it('gives water its ripple over its own fill', () => {
    const ops = groundOps(ground, u, { ground: true })
    const i = ops.findIndex((op) => op.fill === '#2E4A6B')
    expect(refName(ops[i + 1].fill ?? '')).toBe('tm-water')
  })
})

describe('sceneryScene', () => {
  const scenery = {
    bands: [], fields: [], terrain: [], runoffs: [], kerbs: [], marshals: [],
    stands: [{ x: 0, y: 0, w: 30, h: 12, rot: 0, fill: '#4A515C', facing: true }],
    buildings: [{ x: 50, y: 50, w: 20, h: 14, rot: 0, fill: '#59616E', storeys: 2 }],
    fences: [{ d: 'M 0 0 L 9 0', pts: [{ x: 0, y: 0 }, { x: 9, y: 0 }] }],
  } as never as Parameters<typeof sceneryScene>[0]
  const sceneOpts = {
    u: (m: number) => m / 3, lighting: MOODS.afternoon, view: 0.4, ground: true,
    extrude: 0.62, storeyM: 4.6, bayM: 5.4, standFrontM: 1, standRearM: 5.5, standRoofFrac: 0.3,
    marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
    solidHeightM: () => 9, trees: [tree(5, 5)],
  }

  it('puts every shadow before the solids, so nothing casts over what stands on it', () => {
    const items = sceneryScene(scenery, sceneOpts)
    const groups = items.filter(isGroup)
    // Shadow groups carry no fill of their own; the layer supplies it. Solids always do.
    const firstSolid = groups.findIndex((g) => g.ops[0].fill)
    const lastShadow = groups.map((g) => !g.ops[0].fill).lastIndexOf(true)
    expect(lastShadow).toBeLessThan(firstSolid)
    expect(items.length).toBeGreaterThan(0)
  })

  it('keeps the SVG document order: kerbs under the shadows, trees over stands, furniture last', () => {
    // Ops and groups painted as two separate passes is the bug that put every stand on top of the
    // trees and kerbs in front of it — the order has to hold across the whole sequence, and it is
    // the SVG's: ground, road, kerbs, shadows, solids, trees, then the trackside furniture.
    const kerb: DrawOp = { d: 'M 0 0 L 1 0', stroke: '#C8352F' }
    const items = sceneryScene(scenery, { ...sceneOpts, kerbs: [kerb] })
    const kerbAt = items.indexOf(kerb)
    expect(kerbAt, 'kerbs paint before every shadow and solid').toBeLessThan(items.findIndex(isGroup))
    const lastGroup = items.map(isGroup).lastIndexOf(true)
    const canopy = items.findIndex(
      (i) => !isGroup(i) && (refName(i.fill ?? '') ?? '').startsWith('tm-tree'),
    )
    expect(canopy, 'a tree canopy paints after the last solid group').toBeGreaterThan(lastGroup)
    const fenceTop = items.findIndex((i) => !isGroup(i) && i.d === 'M 0 0 L 9 0')
    expect(fenceTop, 'fencing paints over the trees, as trackside furniture').toBeGreaterThan(canopy)
  })

  it('stamps solids, trees, furniture and the ground with clip discs; only the road stays unstamped', () => {
    // The clip disc is what lets the canvas skip off-screen items exactly — an item without one is
    // drawn every frame, which must remain true only for things that genuinely always show. The road is
    // the last of those: until the racing line is solved it is the layout's raw spline, whose extent
    // nothing here can measure.
    const track: DrawOp[] = [{ d: 'M 0 0 L 5 5', stroke: '#333333' }]
    const items = sceneryScene(scenery, { ...sceneOpts, track })
    expect(items.filter(isGroup).every((g) => g.clip), 'every group carries its disc').toBe(true)
    const canopy = items.find(
      (i) => !isGroup(i) && (refName(i.fill ?? '') ?? '').startsWith('tm-tree'),
    ) as DrawOp
    expect(canopy.clip, 'tree ops carry their disc').toBeTruthy()
    expect(track[0].clip, 'the road is never skipped').toBeUndefined()
    for (const op of groundOps(scenery, opts.u, { ground: true })) {
      expect(op.clip, 'every ground shape carries its disc').toBeTruthy()
    }
  })

  it('paints the overlay last, over every solid and every shadow', () => {
    // The start's chequer and the grid boxes. They live at the END of the scene because that is where
    // the SVG layer draws them — after its furniture — and the two renderers are not allowed to
    // disagree about whether a grandstand's shadow falls across the start line. Put in with the road
    // instead, they land under the kerbs and under everything the scenery casts.
    const overlay: DrawOp[] = [{ d: 'M 1 1 L 2 2', fill: '#F2F2F2' }]
    const items = sceneryScene(scenery, { ...sceneOpts, overlay })
    expect(items[items.length - 1]).toBe(overlay[0])
  })

  it('drops what the cull disc cannot see but keeps the ground and the road', () => {
    const track: DrawOp[] = [{ d: 'M 0 0 L 5 5', stroke: '#333333' }]
    const far = sceneryScene(scenery, { ...sceneOpts, track, cull: { cx: 4000, cy: 4000, r: 10 } })
    expect(far.some(isGroup), 'no solid survives a disc parked far away').toBe(false)
    expect(far, 'the road is not cullable').toContain(track[0])
    const near = sceneryScene(scenery, { ...sceneOpts, track, cull: { cx: 0, cy: 0, r: 200 } })
    expect(near.some(isGroup), 'a disc over the circuit keeps its solids').toBe(true)
  })

  it('drops the expensive half at the cheap tier but keeps the stands and roofs', () => {
    const full = sceneryScene(scenery, sceneOpts)
    const low = sceneryScene(scenery, { ...sceneOpts, pxPerM: 0.4 })
    expect(low.length).toBeLessThan(full.length)
    // And nothing has VANISHED, which is the whole difference from the boolean this replaced: below the
    // top rung a solid is batched into a shared draw, so it stops being a group without stopping being
    // drawn. Its own colour is still in the scene.
    const flatOps = low.flatMap((i) => (isGroup(i) ? i.ops : [i]))
    expect(flatOps.length).toBeGreaterThan(0)
    // Fewer ITEMS but the same number of sub-shapes: a batched draw carries them as subpaths.
    const subpaths = (xs: DrawOp[]) => xs.reduce((n, op) => n + (op.d.match(/M /g) ?? []).length, 0)
    const fullOps = full.flatMap((i) => (isGroup(i) ? i.ops : [i]))
    expect(subpaths(flatOps)).toBeGreaterThan(0)
    expect(subpaths(flatOps)).toBeLessThanOrEqual(subpaths(fullOps))
  })

  it('draws nothing at all for an empty world', () => {
    const empty = { ...scenery, stands: [], buildings: [], fences: [] } as never
    expect(sceneryScene(empty, { ...sceneOpts, trees: [] })).toEqual([])
  })

  it('reuses the static parts across calls, so a tree cull rebuilds only the trees', () => {
    // A cull commit changes nothing but the tree set; if the stands were rebuilt with it, every
    // zoom gesture would pay the whole circuit's string-building a dozen times over.
    const standOf = (items: ReturnType<typeof sceneryScene>) => items.filter(isGroup)
      .find((g) => g.ops.some((op) => refName(op.fill ?? '') === 'tm-seats'))
    const a = sceneryScene(scenery, sceneOpts)
    const b = sceneryScene(scenery, { ...sceneOpts, trees: [tree(9, 9)] })
    expect(standOf(b), 'identical inputs reuse the same groups').toBe(standOf(a))
    const turned = sceneryScene(scenery, { ...sceneOpts, view: sceneOpts.view + 0.5 })
    expect(standOf(turned), 'a new bearing rebuilds them').not.toBe(standOf(a))
  })
})

describe('treeSolidOps across the detail ladder', () => {
  // 12m canopies: near at racing zoom, flat when the whole pit building is in frame, gone at a
  // full-track fit. `opts` carries no pxPerM, which means full detail — the SVG layer's case.
  const grove = Array.from({ length: 40 }, (_, i) => tree((i % 8) * 40, Math.floor(i / 8) * 40))
  const at = (pxPerM: number) => treeSolidOps(grove, { ...opts, pxPerM })

  it('draws every tree individually while they are big on screen', () => {
    const ops = at(20)
    expect(ops).toHaveLength(grove.length * 2)
    expect(refName(ops[1].fill!)).toBe('tm-tree0')
  })

  it('keeps a small tree its own draw rather than concatenating the grove into one', () => {
    const ops = at(1.2)
    // Every tree is still THERE, and each op carries exactly one tree's path: the merge that made a
    // grove one screen-sized fill cost more in raster than it ever saved in draw calls.
    expect(ops).toHaveLength(grove.length * 2)
    for (const t of grove) expect(ops.some((o) => o.d === t.d)).toBe(true)
  })

  it('drops the gradient at the flat rungs, because that shading is smaller than the eye resolves', () => {
    for (const op of at(1.2)) {
      expect(op.bbox).toBeUndefined()
      expect(refName(op.fill ?? '')).toBeNull()
    }
  })

  it('sheds the trunks before the canopies, then the trees entirely', () => {
    const far = at(0.35)
    expect(far.every((o) => !o.stroke)).toBe(true)
    expect(far.length).toBeGreaterThan(0)
    expect(at(0.02)).toEqual([])
  })

  it('puts a trunk immediately under its own canopy, so no bark paints over leaves', () => {
    // Trunk width scales with canopy size, so a grove of mixed sizes makes several trunk paints. The
    // batcher grouped those by first appearance and landed half the bark on top of the leaves; the
    // workaround for that laid every trunk before every canopy, which let a far canopy bury a near
    // trunk. Pairing each tree's own two ops is what neither could do.
    const mixed = grove.map((t, i) => ({ ...t, r: t.r * (1 + (i % 4) * 0.4) }))
    // 0.55 keeps every one of them on a flat rung.
    const ops = treeSolidOps(mixed, { ...opts, pxPerM: 0.55 })
    expect(ops).toHaveLength(mixed.length * 2)
    for (let i = 0; i < ops.length; i += 2) {
      expect(ops[i].stroke, `op ${i} is a trunk`).toBeTruthy()
      expect(ops[i + 1].fill, `op ${i + 1} is a canopy`).toBeTruthy()
    }
  })

  it('gives every op a disc around its own tree, so the cull can drop one at a time', () => {
    const ops = at(1.2)
    const canopies = ops.filter((o) => o.fill)
    expect(canopies).toHaveLength(grove.length)
    for (const t of grove) {
      const own = canopies.find((o) => o.d === t.d)!
      // Tight to that tree: a merged disc spanned the whole 280-unit grove and could never be culled.
      expect(Math.hypot(t.x - own.clip!.cx, t.y - own.clip!.cy)).toBeLessThanOrEqual(own.clip!.r)
      expect(own.clip!.r).toBeLessThan(t.r * 4)
    }
  })

  it('keeps a detailed tree on its own gradient', () => {
    const ops = at(20)
    for (let i = 0; i < ops.length; i += 2) expect(ops[i + 1].bbox).toBeTruthy()
  })
})

describe('every op carries its own ink', () => {
  // The canvas has no equivalent of an SVG <g fill> handing paint down to the paths inside it, so an
  // op with neither fill nor stroke draws NOTHING there while looking correct in SVG. That is how
  // building and grandstand cast shadows went missing on the canvas: the producer left them unpainted
  // and only some consumers remembered to compensate. This walks a whole composed scene, so a new op
  // that forgets fails here rather than by quietly not existing on screen.
  const rect = (x: number, y: number): SceneryRect => (
    { x, y, w: 30, h: 14, rot: 0.3, fill: '#8A7F72', storeys: 2 }
  )
  const shadowOpts = {
    ...opts, heightM: () => 9.2, storeyM: 4.6, bayM: 5.4, hutM: 2.8, hutW: 4.4, hutH: 3.2, fenceM: 4,
  }

  it('paints every cast shadow, whoever produced it', () => {
    const painted = (op: DrawOp) => !!(op.fill || op.stroke)
    for (const g of structureShadowGroups([rect(0, 0), rect(90, 40)], shadowOpts)) {
      expect(g.ops.every(painted), 'structure cast shadow').toBe(true)
    }
    expect(painted(runShadowOp([{ x: 0, y: 0 }, { x: 50, y: 8 }], 4, opts)), 'fence run shadow').toBe(true)
    for (const g of marshalGroups([{ x: 0, y: 0, rot: 0 }], shadowOpts)) {
      expect(painted(g.shadow), 'marshal hut shadow').toBe(true)
    }
    expect(painted(treeShadowOp([tree(0, 0)], opts)!), 'tree shadow').toBe(true)
  })

  it('leaves nothing unpainted anywhere in a composed scene', () => {
    const scenery = {
      base: '#3E5A34', bands: [], fields: [], terrain: [], runoffs: [], kerbs: [],
      stands: [rect(60, 0)], buildings: [rect(0, 0)], trees: [tree(30, 30), tree(-40, 20)],
      fences: [{ pts: [{ x: 0, y: 60 }, { x: 80, y: 60 }] }], marshals: [{ x: 20, y: -30, rot: 0 }],
      tyreWalls: [],
    } as unknown as Parameters<typeof sceneryScene>[0]
    const items = sceneryScene(scenery, {
      u: opts.u, lighting: opts.lighting, view: opts.view, ground: true,
      extrude: opts.extrude, storeyM: 4.6, bayM: 5.4, standFrontM: 1, standRearM: 5.5,
      standRoofFrac: 0.3, marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: () => 9.2, trees: scenery.trees, cull: null,
    })
    expect(items.length).toBeGreaterThan(0)
    const flat = items.flatMap((i) => (isGroup(i) ? i.ops : [i]))
    const blind = flat.filter((op) => !op.fill && !op.stroke)
    expect(blind.map((op) => op.d.slice(0, 40))).toEqual([])
  })
})

describe('soft shadows', () => {
  const rect = (x: number, y: number): SceneryRect => (
    { x, y, w: 30, h: 14, rot: 0.3, fill: '#8A7F72', storeys: 2 }
  )
  const sOpts = { ...opts, heightM: () => 9.2 }
  const bandsAt = (pxPerM?: number) => structureShadowGroups([rect(0, 0)], { ...sOpts, pxPerM })[0].ops


  it('goes back to one flat op once it is small, where the softness cannot be seen', () => {
    // The whole reason this is affordable: zoomed out, every shadow on the circuit is in shot.
    // The rect is 30 UNITS wide against u = m/3, so it is a 90m building: 0.1px/m makes it 9px.
    expect(bandsAt(0.1)).toHaveLength(1)
  })

  it('composites to exactly the opacity the hard shadow had', () => {
    // Each band is a whole shape over the last, so the core sees the product of the transparencies.
    // Get this wrong and softening quietly darkens or lightens every shadow on the map.
    const soft = bandsAt(20)
    const hard = bandsAt(0.1)[0]
    const composite = 1 - soft.reduce((acc, op) => acc * (1 - (op.alpha ?? 1)), 1)
    expect(composite).toBeCloseTo(hard.alpha!, 6)
  })


  it('shades a whole grove for the price of one shadow', () => {
    // ONE op however many trees are in it: every canopy's shadow is a subpath of the same path, which
    // is what makes tree shade the cheapest thing on the map and why it survives to the bottom rung.
    const many = Array.from({ length: 60 }, (_, i) => tree((i % 10) * 30, Math.floor(i / 10) * 30))
    const op = treeShadowOp(many, { ...opts, pxPerM: 20 })!
    expect((op.d.match(/M /g) ?? []).length).toBe(many.length)
  })
})

describe('the geometry caches', () => {
  // Everything the producers build is a function of (the object, the bearing and light, the rung its
  // own size resolves to). These pin that: a key that forgets a field serves stale geometry, which is a
  // silently wrong picture rather than a crash, and nothing downstream can catch it.
  //
  // `opts.u` is metres/3, so a 40x18-unit footprint is 120m by 54m. Judged on its short side that is
  // 54m, which reaches 'near' at 34/54 = 0.63 px/m and drops to 'mid' below it.
  const rect = (x: number, y: number): SceneryRect =>
    ({ x, y, w: 40, h: 18, rot: 0.3, fill: '#59616E', storeys: 2 })
  const solid = { ...opts, storeyM: 4.6, bayM: 5.4 }

  it('hands back the SAME group for two camera scales that leave the rung alone', () => {
    const b = rect(0, 0)
    const at = (pxPerM: number) => buildingWallGroups([b], { ...solid, pxPerM })[0]
    // Different halves of the zoom range and different lodBuckets, but both comfortably 'near'.
    expect(at(4)).toBe(at(20))
  })

  it('rebuilds a solid when its rung moves, and drops its detail with it', () => {
    const b = rect(0, 0)
    const at = (pxPerM: number) => buildingWallGroups([b], { ...solid, pxPerM })[0]
    expect(at(1)).not.toBe(at(0.4))
    // near draws silhouette, side faces and the window grid; mid drops the grid.
    expect(at(1).ops.length).toBeGreaterThan(at(0.4).ops.length)
  })

  it('rebuilds a solid when the bearing or the light moves', () => {
    const b = rect(0, 0)
    const base = buildingWallGroups([b], { ...solid, pxPerM: 4 })[0]
    expect(buildingWallGroups([b], { ...solid, pxPerM: 4, view: opts.view + 1 })[0]).not.toBe(base)
    expect(buildingWallGroups([b], {
      ...solid, pxPerM: 4, lighting: { ...MOODS.afternoon, azimuth: 1.1 },
    })[0]).not.toBe(base)
  })

  it('rebuilds a roof when metres-per-unit changes, which is its whole key besides the rung', () => {
    // The thinnest key in the file: a roof reads nothing off the light or the bearing, so `u` and the
    // rung are all that stand between two circuits' worth of geometry.
    const b = rect(0, 0)
    const base = buildingRoofGroups([b], { u: opts.u, pxPerM: 4 })[0]
    expect(buildingRoofGroups([b], { u: opts.u, pxPerM: 4 })[0]).toBe(base)
    expect(buildingRoofGroups([b], { u: (m: number) => m / 9, pxPerM: 4 })[0]).not.toBe(base)
  })

  it('gives a shadow its own entry per height, since `heightM` cannot go in a key', () => {
    const r = rect(0, 0)
    const at = (h: number) => structureShadowGroups([r], { ...opts, pxPerM: 4, heightM: () => h })[0]
    expect(at(9)).toBe(at(9))
    expect(at(9)).not.toBe(at(30))
    expect(at(9).ops[0].d).not.toBe(at(30).ops[0].d)
  })

  it('reuses the whole assembled scene across zooms that move nobody rung', () => {
    // The point of keying the scene cache on the rungs rather than on the zoom: most notches move
    // nothing, and a key that travels with the camera scale could not say so.
    // The terrain patch is not decoration. `groundOps` is the only thing in `staticParts` that
    // allocates fresh objects on a miss, so with nothing in the ground a rebuilt assembly comes back
    // element-identical and the assertion below cannot tell a hit from a miss at all — it would pass
    // just as happily with the rung signature reverted to a raw zoom bucket.
    const scene = {
      base: '#3E5A34', bands: [], fields: [], runoffs: [], kerbs: [], marshals: [],
      terrain: [{ d: 'M 0 0 L 40 0 L 40 40 Z', fill: '#2F4A28' }],
      stands: [], trees: [], fences: [], buildings: [rect(0, 0)],
    } as unknown as Parameters<typeof sceneryScene>[0]
    const sceneAt = (pxPerM: number) => sceneryScene(scene, {
      u: opts.u, lighting: MOODS.afternoon, view: 0.4, ground: true, extrude: 0.62,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: () => 9, trees: [], pxPerM,
    })
    // A bucket apart (lodBucket 8 and 9) and every rung in the signature 'near' at both — including the
    // crop rows, the hedgerows, the fencing and the marshal huts, which are the small things that decide
    // the signature long before a building does. Every item comes back as the very same object.
    const a = sceneAt(16)
    const b = sceneAt(24)
    expect(b.length).toBe(a.length)
    expect(a.every((item, i) => item === b[i]), 'every item is the very same object').toBe(true)
    // Below 0.63 px/m the building's short side leaves 'near', and it has to be rebuilt.
    const far = sceneAt(0.4)
    expect(far.some((item, i) => item !== a[i]) || far.length !== a.length).toBe(true)
  })
})
