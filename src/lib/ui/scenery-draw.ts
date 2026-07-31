// #sim-2d — what to draw, separated from what draws it.
//
// The picture is described ONCE, here, as plain data: a path string plus how to paint it. The canvas
// walks the list and paints it; nothing else knows the geometry. That separation is what makes the
// renderer replaceable — a WebGL backend consumes the same list.
//
// Everything in this file is pure, which is also what lets the geometry be tested without a DOM. It
// describes the world at FULL detail, always: there is no level-of-detail ladder, no culling and no
// caching here. An object is drawn the same way at every zoom, and the backend decides what that costs.

import {
  type Part, mapPathPoints, partsPath, posts, rakedStand, ribbon, sideFacesX, sweptHull,
  wallWindows,
} from './extrude'
import {
  type Lighting, dirAt, shadeFace, shadowFill, shadowOpacity, shadowReach, tintFace,
} from './lighting'
import type { Scenery, SceneryRect, SceneryTree } from './track-scenery'
import type { SceneryFence } from './scenery-props'
import type { Vec } from './geom'
import { SOFT_BAND_ALPHA } from './terrain-field'

/** One drawing instruction. `fill` and `stroke` are colours, or a `ref:NAME` naming a gradient or
 *  pattern the renderer supplies — the canvas resolves those to a CanvasGradient. Keeping them
 *  symbolic is what stops paint leaking into the geometry. */
export interface DrawOp {
  d: string
  fill?: string
  stroke?: string
  /** Stroke width in viewBox units. */
  width?: number
  alpha?: number
  cap?: 'round' | 'butt'
  /** Relief bands are drawn as nested rings, so their holes need the even-odd rule. */
  evenOdd?: boolean
  /** Dash length and gap, in viewBox units, with an offset for stacking bands out of phase. */
  dash?: { on: number; off: number; shift: number }
  /** Extent the paint resolves against, when the paint is a gradient.
   *
   *  A canvas needs this: `Path2D` cannot report a bounding box, so anything gradient-filled has to
   *  carry the one it was built from or the ramp lands somewhere else entirely. Only set where it is
   *  needed. */
  bbox?: { x: number; y: number; w: number; h: number }
}

/** True when a fill or stroke names a shared gradient or pattern rather than a plain colour. */
export const REF = 'ref:'
export const refName = (v: string): string | null => (v.startsWith(REF) ? v.slice(REF.length) : null)

/** How far a tree's shadow runs, as a multiple of its drawn height. Clamped: a low sun would
 *  otherwise throw a shadow several tree-lengths across the grass, which reads as a much bigger tree
 *  than the one drawn. Kept here rather than in a renderer because it is part of the picture. */
export function treeShadowRatio(reach: number): number {
  return Math.max(0.3, Math.min(0.8, reach))
}

/** Ops sharing one placement. A building is drawn in its OWN rotated frame, so its geometry is built
 *  once around the origin and placed by the group — the canvas as a save/translate/rotate/restore.
 *  Baking the rotation into every path instead would cost the same arithmetic per building and lose
 *  the shared frame the window grids are laid out in. */
export interface DrawGroup {
  x: number
  y: number
  /** Radians. */
  rot: number
  ops: DrawOp[]
}

export interface SolidDrawOpts extends TreeDrawOpts {
  /** Metres of apparent height per storey. */
  storeyM: number
  /** Width of one window-and-pier module, in metres. */
  bayM: number
}

export interface TreeDrawOpts {
  /** Metres to viewBox units. */
  u: (m: number) => number
  /** Foreshortening applied to every height on the map. */
  extrude: number
  lighting: Lighting
  /** Bearing the camera looks along; solids lean against it. */
  view: number
}

/** Trunk and canopy for a set of trees, already depth-sorted so a nearer tree covers a further one.
 *
 *  Each tree's trunk goes with its own canopy rather than into a shared layer underneath: drawn as one
 *  batch, a near trunk ends up buried by a far canopy. */
export function treeSolidOps(trees: SceneryTree[], o: TreeDrawOpts): DrawOp[] {
  const dir = dirAt(o.view)
  const out: DrawOp[] = []
  for (const t of depthSorted(trees, dir)) {
    const lift = o.u(t.h * o.extrude)
    out.push({
      d: `M ${t.x.toFixed(1)} ${t.y.toFixed(1)} L ${(t.x + dir.x * lift).toFixed(1)} ${(t.y + dir.y * lift).toFixed(1)}`,
      stroke: shadeFace('#6B5138', o.lighting),
      // Trunk width scales with the canopy it carries; a constant width made every tree a lollipop.
      width: Math.max(o.u(0.8), t.r * 0.34),
      cap: 'round',
    })
    out.push({
      d: t.d,
      fill: `${REF}tm-tree${t.variant}`,
      bbox: { x: t.x - t.r, y: t.y - t.r, w: t.r * 2, h: t.r * 2 },
    })
  }
  return out
}

/** Every tree's shadow as ONE op. They share a fill and never overlap meaningfully, so a single path
 *  of many subpaths is one shape rather than a thousand. */
export function treeShadowOp(trees: SceneryTree[], o: TreeDrawOpts): DrawOp | null {
  if (trees.length === 0) return null
  const dir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const reach = shadowReach(o.lighting)
  const d = trees.map((t) => {
    const lift = o.u(t.h * o.extrude)
    const len = lift * treeShadowRatio(reach)
    // Stretch the canopy about its own centre along the light, then plant it at the base of the
    // trunk. Baked into the path data rather than applied as a transform: as one path this is a
    // single shape for a whole circuit's trees rather than a matrix per tree per frame.
    const sx = (2 * t.r + len) / (2 * t.r)
    const cx = t.x + dir.x * lift + ldir.x * (len / 2)
    const cy = t.y + dir.y * lift + ldir.y * (len / 2)
    return mapPathPoints(t.d, (px, py) => {
      const vx = px - t.x
      const vy = py - t.y
      const ax = vx * ldir.x + vy * ldir.y
      const ay = -vx * ldir.y + vy * ldir.x
      const bx = ax * sx
      return { x: cx + bx * ldir.x - ay * ldir.y, y: cy + bx * ldir.y + ay * ldir.x }
    })
  }).join(' ')
  return { d, fill: shadowFill(o.lighting), alpha: shadowOpacity(o.lighting) * 0.55 }
}

/** Furthest first, so the painter's order comes out right.
 *
 *  Height draws LATER everywhere in this renderer — a roof is painted over its own walls — so a larger
 *  projection along the view bearing means NEARER, and nearer draws last. */
export function depthSorted<T extends { x: number; y: number }>(
  items: T[], dir: { x: number; y: number },
): T[] {
  return [...items].sort((a, b) => (a.x * dir.x + a.y * dir.y) - (b.x * dir.x + b.y * dir.y))
}

/** Walls, height faces and glazing for every building, each in its own frame.
 *
 *  The roof is painted over the near half of the hull afterwards, which is what leaves only the faces
 *  actually turned toward the camera visible. */
export function buildingWallGroups(buildings: SceneryRect[], o: SolidDrawOpts): DrawGroup[] {
  const dir = dirAt(o.view)
  return buildings.map((r) => {
    const storeys = r.storeys ?? 1
    const h = storeys * o.storeyM
    const t = o.u(h * o.extrude)
    const off = toLocal(dir.x * t, dir.y * t, r.rot)
    const parts = partsOf(r)
    return {
      x: r.x,
      y: r.y,
      rot: r.rot,
      ops: [
        // The whole solid's silhouette, in one piece.
        { d: sweptHull(parts, off.x, off.y), fill: shadeFace(r.fill, o.lighting) },
        // The left/right faces a shade apart, so the two visible planes of the box are distinct.
        { d: sideFacesX(parts, off.x, off.y), fill: tintFace(r.fill, o.lighting, -0.45) },
        {
          d: wallWindows(parts, off.x, off.y, o.u(o.bayM), Math.max(1, Math.round(h / o.storeyM))),
          fill: '#0E1319',
          alpha: 0.42,
        },
      ],
    }
  })
}

/** A footprint's rectangles, defaulting to the single box its width and height describe. */
export function partsOf(r: { w: number; h: number; parts?: Part[] }): Part[] {
  return r.parts ?? [{ dx: 0, dy: 0, w: r.w, h: r.h }]
}

/** Rotate a world-space vector into a footprint's local frame. */
export function toLocal(x: number, y: number, rot: number): { x: number; y: number } {
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return { x: x * c - y * s, y: x * s + y * c }
}

export interface StandDrawOpts extends TreeDrawOpts {
  /** Trackside and rear heights of a seating bank, in metres. */
  frontM: number
  rearM: number
  /** How much of the deck the rear canopy covers. */
  roofFrac: number
}

/** A grandstand: the bank below the deck, the raked seating on top, and the canopy over the rear.
 *
 *  Raked rather than extruded uniformly, because a bank of seats climbs AWAY from the circuit. Given
 *  one flat height they read as office blocks parked beside the track. */
export function standGroups(stands: Scenery['stands'], o: StandDrawOpts): DrawGroup[] {
  const dir = dirAt(o.view)
  const t = o.u(o.rearM * o.extrude)
  return stands.map((s) => {
    const off = toLocal(dir.x * t, dir.y * t, s.rot)
    const { hull, deck, roof } = rakedStand(s.w, s.h, s.facing, off, 1 - o.frontM / o.rearM, o.roofFrac)
    const box = { x: -s.w / 2, y: -s.h / 2, w: s.w, h: s.h }
    return {
      x: s.x,
      y: s.y,
      rot: s.rot,
      ops: [
        { d: hull, fill: shadeFace(s.fill, o.lighting) },
        { d: deck, fill: `${REF}tm-seats`, bbox: box },
        { d: deck, fill: `${REF}tm-crowd`, bbox: box },
        // Which way a stand faces has to be legible at a glance, so the rake darkens toward the front.
        { d: deck, fill: `${REF}${s.facing ? 'tm-rake' : 'tm-rake-flip'}`, bbox: box },
        { d: roof, fill: '#7B8494' },
        { d: deck, fill: `${REF}tm-bevel`, bbox: box },
      ],
    }
  })
}

/** Building roofs, painted over the near half of their own walls.
 *
 *  The bevel fills the union path directly rather than clipping a rect to it — an objectBoundingBox
 *  gradient already resolves against the path's own extent, and doing it per PART gave every sub-rect
 *  its own light-to-dark ramp, seaming at each internal edge. */
export function buildingRoofGroups(buildings: SceneryRect[]): DrawGroup[] {
  return buildings.map((b) => {
    const d = partsPath(partsOf(b))
    const box = { x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h }
    return {
      x: b.x,
      y: b.y,
      rot: b.rot,
      ops: [
        { d, fill: b.fill },
        { d, fill: `${REF}tm-roof`, bbox: box },
        { d, fill: `${REF}tm-bevel`, bbox: box },
      ],
    }
  })
}

export interface ShadowDrawOpts extends TreeDrawOpts {
  /** How tall a given solid casts from. A stand's rear is what casts, not its low trackside front. */
  heightM: (r: SceneryRect) => number
}

/** Cast shadows for the built structures.
 *
 *  Swept along the ground FROM THE BASE, so the near end tucks under the solid instead of leaving a
 *  gap that reads as the building levitating. That base is where the CAMERA put it, while the sweep
 *  runs along the SUN — the one place on the map that genuinely needs both bearings at once. */
export function structureShadowGroups(structures: SceneryRect[], o: ShadowDrawOpts): DrawGroup[] {
  const vdir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const reach = shadowReach(o.lighting)
  return structures.map((r) => {
    const h = o.heightM(r)
    const lift = o.u(h * o.extrude)
    const cast = o.u(h * reach)
    const off = toLocal(ldir.x * cast, ldir.y * cast, r.rot)
    return {
      x: r.x + vdir.x * lift,
      y: r.y + vdir.y * lift,
      rot: r.rot,
      // Painted HERE, not by the caller. A canvas has no inheriting group fill: an op with neither
      // fill nor stroke is silently drawn as nothing, which is exactly how every building and
      // grandstand once lost its shadow. Every shadow in this file carries its own ink.
      ops: [{
        d: sweptHull(partsOf(r), off.x, off.y),
        fill: shadowFill(o.lighting),
        alpha: shadowOpacity(o.lighting),
      }],
    }
  })
}

export interface FenceDrawOpts extends TreeDrawOpts {
  /** Height of the debris fencing, in metres. */
  fenceM: number
}

/** Debris fencing: a solid on a curve.
 *
 *  It needs the height face between its top line and its base, or it is a line plus a detached shadow
 *  and reads as floating. That face is a cage rather than a wall, so it is drawn see-through with its
 *  posts as verticals — one path for a whole circuit's worth. */
export function fenceOps(fences: SceneryFence[], o: FenceDrawOpts): DrawOp[][] {
  const dir = dirAt(o.view)
  const lift = o.u(o.fenceM * o.extrude)
  const ox = dir.x * lift
  const oy = dir.y * lift
  return fences.map((f) => [
    // You can see the circuit through debris fencing, so the face is barely there.
    { d: ribbon(f.pts, ox, oy), fill: '#AEB6C2', alpha: 0.13 },
    { d: posts(f.pts, ox, oy, 2), stroke: '#79808C', width: o.u(0.35), alpha: 0.5 },
    { d: f.d, stroke: '#79808C', width: o.u(0.4), alpha: 0.6 },
  ])
}

/** The shadow a run of fencing or tyre wall throws.
 *
 *  SWEPT from the object's base, never a displaced copy of it: a copy offset by the cast distance
 *  leaves a gap between the object and its own shadow, which reads as levitation and implies
 *  something taller than the thing drawn. */
export function runShadowOp(pts: readonly Vec[], heightM: number, o: TreeDrawOpts): DrawOp {
  const dir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const base = o.u(heightM * o.extrude)
  const cast = o.u(heightM * shadowReach(o.lighting))
  return {
    d: ribbon(
      pts.map((p) => ({ x: p.x + dir.x * base, y: p.y + dir.y * base })), ldir.x * cast, ldir.y * cast,
    ),
    fill: shadowFill(o.lighting),
    alpha: shadowOpacity(o.lighting),
  }
}

export interface MarshalDrawOpts extends TreeDrawOpts {
  /** Hut height in metres, and its footprint. */
  hutM: number
  hutW: number
  hutH: number
}

/** A rectangle with rounded corners as path data — what an SVG `<rect rx>` draws. */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  const f = (n: number) => n.toFixed(2)
  return `M ${f(x + rr)} ${f(y)} h ${f(w - 2 * rr)} a ${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(rr)} `
    + `v ${f(h - 2 * rr)} a ${f(rr)} ${f(rr)} 0 0 1 ${f(-rr)} ${f(rr)} h ${f(-(w - 2 * rr))} `
    + `a ${f(rr)} ${f(rr)} 0 0 1 ${f(-rr)} ${f(-rr)} v ${f(-(h - 2 * rr))} `
    + `a ${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(-rr)} Z`
}

/** A marshal post's shadow, walls, roof and orange panel, in its own frame.
 *
 *  A real height face rather than a displaced copy of itself — the same mistake the buildings started
 *  with. The shadow is a second sweep from the same footprint, anchored at the hut's drawn base (the
 *  camera's lift is baked into its geometry, so a renderer just paints it where the group sits). */
export function marshalGroups(
  marshals: Scenery['marshals'], o: MarshalDrawOpts,
): Array<DrawGroup & { shadow: DrawOp }> {
  const dir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const w = o.u(o.hutW)
  const h = o.u(o.hutH)
  const hut: Part[] = [{ dx: 0, dy: 0, w, h }]
  const lift = o.u(o.hutM * o.extrude)
  const cast = o.u(o.hutM * shadowReach(o.lighting))
  return marshals.map((m) => {
    const off = toLocal(dir.x * lift, dir.y * lift, m.rot)
    const sOff = toLocal(ldir.x * cast, ldir.y * cast, m.rot)
    const shadowHut: Part[] = [{ dx: off.x, dy: off.y, w, h }]
    return {
      x: m.x,
      y: m.y,
      rot: m.rot,
      shadow: {
        d: sweptHull(shadowHut, sOff.x, sOff.y),
        fill: shadowFill(o.lighting),
        alpha: shadowOpacity(o.lighting),
      },
      ops: [
        { d: sweptHull(hut, off.x, off.y), fill: shadeFace('#3A4049', o.lighting) },
        { d: roundedRectPath(-w / 2, -h / 2, w, h, o.u(0.3)), fill: '#3A4049' },
        { d: `M ${(-w / 2).toFixed(2)} ${(-h / 2).toFixed(2)} h ${w.toFixed(2)} v ${o.u(1.0).toFixed(2)} h ${(-w).toFixed(2)} Z`, fill: '#E8952B' },
      ],
    }
  })
}

/** Width of a hedgerow, in metres. */
const HEDGEROW_M = 2.2

/** The ground the circuit sits on: relief bands, the field quilt, terrain patches and run-off aprons.
 *
 *  Big paths and few of them. Ordered lowest first. */
export function groundOps(
  scenery: Pick<Scenery, 'bands' | 'fields' | 'terrain' | 'runoffs'>,
  u: (m: number) => number,
  { ground }: { ground: boolean },
): DrawOp[] {
  const ops: DrawOp[] = []
  if (ground) {
    for (const b of scenery.bands) {
      ops.push({ d: b.d, fill: b.fill, alpha: b.soft ? SOFT_BAND_ALPHA : 1, evenOdd: true })
    }
    for (const f of scenery.fields) {
      ops.push({ d: f.d, fill: f.fill, alpha: 0.75 })
      // Crop rows and hedgerows are per-field detail.
      if (f.crop) ops.push({ d: f.d, fill: `${REF}tm-crop` })
      // The hedgerow is a stroke, so its ink reaches half a pen outside the parcel it edges.
      ops.push({ d: f.d, stroke: '#1F3318', width: u(HEDGEROW_M), alpha: 0.35 })
    }
  }
  for (const b of scenery.terrain) {
    ops.push({ d: b.d, fill: b.fill })
    if (b.water) ops.push({ d: b.d, fill: `${REF}tm-water` })
  }
  for (const b of scenery.runoffs) ops.push({ d: b.d, fill: b.fill })
  return ops
}

/** Wall depth as a fraction of height — how much of the side face the oblique view reveals, and so
 *  how far from straight down the camera is pretending to be.
 *
 *  This is the whole of the map's perspective, in one number. At 0.62 the view sat well off vertical
 *  and every solid leaned a long way up the screen, which reads as a diorama shot from a corner of the
 *  room. Lower is closer to overhead: the same objects, less of their sides, less lean. Kept above zero
 *  because a true plan view has no depth cue at all and the map goes back to being a diagram. */
export const EXTRUDE = 0.4

/** Metres of apparent height per storey. Diorama scale: tall enough that height is unmistakable.
 *  Exported with the rest of the diorama heights below: the 3D world stands the same solids up for
 *  real, and both renderers must read one set of numbers (#3d-port). */
export const STOREY_M = 4.6
/** Structural bay: how wide one window-and-pier module is on a wall. */
export const WINDOW_BAY_M = 5.4
/** A grandstand's front (trackside) and rear heights in metres. Real seating banks rake up away from
 *  the circuit; extruding one uniformly made them read as tall slabs beside the track.
 *
 *  These stay LOW on purpose. A stand is only 12-17 m deep, so displacing its rear edge by the full
 *  height of a real grandstand shears the deck by nearly half its own depth and the bank reads as a
 *  ski jump. The rake wants to be a gentle ramp; the height is carried by the roof and the shadow. */
export const STAND_FRONT_M = 1.0
export const STAND_REAR_M = 5.5
/** How much of the deck the rear roof canopy covers. */
export const STAND_ROOF_FRAC = 0.3
/** Marshal hut height, and its footprint. */
export const MARSHAL_H_M = 2.8
export const MARSHAL_W_M = 4.4
export const MARSHAL_D_M = 3.2
/** Height of the debris fencing standing behind the barrier. */
export const FENCE_H_M = 4

/** A stand casts from its REAR, which is what stands up; a building from its roofline. */
const solidHeightM = (r: SceneryRect): number =>
  ('facing' in r ? STAND_REAR_M : (r.storeys ?? 1) * STOREY_M)

export interface SceneOpts {
  u: (m: number) => number
  lighting: Lighting
  view: number
  ground: boolean
  /** The ground plane under everything is NOT here. It was a world-sized rect at the bottom of the
   *  scene, and a scene that opens by covering the whole surface has just made the clear before it
   *  pointless. The renderer fills the canvas with the ground colour instead of clearing it. */
  /** The road itself, drawn between the ground and the shadows so scenery shadows fall ON tarmac.
   *  Built by the caller because it comes off the layout rather than off the scenery. */
  track?: DrawOp[]
  /** Kerbs, over the road and UNDER the scenery shadows — a tree's shade falls on a kerb. */
  kerbs?: DrawOp[]
  /** Garage floors, under the lane's paint so its white edge line runs unbroken. */
  pitUnder?: DrawOp[]
  /** The pit complex, after the road and before the kerbs and shadows, so scenery shadows and solids
   *  paint over it rather than under. */
  pitOver?: DrawOp[]
  /** Road paint that goes on LAST, over every solid and every shadow: the start/finish chequer and the
   *  grid boxes. */
  overlay?: DrawOp[]
}

/** One entry in the paint order: a flat op, or a placed group of them. A single sequence rather than
 *  separate op and group lists — the picture interleaves them (a stand paints after the tree shadows
 *  but before the kerbs), and two lists painted one after the other cannot say that. */
export type SceneItem = DrawOp | DrawGroup

/** True for a placed group; a flat op has no `ops` of its own. */
export const isGroup = (item: SceneItem): item is DrawGroup => 'ops' in item

/** The whole static world in paint order, as one description.
 *
 *  This is what makes the canvas a small component rather than a second renderer: it walks this
 *  list. The order is ground, floors, road, pit complex, kerbs, shadows, solids, trees, furniture,
 *  then the start's own paint. */
export function sceneryScene(scenery: Scenery, o: SceneOpts): SceneItem[] {
  const treeOpts = { u: o.u, extrude: EXTRUDE, lighting: o.lighting, view: o.view }
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]

  const items: SceneItem[] = []
  items.push(...groundOps(scenery, o.u, { ground: o.ground }))
  // Garage floors go under the lane's paint; the road then goes down before any shadow, which is the
  // whole reason shadows read as lying ON it. The pit complex and the kerbs are part of the ground
  // picture too: scenery shadows and solids paint over them.
  if (o.pitUnder) items.push(...o.pitUnder)
  if (o.track) items.push(...o.track)
  if (o.pitOver) items.push(...o.pitOver)
  if (o.kerbs) items.push(...o.kerbs)

  // Shadows before every solid, so nothing casts over the thing standing on it.
  items.push(...structureShadowGroups(structures, { ...treeOpts, heightM: solidHeightM }))
  const treeShade = treeShadowOp(scenery.trees, treeOpts)
  if (treeShade) items.push(treeShade)

  items.push(...buildingWallGroups(scenery.buildings, {
    ...treeOpts, storeyM: STOREY_M, bayM: WINDOW_BAY_M,
  }))
  items.push(...standGroups(scenery.stands, {
    ...treeOpts, frontM: STAND_FRONT_M, rearM: STAND_REAR_M, roofFrac: STAND_ROOF_FRAC,
  }))
  items.push(...buildingRoofGroups(scenery.buildings))

  // Trees and MARSHAL POSTS in one depth order. Posts stand out among the trees, so drawing every post
  // after every tree let a 2.8m hut paint over a 12m tree standing in front of it, which is the exact
  // thing depth sorting exists to prevent. Fences stay last and unsorted: they genuinely do line the
  // tarmac's edge, so a fence in front of a grove should read as a fence, not a hedge decoration.
  {
    const dir = dirAt(o.view)
    const depth = (p: { x: number; y: number }) => p.x * dir.x + p.y * dir.y
    const trees = depthSorted(scenery.trees, dir)
    const huts = marshalGroups(scenery.marshals, {
      ...treeOpts, hutM: MARSHAL_H_M, hutW: MARSHAL_W_M, hutH: MARSHAL_D_M,
    })
    // The hut with its own shadow as ONE group: the shadow op leads, painted with the shared shadow
    // ink, so it lands under the hut standing on it.
    const posts = depthSorted(huts, dir).map((g): DrawGroup =>
      ({ x: g.x, y: g.y, rot: g.rot, ops: [g.shadow, ...g.ops] }))
    let ti = 0
    for (const post of posts) {
      let j = ti
      while (j < trees.length && depth(trees[j]) <= depth(post)) j++
      if (j > ti) items.push(...treeSolidOps(trees.slice(ti, j), treeOpts))
      ti = j
      items.push(post)
    }
    if (ti < trees.length) items.push(...treeSolidOps(trees.slice(ti), treeOpts))
  }

  // The fence's own shadow goes with the fence, not with the scenery shadows.
  for (const f of scenery.fences) {
    items.push({ ...runShadowOp(f.pts, FENCE_H_M, treeOpts), alpha: 0.35 })
  }
  for (const ops of fenceOps(scenery.fences, { ...treeOpts, fenceM: FENCE_H_M })) items.push(...ops)

  // The start's own paint, over everything.
  if (o.overlay) items.push(...o.overlay)
  return items
}
