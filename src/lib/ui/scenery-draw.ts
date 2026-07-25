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
  type Part, mapPathPoints, partsPath, rakedStand, sideFacesX, sweptHull, wallWindows,
} from './extrude'
import {
  type Lighting, dirAt, shadeFace, shadowFill, shadowOpacity, shadowReach, tintFace,
} from './lighting'
import type { Scenery, SceneryRect, SceneryTree } from './track-scenery'

/** One drawing instruction. `fill` and `stroke` are colours, or a `ref:NAME` naming a gradient or
 *  pattern the renderer supplies — the SVG layer resolves those to `url(#NAME)`, the canvas to a
 *  CanvasGradient. Keeping them symbolic is what stops paint leaking into the geometry. */
export interface DrawOp {
  d: string
  fill?: string
  stroke?: string
  /** Stroke width in viewBox units. */
  width?: number
  alpha?: number
  cap?: 'round' | 'butt'
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
  const ops: DrawOp[] = []
  for (const t of depthSorted(trees, dir)) {
    const lift = o.u(t.h * o.extrude)
    ops.push({
      d: `M ${t.x.toFixed(1)} ${t.y.toFixed(1)} L ${(t.x + dir.x * lift).toFixed(1)} ${(t.y + dir.y * lift).toFixed(1)}`,
      stroke: shadeFace('#6B5138', o.lighting),
      // Trunk width scales with the canopy it carries; a constant width made every tree a lollipop.
      width: Math.max(o.u(0.8), t.r * 0.34),
      cap: 'round',
    })
    ops.push({ d: t.d, fill: `${REF}tm-tree${t.variant}` })
  }
  return ops
}

/** Every tree's shadow as ONE op. They share a fill and never overlap meaningfully, so a single path
 *  of many subpaths costs one draw call instead of a thousand. */
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
    const ops: DrawOp[] = [
      { d: hull, fill: shadeFace(s.fill, o.lighting) },
      { d: deck, fill: `${REF}tm-seats` },
    ]
    if (full) ops.push({ d: deck, fill: `${REF}tm-crowd` })
    // Which way a stand faces has to be legible at a glance, so the rake darkens toward the front.
    if (full) ops.push({ d: deck, fill: `${REF}${s.facing ? 'tm-rake' : 'tm-rake-flip'}` })
    ops.push({ d: roof, fill: '#7B8494' })
    if (full) ops.push({ d: deck, fill: `${REF}tm-bevel` })
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
    const ops: DrawOp[] = [{ d, fill: b.fill }]
    if (full) ops.push({ d, fill: `${REF}tm-roof` }, { d, fill: `${REF}tm-bevel` })
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
      ops: [{ d: sweptHull(partsOf(r), off.x, off.y) }],
    }
  })
}
