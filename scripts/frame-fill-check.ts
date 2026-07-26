// Probe: how many PIXELS a racing-zoom frame paints, section by section.
//
// scripts/canvas-cost-check.ts counts ops, paths and paint lookups — main-thread setup work. That is
// not what the map is short of: with the fps readout open, canvas command time measures ~0.8ms of a
// 30ms frame while panning, so the frame is going somewhere the op count cannot see. It goes on
// RASTER, and raster is billed in pixels, so pixels are what this counts.
//
// Estimated, not exact: a stroke is its visible polyline length times its width, a fill is its
// shoelace area times the fraction of its bounding box inside the viewport. Both are conservative
// about clipping and neither knows about self-overlap, so treat the numbers as a ranking of where a
// frame's fill goes, not as a rasteriser. Overdraw is the point: sections are counted as they are
// submitted, including whatever a later op paints over.
//
// Run: npx tsx scripts/frame-fill-check.ts [circuit ...]

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery, KERB_BLOCK_M, KERB_WIDTH_M } from '../src/lib/ui/track-scenery'
import { TRACK_WIDTH_M, densifyTrace } from '../src/lib/ui/track-path'
import { buildRacingLine, polylineArc } from '../src/lib/ui/racing-line'
import { lapDynamics, trackPhysics } from '../src/lib/ui/lap-dynamics'
import { roadOps } from '../src/lib/ui/road-ops'
import { EXTRUDE } from '../src/components/race/SceneryLayer'
import { pitComplexOps, pitFloorOps } from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone, pitViewAzimuth } from '../src/lib/ui/pit-zone'
import { MOODS, screenUpAzimuth, shadowFill } from '../src/lib/ui/lighting'
import { isGroup, sceneryScene, type DrawOp, type SceneItem, type SceneMark } from '../src/lib/ui/scenery-draw'

const VIEW_W = 1600
const VIEW_H = 900
const RACE_Z = 20
const CULL_MARGIN = 1.45
const DPR = Number(process.env.DPR ?? 1.5)
const VIEWPORT_MPX = (VIEW_W * DPR * VIEW_H * DPR) / 1e6

const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (ids.length === 0) ids.push('hungary', 'hockenheim', 'monaco')
/** Screen pixels per metre of track, which is what the fps readout reports and the only measure of
 *  "how far out am I" that means the same thing on two different circuits. Given, it replaces the
 *  racing-zoom default: a shot framing the whole pit building sits near 3.5. */
const pxm = Number(process.argv.slice(2).find((a) => a.startsWith('--pxm='))?.split('=')[1] ?? 0)
/** The racing line, brake marks and marbles worn into the tarmac. OFF, like the renderer's own flag:
 *  a probe that draws what the map does not is measuring a frame nobody sees. `--ink` puts it back for
 *  the day there is budget to turn it on again. */
const surfaceInk = process.argv.includes('--ink')

type Pt = [number, number]

/** Subpaths of a path, as point runs. Everything the scene emits is M/L with the odd Q, whose control
 *  point is skipped: it moves an endpoint by less than the tolerance this probe already carries. */
function subpaths(d: string): Pt[][] {
  const out: Pt[][] = []
  for (const part of d.split(/(?=M)/)) {
    const body = part.trim()
    if (!body.startsWith('M')) continue
    const nums = body.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? []
    const pts: Pt[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
    if (pts.length) out.push(pts)
  }
  return out
}

interface Box { x0: number; y0: number; x1: number; y1: number }

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

/** How much of the viewport one op REACHES ACROSS, and the same weighted by how many edges reach.
 *
 *  The fill column bills a shape for the pixels it is estimated to end up writing. That is the right
 *  measure for a frame short of fill rate, and the wrong one for the frame this map actually drops:
 *  canvas paint time measures 0.14ms while frames go in whole vsync intervals, which is the compositor
 *  missing its deadline rather than JavaScript running long.
 *
 *  So this counts SETUP instead. A GPU fills a non-convex path by working over every edge across the
 *  area the path reaches, and it pays for that whether or not the covered pixels survive: a path
 *  several viewports long is billed a whole viewport here however little of it is finally seen, and
 *  its edge count multiplies that. Cutting such a path into pieces shows up as the pieces off screen
 *  costing nothing, which the fill column cannot show — its own estimate changes bias with the shape.
 *
 *  A RANKING, not a rasteriser, and one to read with its limits in mind: it over-bills a big
 *  many-vertexed fill that turns out to be cheap in practice (the ground's terrain patches rank above
 *  everything and ablate to nothing on the lap benchmark). Only fills are weighted by edge count. A
 *  stroke's work is local to each segment rather than spread over the whole path, so weighting a
 *  circuit-long fence run by its vertex count ranked it first on a frame that hiding it does not
 *  change.
 *
 *  Per SUBPATH, not per path: a swept hull is a ring, its offset copy and a quad per wall, and each of
 *  those is set up on its own. */
function opExtent(op: DrawOp, box: Box, at: (p: Pt) => Pt): { ext: number; fan: number } {
  let ext = 0
  let fan = 0
  const grow = op.stroke ? (op.width ?? 1) / 2 : 0
  for (const raw of subpaths(op.d)) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
    for (const p of raw) {
      const [x, y] = at(p)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    if (x0 > x1) continue
    const seen = overlap({ x0: x0 - grow, y0: y0 - grow, x1: x1 + grow, y1: y1 + grow }, box)
    ext += seen
    if (op.fill) fan += seen * raw.length
  }
  return { ext, fan }
}

/** Area of one op inside the viewport, in square viewBox units. */
function opArea(op: DrawOp, box: Box, at: (p: Pt) => Pt): number {
  let area = 0
  for (const raw of subpaths(op.d)) {
    const pts = raw.map(at)
    if (op.stroke) {
      // Visible length times width. Segment midpoint against the box: segments are metres long against
      // a viewport tens of metres across, so the edge error is small.
      let len = 0
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]
        const [bx, by] = pts[i]
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2
        if (mx < box.x0 || mx > box.x1 || my < box.y0 || my > box.y1) continue
        len += Math.hypot(bx - ax, by - ay)
      }
      area += len * (op.width ?? 1)
    }
    if (op.fill) {
      let shoelace = 0
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[(i + 1) % pts.length]
        shoelace += ax * by - bx * ay
        if (ax < x0) x0 = ax
        if (ax > x1) x1 = ax
        if (ay < y0) y0 = ay
        if (ay > y1) y1 = ay
      }
      const bbox = (x1 - x0) * (y1 - y0)
      // How much of the shape's own box the viewport holds. Crude, but a fill that is mostly off
      // screen should not be billed for the part the rasteriser clips away.
      const seen = bbox > 0 ? overlap({ x0, y0, x1, y1 }, box) / bbox : 0
      area += Math.abs(shoelace / 2) * seen
    }
  }
  return area
}

for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) { console.log(`${id}: unknown layout`); continue }
  const u = (m: number) => m / layout.metresPerUnit
  const pad = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const vb = { x: vx - pad, y: vy - pad, w: vw + 2 * pad, h: vh + 2 * pad }
  const ppu = Math.min(VIEW_W / vb.w, VIEW_H / vb.h)
  const zoom = pxm > 0 ? (pxm * layout.metresPerUnit) / ppu : RACE_Z
  const k = zoom * ppu // viewBox units to device-independent pixels
  const pxPerUnit2 = (k * DPR) ** 2
  // Below LOD_PX_PER_M the heavy layers drop out; above it the scene is composed at FULL detail
  // against a disc whose radius goes as 1/zoom, so zooming out widens what is drawn faster than it
  // shrinks it — which is how a wide shot ends up submitting more draw calls than a racing one.
  const pxPerM = (ppu * zoom) / layout.metresPerUnit
  // The two tiers the renderer keeps: scenery drops out far later than the ink stops being softened.
  const full = pxPerM >= 2
  const inkFull = pxPerM >= 5

  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: layout.metresPerUnit,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
  })
  const lighting = { ...MOODS.afternoon, azimuth: pitViewAzimuth(layout) ?? MOODS.afternoon.azimuth }
  const viewAz = screenUpAzimuth(0)
  const pitZone = buildPitZone(layout, buildPitSlots(layout, 10))

  const centre = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  const arc = polylineArc(centre)
  const solved = buildRacingLine(arc, layout.metresPerUnit)
  const dyn = lapDynamics(solved.pts, arc.length, trackPhysics(layout.metresPerUnit))
  // Through the renderer's OWN builder, never a copy of it: a probe that submits a different road
  // measures a different road, which is exactly how cutting the apron into stretches moved nothing
  // here while moving everything in the map.
  const track = roadOps({
    layout,
    u,
    pitZone,
    lap: { pts: solved.pts, lateral: solved.lateral, centre, dyn },
    ground: scenery.base,
    shadow: shadowFill(lighting),
    inkFull,
    surfaceInk,
  })
  const pitUnder = pitZone ? pitFloorOps(pitZone, lighting, () => '#888888') : []
  const pitOver = pitZone ? pitComplexOps(pitZone, u, lighting, viewAz, () => '#888888') : []
  const pitPts = pitZone ? [...pitZone.buildingPts, ...pitZone.garageFloors.flat()] : []
  const pitDisc = pitPts.length > 0 ? (() => {
    const xs = pitPts.map((p) => p.x)
    const ys = pitPts.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    return { cx, cy, r: Math.max(...pitPts.map((p) => Math.hypot(p.x - cx, p.y - cy))) + u(80) }
  })() : null

  const viewR = (Math.hypot(VIEW_W, VIEW_H) / 2 / k) * 1.05
  const halfW = VIEW_W / 2 / k
  const halfH = VIEW_H / 2 / k

  /** The scene as composed against the cull disc at a station, and the megapixels each section paints. */
  function shotAt(cx: number, cy: number) {
    const cull = { cx, cy, r: (Math.hypot(VIEW_W, VIEW_H) / 2 / zoom / ppu) * CULL_MARGIN }
    const pitNear = !pitDisc || Math.hypot(pitDisc.cx - cx, pitDisc.cy - cy) <= cull.r + pitDisc.r
    const marks: SceneMark[] = []
    const items = sceneryScene(scenery, {
      u, lighting, view: viewAz, ground: true, extrude: EXTRUDE, pxPerM,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: (r: { storeys?: number }) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
      trees: scenery.trees.filter((t) => Math.hypot(t.x - cx, t.y - cy) <= cull.r + t.r),
      cull,
      track,
      kerbs: scenery.kerbs
        .filter((kb) => Math.hypot(kb.cx - cx, kb.cy - cy) <= cull.r + kb.r)
        .flatMap((kb): DrawOp[] => {
          const clip = { cx: kb.cx, cy: kb.cy, r: kb.r + u(KERB_WIDTH_M) }
          return [
            { d: kb.d, stroke: '#E6E3DC', width: u(KERB_WIDTH_M), cap: 'round', clip },
            {
              d: kb.d, stroke: '#C8352F', width: u(KERB_WIDTH_M), cap: 'butt',
              dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 }, clip,
            },
          ]
        }),
      pitUnder: pitNear ? pitUnder : [],
      pitOver: pitNear ? pitOver : [],
    }, marks)

    const box: Box = { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH }
    // The frame opens by filling the surface with the ground colour, which is a write like any other.
    const by: Record<string, number> = { ground: VIEWPORT_MPX }
    let m = 0
    let section = 'setup'
    let total = VIEWPORT_MPX
    const add = (op: DrawOp, at: (p: Pt) => Pt) => {
      const mpx = (opArea(op, box, at) * pxPerUnit2) / 1e6
      by[section] = (by[section] ?? 0) + mpx
      total += mpx
      const reach = opExtent(op, box, at)
      const ext = (reach.ext * pxPerUnit2) / 1e6
      extBy[section] = (extBy[section] ?? 0) + ext
      extent += ext
      const fn = (reach.fan * pxPerUnit2) / 1e6
      fanBy[section] = (fanBy[section] ?? 0) + fn
      fan += fn
      ops++
      opsBy[section] = (opsBy[section] ?? 0) + 1
      // A gradient or a tiled pattern is a different rasteriser path from a solid: per pixel it is
      // several times the cost, and tree canopies are gradient-filled one per tree.
      for (const paint of [op.fill, op.stroke]) {
        if (!paint?.startsWith('ref:')) continue
        fancy++
        const nm = paint.slice(4)
        byPaint[nm] = (byPaint[nm] ?? 0) + 1
      }
    }
    let ops = 0
    let fancy = 0
    let extent = 0
    let fan = 0
    const byPaint: Record<string, number> = {}
    const opsBy: Record<string, number> = {}
    const extBy: Record<string, number> = {}
    const fanBy: Record<string, number> = {}
    for (let i = 0; i < items.length; i++) {
      while (m < marks.length && marks[m].at === i) section = marks[m++].name
      const item: SceneItem = items[i]
      // The viewport skip drawScene applies before submitting anything.
      if (item.clip && Math.hypot(item.clip.cx - cx, item.clip.cy - cy) > viewR + item.clip.r) continue
      if (isGroup(item)) {
        const cos = Math.cos(item.rot)
        const sin = Math.sin(item.rot)
        const at = ([x, y]: Pt): Pt => [item.x + x * cos - y * sin, item.y + x * sin + y * cos]
        for (const op of item.ops) add(op, at)
      } else {
        add(item, (p) => p)
      }
    }
    return { total, by, ops, fancy, byPaint, opsBy, extent, extBy, fan, fanBy }
  }

  const stations = centre.filter((_, i) => i % Math.max(1, Math.floor(centre.length / 120)) === 0)
  const shots = stations.map((p) => shotAt(p.x, p.y))
  const sorted = [...shots].sort((a, b) => a.total - b.total)
  const pitShot = pitDisc ? shotAt(pitDisc.cx, pitDisc.cy) : null

  const line = (label: string, s: ReturnType<typeof shotAt>) => {
    const parts = Object.entries(s.by).filter(([, v]) => v > 0.05)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([n, v]) => `${n} ${v.toFixed(1)}`).join('  ')
    console.log(`  ${label.padEnd(12)} ${s.total.toFixed(1).padStart(6)} Mpx `
      + `(${(s.total / VIEWPORT_MPX).toFixed(1).padStart(4)}x vp)  ${String(s.ops).padStart(5)} ops `
      + `${String(s.fancy).padStart(4)} gradient/pattern  |  ${parts}`)
    const fx = Object.entries(s.byPaint).sort((a, b) => b[1] - a[1])
      .map(([n, v]) => `${n} ${v}`).join('  ')
    if (fx) console.log(`${' '.repeat(15)}gradient/pattern fills: ${fx}`)
    const ob = Object.entries(s.opsBy).sort((a, b) => b[1] - a[1])
      .map(([n, v]) => `${n} ${v}`).join('  ')
    console.log(`${' '.repeat(15)}draw calls: ${ob}`)
    const ex = Object.entries(s.extBy).filter(([, v]) => v > 0.05)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([n, v]) => `${n} ${v.toFixed(1)}`).join('  ')
    console.log(`${' '.repeat(15)}path extent: ${s.extent.toFixed(1)} Mpx `
      + `(${(s.extent / VIEWPORT_MPX).toFixed(1)}x vp)  |  ${ex}`)
    const fn = Object.entries(s.fanBy).filter(([, v]) => v > 1)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([n, v]) => `${n} ${v.toFixed(0)}`).join('  ')
    console.log(`${' '.repeat(15)}stencil fan: ${s.fan.toFixed(0)} Mpx-edges `
      + `(${(s.fan / VIEWPORT_MPX).toFixed(0)}x vp)  |  ${fn}`)
  }
  console.log(`\n${id} — fill submitted per frame at ${zoom.toFixed(1)}x `
    + `(${pxPerM.toFixed(1)}px/m, scenery ${full ? 'full' : 'low'}, ink ${inkFull ? 'full' : 'flat'}), `
    + `viewport ${VIEWPORT_MPX.toFixed(2)} Mpx (dpr ${DPR})`)
  line('median lap', sorted[Math.floor(sorted.length / 2)])
  line('worst lap', sorted[sorted.length - 1])
  if (pitShot) line('on the pit', pitShot)
}
