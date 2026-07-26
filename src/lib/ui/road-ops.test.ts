// #sim-2d — the road as draw ops. One builder, read by the renderer and by both probes, because a
// probe that submits its own copy of the road measures a road nobody draws. These pin the two things
// that copy kept getting wrong: the order the layers go down in, and whether a piece carries a disc
// tight enough to be worth culling by.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildPitSlots, buildPitZone } from './pit-zone'
import { roadOps } from './road-ops'
import { densifyTrace } from './track-path'
import { buildRacingLine, polylineArc } from './racing-line'
import { lapDynamics, trackPhysics } from './lap-dynamics'

const IDS = Object.keys(TRACK_LAYOUTS)

const build = (id: string, surfaceInk = false) => {
  const layout = TRACK_LAYOUTS[id]
  return {
    layout,
    ops: roadOps({
      layout,
      u: (m: number) => m / layout.metresPerUnit,
      pitZone: buildPitZone(layout, buildPitSlots(layout, 11)),
      lap: null,
      ground: '#4A5D3A',
      shadow: '#181A26',
      inkFull: true,
      surfaceInk,
    }),
  }
}

const CASING = '#D8D8D2'
const TARMAC = '#33383E'

describe('roadOps', () => {
  it('lays every white casing before any dark tarmac', () => {
    // Interleaved per road instead, the pit lane's casing lands on top of the track it has already
    // merged into, and its round cap leaves a white outline curving across the tarmac with a blob on
    // the end of it. This was a real defect once, and the two probes' copies of the list are exactly
    // where it would come back.
    for (const id of IDS) {
      const { ops } = build(id)
      const ink = (c: string) => ops.flatMap((op, i) => (op.fill === c || op.stroke === c ? [i] : []))
      const white = ink(CASING)
      const dark = ink(TARMAC)
      expect(white.length, `${id}: no casing`).toBeGreaterThan(0)
      expect(dark.length, `${id}: no tarmac`).toBeGreaterThan(0)
      expect(Math.max(...white), `${id}: a casing lands over the tarmac`).toBeLessThan(Math.min(...dark))
    }
  })

  it('draws the apron in stretches, each with a disc that holds it', () => {
    for (const id of IDS) {
      const { layout, ops } = build(id)
      const zone = buildPitZone(layout, buildPitSlots(layout, 11))!
      const apron = ops.filter((op) => op.clip && op.d.endsWith('Z'))
      // Two passes over the apron, casing then tarmac, one op per stretch each.
      expect(apron, `${id}: apron stretches`).toHaveLength(2 * zone.workSpans.length)
      for (const op of apron) {
        const nums = (op.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const d = Math.hypot(nums[i] - op.clip!.cx, nums[i + 1] - op.clip!.cy)
          expect(d, `${id}: an apron stretch reaches outside its disc`).toBeLessThanOrEqual(op.clip!.r + 1e-6)
        }
      }
    }
  })

  it('keeps the ink worn into the tarmac behind its flag, and the tarmac edge in front of it', () => {
    // The renderer draws the ink off; a probe that draws it on reports a frame nobody sees. The
    // tarmac's EDGE is a separate thing and stays: it is what makes the road read as a slab laid on
    // the ground rather than a line drawn into it.
    const layout = TRACK_LAYOUTS.hungary
    const centre = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
    const solved = buildRacingLine(polylineArc(centre), layout.metresPerUnit)
    const dyn = lapDynamics(solved.pts, polylineArc(centre).length, trackPhysics(layout.metresPerUnit))
    const withLap = (surfaceInk: boolean) => roadOps({
      layout,
      u: (m: number) => m / layout.metresPerUnit,
      pitZone: buildPitZone(layout, buildPitSlots(layout, 11)),
      lap: { pts: solved.pts, lateral: solved.lateral, centre, dyn },
      ground: '#4A5D3A',
      shadow: '#181A26',
      inkFull: true,
      surfaceInk,
    })
    const off = withLap(false)
    const on = withLap(true)
    expect(on.length, 'the flag gates nothing').toBeGreaterThan(off.length)
    // The edge is there either way, and it is what the flag must NOT take with it.
    expect(off.length).toBeGreaterThan(build('hungary').ops.length)
  })
})
