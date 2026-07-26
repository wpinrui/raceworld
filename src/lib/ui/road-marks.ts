// The paint on the road that is neither the surface nor the kerbs (#sim-2d): the start/finish
// chequer, and the grid box each car lines up in.
//
// Described as `DrawOp`s for the same reason everything else here is: there are two renderers and one
// picture. But these two had a second reason to move, which is that they were the last STATIC world
// geometry still living as elements inside the camera's transform. A hundred and sixteen little rects,
// re-rasterised at a new scale on every camera frame for the length of a race, when between them they
// carry three distinct fills and could therefore be three draw calls.
//
// Both are laid out in the frame of the thing they belong to (the line's own heading, the box's own
// heading) and baked into world space here, so a renderer only has to fill them.

import type { Bounds, DrawOp } from './scenery-draw'
import { unionOf } from './lod'

/** Coordinates are written to two decimals, so a corner can land up to half of the last place outside
 *  where the arithmetic put it, on each axis. A cull disc is only allowed to be wrong in one direction,
 *  so every disc here absorbs that. */
const ROUND_SLOP = Math.hypot(0.005, 0.005) * 1.01

/** One axis-aligned rectangle in a local frame, written into world space as a closed path. */
function rectPath(
  o: { x: number; y: number; cos: number; sin: number },
  x: number, y: number, w: number, h: number,
): string {
  const p = (lx: number, ly: number) =>
    `${(o.x + lx * o.cos - ly * o.sin).toFixed(2)} ${(o.y + lx * o.sin + ly * o.cos).toFixed(2)}`
  return `M ${p(x, y)} L ${p(x + w, y)} L ${p(x + w, y + h)} L ${p(x, y + h)} Z`
}

/** The disc a run of local rectangles occupies once placed, from the local extent. Conservative: the
 *  half-diagonal of the local bounding box does not depend on the rotation. */
const discOf = (o: { x: number; y: number }, halfW: number, halfH: number): Bounds =>
  ({ cx: o.x, cy: o.y, r: Math.hypot(halfW, halfH) + ROUND_SLOP })

/** Rows across the road and columns along it: 3 rows of 0.5m squares spanning the tarmac. */
const SF_ROWS = 3
const SF_COLS = 24
const SF_SQUARE_M = 0.5

/** The start/finish line: a chequered band spanning EXACTLY the tarmac width.
 *
 *  One op of alternating squares as subpaths. They share a fill and never touch, so a single fill is
 *  identical to thirty-six of them and costs a thirty-sixth as much to submit. */
export function startLineOps(
  at: { x: number; y: number; angle: number }, u: (m: number) => number,
): DrawOp[] {
  const o = { x: at.x, y: at.y, cos: Math.cos(at.angle), sin: Math.sin(at.angle) }
  const s = u(SF_SQUARE_M)
  const x0 = -u(0.75)
  const y0 = -u(6)
  const d: string[] = []
  for (let i = 0; i < SF_ROWS * SF_COLS; i++) {
    const row = i % SF_ROWS
    const col = Math.floor(i / SF_ROWS)
    if ((row + col) % 2 === 1) continue
    d.push(rectPath(o, x0 + row * s, y0 + col * s, s, s))
  }
  if (d.length === 0) return []
  return [{
    d: d.join(' '),
    fill: '#F2F2F2',
    clip: discOf(o, u(0.75), u(6)),
  }]
}

/** A starting box, anchored to the PARKED CAR (centre at the slot origin, CAR_SCALE applied): an
 *  inverted U with the crossbar just clear of the wing tip, and a yellow tyre guide TRANSVERSE at
 *  front-axle height, reaching out past the right leg so the driver can sight it beside the nose.
 *
 *  Every box's white paint is one op and every box's yellow is another, so a whole grid is two draw
 *  calls rather than eighty. They are drawn together or not at all, which is what a starting grid does. */
export function gridBoxOps(
  boxes: ReadonlyArray<{ x: number; y: number; deg: number }>, u: (m: number) => number,
): DrawOp[] {
  if (boxes.length === 0) return []
  const white: string[] = []
  const yellow: string[] = []
  const discs: Bounds[] = []
  for (const b of boxes) {
    const rad = (b.deg * Math.PI) / 180
    const o = { x: b.x, y: b.y, cos: Math.cos(rad), sin: Math.sin(rad) }
    white.push(
      rectPath(o, u(2.49), -u(1.7), u(0.25), u(3.4)),
      rectPath(o, u(0.35), -u(1.7), u(2.39), u(0.25)),
      rectPath(o, u(0.35), u(1.45), u(2.39), u(0.25)),
    )
    yellow.push(rectPath(o, u(1.31), u(1.2), u(0.18), u(1.6)))
    // Local extent of everything above: x out to 2.74, y out to 2.8.
    discs.push(discOf(o, u(2.74), u(2.8)))
  }
  // The grid runs a hundred and sixty metres back from the line, so the union is a long way across —
  // but it is two calls for the whole field.
  const clip = unionOf(discs)
  return [
    { d: white.join(' '), fill: '#F2F2F2', clip },
    { d: yellow.join(' '), fill: '#E8C33A', clip },
  ]
}
