// The paint on and beside the road surface (#sim-2d): the start/finish chequer, the grid box each
// car lines up in, and the kerbs' two strokes.
//
// Described as `DrawOp`s like everything else on the map, and as few of them: a hundred and sixteen
// little rects carry three distinct fills between them, so each fill is one path of many subpaths.
//
// The chequer and boxes are laid out in the frame of the thing they belong to (the line's own
// heading, the box's own heading) and baked into world space here, so a renderer only has to fill them.

import type { DrawOp } from './scenery-draw'
import { KERB_BLOCK_M, KERB_RED, KERB_WHITE, KERB_WIDTH_M, type SceneryKerb } from './track-scenery'

/** A kerb's paint: the white round-capped base with the red blocks dashed over it. One home for the
 *  numbers, because the map, the 2D preview and the 3D world all lay the same kerb (#3d-port). */
export function kerbOps(kerbs: readonly SceneryKerb[], u: (m: number) => number): DrawOp[] {
  return kerbs.flatMap((k): DrawOp[] => [
    { d: k.d, stroke: KERB_WHITE, width: u(KERB_WIDTH_M), cap: 'round' },
    {
      d: k.d, stroke: KERB_RED, width: u(KERB_WIDTH_M), cap: 'butt',
      dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 },
    },
  ])
}

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

/** The marks' white, shared by the chequer and the grid boxes' frame. */
export const MARK_WHITE = '#F2F2F2'

/** Where the start/finish band actually sits: nudged forward of the path start so the band clears
 *  the pole box's crossbar. One home for the nudge, because the map, the 2D preview and the 3D world
 *  must lay the band on the same spot (#3d-port). */
export function startPose(
  start: { x: number; y: number; angle: number }, metresPerUnit: number,
): { x: number; y: number; angle: number } {
  const lead = 1.5 / metresPerUnit
  return { x: start.x + Math.cos(start.angle) * lead, y: start.y + Math.sin(start.angle) * lead, angle: start.angle }
}

/** The chequer's painted squares in the line's own frame, for any renderer to fill. */
export function startLineRects(u: (m: number) => number): Array<[number, number, number, number]> {
  const s = u(SF_SQUARE_M)
  const x0 = -u(0.75)
  const y0 = -u(6)
  const rects: Array<[number, number, number, number]> = []
  for (let i = 0; i < SF_ROWS * SF_COLS; i++) {
    const row = i % SF_ROWS
    const col = Math.floor(i / SF_ROWS)
    if ((row + col) % 2 === 1) continue
    rects.push([x0 + row * s, y0 + col * s, s, s])
  }
  return rects
}

/** The start/finish line: a chequered band spanning EXACTLY the tarmac width.
 *
 *  One op of alternating squares as subpaths. They share a fill and never touch, so a single fill is
 *  identical to thirty-six of them and costs a thirty-sixth as much to submit. */
export function startLineOps(
  at: { x: number; y: number; angle: number }, u: (m: number) => number,
): DrawOp[] {
  const o = { x: at.x, y: at.y, cos: Math.cos(at.angle), sin: Math.sin(at.angle) }
  const d = startLineRects(u).map(([x, y, w, h]) => rectPath(o, x, y, w, h))
  if (d.length === 0) return []
  return [{ d: d.join(' '), fill: MARK_WHITE }]
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
    { d: white.join(' '), fill: MARK_WHITE },
    { d: yellow.join(' '), fill: '#E8C33A' },
  ]
}
