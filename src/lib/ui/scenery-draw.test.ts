// #sim-2d — the drawing description. These pin the contract the renderer relies on, so a change that
// would put the wrong picture on screen fails here rather than there.

import { describe, it, expect } from 'vitest'
import { MOODS } from './lighting'
import {
  REF, buildingRoofGroups, buildingWallGroups, depthSorted, isGroup, partsOf, refName, standGroups,
  toLocal, fenceOps, groundOps, marshalGroups, runShadowOp, sceneryScene,
  structureShadowGroups, treeShadowOp, treeShadowRatio, treeSolidOps, type DrawOp,
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
      expect(ops[i + 1].bbox, 'the gradient resolves against the canopy').toBeTruthy()
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
  const first = (o: typeof opts) => treeShadowOp([tree(0, 0)], o)!

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

  it('shades a whole grove with one shape', () => {
    // Every canopy's shadow is a subpath of the same path, so nothing composites twice where two
    // shadows overlap.
    const many = Array.from({ length: 60 }, (_, i) => tree((i % 10) * 30, Math.floor(i / 10) * 30))
    const op = treeShadowOp(many, opts)!
    expect((op.d.match(/M /g) ?? []).length).toBe(many.length)
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

  it('draws the bank, its seating, its crowd, its rake, its roof and its bevel', () => {
    const [g] = standGroups([stand(true)] as never, standOpts)
    expect(g.ops.map((op) => refName(op.fill!))).toEqual([
      null, 'tm-seats', 'tm-crowd', 'tm-rake', null, 'tm-bevel',
    ])
    expect(g.ops[4].fill, 'the canopy over the rear').toBe('#7B8494')
  })
})

describe('buildingRoofGroups', () => {
  const b = { x: 5, y: 6, w: 20, h: 12, rot: 0.3, fill: '#59616E' } as SceneryRect

  it('paints the bevel over the WHOLE union, never per part', () => {
    // Per part, every sub-rect got its own light-to-dark ramp and seamed at each internal edge.
    const [g] = buildingRoofGroups([{ ...b, parts: [
      { dx: -4, dy: 0, w: 10, h: 12 }, { dx: 5, dy: 0, w: 8, h: 6 },
    ] } as SceneryRect])
    expect(g.ops).toHaveLength(3)
    expect(g.ops[0].d).toBe(g.ops[2].d)
    expect(refName(g.ops[2].fill!)).toBe('tm-bevel')
  })

  it('carries the placement on the group', () => {
    const [g] = buildingRoofGroups([b])
    expect([g.x, g.y, g.rot]).toEqual([5, 6, 0.3])
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

  it('carries its roof and orange panel as ops, so the hut is drawn whole', () => {
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

  it('gives a cultivated parcel its crop rows and every parcel its hedgerow', () => {
    const ops = groundOps(ground, u, { ground: true })
    expect(ops.some((op) => refName(op.fill ?? '') === 'tm-crop')).toBe(true)
    expect(ops.some((op) => op.stroke === '#1F3318')).toBe(true)
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
    base: '#3E5A34', bands: [], fields: [], terrain: [], runoffs: [], kerbs: [], marshals: [],
    stands: [{ x: 0, y: 0, w: 30, h: 12, rot: 0, fill: '#4A515C', facing: true }],
    buildings: [{ x: 50, y: 50, w: 20, h: 14, rot: 0, fill: '#59616E', storeys: 2 }],
    trees: [tree(5, 5)],
    fences: [{ d: 'M 0 0 L 9 0', pts: [{ x: 0, y: 0 }, { x: 9, y: 0 }] }],
  } as never as Parameters<typeof sceneryScene>[0]
  const sceneOpts = {
    u: (m: number) => m / 3, lighting: MOODS.afternoon, view: 0.4, ground: true,
  }

  it('puts every shadow before the solids, so nothing casts over what stands on it', () => {
    const items = sceneryScene(scenery, sceneOpts)
    const groups = items.filter(isGroup)
    const shadowInk = groups[0].ops[0].fill
    const firstSolid = groups.findIndex((g) => g.ops[0].fill !== shadowInk)
    const lastShadow = groups.map((g) => g.ops[0].fill === shadowInk).lastIndexOf(true)
    expect(lastShadow).toBeLessThan(firstSolid)
    expect(items.length).toBeGreaterThan(0)
  })

  it('keeps the paint order: kerbs under the shadows, trees over stands, furniture last', () => {
    // Ops and groups painted as two separate passes is the bug that put every stand on top of the
    // trees and kerbs in front of it — the order has to hold across the whole sequence: ground, road,
    // kerbs, shadows, solids, trees, then the trackside furniture.
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

  it('paints the overlay last, over every solid and every shadow', () => {
    // The start's chequer and the grid boxes. A grandstand's cast shadow must not fall across the
    // start line; put in with the road instead, they land under the kerbs and under everything the
    // scenery casts.
    const overlay: DrawOp[] = [{ d: 'M 1 1 L 2 2', fill: '#F2F2F2' }]
    const items = sceneryScene(scenery, { ...sceneOpts, overlay })
    expect(items[items.length - 1]).toBe(overlay[0])
  })

  it('lays the road before any shadow, so shade reads as lying ON the tarmac', () => {
    const track: DrawOp[] = [{ d: 'M 0 0 L 5 5', stroke: '#333333' }]
    const items = sceneryScene(scenery, { ...sceneOpts, track })
    expect(items.indexOf(track[0])).toBeLessThan(items.findIndex(isGroup))
  })

  it('draws nothing at all for an empty world', () => {
    const empty = { ...scenery, stands: [], buildings: [], fences: [], trees: [] } as never
    expect(sceneryScene(empty, sceneOpts)).toEqual([])
  })
})

describe('every op carries its own ink', () => {
  // An op with neither fill nor stroke draws NOTHING on a canvas, and there is no equivalent of an
  // SVG <g fill> handing paint down to the shapes inside a group. That is how building and grandstand
  // cast shadows once went missing. This walks a whole composed scene, so a new op that forgets fails
  // here rather than by quietly not existing on screen.
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
      fences: [{ d: 'M 0 60 L 80 60', pts: [{ x: 0, y: 60 }, { x: 80, y: 60 }] }],
      marshals: [{ x: 20, y: -30, rot: 0 }],
    } as unknown as Parameters<typeof sceneryScene>[0]
    const items = sceneryScene(scenery, {
      u: opts.u, lighting: opts.lighting, view: opts.view, ground: true,
    })
    expect(items.length).toBeGreaterThan(0)
    const flat = items.flatMap((i) => (isGroup(i) ? i.ops : [i]))
    const blind = flat.filter((op) => !op.fill && !op.stroke)
    expect(blind.map((op) => op.d.slice(0, 40))).toEqual([])
  })
})
