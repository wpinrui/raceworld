import { describe, expect, it } from 'vitest'
import { gridBoxOps, kerbOps, startLineOps, startLineRects, startPose } from './road-marks'
import { KERB_RED, KERB_WHITE, type SceneryKerb } from './track-scenery'
import type { DrawOp } from './scenery-draw'

/** Metres straight through, so every number in a test reads as metres. */
const u = (m: number) => m

/** Every coordinate pair in an op's path data. */
function points(op: DrawOp): Array<{ x: number; y: number }> {
  const n = (op.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] })
  return out
}

const subpaths = (op: DrawOp) => op.d.split('M').length - 1

/** What an SVG `<g transform="translate(ox oy) rotate(deg)">` around a `<rect>` corner resolves to.
 *  These marks were markup before they were ops, and they have to land in exactly the same place: the
 *  grid boxes are drawn to line up with the parked sprites, and the chequer with the tarmac's width. */
function svgPlaced(ox: number, oy: number, deg: number, lx: number, ly: number) {
  const a = (deg * Math.PI) / 180
  return { x: ox + lx * Math.cos(a) - ly * Math.sin(a), y: oy + lx * Math.sin(a) + ly * Math.cos(a) }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.02

/** Does any point in the op sit where SVG would have put this local corner? */
const has = (op: DrawOp, at: { x: number; y: number }) =>
  points(op).some((p) => near(p.x, at.x) && near(p.y, at.y))

describe('startLineOps', () => {
  const at = { x: 100, y: 50, angle: 0 }

  it('is one op, so a whole chequer costs one draw call', () => {
    const ops = startLineOps(at, u)
    expect(ops).toHaveLength(1)
    expect(ops[0].fill).toBe('#F2F2F2')
  })

  it('lays a 3x24 chequer, which is half of 72 squares', () => {
    expect(subpaths(startLineOps(at, u)[0])).toBe(36)
  })

  it('spans the tarmac across and 1.5m along, as the markup did', () => {
    const p = points(startLineOps(at, u)[0])
    const xs = p.map((q) => q.x)
    const ys = p.map((q) => q.y)
    // Local x ran -0.75..0.75 (three 0.5m rows) and y -6..6 (twenty-four of them).
    expect(Math.min(...xs)).toBeCloseTo(100 - 0.75, 1)
    expect(Math.max(...xs)).toBeCloseTo(100 + 0.75, 1)
    expect(Math.min(...ys)).toBeCloseTo(50 - 6, 1)
    expect(Math.max(...ys)).toBeCloseTo(50 + 6, 1)
  })

  it('places its corners exactly where the SVG transform did, at any heading', () => {
    const turned = { x: 100, y: 50, angle: 0.9 }
    const op = startLineOps(turned, u)[0]
    const deg = (turned.angle * 180) / Math.PI
    // The first square of the first column: local x -0.75..-0.25, y -6..-5.5.
    expect(has(op, svgPlaced(100, 50, deg, -0.75, -6))).toBe(true)
    expect(has(op, svgPlaced(100, 50, deg, -0.25, -5.5))).toBe(true)
  })

  it('scales through `u`, so a circuit metres-per-unit reaches it', () => {
    const half = startLineOps(at, (m) => m / 2)[0]
    const ys = points(half).map((q) => q.y)
    expect(Math.min(...ys)).toBeCloseTo(50 - 3, 1)
  })
})

describe('gridBoxOps', () => {
  const boxes = [
    { x: 0, y: 0, deg: 0 },
    { x: -8, y: 3.4, deg: 0 },
    { x: -16, y: 0, deg: 12 },
  ]

  it('is two ops for a whole grid: one white, one yellow', () => {
    const ops = gridBoxOps(boxes, u)
    expect(ops.map((o) => o.fill)).toEqual(['#F2F2F2', '#E8C33A'])
  })

  it('draws three white bars and one yellow guide per box', () => {
    const [white, yellow] = gridBoxOps(boxes, u)
    expect(subpaths(white)).toBe(3 * boxes.length)
    expect(subpaths(yellow)).toBe(boxes.length)
  })

  it('draws nothing at all before the grid is known', () => {
    expect(gridBoxOps([], u)).toEqual([])
  })

  it('places the crossbar and the tyre guide where the SVG rects did', () => {
    const [white, yellow] = gridBoxOps([boxes[2]], u)
    const { x, y, deg } = boxes[2]
    // The leg down the right-hand side: local x 2.49, y -1.7.
    expect(has(white, svgPlaced(x, y, deg, 2.49, -1.7))).toBe(true)
    // The yellow guide's near corner: local x 1.31, y 1.2.
    expect(has(yellow, svgPlaced(x, y, deg, 1.31, 1.2))).toBe(true)
  })
})

describe('startPose', () => {
  it('nudges 1.5 real metres along the direction of travel, whatever the scale', () => {
    const at = startPose({ x: 10, y: 5, angle: Math.PI / 2 }, 3)
    expect(at.x).toBeCloseTo(10, 10)
    expect(at.y).toBeCloseTo(5.5, 10)
    expect(at.angle).toBe(Math.PI / 2)
  })
})

describe('startLineRects', () => {
  it('is the chequer startLineOps paints: 36 alternating squares over the same span', () => {
    const rects = startLineRects(u)
    expect(rects).toHaveLength(36)
    expect(Math.min(...rects.map(([x]) => x))).toBeCloseTo(-0.75, 10)
    expect(Math.max(...rects.map(([, y, , h]) => y + h))).toBeCloseTo(6, 10)
    expect(rects.every(([, , w, h]) => w === 0.5 && h === 0.5)).toBe(true)
  })
})

describe('kerbOps', () => {
  const kerb: SceneryKerb = { d: 'M 0 0 L 20 0', pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }], cx: 10, cy: 0, r: 10 }

  it('lays the white base round-capped under the red blocks, butt-cut at the 3m pitch', () => {
    const [white, red] = kerbOps([kerb], u)
    expect(white).toMatchObject({ d: kerb.d, stroke: KERB_WHITE, width: 1.3, cap: 'round' })
    expect(red).toMatchObject({
      d: kerb.d, stroke: KERB_RED, width: 1.3, cap: 'butt', dash: { on: 3, off: 3, shift: 0 },
    })
  })

  it('is two ops per kerb, in base-then-blocks order across the whole set', () => {
    const ops = kerbOps([kerb, kerb], u)
    expect(ops.map((o) => o.stroke)).toEqual([KERB_WHITE, KERB_RED, KERB_WHITE, KERB_RED])
  })
})
