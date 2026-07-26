// #sim-2d — what to draw, separated from what draws it.
//
// The map is moving to a canvas, because an SVG document cannot be both sharp and cheap here: racing
// zoom is 20x, so a pre-baked image would need ~350 megapixels to stay sharp over a circuit, while
// live SVG re-rasterises every path on every camera frame. A canvas redraws vectors at the exact
// current transform, so it is sharp at any zoom and skips DOM, style and layout entirely.
//
// The risk in that move is having two renderers with the drawing logic written out twice, which then
// drift. So the drawing is described ONCE, here, as plain data: a path string plus how to paint it.
// The SVG layer maps each op to a <path>; the canvas maps each to a cached Path2D. Neither knows
// anything the other does not.
//
// Everything in this file is pure, which is also what lets the geometry be tested without a DOM.

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
import { atLeast, lodBucket, mergeByPaint, rungFor } from './lod'
import { TREE_FLAT } from './scenery-paint'

/** One drawing instruction. `fill` and `stroke` are colours, or a `ref:NAME` naming a gradient or
 *  pattern the renderer supplies — the SVG layer resolves those to `url(#NAME)`, the canvas to a
 *  CanvasGradient. Keeping them symbolic is what stops paint leaking into the geometry. */
/** A bounding disc in world units, conservative: everything the item draws lies inside it. */
export interface Bounds { cx: number; cy: number; r: number }

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
   *  SVG resolves an objectBoundingBox gradient against the path's own extent and needs no help. A
   *  canvas does: `Path2D` cannot report a bounding box, so anything gradient-filled has to carry the
   *  one it was built from or the ramp lands somewhere else entirely. Only set where it is needed. */
  bbox?: { x: number; y: number; w: number; h: number }
  /** Where the op's ink actually lands, when its extent is knowable. The canvas skips ops whose
   *  disc misses the viewport — the cull disc is deliberately wider than the screen, so most frames
   *  most of the composed scene is pure rasteriser feed for pixels no one sees. Unset means "always
   *  draw" (the ground, the road). Skipping is EXACT, never a level of detail: an op is either
   *  entirely off screen or drawn whole. */
  clip?: Bounds
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
 *  once around the origin and placed by the group — the SVG layer as a `<g transform>`, the canvas as
 *  a save/translate/rotate/restore. Baking the rotation into every path instead would cost the same
 *  arithmetic per building and lose the shared frame the window grids are laid out in. */
export interface DrawGroup {
  x: number
  y: number
  /** Radians. */
  rot: number
  ops: DrawOp[]
  /** Same contract as an op's clip disc, covering the whole placed group. */
  clip?: Bounds
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
  /** Screen pixels per metre of world, which is what every detail rung is decided from.
   *
   *  Optional, and absent means INFINITELY near: every rung resolves to `near` and the picture is the
   *  fully detailed one. That is the right default because the ladder belongs to the canvas — the SVG
   *  layer draws the static map view and the fallback, neither of which is frame-rate bound — and
   *  because a caller that forgets it gets the correct picture rather than a silently degraded one. */
  pxPerM?: number
  /** Graphics quality, as a multiplier on the rung thresholds. See lib/ui/lod.ts. */
  quality?: number
}

/** Trunk and canopy for a set of trees, already depth-sorted so a nearer tree covers a further one.
 *
 *  Each tree's trunk goes with its own canopy rather than into a shared layer underneath: drawn as one
 *  batch, a near trunk ends up buried by a far canopy. That holds at the NEAR rung, which is the only
 *  one that draws a tree at a time.
 *
 *  Below it every tree of a variant shares one flat green, so the whole grove merges into a couple of
 *  draws (`mergeByPaint`). Trees keep their place, size and silhouette and lose the sphere shading —
 *  which is the trade that lets them exist at all out here. Before the ladder they were simply deleted
 *  at this zoom, because at one draw call each a simpler tree saved nothing.
 *
 *  A tree picks its own rung from its own canopy, so a sapling flattens while an oak beside it has not.
 *  Merging then reorders flat canopies of DIFFERENT variants against each other, which is a pixel or
 *  two of overlap on a shape this small; within a variant the paint is opaque and identical, so order
 *  cannot matter at all. */
export function treeSolidOps(trees: SceneryTree[], o: TreeDrawOpts): DrawOp[] {
  const dir = dirAt(o.view)
  // Split by rung, because only the flat ones may merge. Batching the NEAR rung would pool every
  // trunk into one draw and let a far canopy bury a near trunk, which is the very thing keeping each
  // trunk beside its own canopy exists to prevent.
  const near: DrawOp[] = []
  // Trunks and canopies are kept apart at the flat rungs, and it matters. A trunk's width scales with
  // the canopy it carries, so trunks of different sizes are different paints, and merging by paint
  // orders groups by first appearance: trunk-width-A, canopy, trunk-width-B, canopy... which paints
  // half the bark ON TOP of the leaves. Every trunk goes down before any canopy instead.
  const flatTrunks: DrawOp[] = []
  const flatCanopies: DrawOp[] = []
  // Canopy diameter in metres. Scene geometry is in viewBox units and `u` converts the other way.
  const metres = (units: number) => units / o.u(1)
  for (const t of depthSorted(trees, dir)) {
    const rung = rungFor(metres(2 * t.r), o.pxPerM ?? Infinity, o.quality)
    if (rung === 'gone') continue
    const lift = o.u(t.h * o.extrude)
    // Canopy at the tree's point, trunk running its lift toward the base: one disc holds both.
    const clip = { cx: t.x, cy: t.y, r: t.r + lift + o.u(1) }
    // The trunk is a stroke a third of the canopy wide. At the far rung that is well under a pixel and
    // it is only ever seen where it pokes out from under the canopy, so it goes.
    if (atLeast(rung, 'mid')) {
      (rung === 'near' ? near : flatTrunks).push({
        d: `M ${t.x.toFixed(1)} ${t.y.toFixed(1)} L ${(t.x + dir.x * lift).toFixed(1)} ${(t.y + dir.y * lift).toFixed(1)}`,
        stroke: shadeFace('#6B5138', o.lighting),
        // Trunk width scales with the canopy it carries; a constant width made every tree a lollipop.
        width: Math.max(o.u(0.8), t.r * 0.34),
        cap: 'round',
        clip,
      })
    }
    (rung === 'near' ? near : flatCanopies).push(rung === 'near'
      ? {
        d: t.d,
        fill: `${REF}tm-tree${t.variant}`,
        bbox: { x: t.x - t.r, y: t.y - t.r, w: t.r * 2, h: t.r * 2 },
        clip,
      }
      // No bbox: that is what tells mergeByPaint this one may batch.
      : { d: t.d, fill: TREE_FLAT[t.variant] ?? TREE_FLAT[0], clip })
  }
  // Flat first: a tree only lands on the near rung by being the bigger one, so the detailed trees
  // painting last is the depth order that survives the split more often than the other way round.
  return [...mergeByPaint(flatTrunks), ...mergeByPaint(flatCanopies), ...near]
}

/** Every tree's shadow as ONE op. They share a fill and never overlap meaningfully, so a single path
 *  of many subpaths costs one draw call instead of a thousand. */
export function treeShadowOp(trees: SceneryTree[], o: TreeDrawOpts): DrawOp | null {
  if (trees.length === 0) return null
  const dir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const reach = shadowReach(o.lighting)
  // The whole grove's disc, padded by the furthest any one shadow can stretch from its tree.
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  let pad = 0
  for (const t of trees) {
    if (t.x < x0) x0 = t.x
    if (t.y < y0) y0 = t.y
    if (t.x > x1) x1 = t.x
    if (t.y > y1) y1 = t.y
    pad = Math.max(pad, 2 * t.r + 2 * o.u(t.h * o.extrude))
  }
  const clip = {
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 + pad,
  }
  const d = trees.map((t) => {
    const lift = o.u(t.h * o.extrude)
    const len = lift * treeShadowRatio(reach)
    // Stretch the canopy about its own centre along the light, then plant it at the base of the
    // trunk. Baked into the path data rather than applied as a transform: as one path this is a
    // single element for a whole circuit's trees rather than a matrix per tree per frame.
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
  return { d, fill: shadowFill(o.lighting), alpha: shadowOpacity(o.lighting) * 0.55, clip }
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
export function buildingWallGroups(
  buildings: SceneryRect[], o: SolidDrawOpts,
): DrawGroup[] {
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
export function standGroups(
  stands: Scenery['stands'], o: StandDrawOpts, full: boolean,
): DrawGroup[] {
  const dir = dirAt(o.view)
  const t = o.u(o.rearM * o.extrude)
  return stands.map((s) => {
    const off = toLocal(dir.x * t, dir.y * t, s.rot)
    const { hull, deck, roof } = rakedStand(s.w, s.h, s.facing, off, 1 - o.frontM / o.rearM, o.roofFrac)
    const box = { x: -s.w / 2, y: -s.h / 2, w: s.w, h: s.h }
    const ops: DrawOp[] = [
      { d: hull, fill: shadeFace(s.fill, o.lighting) },
      { d: deck, fill: `${REF}tm-seats`, bbox: box },
    ]
    if (full) ops.push({ d: deck, fill: `${REF}tm-crowd`, bbox: box })
    // Which way a stand faces has to be legible at a glance, so the rake darkens toward the front.
    if (full) ops.push({ d: deck, fill: `${REF}${s.facing ? 'tm-rake' : 'tm-rake-flip'}`, bbox: box })
    ops.push({ d: roof, fill: '#7B8494' })
    if (full) ops.push({ d: deck, fill: `${REF}tm-bevel`, bbox: box })
    return { x: s.x, y: s.y, rot: s.rot, ops }
  })
}

/** Building roofs, painted over the near half of their own walls.
 *
 *  The bevel fills the union path directly rather than clipping a rect to it — an objectBoundingBox
 *  gradient already resolves against the path's own extent, and doing it per PART gave every sub-rect
 *  its own light-to-dark ramp, seaming at each internal edge. */
export function buildingRoofGroups(
  buildings: SceneryRect[], full: boolean,
): DrawGroup[] {
  return buildings.map((b) => {
    const d = partsPath(partsOf(b))
    const box = { x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h }
    const ops: DrawOp[] = [{ d, fill: b.fill }]
    if (full) ops.push({ d, fill: `${REF}tm-roof`, bbox: box }, { d, fill: `${REF}tm-bevel`, bbox: box })
    return { x: b.x, y: b.y, rot: b.rot, ops }
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
    const base = o.u(h * o.extrude)
    const cast = o.u(h * reach)
    const off = toLocal(ldir.x * cast, ldir.y * cast, r.rot)
    return {
      x: r.x + vdir.x * base,
      y: r.y + vdir.y * base,
      rot: r.rot,
      // Painted HERE, not by the caller. An SVG <g fill> passes its paint down to the paths inside it
      // and a canvas has no such thing: an op with neither fill nor stroke is silently drawn as
      // nothing, which is exactly how every building and grandstand lost its shadow on the canvas
      // while keeping it in SVG. Every shadow in this file now carries its own ink.
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
export function runShadowOp(
  pts: Vec[], heightM: number, o: TreeDrawOpts,
): DrawOp {
  const dir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const base = o.u(heightM * o.extrude)
  const cast = o.u(heightM * shadowReach(o.lighting))
  return {
    d: ribbon(pts.map((p) => ({ x: p.x + dir.x * base, y: p.y + dir.y * base })), ldir.x * cast, ldir.y * cast),
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
 *  camera's lift is baked into its geometry, so a renderer just paints it where the group sits). The
 *  roof and its trackside panel are ops here rather than markup in a layer, so BOTH renderers draw
 *  the whole hut — inlined in the SVG they simply did not exist on the canvas. */
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

/** The ground the circuit sits on: relief bands, the field quilt, terrain patches and run-off aprons.
 *
 *  Big paths and few of them, so they stay affordable at full zoom-out — which is exactly where a
 *  single flat green used to read as a runway extending forever. Ordered lowest first. */
export function groundOps(
  scenery: Pick<Scenery, 'bands' | 'fields' | 'terrain' | 'runoffs'>,
  u: (m: number) => number,
  { full, ground }: { full: boolean; ground: boolean },
): DrawOp[] {
  const ops: DrawOp[] = []
  if (ground) {
    for (const b of scenery.bands) ops.push({ d: b.d, fill: b.fill, alpha: b.soft ? 0.3 : 1, evenOdd: true })
    for (const f of scenery.fields) {
      ops.push({ d: f.d, fill: f.fill, alpha: 0.75 })
      // Crop rows and hedgerows are per-field detail: zoomed out only the tint is legible.
      if (full && f.crop) ops.push({ d: f.d, fill: `${REF}tm-crop` })
      if (full) ops.push({ d: f.d, stroke: '#1F3318', width: u(2.2), alpha: 0.35 })
    }
  }
  for (const b of scenery.terrain) {
    ops.push({ d: b.d, fill: b.fill })
    if (b.water) ops.push({ d: b.d, fill: `${REF}tm-water` })
  }
  for (const b of scenery.runoffs) ops.push({ d: b.d, fill: b.fill })
  return ops
}

export interface SceneOpts {
  u: (m: number) => number
  lighting: Lighting
  view: number
  full: boolean
  /** Screen pixels per metre of world. Feeds the per-object detail ladder in lib/ui/lod.ts; absent
   *  means full detail everywhere, which is what the SVG layer and the previews want. */
  pxPerM?: number
  /** Graphics quality, as a multiplier on the ladder's thresholds. */
  quality?: number
  ground: boolean
  extrude: number
  storeyM: number
  bayM: number
  standFrontM: number
  standRearM: number
  standRoofFrac: number
  marshalM: number
  marshalW: number
  marshalD: number
  fenceM: number
  /** A stand casts from its rear, a building from its roofline. */
  solidHeightM: (r: SceneryRect) => number
  trees: SceneryTree[]
  /** Drop everything outside this disc. The canvas walks every op every frame, so anything nowhere
   *  near the shot is pure path setup; the disc is the trees' — bigger than the viewport, moved with
   *  hysteresis — so nothing pops inside the frame. Each entry's own radius is respected, so a
   *  building straddling the edge stays. */
  cull?: { cx: number; cy: number; r: number } | null
  /** The ground plane under everything is NOT here. It was a world-sized rect at the bottom of the
   *  scene, and a scene that opens by covering the whole surface has just made the clear before it
   *  pointless — two full-surface writes a frame for one visible one. The renderer fills the canvas
   *  with the ground colour instead of clearing it; see `drawScene`. */
  /** The road itself, drawn between the ground and the shadows so scenery shadows fall ON tarmac.
   *  Built by the caller because it comes off the layout rather than off the scenery. */
  track?: DrawOp[]
  /** Kerbs, over the road and UNDER the scenery shadows — a tree's shade falls on a kerb. */
  kerbs?: DrawOp[]
  /** Garage floors, under the lane's paint so its white edge line runs unbroken. */
  pitUnder?: DrawOp[]
  /** The pit complex, after the road and before the kerbs and shadows, exactly where the SVG puts
   *  its PitBuilding — so scenery shadows and solids paint over it, not under. */
  pitOver?: DrawOp[]
}

/** One entry in the paint order: a flat op, or a placed group of them. A single sequence rather than
 *  separate op and group lists — the picture interleaves them (a stand paints after the tree shadows
 *  but before the kerbs), and two lists painted one after the other cannot say that. Splitting them
 *  is exactly the bug that had every solid drawn over the trees and kerbs in front of it. */
export type SceneItem = DrawOp | DrawGroup

/** True for a placed group; a flat op has no `ops` of its own. */
export const isGroup = (item: SceneItem): item is DrawGroup => 'ops' in item

/** The parts of a scene that do not depend on which trees or kerbs are in shot. Rebuilt only when
 *  the camera bearing, light or detail tier changes — a cull step only re-filters them. Every item
 *  carries its clip disc, which serves twice: composition drops what the CULL disc cannot hold,
 *  and the canvas skips what the VIEWPORT cannot see on each frame. */
interface StaticParts {
  key: string
  ground: DrawOp[]
  shadowGroups: DrawGroup[]
  wallGroups: DrawGroup[]
  standGs: DrawGroup[]
  roofGs: DrawGroup[]
  runShadows: DrawOp[]
  fenceRuns: DrawOp[]
  marshalGs: DrawGroup[]
}

const discOfRect = (r: { x: number; y: number; w: number; h: number }, pad: number): Bounds => ({
  cx: r.x, cy: r.y, r: Math.hypot(r.w, r.h) / 2 + pad,
})

const discOfPts = (pts: Vec[], pad: number): Bounds => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 + pad }
}

const stamp = <T extends { clip?: Bounds }>(item: T, clip: Bounds): T => {
  item.clip = clip
  return item
}

/** Everything here is heavy string-building (swept hulls, window grids) over the whole circuit, and
 *  none of it changes when the cull disc moves. Without this cache a cull commit during a zoom paid
 *  the full rebuild — tens of milliseconds, a dozen times per gesture.
 *
 *  Keyed on every scalar the geometry reads. `solidHeightM` is a function and stays out of the key:
 *  callers pass a fixed formula, and a caller that varied it per call would have to invalidate by
 *  passing a fresh `Scenery`. */
const staticCache = new WeakMap<Scenery, StaticParts>()

function staticParts(scenery: Scenery, o: SceneOpts): StaticParts {
  const key = JSON.stringify([
    o.view, o.full, o.ground, o.extrude, o.storeyM, o.bayM, o.standFrontM, o.standRearM,
    o.standRoofFrac, o.marshalM, o.marshalW, o.marshalD, o.fenceM, o.u(1), o.lighting,
    // Quantised, never raw: the rungs only change at discrete scales, and keying on a live
    // pixels-per-metre would rebuild a circuit's whole string geometry on every zoom notch.
    o.pxPerM == null ? null : lodBucket(o.pxPerM), o.quality,
  ])
  const hit = staticCache.get(scenery)
  if (hit && hit.key === key) return hit
  const treeOpts = {
    u: o.u, extrude: o.extrude, lighting: o.lighting, view: o.view, pxPerM: o.pxPerM, quality: o.quality,
  }
  // Padding covers what geometry adds beyond a footprint: the height lean and the cast shadow.
  // Generous on purpose — keeping a fraction more than the disc strictly needs is invisible, while
  // dropping a shadow whose caster is just off the disc's edge is not.
  const solidPad = o.u(80)
  const runPad = o.u(25)
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]
  const structDiscs = structures.map((r) => discOfRect(r, solidPad))
  const runShadows: DrawOp[] = []
  const fenceRuns: DrawOp[] = []
  if (o.full) {
    for (const f of scenery.fences) {
      runShadows.push(stamp({ ...runShadowOp(f.pts, o.fenceM, treeOpts), alpha: 0.35 }, discOfPts(f.pts, runPad)))
    }
    fenceOps(scenery.fences, { ...treeOpts, fenceM: o.fenceM }).forEach((ops2, i) => {
      const disc = discOfPts(scenery.fences[i].pts, runPad)
      for (const op of ops2) fenceRuns.push(stamp(op, disc))
    })
  }
  const parts: StaticParts = {
    key,
    ground: groundOps(scenery, o.u, { full: o.full, ground: o.ground }),
    shadowGroups: o.full
      ? structureShadowGroups(structures, { ...treeOpts, heightM: o.solidHeightM })
        .map((g, i) => stamp(g, structDiscs[i]))
      : [],
    wallGroups: o.full
      ? buildingWallGroups(scenery.buildings, { ...treeOpts, storeyM: o.storeyM, bayM: o.bayM })
        .map((g, i) => stamp(g, discOfRect(scenery.buildings[i], solidPad)))
      : [],
    standGs: standGroups(scenery.stands, {
      ...treeOpts, frontM: o.standFrontM, rearM: o.standRearM, roofFrac: o.standRoofFrac,
    }, o.full).map((g, i) => stamp(g, discOfRect(scenery.stands[i], solidPad))),
    roofGs: buildingRoofGroups(scenery.buildings, o.full)
      .map((g, i) => stamp(g, discOfRect(scenery.buildings[i], solidPad))),
    runShadows,
    fenceRuns,
    marshalGs: o.full
      ? marshalGroups(scenery.marshals, {
        ...treeOpts, hutM: o.marshalM, hutW: o.marshalW, hutH: o.marshalD,
      }).map((g) => stamp<DrawGroup>({
        // The hut with its shadow as ONE group: the shadow op leads, painted with the shared
        // shadow ink, so the canvas draws what the SVG layer draws.
        x: g.x,
        y: g.y,
        rot: g.rot,
        // The hut's shadow leads, carrying its own ink like every other shadow here.
        ops: [g.shadow, ...g.ops],
      }, { cx: g.x, cy: g.y, r: o.u(Math.hypot(o.marshalW, o.marshalD)) + o.u(30) }))
      : [],
  }
  staticCache.set(scenery, parts)
  return parts
}

/** A section boundary in a composed scene: everything from `at` until the next mark belongs to
 *  `name`. Used by the renderer's timing readout to attribute paint cost per section. */
export interface SceneMark { name: string; at: number }

/** The whole static world in paint order, as one description.
 *
 *  This is what makes the canvas a small component rather than a second renderer: it walks this
 *  list. The order is the SVG document's, layer for layer — ground, floors, road, pit complex,
 *  kerbs, shadows, solids, trees, then furniture — so the two renderers cannot drift apart. */
export function sceneryScene(scenery: Scenery, o: SceneOpts, marks?: SceneMark[]): SceneItem[] {
  const s = staticParts(scenery, o)
  const treeOpts = {
    u: o.u, extrude: o.extrude, lighting: o.lighting, view: o.view, pxPerM: o.pxPerM, quality: o.quality,
  }
  const cull = o.cull
  const keep = <T extends SceneItem>(xs: T[]): T[] => (cull
    ? xs.filter((i) => !i.clip || Math.hypot(i.clip.cx - cull.cx, i.clip.cy - cull.cy) <= cull.r + i.clip.r)
    : xs)

  const items: SceneItem[] = []
  const mark = (name: string) => { marks?.push({ name, at: items.length }) }
  mark('ground')
  items.push(...s.ground)
  // Garage floors go under the lane's paint; the road then goes down before any shadow, which is the
  // whole reason shadows read as lying ON it. The pit complex and the kerbs are part of the ground
  // picture too: scenery shadows and solids paint over them.
  mark('pit')
  if (o.pitUnder) items.push(...o.pitUnder)
  mark('road')
  if (o.track) items.push(...o.track)
  mark('pit')
  if (o.pitOver) items.push(...o.pitOver)
  mark('kerbs')
  if (o.kerbs) items.push(...o.kerbs)

  mark('shadows')
  if (o.full) {
    // Shadows before every solid, so nothing casts over the thing standing on it.
    items.push(...keep(s.shadowGroups))
    const trees = treeShadowOp(o.trees, treeOpts)
    if (trees) items.push(trees)
  }
  mark('solids')
  if (o.full) items.push(...keep(s.wallGroups))
  items.push(...keep(s.standGs))
  items.push(...keep(s.roofGs))
  // Trees and MARSHAL POSTS in one depth order. Posts stand out among the trees, so drawing every post
  // after every tree let a 2.8m hut paint over a 12m tree standing in front of it, which is the exact
  // thing depth sorting exists to prevent. Fences stay last and unsorted: they genuinely do line the
  // tarmac's edge, so a fence in front of a grove should read as a fence, not a hedge decoration.
  //
  // The posts land in the 'trees' benchmark category as a result, which is where their cost now is.
  mark('trees')
  // NOT gated on `full` any more. Trees carry their own rung now, per tree, from their own canopy —
  // which is the whole point: this block used to be all-or-nothing, so the only way it ever got
  // cheaper was for every tree on the circuit to vanish at once.
  {
    const dir = dirAt(o.view)
    const depth = (p: { x: number; y: number }) => p.x * dir.x + p.y * dir.y
    const trees = depthSorted(o.trees, dir)
    const posts = depthSorted(keep(s.marshalGs), dir)
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
  mark('furniture')
  if (o.full) items.push(...keep(s.runShadows))
  if (o.full) items.push(...keep(s.fenceRuns))
  return items
}
