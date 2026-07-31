// The paint on the road that is neither the surface nor the kerbs (#sim-2d): the start/finish
// chequer, and the grid box each car lines up in.
//
// Described as `DrawOp`s like everything else on the map, and as THREE of them: a hundred and sixteen
// little rects carry three distinct fills between them, so each fill is one path of many subpaths.
//
// Both are laid out in the frame of the thing they belong to (the line's own heading, the box's own
// heading) and baked into world space here, so a renderer only has to fill them.

import type { DrawOp } from './scenery-draw'

/** One axis-aligned rectangle in a local frame, written into world space as a closed path. */
function rectPath(
  o: { x: number; y: number; cos: number; sin: number },
  x: number, y: number, w: number, h: number,
): string {
  const p = (lx: number, ly: number) =>
    `${(o.x + lx * o.cos - ly * o.sin).toFixed(2)} ${(o.y + lx * o.sin + ly * o.cos).toFixed(2)}`
  return `M ${p(x, y)} L ${p(x + w, y)} L ${p(x + w, y + h)} L ${p(x, y + h)} Z`
}

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
  return [{ d: d.join(' '), fill: '#F2F2F2' }]
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
  for (const b of boxes) {
    const rad = (b.deg * Math.PI) / 180
    const o = { x: b.x, y: b.y, cos: Math.cos(rad), sin: Math.sin(rad) }
    white.push(
      rectPath(o, u(2.49), -u(1.7), u(0.25), u(3.4)),
      rectPath(o, u(0.35), -u(1.7), u(2.39), u(0.25)),
      rectPath(o, u(0.35), u(1.45), u(2.39), u(0.25)),
    )
    yellow.push(rectPath(o, u(1.31), u(1.2), u(0.18), u(1.6)))
  }
  return [
    { d: white.join(' '), fill: '#F2F2F2' },
    { d: yellow.join(' '), fill: '#E8C33A' },
  ]
}
