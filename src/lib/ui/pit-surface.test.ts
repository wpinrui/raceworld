import { describe, expect, it } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildPitSlots, buildPitZone } from './pit-zone'
import { LANE_TARMAC_M, LANE_WIDTH_M } from './track-path'
import { pitEdgeOps, pitSurfaceOps, type PitSurface } from './pit-surface'
import { SOFT_LAYERS } from './surface-ink'
import type { DrawOp } from './scenery-draw'

const GROUND = '#3F602C'
const TARMAC = '#33383E'

function surfaceFor(id: string): PitSurface {
  const layout = TRACK_LAYOUTS[id]
  const slots = buildPitSlots(layout, 10)
  const zone = buildPitZone(layout, slots)
  return {
    u: (m: number) => m / layout.metresPerUnit,
    fast: layout.pit.fastPts,
    apron: zone ? { outer: zone.workOuter, inner: zone.workInner } : undefined,
    boxes: slots,
    tarmac: TARMAC,
    ground: GROUND,
  }
}

/** Every coordinate pair an op's path visits. */
function pointsOf(op: DrawOp): Array<{ x: number; y: number }> {
  const nums = (op.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] })
  return out
}

const IDS = ['britain', 'monaco', 'belgium']

describe('pit surface', () => {
  it('paints opaque colour only, never a translucent stripe', () => {
    // Arcs abut, so a translucent one double-paints at every join. The ink is pre-blended instead.
    for (const id of IDS) {
      const s = surfaceFor(id)
      for (const op of [...pitEdgeOps(s), ...pitSurfaceOps(s)]) {
        expect(op.alpha, `${id}: translucent op`).toBeUndefined()
        expect(op.fill ?? op.stroke).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('fades the apron from the ground colour up to the tarmac, and no darker', () => {
    const s = surfaceFor('britain')
    const ops = pitEdgeOps(s)
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    const ground = lum(GROUND)
    const tarmac = lum(TARMAC)
    for (const op of ops) {
      const v = lum(op.stroke!)
      expect(v).toBeGreaterThanOrEqual(Math.min(ground, tarmac) - 1)
      expect(v).toBeLessThanOrEqual(Math.max(ground, tarmac) + 1)
    }
    // Widest and faintest first: the last pass is the asphalt itself, at full tarmac.
    expect(ops[ops.length - 1].stroke).toBe(TARMAC)
  })

  it('lays the fade under the asphalt, wider than it', () => {
    const s = surfaceFor('britain')
    const ops = pitEdgeOps(s)
    const road = ops.filter((o) => o.stroke === TARMAC)
    const widest = Math.max(...road.map((o) => o.width ?? 0))
    for (const op of ops.filter((o) => o.stroke !== TARMAC)) {
      expect(op.width ?? 0).toBeGreaterThan(0)
    }
    // Every fade layer of the LANE is wider than the lane's own asphalt pass, or it would not show.
    const laneRoad = road.filter((o) => Math.abs((o.width ?? 0) - widest) < 1e-9)
    expect(laneRoad.length).toBeGreaterThan(0)
    const fadeWidths = ops.filter((o) => o.stroke !== TARMAC).map((o) => o.width ?? 0)
    expect(Math.max(...fadeWidths)).toBeGreaterThan(widest)
  })

  it('reaches past the drawn lane but stays close to it', () => {
    // The apron exists to sit the ribbon ON the ground; it is not licence to paint a car park.
    const layout = TRACK_LAYOUTS.britain
    const s = surfaceFor('britain')
    const u = (m: number) => m / layout.metresPerUnit
    const lane = s.fast
    const nearest = (p: { x: number; y: number }) => Math.min(
      ...lane.map((q) => Math.hypot(q.x - p.x, q.y - p.y)),
    )
    for (const op of pitEdgeOps(s).filter((o) => o.stroke === TARMAC)) {
      for (const p of pointsOf(op)) {
        // Measured to the lane's own line: the working apron's edge is legitimately off it.
        expect(nearest(p)).toBeLessThan(u(30))
      }
    }
    const laneAsphalt = Math.max(...pitEdgeOps(s).map((o) => o.width ?? 0))
    expect(laneAsphalt).toBeGreaterThan(u(LANE_WIDTH_M))
    expect(laneAsphalt).toBeLessThan(u(LANE_WIDTH_M * 3))
  })

  it('keeps the worn band inside the lane it is worn into', () => {
    // The band down the fast lane is drawn ON the lane's own centreline, so nothing bounds it but its
    // width: one wider than the asphalt would paint straight over the white line the lane is edged by.
    for (const id of IDS) {
      const s = surfaceFor(id)
      const onLane = new Set(s.fast.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`))
      const wear = pitSurfaceOps(s).filter((o) => (
        o.stroke && pointsOf(o).every((p) => onLane.has(`${p.x.toFixed(2)},${p.y.toFixed(2)}`))
      ))
      expect(wear.length, `${id}: no band found on the lane`).toBeGreaterThan(0)
      for (const op of wear) {
        expect(op.width!, `${id}: worn band wider than the asphalt`).toBeLessThanOrEqual(s.u(LANE_TARMAC_M))
      }
    }
  })

  it('softens every mark by nesting, and mottles the lane at every zoom', () => {
    // Softness is nested opaque strokes rather than a blur, so a mark is SOFT_LAYERS strokes wide;
    // the grain is the only thing here drawn as a fill.
    for (const id of IDS) {
      const s = surfaceFor(id)
      const widths = new Set(pitEdgeOps(s).map((o) => o.width))
      expect(widths.size, `${id}: the apron fade is not nested`).toBeGreaterThanOrEqual(SOFT_LAYERS)
      expect(pitSurfaceOps(s).some((o) => o.fill && !o.stroke), `${id}: no grain`).toBe(true)
    }
  })

  it('draws nothing without a lane, and no box marks without boxes', () => {
    const s = surfaceFor('britain')
    expect(pitEdgeOps({ ...s, fast: [] })).toEqual([])
    const noBoxes = pitSurfaceOps({ ...s, boxes: [] })
    expect(noBoxes.length).toBeLessThan(pitSurfaceOps(s).length)
    // A layout with no box row still gets its lane edged and worn.
    expect(pitEdgeOps({ ...s, apron: undefined }).length).toBeGreaterThan(0)
  })

  it('is stable: the same circuit describes the same ink every time', () => {
    // The mottling is built from sines rather than random, so a circuit cannot look different between
    // two renders of the same race.
    const a = pitSurfaceOps(surfaceFor('monaco'))
    const b = pitSurfaceOps(surfaceFor('monaco'))
    expect(a.map((o) => `${o.d}|${o.fill ?? o.stroke}`)).toEqual(b.map((o) => `${o.d}|${o.fill ?? o.stroke}`))
  })

  it('produces finite geometry on every circuit', () => {
    for (const id of Object.keys(TRACK_LAYOUTS)) {
      const s = surfaceFor(id)
      for (const op of [...pitEdgeOps(s), ...pitSurfaceOps(s)]) {
        expect(op.d, `${id}: non-finite coordinate`).not.toMatch(/NaN|Infinity/)
        expect(Number.isFinite(op.width ?? 0), `${id}: non-finite width`).toBe(true)
      }
    }
  })
})
