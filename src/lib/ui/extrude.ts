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

/** A closed ring as one subpath, wound to match `partsPath`. */
export function ringPath(pts: Vec[]): string {
  if (pts.length < 3) return ''
  const r = ringArea(pts) <= 0 ? pts : [...pts].reverse()
  return `M ${r.map((p) => `${f2(p.x)} ${f2(p.y)}`).join(' L ')} Z `
}

/** An OPEN run of points as path data. The rail along the pit roof, the stripe down the box row and
 *  the limiter lines are all polylines rather than rings, and each of them used to write this line
 *  out again at its call site. */
export function linePath(pts: Vec[]): string {
  if (pts.length < 2) return ''
  return `M ${pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join(' L ')} `
}

/** The swept hull of a CLOSED RING under a translation: the top ring, the base ring, and a quad for
 *  every edge whose outward normal faces the sweep.
 *
 *  `sweptHull` only speaks rectangles, and some solids are not sets of boxes — a pit building is one
 *  articulated concave outline with a pilaster at every garage boundary. Back-facing edges have to be
 *  skipped rather than emitted-and-ignored: on a convex shape their quads fall inside the hull
 *  harmlessly, but on a concave one they poke out through the wall. */
export function sweptRing(pts: Vec[], ox: number, oy: number): string {
  if (pts.length < 3) return ''
  const r = ringArea(pts) <= 0 ? pts : [...pts].reverse()
  if (Math.hypot(ox, oy) < 1e-6) return ringPath(r)
  let d = ringPath(r) + ringPath(r.map((p) => ({ x: p.x + ox, y: p.y + oy })))
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    // Outward normal of an edge on a ring wound in this convention is the direction turned -90.
    if ((q.y - p.y) * ox - (q.x - p.x) * oy <= 0) continue
    d += quad(p, q, { x: q.x + ox, y: q.y + oy }, { x: p.x + ox, y: p.y + oy })
  }
  return d
}

/** The wall faces of a ring that are angled AWAY from the sweep, as opposed to squarely facing it.
 *
 *  One flat tone across every wall of a solid collapses its perspective: with nothing separating the
 *  front of the building from its returns, the eye cannot tell which plane is which. This is the ring
 *  equivalent of `sideFacesX`, and it exists for the same reason — two adjoining planes at different
 *  angles to the sky is what reads as a box. Overlay it on `sweptRing` in a second tone.
 *
 *  `cut` is the cosine of the angle at which a face stops counting as front-on.
 *
 *  `skip` marks edges of the GIVEN ring (edge i runs from `pts[i]`) that must not take a face at all.
 *  A ring cut out of a longer one carries two edges that are not walls: they are where the cut fell,
 *  and the neighbouring piece stands against them. Shading those paints a second tone straight down
 *  the middle of a continuous wall. The ring is reversed here when its winding needs it, so the mark
 *  is mapped through that rather than read off the reversed ring. */
export function obliqueRingFaces(pts: Vec[], ox: number, oy: number, cut = Math.SQRT1_2): string {
  if (pts.length < 3) return ''
  const ol = Math.hypot(ox, oy)
  if (ol < 1e-6) return ''
  const r = ringArea(pts) > 0 ? [...pts].reverse() : pts
  const n = r.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    const el = Math.hypot(q.x - p.x, q.y - p.y)
    if (el < 1e-9) continue
    // Outward normal of an edge on a ring wound in this convention is its direction turned -90.
    const dot = ((q.y - p.y) * ox - (q.x - p.x) * oy) / (el * ol)
    // Epsilon so a face sitting exactly on the cut lands the same way every time; a 45-degree
    // sweep puts both of a square's visible faces precisely there.
    if (dot <= 0 || dot >= cut - 1e-9) continue
    d += quad(p, q, { x: q.x + ox, y: q.y + oy }, { x: p.x + ox, y: p.y + oy })
  }
  return d
}

export interface FaceEdge { a: Vec; b: Vec; axis: 'x' | 'y'; part: Part }

/** Every footprint edge that generates a VISIBLE height face: it faces the sweep, and it is not
 *  buried inside the union.
 *
 *  Buried edges matter because a multi-part footprint (a tower on a podium) has edges interior to its
 *  own silhouette. `sweptHull` can emit those harmlessly since they share its fill, but anything
 *  drawn differently on them paints a sliver straight across the wall. */
export function visibleEdges(parts: Part[], ox: number, oy: number): FaceEdge[] {
  const out: FaceEdge[] = []
  for (const p of parts) {
    const x0 = p.dx - p.w / 2
    const x1 = p.dx + p.w / 2
    const y0 = p.dy - p.h / 2
    const y1 = p.dy + p.h / 2
    // Probe just outside the edge at three points: covered everywhere means interior.
    const buried = (fx: (t: number) => number, fy: (t: number) => number) => (
      [0.15, 0.5, 0.85].every((t) => parts.some((q) => (
        q !== p && Math.abs(fx(t) - q.dx) < q.w / 2 && Math.abs(fy(t) - q.dy) < q.h / 2
      )))
    )
    const eps = 1e-3
    if (Math.abs(ox) > 1e-6) {
      const xe = ox > 0 ? x1 : x0
      const xp = xe + Math.sign(ox) * eps
      if (!buried(() => xp, (t) => y0 + (y1 - y0) * t)) out.push({ a: { x: xe, y: y0 }, b: { x: xe, y: y1 }, axis: 'x', part: p })
    }
    if (Math.abs(oy) > 1e-6) {
      const ye = oy > 0 ? y1 : y0
      const yp = ye + Math.sign(oy) * eps
      if (!buried((t) => x0 + (x1 - x0) * t, () => yp)) out.push({ a: { x: x0, y: ye }, b: { x: x1, y: ye }, axis: 'y', part: p })
    }
  }
  return out
}

/** Windows laid out IN THE PLANE OF EACH WALL.
 *
 *  A tile pattern cannot do this and it is not a matter of tuning. A wall face is the parallelogram
 *  spanned by its ground edge and the extrusion offset, so an axis-aligned grid puts every window at
 *  the wrong angle on every wall whose building is rotated, and puts the ROWS along the map's y axis
 *  rather than up the wall. It reads as a decal stuck on a solid. Gridding the face in its own basis
 *  costs one path per building, the same as the pattern did.
 *
 *  `cell` is the bay width in local units, `rows` the storey count, and the fractions how much of
 *  each bay is glass. */
export function wallWindows(
  parts: Part[], ox: number, oy: number, cell: number, rows: number, wFrac = 0.42, hFrac = 0.46,
): string {
  if (rows < 1 || cell <= 0 || Math.hypot(ox, oy) < 1e-6) return ''
  let d = ''
  for (const e of visibleEdges(parts, ox, oy)) {
    // Cull each window against the SWEPT HULLS of the other parts, not just their footprints.
    //
    // Two things go wrong without this, and both showed up as overlapping glass rather than as a
    // shading bug. An edge only PARTLY covered by a neighbour is not buried, so it used to glaze its
    // whole length including the stretch its neighbour also glazed; and where an articulated
    // footprint steps, one part's side wall and another's front wall genuinely overlap in projection,
    // so windows on the hidden one crossed windows on the visible one. A point inside another part's
    // swept hull is a point on a face that part covers, whichever of the two it is.
    const hidden = (p: Vec) => parts.some((q) => q !== e.part && inSweptHull(p, q, ox, oy))
    d += gridFace(e.a, e.b, ox, oy, cell, rows, wFrac, hFrac, hidden)
  }
  return d
}

/** Is `p` inside the region a rect sweeps under the translation `(ox, oy)`? True when some point of
 *  the sweep lands on it: `p - t*o` is inside the rect for a `t` in `[0, 1]`. Each axis gives an
 *  interval in `t`, so the test is an interval intersection. */
function inSweptHull(p: Vec, q: Part, ox: number, oy: number): boolean {
  let lo = 0
  let hi = 1
  const clip = (c: number, cq: number, half: number, o: number) => {
    if (Math.abs(o) < 1e-9) {
      if (Math.abs(c - cq) >= half) hi = -1
      return
    }
    const t0 = (c - cq - half) / o
    const t1 = (c - cq + half) / o
    lo = Math.max(lo, Math.min(t0, t1))
    hi = Math.min(hi, Math.max(t0, t1))
  }
  const eps = 1e-6
  clip(p.x, q.dx, q.w / 2 - eps, ox)
  clip(p.y, q.dy, q.h / 2 - eps, oy)
  return lo <= hi
}

/** `wallWindows` for a closed ring — the pit complex is one articulated outline, not a set of boxes. */
export function ringWindows(
  pts: Vec[], ox: number, oy: number, cell: number, rows: number, wFrac = 0.42, hFrac = 0.46,
): string {
  if (pts.length < 3 || rows < 1 || cell <= 0 || Math.hypot(ox, oy) < 1e-6) return ''
  const r = ringArea(pts) <= 0 ? pts : [...pts].reverse()
  let d = ''
  for (let i = 0; i < r.length; i++) {
    const p = r[i]
    const q = r[(i + 1) % r.length]
    if ((q.y - p.y) * ox - (q.x - p.x) * oy <= 0) continue
    d += gridFace(p, q, ox, oy, cell, rows, wFrac, hFrac)
  }
  return d
}

/** One wall's grid, in the basis {edge, offset}: `u` runs along the ground edge, `v` up the wall. */
function gridFace(
  a: Vec, b: Vec, ox: number, oy: number, cell: number, rows: number, wFrac: number, hFrac: number,
  hidden: (p: Vec) => boolean = () => false,
): string {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const cols = Math.floor(len / cell)
  if (cols < 1) return ''
  const at = (uu: number, vv: number): Vec => ({
    x: a.x + (b.x - a.x) * uu + ox * vv,
    y: a.y + (b.y - a.y) * uu + oy * vv,
  })
  // Centre the run of bays on the wall so a window never bleeds off the corner.
  const pad = (1 - (cols * cell) / len) / 2
  const bay = cell / len
  let d = ''
  for (let c = 0; c < cols; c++) {
    const u0 = pad + (c + (1 - wFrac) / 2) * bay
    const u1 = u0 + wFrac * bay
    for (let r = 0; r < rows; r++) {
      const v0 = (r + (1 - hFrac) / 2) / rows
      const v1 = v0 + hFrac / rows
      if (hidden(at((u0 + u1) / 2, (v0 + v1) / 2))) continue
      d += quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1))
    }
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

/** The height face of a WALL: the band swept between a run's top line and its base line. A barrier is
 *  a solid the same as a building is, but its outline is an open curve rather than a rectangle, so
 *  the face is one ribbon rather than a pair of quads. Without it a wall is a top line and a
 *  detached shadow with nothing between them, and it reads as floating above the ground. */
export function ribbon(pts: Vec[], ox: number, oy: number): string {
  if (pts.length < 2) return ''
  const top = pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join(' L ')
  const base = [...pts].reverse().map((p) => `${f2(p.x + ox)} ${f2(p.y + oy)}`).join(' L ')
  return `M ${top} L ${base} Z `
}

/** Vertical members up a wall's face — the posts of a debris fence, drawn as subpaths of ONE path so
 *  a whole circuit's fencing costs a single element. `every` is a stride over the run's points. */
export function posts(pts: Vec[], ox: number, oy: number, every: number): string {
  let d = ''
  for (let i = 0; i < pts.length; i += Math.max(1, every)) {
    d += `M ${f2(pts[i].x)} ${f2(pts[i].y)} L ${f2(pts[i].x + ox)} ${f2(pts[i].y + oy)} `
  }
  return d
}

/** Apply a point transform to every coordinate pair in a path built from absolute M/L/Q commands
 *  (which is everything `smoothClosed` and `blobPath` emit).
 *
 *  This exists to bake a per-element `transform` into the geometry so many shapes can share ONE
 *  path. A thousand trees each carrying their own transform attribute is a thousand matrices for the
 *  browser to resolve every frame; as subpaths of a single path they cost one. */
export function mapPathPoints(d: string, fn: (x: number, y: number) => Vec): string {
  // Tokenised rather than split on whitespace: the emitters here write `h 10` but a hand-authored path
  // is free to write `h10`, and a mapper that only understood the first was a landmine for any caller
  // handing it geometry it did not build itself.
  const toks = d.match(/[MLQTZzHhVv]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const out: string[] = []
  // The cursor is tracked in SOURCE space, because that is where a relative command means something.
  // Without it, `h`/`v` could not be resolved at all — which is why they used to throw, and why every
  // group carrying one fell back to being drawn on its own instead of batching.
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const emit = (cmd: string, x: number, y: number) => {
    const p = fn(x, y)
    out.push(cmd, f2(p.x), f2(p.y))
    cx = x
    cy = y
  }
  for (let i = 0; i < toks.length;) {
    const tok = toks[i]
    if (tok === 'Z' || tok === 'z') {
      out.push('Z')
      cx = sx
      cy = sy
      i += 1
      continue
    }
    if (tok === 'M' || tok === 'L' || tok === 'Q' || tok === 'T') {
      const pairs = tok === 'Q' ? 2 : 1
      i += 1
      // Q carries a control point and an endpoint; only the endpoint moves the cursor.
      const ctrl: string[] = []
      for (let k = 0; k < pairs; k++) {
        const x = Number(toks[i])
        const y = Number(toks[i + 1])
        i += 2
        if (k < pairs - 1) {
          const p = fn(x, y)
          ctrl.push(f2(p.x), f2(p.y))
        } else {
          out.push(tok, ...ctrl)
          const p = fn(x, y)
          out.push(f2(p.x), f2(p.y))
          cx = x
          cy = y
        }
      }
      if (tok === 'M') { sx = cx; sy = cy }
      continue
    }
    // The shorthands, resolved to an absolute line. A horizontal run in the source is NOT horizontal
    // once mapped through an arbitrary transform, so it cannot stay an `h`.
    if (tok === 'H' || tok === 'h') {
      const x = tok === 'H' ? Number(toks[i + 1]) : cx + Number(toks[i + 1])
      emit('L', x, cy)
      i += 2
      continue
    }
    if (tok === 'V' || tok === 'v') {
      const y = tok === 'V' ? Number(toks[i + 1]) : cy + Number(toks[i + 1])
      emit('L', cx, y)
      i += 2
      continue
    }
    throw new Error(`mapPathPoints: unsupported command "${tok}"`)
  }
  return out.join(' ')
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
