// Oblique extrusion geometry for the race map (#sim-2d). A top-down view carries no depth, so solids
// are faked by displacing a footprint along one shared direction and drawing the HEIGHT FACES that
// connect the two outlines. Getting those faces right is the whole illusion:
//
//   - A displaced COPY of the silhouette is not a wall. It reads as the same shape twice, staggered,
//     and on a footprint with a hole the copy shows through the gap.
//   - Smearing N copies along the offset unions to roughly the right silhouette but STAIRCASES every
//     diagonal edge, because an axis-aligned rect stepped along a diagonal is a staircase.
//   - Two parallelograms per rect is exact, cheaper, and reads as a box.
//
// Everything here is pure and emits SVG path data in a footprint's LOCAL frame.

export interface Part { dx: number; dy: number; w: number; h: number }
export interface Vec { x: number; y: number }

const f2 = (n: number) => n.toFixed(2)

/** Every rect of a footprint as subpaths of ONE path. Filled `nonzero` this renders as their union,
 *  which keeps a multi-part building to a couple of DOM nodes instead of a couple per part. */
export function partsPath(parts: Part[]): string {
  let d = ''
  for (const p of parts) {
    const x0 = p.dx - p.w / 2
    const y0 = p.dy - p.h / 2
    d += `M ${f2(x0)} ${f2(y0)} h ${f2(p.w)} v ${f2(p.h)} h ${f2(-p.w)} Z `
  }
  return d
}

/** One quad, wound to MATCH the rects `partsPath` emits.
 *
 *  This matters more than it looks. Under `nonzero` fill, two overlapping subpaths of OPPOSITE
 *  winding cancel to a hole, so a quad wound against the rects subtracts the base out of the solid
 *  and the building renders as a hollow shell with the ground showing through. `partsPath` walks each
 *  rect top-left, right, down, left, which is negative under the shoelace sum below, so every quad
 *  has to land on the same sign. */
export function quad(a: Vec, b: Vec, c: Vec, d: Vec): string {
  const area = (b.x - a.x) * (b.y + a.y) + (c.x - b.x) * (c.y + b.y)
    + (d.x - c.x) * (d.y + c.y) + (a.x - d.x) * (a.y + d.y)
  const pts = area <= 0 ? [a, b, c, d] : [d, c, b, a]
  return `M ${pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join(' L ')} Z `
}

/** Signed shoelace of a ring, in the same convention `quad` normalises to. Exported for tests. */
export function ringArea(pts: Vec[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += (q.x - p.x) * (q.y + p.y)
  }
  return a
}

/** The exact swept hull of a footprint under a translation: the roof rects, the base rects, and the
 *  parallelogram joining each edge that faces the sweep. Used for both the walls of a solid and the
 *  shadow it throws, which are the same shape at different lengths. */
export function sweptHull(parts: Part[], ox: number, oy: number): string {
  if (Math.hypot(ox, oy) < 1e-6) return partsPath(parts)
  let d = partsPath(parts) + partsPath(parts.map((p) => ({ ...p, dx: p.dx + ox, dy: p.dy + oy })))
  for (const p of parts) {
    const x0 = p.dx - p.w / 2
    const x1 = p.dx + p.w / 2
    const y0 = p.dy - p.h / 2
    const y1 = p.dy + p.h / 2
    const off = (v: Vec): Vec => ({ x: v.x + ox, y: v.y + oy })
    // Only edges whose outward normal faces the sweep generate a visible face.
    if (ox > 0) d += quad({ x: x1, y: y0 }, { x: x1, y: y1 }, off({ x: x1, y: y1 }), off({ x: x1, y: y0 }))
    if (ox < 0) d += quad({ x: x0, y: y0 }, { x: x0, y: y1 }, off({ x: x0, y: y1 }), off({ x: x0, y: y0 }))
    if (oy > 0) d += quad({ x: x0, y: y1 }, { x: x1, y: y1 }, off({ x: x1, y: y1 }), off({ x: x0, y: y1 }))
    if (oy < 0) d += quad({ x: x0, y: y0 }, { x: x1, y: y0 }, off({ x: x1, y: y0 }), off({ x: x0, y: y0 }))
  }
  return d
}

/** Only the height faces from the LEFT/RIGHT edges. Drawn a shade apart from the top/bottom ones:
 *  two adjoining planes at different angles to the sky is what reads as a box rather than as a flat
 *  patch of dark colour.
 *
 *  Edges BURIED inside the union are skipped. A multi-part footprint (a tower on a podium, say) has
 *  edges that are interior to its own silhouette; `sweptHull` can emit those harmlessly because they
 *  share its fill, but tinting them differently paints a sliver straight across the wall. */
export function sideFacesX(parts: Part[], ox: number, oy: number): string {
  if (Math.abs(ox) < 1e-6) return ''
  let d = ''
  for (const p of parts) {
    const xe = ox > 0 ? p.dx + p.w / 2 : p.dx - p.w / 2
    const y0 = p.dy - p.h / 2
    const y1 = p.dy + p.h / 2
    // Probe just outside the edge, at both ends and the middle: if another part covers all of it,
    // this edge is interior and casts no face.
    const eps = Math.sign(ox) * 1e-3
    const probes = [y0 + (y1 - y0) * 0.15, p.dy, y1 - (y1 - y0) * 0.15]
    const buried = probes.every((py) => parts.some((q) => (
      q !== p
      && Math.abs(xe + eps - q.dx) < q.w / 2
      && Math.abs(py - q.dy) < q.h / 2
    )))
    if (buried) continue
    d += quad(
      { x: xe, y: y0 }, { x: xe, y: y1 },
      { x: xe + ox, y: y1 + oy }, { x: xe + ox, y: y0 + oy },
    )
  }
  return d
}

export interface RakedStand {
  /** The whole solid's outline, for the silhouette and its stroke. */
  hull: string
  /** The seating deck on top, carrying the seat and crowd patterns. */
  deck: string
  /** The deck's rear edge, where the roof sits. */
  roof: string
}

/** A grandstand raked like real seating: the REAR edge lifts far more than the trackside front, so
 *  the bank climbs away from the circuit instead of standing up as a slab. A stand extruded
 *  uniformly reads as an office block beside the track, which is what it looked like.
 *
 *  Two rules it has to share with `sweptHull`, or stands stop matching the buildings beside them:
 *
 *  1. ONLY the faces whose outward normal points toward the viewer are drawn. Emitting all four
 *     shows the stand's back wall, which no building ever shows — the north face of a solid is not
 *     in view from this angle.
 *  2. The TOP surface is the anchor, exactly as a building's roof is, and the base is pushed away
 *     down-light. Anchoring the base instead leaves it sticking out behind the deck.
 *
 *  `frontPlusY` says which local edge faces the circuit. `o` is the base's full display offset (for
 *  the rear, tallest edge). `frontFrac` is how much of that offset the lower front edge takes:
 *  `1 - frontHeight/rearHeight`. `roofFrac` is how much of the deck the rear canopy covers. */
export function rakedStand(
  w: number, h: number, frontPlusY: boolean, o: Vec, frontFrac: number, roofFrac = 0.3,
): RakedStand {
  const yF = frontPlusY ? h / 2 : -h / 2
  const yR = -yF
  const at = (x: number, y: number, k: number): Vec => ({ x: x + o.x * k, y: y + o.y * k })
  // Deck: rear edge at the footprint (the high, anchored end), front edge pushed most of the way
  // toward the base because it is lower.
  const dRL = at(-w / 2, yR, 0)
  const dRR = at(w / 2, yR, 0)
  const dFL = at(-w / 2, yF, frontFrac)
  const dFR = at(w / 2, yF, frontFrac)
  // Base: the whole footprint at ground level, a full offset away.
  const bRL = at(-w / 2, yR, 1)
  const bRR = at(w / 2, yR, 1)
  const bFL = at(-w / 2, yF, 1)
  const bFR = at(w / 2, yF, 1)

  const deck = quad(dFL, dFR, dRR, dRL)
  let hull = quad(bFL, bFR, bRR, bRL) + deck
  // A face is visible only where its outward normal agrees with the offset.
  if (Math.sign(yF) * o.y > 0) hull += quad(dFL, dFR, bFR, bFL)
  if (Math.sign(yR) * o.y > 0) hull += quad(dRR, dRL, bRL, bRR)
  if (o.x < 0) hull += quad(dRL, dFL, bFL, bRL)
  if (o.x > 0) hull += quad(dFR, dRR, bRR, bFR)

  // The roof covers the rear rows: a strip of the deck measured back from its rear edge.
  const mixv = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const roof = quad(dRL, dRR, mixv(dRR, dFR, roofFrac), mixv(dRL, dFL, roofFrac))
  return { hull, deck, roof }
}
