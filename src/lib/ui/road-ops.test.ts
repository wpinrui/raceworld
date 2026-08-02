// #sim-2d — the road as draw ops. One builder, read by the renderer and by the preview probe, because
// a probe that submits its own copy of the road measures a road nobody draws. These pin what that copy
// kept getting wrong: the order the layers go down in, and what the tarmac carries once the racing
// line has been solved.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildPitSlots, buildPitZone } from './pit-zone'
import { ROAD_TARMAC, roadOps } from './road-ops'
import { densifyTrace } from './track-path'
import { buildRacingLine, polylineArc } from './racing-line'
import { lapDynamics, trackPhysics } from './lap-dynamics'
import { MARBLE, RUBBER, SKID, blend } from './surface-ink'

const IDS = Object.keys(TRACK_LAYOUTS)

const build = (id: string) => {
  const layout = TRACK_LAYOUTS[id]
  const pitSlots = buildPitSlots(layout, 11)
  return {
    layout,
    ops: roadOps({
      layout,
      u: (m: number) => m / layout.metresPerUnit,
      pitZone: buildPitZone(layout, pitSlots),
      pitSlots,
      lap: null,
      ground: '#4A5D3A',
      shadow: '#181A26',
    }),
  }
}

const CASING = '#D8D8D2'
const TARMAC = ROAD_TARMAC

/** Hungary with its racing line solved, which is the only state the driven-in ink exists in. */
const withLap = () => {
  const layout = TRACK_LAYOUTS.hungary
  const pitSlots = buildPitSlots(layout, 11)
  const centre = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  const solved = buildRacingLine(polylineArc(centre), layout.metresPerUnit)
  const dyn = lapDynamics(solved.pts, polylineArc(centre).length, trackPhysics(layout.metresPerUnit))
  return roadOps({
    layout,
    u: (m: number) => m / layout.metresPerUnit,
    pitZone: buildPitZone(layout, pitSlots),
    pitSlots,
    lap: { pts: solved.pts, lateral: solved.lateral, centre, dyn },
    ground: '#4A5D3A',
    shadow: '#181A26',
  })
}

describe('roadOps', () => {
  it('lays every white casing before any dark tarmac', () => {
    // Across the RIBBONS: the circuit, the pit lane and the working apron. Interleaved per road
    // instead, the pit lane's casing lands on top of the track it has already merged into, and its
    // round cap leaves a white outline curving across the tarmac with a blob on the end of it. This
    // was a real defect once.
    for (const id of IDS) {
      const { layout, ops } = build(id)
      const ribbon = ops.filter((op) => op.d === layout.d || op.d === layout.pit.fastD || op.d.endsWith('Z'))
      const ink = (c: string) => ribbon.flatMap((op, i) => (op.fill === c || op.stroke === c ? [i] : []))
      const white = ink(CASING)
      const dark = ink(TARMAC)
      expect(white.length, `${id}: no casing`).toBeGreaterThan(0)
      expect(dark.length, `${id}: no tarmac`).toBeGreaterThan(0)
      expect(Math.max(...white), `${id}: a casing lands over the tarmac`).toBeLessThan(Math.min(...dark))
    }
  })

  it('lays the aprons under the roads that sit on them', () => {
    // The fade from asphalt into the verge is drawn UNDER the ribbon, so the road covers all but the
    // rim of it. Painted after, it would wash over the tarmac it is meant to edge.
    for (const id of IDS) {
      const { layout, ops } = build(id)
      const firstRibbon = ops.findIndex((op) => op.d === layout.d)
      expect(firstRibbon, `${id}: nothing under the road`).toBeGreaterThan(0)
    }
  })

  it('lays the pit apron under the ink and gives the circuit no edge treatment at all', () => {
    // The circuit's falloff bands and its apron are BOTH gone: a white line is the track's boundary,
    // so nothing of the circuit's own may be laid outside it. What survives under the ink is the pit
    // lane's apron, which is a real working surface rather than an edge effect, and it still has to
    // go down before any asphalt the roads themselves lay.
    for (const id of IDS) {
      const { layout, ops } = build(id)
      const firstRibbon = ops.findIndex((op) => op.d === layout.d)
      const under = ops.slice(0, firstRibbon)
      const outside = under.filter((op) => {
        const c = op.stroke ?? op.fill
        return c !== undefined && c !== TARMAC && c !== CASING
      })
      expect(outside, `${id}: the circuit still wears an edge treatment`).toEqual([])
      expect(under.length, `${id}: the pit apron went with it`).toBeGreaterThan(0)
    }
  })

  it('wears the racing line, its marbles and its brake marks into the tarmac', () => {
    // The circuit's driven-in detail. Each mark is pre-blended opaquely against the tarmac, so it is
    // identified by the colour it resolves to rather than by an alpha.
    const ops = withLap()
    const has = (over: string) => ops.some((op) => {
      const c = op.stroke ?? op.fill
      // Any strength of that ink against the road: the marks breathe along the lap.
      return !!c && Array.from({ length: 40 }, (_, i) => blend(TARMAC, over, (i + 1) / 200)).includes(c)
    })
    expect(has(RUBBER), 'the polished racing line').toBe(true)
    expect(has(MARBLE), 'the marbles a corner throws off').toBe(true)
    expect(has(SKID), 'brake marks into the braking zones').toBe(true)
  })

  it('draws the driven-in ink OVER the road it is worn into', () => {
    const ops = withLap()
    const lastTarmac = ops.map((op) => op.fill === TARMAC || op.stroke === TARMAC).lastIndexOf(true)
    const firstMark = ops.findIndex((op, i) => i > lastTarmac && (op.stroke ?? op.fill) !== undefined)
    expect(lastTarmac).toBeGreaterThan(0)
    expect(firstMark, 'nothing is worn into the tarmac at all').toBeGreaterThan(lastTarmac)
  })

  it('gives the pit lane its own wear rather than leaving it a bare slab', () => {
    // A pit lane has no racing line and nothing that locks a wheel, but it is tarmac the camera parks
    // on for a whole stop: it gets an apron, a band worn down the fast lane and grime at each box.
    const bare = build('hungary').ops.length
    const ops = withLap()
    expect(ops.length).toBeGreaterThan(bare)
  })
})
