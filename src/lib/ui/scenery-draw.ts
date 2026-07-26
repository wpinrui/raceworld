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
import { atLeast, mergeByPaint, rungFor, type Rung } from './lod'
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
   *  most of the composed scene is pure rasteriser feed for pixels no one sees. Skipping is EXACT,
   *  never a level of detail: an op is either entirely off screen or drawn whole.
   *
   *  Unset means "always draw". The ROAD is the last thing left that means it: it is stroked from the
   *  layout's own spline until the racing line has been solved, and a spline carries no extent anything
   *  here can read. The ground carried discs from the moment they could be measured off its paths
   *  (`discOfPath`), because a lake behind the paddock is off screen most of a lap. */
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
  /** Set once the object is below its top rung, meaning its placement may be BAKED into its paths so
   *  it can share a draw call with its neighbours. Only the producer knows this: a wall carries no
   *  gradient at any rung, so "has no gradient" is not the same question and batching on it would
   *  flatten fully-detailed buildings and reorder their faces against each other. */
  flat?: boolean
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

/** An object's size in METRES, from geometry that is in viewBox units. Every rung is decided from a
 *  real-world size, so the ladder means the same thing on a circuit drawn at any metres-per-unit. */
const metresIn = (o: { u: (m: number) => number }) => (units: number) => units / o.u(1)

/** The light, as a cache key. Four scalars is the whole of it. */
const lightKey = (l: Lighting) => `${l.azimuth},${l.elevation},${l.warmth},${l.ambient}`

/** How far past its own footprint a built solid's ink can reach, in metres: the height lean the camera
 *  gives it plus the shadow it throws. Generous on purpose — keeping a fraction more than the disc
 *  strictly needs is invisible, while dropping a shadow whose caster is just off the edge is not. */
const SOLID_PAD_M = 80

/** The disc a footprint occupies, padded for what its geometry adds beyond it.
 *
 *  Stamped by the PRODUCER, inside the memo, so what comes out is complete and nothing downstream ever
 *  writes to a cached object. It used to be stamped by `staticParts` afterwards, which was sound only
 *  because every caller happened to compute the identical disc — an invariant nothing stated and nothing
 *  checked, on objects two renderers share. */
const discOfFootprint = (
  r: { x: number; y: number; w: number; h: number }, u: (m: number) => number,
): Bounds => ({ cx: r.x, cy: r.y, r: Math.hypot(r.w, r.h) / 2 + u(SOLID_PAD_M) })

/** How many builds one object may hold. Four rungs times the handful of bearings a session visits;
 *  the cap only matters because a rotate gesture commits a new bearing each time it settles. */
const MEMO_PER_OBJECT = 16

/** A per-object geometry memo.
 *
 *  Everything the producers below build is heavy string work: swept hulls, window grids, raked decks,
 *  ribbons of posts. And every one of them is a function of exactly three things — the object, the
 *  bearing and light it is drawn under, and the RUNG its own size resolves to at the current camera
 *  scale. A rung has four values, so an object only ever has a handful of distinct builds however far
 *  the camera travels.
 *
 *  Cached PER OBJECT rather than per circuit, and that distinction is the whole point. A zoom notch
 *  moves the rung of a few objects and leaves hundreds untouched, but a whole-circuit cache key changes
 *  the moment any one of them moves, so every notch rebuilt the lot: measured at 8ms on a Grand Prix
 *  circuit and 28ms on Monaco, and a wheel crosses a rung boundary about every second notch. Per
 *  object, a notch costs the few objects that actually changed.
 *
 *  A WeakMap, so a circuit's scenery going out of scope takes its geometry with it. */
function objectMemo<T extends object, R>(): (item: T, key: string, build: () => R) => R {
  const cache = new WeakMap<T, Map<string, R>>()
  return (item, key, build) => {
    let by = cache.get(item)
    if (!by) {
      by = new Map()
      cache.set(item, by)
    }
    const hit = by.get(key)
    if (hit !== undefined) return hit
    const made = build()
    // Oldest out, never a wholesale clear: the entries in hand are the rungs either side of where the
    // camera is, and dropping those is exactly what a zoom gesture would then re-pay for.
    if (by.size >= MEMO_PER_OBJECT) by.delete(by.keys().next().value!)
    by.set(key, made)
    return made
  }
}

/** The size a built solid's DETAIL is judged by: its shorter footprint dimension.
 *
 *  Not its longest. A grandstand is 60m by 14m, and everything that makes it a grandstand rather than a
 *  slab — the seat rows, the crowd, the rake, the window bays — runs ACROSS the short way. Judged on the
 *  60m the textures would survive to a zoom where they are a few pixels wide and cost their patterns for
 *  nothing; judged on the 14m they retire when they stop being readable. */
const detailSizeM = (r: SceneryRect, m: (units: number) => number) => m(Math.min(r.w, r.h))

/** The size a solid's SHADOW is judged by: its longest footprint dimension, because a shadow stays
 *  legible as a shape for as long as the thing casting it does, however thin it is. */
const shadowSizeM = (r: SceneryRect, m: (units: number) => number) => m(Math.max(r.w, r.h))

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
const treeSolidMemo = objectMemo<SceneryTree, DrawOp[]>()

export function treeSolidOps(trees: SceneryTree[], o: TreeDrawOpts): DrawOp[] {
  const dir = dirAt(o.view)
  const base = `${o.view}|${o.extrude}|${o.u(1)}|${lightKey(o.lighting)}`
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
    // Trunk then canopy, built once per tree per rung. A cull step re-asks for every tree in the new
    // disc, and most of them were in the old one too.
    const ops = treeSolidMemo(t, `${base}|${rung}`, () => {
      const lift = o.u(t.h * o.extrude)
      // Canopy at the tree's point, trunk running its lift toward the base: one disc holds both.
      const clip = { cx: t.x, cy: t.y, r: t.r + lift + o.u(1) }
      const out: DrawOp[] = []
      // The trunk is a stroke a third of the canopy wide. At the far rung that is well under a pixel
      // and it is only ever seen where it pokes out from under the canopy, so it goes.
      if (atLeast(rung, 'mid')) {
        out.push({
          d: `M ${t.x.toFixed(1)} ${t.y.toFixed(1)} L ${(t.x + dir.x * lift).toFixed(1)} ${(t.y + dir.y * lift).toFixed(1)}`,
          stroke: shadeFace('#6B5138', o.lighting),
          // Trunk width scales with the canopy it carries; a constant width made every tree a lollipop.
          width: Math.max(o.u(0.8), t.r * 0.34),
          cap: 'round',
          clip,
        })
      }
      out.push(rung === 'near'
        ? {
          d: t.d,
          fill: `${REF}tm-tree${t.variant}`,
          bbox: { x: t.x - t.r, y: t.y - t.r, w: t.r * 2, h: t.r * 2 },
          clip,
        }
        // No bbox: that is what tells mergeByPaint this one may batch.
        : { d: t.d, fill: TREE_FLAT[t.variant] ?? TREE_FLAT[0], clip })
      return out
    })
    // The trunk (when there is one) leads; the canopy is always last.
    if (rung === 'near') near.push(...ops)
    else {
      if (ops.length > 1) flatTrunks.push(ops[0])
      flatCanopies.push(ops[ops.length - 1])
    }
  }
  // Flat first: a tree only lands on the near rung by being the bigger one, so the detailed trees
  // painting last is the depth order that survives the split more often than the other way round.
  return [...mergeByPaint(flatTrunks), ...mergeByPaint(flatCanopies), ...near]
}

/** Every tree's shadow as ONE op. They share a fill and never overlap meaningfully, so a single path
 *  of many subpaths costs one draw call instead of a thousand. */
const treeShadowMemo = objectMemo<SceneryTree, string>()

export function treeShadowOp(trees: SceneryTree[], o: TreeDrawOpts): DrawOp | null {
  if (trees.length === 0) return null
  const dir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const reach = shadowReach(o.lighting)
  const base = `${o.view}|${o.extrude}|${o.u(1)}|${lightKey(o.lighting)}`
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
  // Per-tree subpaths are memoised; only the join is per call. The grove's shadow is ONE op, so it is
  // rebuilt on every cull step whatever changed, and re-projecting a canopy the disc already held is
  // the bulk of that.
  const d = trees.map((t) => treeShadowMemo(t, base, () => {
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
  })).join(' ')
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
const wallMemo = objectMemo<SceneryRect, DrawGroup>()

export function buildingWallGroups(
  buildings: SceneryRect[], o: SolidDrawOpts,
): DrawGroup[] {
  const dir = dirAt(o.view)
  const m = metresIn(o)
  const base = `${o.view}|${o.extrude}|${o.storeyM}|${o.bayM}|${o.u(1)}|${lightKey(o.lighting)}`
  return buildings.map((r) => {
    const rung = rungFor(detailSizeM(r, m), o.pxPerM ?? Infinity, o.quality)
    return wallMemo(r, `${base}|${rung}`, () => {
      const storeys = r.storeys ?? 1
      const h = storeys * o.storeyM
      const t = o.u(h * o.extrude)
      const off = toLocal(dir.x * t, dir.y * t, r.rot)
      const parts = partsOf(r)
      // The silhouette is the building. The two visible planes and then the window grid are what tell
      // you it is a building rather than a block, and they go in that order as it shrinks: a bay is
      // 5.4m, so the grid is the first thing that stops being a grid and starts being noise.
      const ops = (at: Rung): DrawOp[] => {
        if (at === 'gone') return []
        const out: DrawOp[] = [
          // The whole solid's silhouette, in one piece.
          { d: sweptHull(parts, off.x, off.y), fill: shadeFace(r.fill, o.lighting) },
        ]
        if (!atLeast(at, 'mid')) return out
        // The left/right faces a shade apart, so the two visible planes of the box are distinct.
        out.push({ d: sideFacesX(parts, off.x, off.y), fill: tintFace(r.fill, o.lighting, -0.45) })
        if (at === 'near') {
          out.push({
            d: wallWindows(parts, off.x, off.y, o.u(o.bayM), Math.max(1, Math.round(h / o.storeyM))),
            fill: '#0E1319',
            alpha: 0.42,
          })
        }
        return out
      }
      return {
        x: r.x,
        y: r.y,
        rot: r.rot,
        ops: ops(rung),
        flat: rung !== 'near',
        clip: discOfFootprint(r, o.u),
      }
    })
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
const standMemo = objectMemo<Scenery['stands'][number], DrawGroup>()

export function standGroups(stands: Scenery['stands'], o: StandDrawOpts): DrawGroup[] {
  const dir = dirAt(o.view)
  const t = o.u(o.rearM * o.extrude)
  const m = metresIn(o)
  const base = `${o.view}|${o.extrude}|${o.frontM}|${o.rearM}|${o.roofFrac}|${o.u(1)}|${lightKey(o.lighting)}`
  return stands.map((s) => {
    const rung = rungFor(detailSizeM(s, m), o.pxPerM ?? Infinity, o.quality)
    return standMemo(s, `${base}|${rung}`, () => {
      const clip = discOfFootprint(s, o.u)
      if (rung === 'gone') return { x: s.x, y: s.y, rot: s.rot, ops: [], clip }
      const off = toLocal(dir.x * t, dir.y * t, s.rot)
      const { hull, deck, roof } = rakedStand(s.w, s.h, s.facing, off, 1 - o.frontM / o.rearM, o.roofFrac)
      const box = { x: -s.w / 2, y: -s.h / 2, w: s.w, h: s.h }
      // The bank and its canopy are the stand. Everything between them is texture on the deck, and the
      // deck is what shrinks: seat rows are 1.5m and crowd dots 3.2m, so all four of those patterns are
      // sub-pixel long before the stand itself stops being a recognisable shape.
      const ops: DrawOp[] = [{ d: hull, fill: shadeFace(s.fill, o.lighting) }]
      if (atLeast(rung, 'mid')) ops.push({ d: deck, fill: `${REF}tm-seats`, bbox: box })
      if (rung === 'near') {
        ops.push({ d: deck, fill: `${REF}tm-crowd`, bbox: box })
        // Which way a stand faces has to be legible at a glance, so the rake darkens toward the front.
        ops.push({ d: deck, fill: `${REF}${s.facing ? 'tm-rake' : 'tm-rake-flip'}`, bbox: box })
      }
      ops.push({ d: roof, fill: '#7B8494' })
      if (rung === 'near') ops.push({ d: deck, fill: `${REF}tm-bevel`, bbox: box })
      return { x: s.x, y: s.y, rot: s.rot, ops, flat: rung !== 'near', clip }
    })
  })
}

/** Building roofs, painted over the near half of their own walls.
 *
 *  The bevel fills the union path directly rather than clipping a rect to it — an objectBoundingBox
 *  gradient already resolves against the path's own extent, and doing it per PART gave every sub-rect
 *  its own light-to-dark ramp, seaming at each internal edge. */
const roofMemo = objectMemo<SceneryRect, DrawGroup>()

export function buildingRoofGroups(
  buildings: SceneryRect[], o: { u: (m: number) => number; pxPerM?: number; quality?: number },
): DrawGroup[] {
  const m = metresIn(o)
  const base = String(o.u(1))
  return buildings.map((b) => {
    const rung = rungFor(detailSizeM(b, m), o.pxPerM ?? Infinity, o.quality)
    return roofMemo(b, `${base}|${rung}`, () => {
      // The roof plate stays to the last rung above nothing: it is the building's top surface, and
      // without it the solid loses its own colour and reads as a shadow. The decking and the bevel
      // across it are detail ON that plate, and go first.
      const clip = discOfFootprint(b, o.u)
      if (rung === 'gone') return { x: b.x, y: b.y, rot: b.rot, ops: [], clip }
      const d = partsPath(partsOf(b))
      const box = { x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h }
      const ops: DrawOp[] = [{ d, fill: b.fill }]
      if (rung === 'near') {
        ops.push({ d, fill: `${REF}tm-roof`, bbox: box }, { d, fill: `${REF}tm-bevel`, bbox: box })
      }
      return { x: b.x, y: b.y, rot: b.rot, ops, flat: rung !== 'near', clip }
    })
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
const structShadowMemo = objectMemo<SceneryRect, DrawGroup>()

export function structureShadowGroups(structures: SceneryRect[], o: ShadowDrawOpts): DrawGroup[] {
  const vdir = dirAt(o.view)
  const ldir = dirAt(o.lighting.azimuth)
  const reach = shadowReach(o.lighting)
  const m = metresIn(o)
  const key = `${o.view}|${o.extrude}|${o.u(1)}|${lightKey(o.lighting)}`
  return structures.map((r) => {
    // A shadow is judged on the LONGEST footprint dimension, not the shortest: it stays a legible
    // shape for as long as its caster does, however thin. It is one draw call, so there is nothing to
    // simplify — it is either drawn or it is not. An empty group rather than a missing one, because a
    // `map` has to return something; it carries its disc like any other and the caller drops it.
    const rung = rungFor(shadowSizeM(r, m), o.pxPerM ?? Infinity, o.quality)
    const h = o.heightM(r)
    // `heightM` is a function and cannot go in a key, so what it RETURNS does. Cheap to call, and it
    // keeps two callers who disagree about how tall a thing is from sharing its shadow.
    return structShadowMemo(r, `${key}|${rung}|${h}`, () => {
      const clip = discOfFootprint(r, o.u)
      if (rung === 'gone') return { x: r.x, y: r.y, rot: r.rot, ops: [], clip }
      const lift = o.u(h * o.extrude)
      const cast = o.u(h * reach)
      const off = toLocal(ldir.x * cast, ldir.y * cast, r.rot)
      return {
        x: r.x + vdir.x * lift,
        y: r.y + vdir.y * lift,
        rot: r.rot,
        // Centred on the FOOTPRINT, not on the lifted base: the pad covers the lean either way, and a
        // disc that moved with the bearing would be a second thing to keep in step.
        clip,
        // Batchable once it is no longer the top rung, like every other solid: one draw for a whole
        // industrial estate's worth of shade instead of one each.
        flat: rung !== 'near',
        // Painted HERE, not by the caller. An SVG <g fill> passes its paint down to the paths inside
        // it and a canvas has no such thing: an op with neither fill nor stroke is silently drawn as
        // nothing, which is exactly how every building and grandstand lost its shadow on the canvas
        // while keeping it in SVG. Every shadow in this file now carries its own ink.
        ops: [{
          d: sweptHull(partsOf(r), off.x, off.y),
          fill: shadowFill(o.lighting),
          alpha: shadowOpacity(o.lighting),
        }],
      }
    })
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
const fenceMemo = objectMemo<SceneryFence, DrawOp[]>()

export function fenceOps(fences: SceneryFence[], o: FenceDrawOpts): DrawOp[][] {
  const dir = dirAt(o.view)
  const lift = o.u(o.fenceM * o.extrude)
  const ox = dir.x * lift
  const oy = dir.y * lift
  // No rung of its own: the fencing is gated wholesale by its height, so its geometry only ever
  // changes with the bearing. A run of posts round a whole circuit is not cheap to write out.
  const key = `${o.view}|${o.extrude}|${o.fenceM}|${o.u(1)}`
  return fences.map((f) => fenceMemo(f, key, () => [
    // You can see the circuit through debris fencing, so the face is barely there.
    { d: ribbon(f.pts, ox, oy), fill: '#AEB6C2', alpha: 0.13 },
    { d: posts(f.pts, ox, oy, 2), stroke: '#79808C', width: o.u(0.35), alpha: 0.5 },
    { d: f.d, stroke: '#79808C', width: o.u(0.4), alpha: 0.6 },
  ]))
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
const marshalMemo = objectMemo<Scenery['marshals'][number], DrawGroup & { shadow: DrawOp }>()

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
  // Like the fencing, gated wholesale rather than per rung, so the bearing and the light are the whole
  // of what its geometry depends on.
  const key = `${o.view}|${o.extrude}|${o.hutM}|${o.hutW}|${o.hutH}|${o.u(1)}|${lightKey(o.lighting)}`
  return marshals.map((m) => marshalMemo(m, key, () => {
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
  }))
}

/** The ground the circuit sits on: relief bands, the field quilt, terrain patches and run-off aprons.
 *
 *  Big paths and few of them, so they stay affordable at full zoom-out — which is exactly where a
 *  single flat green used to read as a runway extending forever. Ordered lowest first. */
/** Row spacing of the crop lattice and the width of a hedgerow, in metres: what those two ground
 *  textures are judged by, since a texture is only worth drawing while its own features are separable. */
const CROP_ROW_M = 3.4
const HEDGEROW_M = 2.2

/** A conservative disc round a path, measured from the path itself.
 *
 *  The ground was the last layer with no discs on it, and it is the only one whose ops the canvas could
 *  therefore never skip: a lake or a field parcel three hundred metres off the shot was submitted whole
 *  on every frame, at racing zoom, with all of it outside the canvas. Measured at 12-23% of all the path
 *  data in a racing shot. It is the same argument that cut the road into arcs; the ground under the road
 *  never got it, because unlike a building or a tree these shapes carry no centre and radius of their
 *  own — only a path string.
 *
 *  So it is read off the string, through the same walker that bakes groups, which is what makes it safe:
 *  it resolves relative commands rather than mistaking their operands for coordinates. Control points
 *  count toward the extent, which can only make the disc bigger than it needs to be. Cached on the shape
 *  object, since a shape's path is fixed for the life of the circuit. */
const pathDiscCache = new WeakMap<object, Bounds>()

function discOfPath(shape: { d: string }, pad: number): Bounds {
  const hit = pathDiscCache.get(shape)
  if (hit) return { ...hit, r: hit.r + pad }
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  try {
    mapPathPoints(shape.d, (x, y) => {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      return { x, y }
    })
  } catch {
    // The walker throws on a command it does not know. Every ground emitter writes M/L/Q/Z today, but a
    // future biome reaching for a cubic must not take the race view down from inside a compose: it falls
    // through to the disc that always passes, which costs a draw call and draws the right picture.
    x0 = Infinity
  }
  const disc: Bounds = Number.isFinite(x0)
    ? { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 }
    // A path with no coordinates in it draws nothing, but a disc of NaN would be skipped or kept at
    // random, so it gets one that always passes.
    : { cx: 0, cy: 0, r: Number.POSITIVE_INFINITY }
  pathDiscCache.set(shape, disc)
  return { ...disc, r: disc.r + pad }
}

export function groundOps(
  scenery: Pick<Scenery, 'bands' | 'fields' | 'terrain' | 'runoffs'>,
  u: (m: number) => number,
  { ground, pxPerM, quality }: { ground: boolean; pxPerM?: number; quality?: number },
): DrawOp[] {
  const px = pxPerM ?? Infinity
  const crop = atLeast(rungFor(CROP_ROW_M, px, quality), 'mid')
  const hedges = atLeast(rungFor(HEDGEROW_M, px, quality), 'mid')
  const ops: DrawOp[] = []
  if (ground) {
    for (const b of scenery.bands) {
      ops.push({ d: b.d, fill: b.fill, alpha: b.soft ? 0.3 : 1, evenOdd: true, clip: discOfPath(b, 0) })
    }
    for (const f of scenery.fields) {
      const clip = discOfPath(f, 0)
      ops.push({ d: f.d, fill: f.fill, alpha: 0.75, clip })
      // Crop rows and hedgerows are per-field detail: zoomed out only the tint is legible.
      if (crop && f.crop) ops.push({ d: f.d, fill: `${REF}tm-crop`, clip })
      // The hedgerow is a stroke, so its ink reaches half a pen outside the parcel it edges.
      if (hedges) {
        ops.push({
          d: f.d, stroke: '#1F3318', width: u(HEDGEROW_M), alpha: 0.35,
          clip: discOfPath(f, u(HEDGEROW_M) / 2),
        })
      }
    }
  }
  for (const b of scenery.terrain) {
    const clip = discOfPath(b, 0)
    ops.push({ d: b.d, fill: b.fill, clip })
    if (b.water) ops.push({ d: b.d, fill: `${REF}tm-water`, clip })
  }
  for (const b of scenery.runoffs) ops.push({ d: b.d, fill: b.fill, clip: discOfPath(b, 0) })
  return ops
}

export interface SceneOpts {
  u: (m: number) => number
  lighting: Lighting
  view: number
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
  /** Road paint that goes on LAST, over every solid and every shadow: the start/finish chequer and the
   *  grid boxes.
   *
   *  Last because that is where the SVG layer has always drawn them, after its furniture, and nothing
   *  about this change is meant to alter the picture. Putting them in with the road instead would let a
   *  grandstand's cast shadow fall across the start line on the canvas and not in SVG, which is the two
   *  renderers disagreeing — the one thing this whole file exists to prevent. */
  overlay?: DrawOp[]
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

/** Write a disc onto an item. Only ever given a FRESH object: a memoised group already carries its own,
 *  and writing to one would reach into geometry two renderers share. */
const stamp = <T extends { clip?: Bounds }>(item: T, clip: Bounds): T => {
  item.clip = clip
  return item
}

/** Everything here is heavy string-building (swept hulls, window grids) over the whole circuit, and
 *  none of it changes when the cull disc moves. Without this cache a cull commit during a zoom paid
 *  the full rebuild — tens of milliseconds, a dozen times per gesture.
 *
 *  Keyed on every scalar the geometry reads, with the detail ladder entering as `rungSignature` rather
 *  than as a zoom. `solidHeightM` is a function and cannot go in the key, but what it RETURNS is in the
 *  per-object key each shadow is built under, so a caller that varied it would not be served a stale
 *  shadow — only a stale assembly of the same ones. */
/** Drop the groups the ladder emptied. Every producer stamps its own disc, so unlike the version that
 *  stamped by index afterwards, this no longer has to run last to keep anything aligned. */
const keepDrawn = (gs: DrawGroup[]): DrawGroup[] => gs.filter((g) => g.ops.length > 0)

/** How many rung assignments to keep assembled per circuit.
 *
 *  One was not enough, and the reason is the shape of a zoom gesture rather than anything subtle. The
 *  camera crosses a rung boundary every couple of wheel notches, and a player zooms OUT to see where the
 *  field is and straight back IN to watch the car. With a single entry every one of those crossings is a
 *  rebuild in both directions; deep enough to hold the whole ladder, the way back is free. Measured over
 *  a full 20x -> 0.6x -> 20x -> 60x -> 20x sweep of Monza, this is the difference between 81ms and 60ms
 *  of blocking work (`npm run zoom:check`).
 *
 *  Affordable at this depth only because the geometry itself is memoised per object below: an entry here
 *  is arrays of references to groups the other caches own, not a circuit's worth of path strings. */
const STATIC_CACHE_N = 12

/** Every rung the static geometry is built from, as one short string.
 *
 *  This replaces the zoom bucket in the cache key, and it is a strictly better question to ask. The
 *  geometry does not depend on the camera scale — it depends on the RUNG each object's size resolves
 *  to at that scale, and a rung has four values. So most bucket crossings move nobody's rung at all,
 *  and the ones that move a shed's do not move a grandstand's. Keyed on the bucket, each of those was
 *  a rebuild of the whole circuit; keyed on this, they are cache hits. */
function rungSignature(scenery: Scenery, o: SceneOpts): string {
  const px = o.pxPerM ?? Infinity
  const m = metresIn(o)
  const c = (sizeM: number) => rungFor(sizeM, px, o.quality)[0]
  // The gates that are not per-object: the two ground textures, the fencing and the marshal huts.
  let sig = c(CROP_ROW_M) + c(HEDGEROW_M) + c(o.fenceM) + c(o.marshalW)
  // Per structure, both questions asked of it: what its own detail is judged by, and what its shadow
  // is. They differ (short side against long), so both belong in the key.
  for (const r of scenery.stands) sig += c(detailSizeM(r, m)) + c(shadowSizeM(r, m))
  for (const r of scenery.buildings) sig += c(detailSizeM(r, m)) + c(shadowSizeM(r, m))
  return sig
}

const fenceRunMemo = objectMemo<SceneryFence, { shadow: DrawOp; runs: DrawOp[] }>()

/** A hut and its own shadow folded into one group. Keyed on what `marshalGroups` handed back, which is
 *  already memoised, so the fold is done once rather than allocating a group per post per compose. */
const hutCache = new WeakMap<object, DrawGroup>()
const hutMemo = (from: object, build: () => DrawGroup): DrawGroup => {
  const hit = hutCache.get(from)
  if (hit) return hit
  const made = build()
  hutCache.set(from, made)
  return made
}

const staticCache = new WeakMap<Scenery, StaticParts[]>()

function staticParts(scenery: Scenery, o: SceneOpts): StaticParts {
  const key = JSON.stringify([
    o.view, o.ground, o.extrude, o.storeyM, o.bayM, o.standFrontM, o.standRearM,
    o.standRoofFrac, o.marshalM, o.marshalW, o.marshalD, o.fenceM, o.u(1), o.lighting,
    // The rungs themselves, never the scale they came from: see `rungSignature`.
    rungSignature(scenery, o),
  ])
  const held = staticCache.get(scenery) ?? []
  const at = held.findIndex((p) => p.key === key)
  if (at >= 0) {
    // Most-recent first, so the entry a jittering zoom keeps returning to is never the one evicted.
    const [hit] = held.splice(at, 1)
    held.unshift(hit)
    return hit
  }
  const treeOpts = {
    u: o.u, extrude: o.extrude, lighting: o.lighting, view: o.view, pxPerM: o.pxPerM, quality: o.quality,
  }
  const runPad = o.u(25)
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]
  const runShadows: DrawOp[] = []
  const fenceRuns: DrawOp[] = []
  // A fence is judged on its HEIGHT, not the length of its run: what makes it read as debris fencing
  // rather than a hedge is the mesh face standing up off the ground, and that is what shrinks.
  const px = o.pxPerM ?? Infinity
  const fenceRung = rungFor(o.fenceM, px, o.quality)
  if (atLeast(fenceRung, 'mid')) {
    // Stamped inside the memo, so what comes back out already carries its disc and nothing here has to
    // reach into a shared object and write to it.
    const key = `${o.view}|${o.extrude}|${o.fenceM}|${o.u(1)}|${lightKey(o.lighting)}|${runPad}`
    for (const f of scenery.fences) {
      const built = fenceRunMemo(f, key, () => {
        const disc = discOfPts(f.pts, runPad)
        return {
          shadow: stamp({ ...runShadowOp(f.pts, o.fenceM, treeOpts), alpha: 0.35 }, disc),
          runs: fenceOps([f], { ...treeOpts, fenceM: o.fenceM })[0].map((op) => stamp({ ...op }, disc)),
        }
      })
      runShadows.push(built.shadow)
      fenceRuns.push(...built.runs)
    }
  }
  const parts: StaticParts = {
    key,
    ground: groundOps(scenery, o.u, { ground: o.ground, pxPerM: o.pxPerM, quality: o.quality }),
    // Every one of these now asks the ladder per OBJECT rather than reading one global boolean, so a
    // shed retires while the grandstand beside it is still fully drawn, and each hands back a group that
    // already carries its own disc. A group whose rung came back 'gone' arrives here with no ops and is
    // dropped.
    shadowGroups: keepDrawn(
      structureShadowGroups(structures, { ...treeOpts, heightM: o.solidHeightM }),
    ),
    wallGroups: keepDrawn(
      buildingWallGroups(scenery.buildings, { ...treeOpts, storeyM: o.storeyM, bayM: o.bayM }),
    ),
    standGs: keepDrawn(standGroups(scenery.stands, {
      ...treeOpts, frontM: o.standFrontM, rearM: o.standRearM, roofFrac: o.standRoofFrac,
    })),
    roofGs: keepDrawn(
      buildingRoofGroups(scenery.buildings, { u: o.u, pxPerM: o.pxPerM, quality: o.quality }),
    ),
    runShadows,
    fenceRuns,
    // A 2.8m hut is the smallest built thing on the map, so it reaches the bottom of the ladder first.
    marshalGs: atLeast(rungFor(o.marshalW, px, o.quality), 'far')
      ? marshalGroups(scenery.marshals, {
        ...treeOpts, hutM: o.marshalM, hutW: o.marshalW, hutH: o.marshalD,
      }).map((g) => hutMemo(g, () => stamp<DrawGroup>({
        // The hut with its shadow as ONE group: the shadow op leads, painted with the shared
        // shadow ink, so the canvas draws what the SVG layer draws.
        x: g.x,
        y: g.y,
        rot: g.rot,
        // The hut's shadow leads, carrying its own ink like every other shadow here.
        ops: [g.shadow, ...g.ops],
      }, { cx: g.x, cy: g.y, r: o.u(Math.hypot(o.marshalW, o.marshalD)) + o.u(30) })))
      : [],
  }
  held.unshift(parts)
  held.length = Math.min(held.length, STATIC_CACHE_N)
  staticCache.set(scenery, held)
  return parts
}

/** A placed group's ops in WORLD space, its translate-and-rotate baked into every path.
 *
 *  A group exists so a building's geometry can be built once around its own origin and placed by a
 *  transform, which is right while it is drawn on its own. It is also what stops two buildings ever
 *  sharing a draw call: a canvas applies the placement with save/translate/rotate/restore, so each
 *  group is its own submission however little it paints. Baking costs one rotation per point, once per
 *  cull step, and buys the chance to merge. */
/** Keyed on the group ITSELF, which is exact only because of an invariant worth stating: a group is
 *  never written to after it is built. Its producer stamps its own disc inside the memo and hands back
 *  the same object for the same (solid, bearing, rung); nothing downstream touches it. `stamp` survives
 *  for the two places that still need it, and both give it a fresh copy rather than a cached group.
 *
 *  It matters because baking is a rotation per point over every flat solid in shot, and it runs on every
 *  compose — every cull step, several times a lap, as well as every zoom notch. */
const bakedMemo = new WeakMap<DrawGroup, DrawOp[]>()

function bakedOps(g: DrawGroup): DrawOp[] {
  const hit = bakedMemo.get(g)
  if (hit) return hit
  const cos = Math.cos(g.rot)
  const sin = Math.sin(g.rot)
  const out = g.ops.map((op) => ({
    ...op,
    d: mapPathPoints(op.d, (x, y) => ({ x: g.x + x * cos - y * sin, y: g.y + x * sin + y * cos })),
    clip: g.clip,
  }))
  bakedMemo.set(g, out)
  return out
}

/** Batch every placed group that is flat enough to batch, and leave the rest as groups.
 *
 *  "Flat enough" is exactly "carries no gradient": an op with a bbox resolves its ramp against its own
 *  extent and cannot share a path, which is the same rule that confines tree batching to the flat rungs.
 *  So this needs no rung of its own — it reads the consequence of the rung each object already picked.
 *
 *  Merging reorders ops of DIFFERENT paints against each other, so where two solids overlap, one's face
 *  can land over the other's silhouette. At the rungs this applies to they are flat shapes a few pixels
 *  across, and built scenery is laid out without overlapping in the first place. */
/** Paths `mapPathPoints` can rewrite: absolute M/L/Q/T/Z and numbers, nothing else. A path carrying a
 *  relative or shorthand command (`h`, `v`, `c`) cannot be baked, so its group stays a group rather than
 *  the bake throwing. Cheaper to ask than to try and catch, and it fails toward the correct picture. */
const BAKEABLE = /^[MLQTZzHhVv\d\s,.+-]*$/

function batchFlat(groups: DrawGroup[]): SceneItem[] {
  const flat: DrawOp[] = []
  const kept: DrawGroup[] = []
  for (const g of groups) {
    if (g.ops.length === 0) continue
    if (!g.flat || g.ops.some((op) => op.bbox || !BAKEABLE.test(op.d))) kept.push(g)
    else flat.push(...bakedOps(g))
  }
  // Batched first, detailed last: an object only keeps its gradients by being the bigger one.
  return [...mergeByPaint(flat), ...kept]
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
  // Shadows before every solid, so nothing casts over the thing standing on it. No gate: each shadow
  // already asked the ladder for itself, and a whole grove's is ONE op however many trees are in it.
  items.push(...batchFlat(keep(s.shadowGroups)))
  const treeShade = treeShadowOp(o.trees, treeOpts)
  if (treeShade) items.push(treeShade)
  mark('solids')
  items.push(...batchFlat(keep(s.wallGroups)))
  items.push(...batchFlat(keep(s.standGs)))
  items.push(...batchFlat(keep(s.roofGs)))
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
  items.push(...keep(s.runShadows))
  items.push(...keep(s.fenceRuns))
  // The start's own paint, over everything, as the SVG layer has always drawn it.
  mark('road')
  if (o.overlay) items.push(...o.overlay)
  return items
}
