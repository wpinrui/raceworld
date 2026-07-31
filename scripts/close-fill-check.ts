// Probe: what the CLOSE shot's frame is made of, per section, at 6 px/m.
//
// frame-fill-check.ts answers the same question at racing zoom (2 px/m) and bills the surface clear
// into its `ground` row, which is the one thing that cannot appear in a lab DELTA: the clear is
// `drawScene`'s opening `fillRect`, it runs before any section timer starts, and it is identical in
// every cell. So a `hide:ground` row can only be the ops `groundOps` stops emitting. This prints
// exactly those ops, their on-screen area, and how many viewports each one spans.
//
// The shadows row is here for the same reason: SOLID_PAD_M pads every structure's cull disc by 80m,
// which at 6 px/m is 480 screen pixels of overhang per edge, so an unknown share of that section is
// submitted with no on-screen ink at all. This counts it.
//
// Estimated like frame-fill-check, and with the same limits: a fill is its shoelace area times the
// fraction of its bounding box the viewport holds, so treat it as a ranking rather than a rasteriser.
//
// Run: npx tsx scripts/close-fill-check.ts [circuit ...] [--pxm=6] [--dpr=1.5]

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
import { lodScale } from '../src/lib/ui/lod'
import { trackFeatures } from '../src/lib/ui/perf-shots'
import {
  groundOps, isGroup, sceneryScene, structureShadowGroups,
  type DrawOp, type SceneItem, type SceneMark,
} from '../src/lib/ui/scenery-draw'

const VIEW_W = 1600
const VIEW_H = 900
const CULL_MARGIN = 1.45
const argv = process.argv.slice(2)
const num = (flag: string, dflt: number) =>
  Number(argv.find((a) => a.startsWith(`--${flag}=`))?.split('=')[1] ?? dflt)
const PXM = num('pxm', 6)
const DPR = num('dpr', 1.5)
const VIEWPORT_MPX = (VIEW_W * DPR * VIEW_H * DPR) / 1e6

const ids = argv.filter((a) => !a.startsWith('--'))
if (ids.length === 0) ids.push(...Object.keys(TRACK_LAYOUTS).sort())

type Pt = [number, number]
interface Box { x0: number; y0: number; x1: number; y1: number }

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

/** Subpaths as point runs. Everything the scene emits is M/L with the odd Q, whose control point is
 *  skipped: it moves an endpoint by less than the tolerance this probe already carries. */
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

/** On-screen area of one op, in square viewBox units. */
function opArea(op: DrawOp, box: Box, at: (p: Pt) => Pt): number {
  let area = 0
  for (const raw of subpaths(op.d)) {
    const pts = raw.map(at)
    if (op.stroke) {
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
      const seen = bbox > 0 ? overlap({ x0, y0, x1, y1 }, box) / bbox : 0
      area += Math.abs(shoelace / 2) * seen
    }
  }
  return area
}

/** The op's own ink extent in world units: what a TIGHT viewport test would be asked, against the
 *  padded cull disc the renderer asks today. */
function inkBox(op: DrawOp, at: (p: Pt) => Pt): Box | null {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const raw of subpaths(op.d)) {
    for (const p of raw) {
      const [x, y] = at(p)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x0 > x1) return null
  const grow = op.stroke ? (op.width ?? 1) / 2 : 0
  return { x0: x0 - grow, y0: y0 - grow, x1: x1 + grow, y1: y1 + grow }
}

/** What the op REACHES ACROSS inside the viewport, and the same weighted by the edges that reach.
 *
 *  The right measure when a section costs main-thread time and paints almost no pixels: a rasteriser
 *  sets a non-convex path up over the whole area it reaches and pays for that whether or not the
 *  covered pixels survive. Per SUBPATH, since a swept hull is a ring plus a quad per wall and each is
 *  set up on its own. Straight out of frame-fill-check's `opExtent`. */
function opReach(op: DrawOp, box: Box, at: (p: Pt) => Pt): { ext: number; fan: number } {
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

const callsOf = (op: DrawOp) => (op.fill ? 1 : 0) + (op.stroke ? 1 : 0)

console.log(`Close shot at ${PXM} px/m, viewport ${VIEW_W}x${VIEW_H} dpr ${DPR}: `
  + `one surface clear writes ${VIEWPORT_MPX.toFixed(2)} Mpx`)
console.log(`${ids.length} layouts, camera on each circuit's tightest corner (what the close shot aims at)\n`)

const groundRows: Array<{ id: string; calls: number; mpx: number }> = []
const shadowRows: Array<{
  id: string; calls: number; mpx: number; ext: number; fan: number
  struct: number; blind: number; structExt: number
  grove: number; groveExt: number
  fence: number; fenceExt: number; fenceFan: number; fenceBlind: number
  padCalls: number; hullCalls: number
}> = []

for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) { console.log(`${id}: unknown layout`); continue }
  const u = (m: number) => m / layout.metresPerUnit
  const pad = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const vb = { x: vx - pad, y: vy - pad, w: vw + 2 * pad, h: vh + 2 * pad }
  const ppu = Math.min(VIEW_W / vb.w, VIEW_H / vb.h)
  const zoom = (PXM * layout.metresPerUnit) / ppu
  const k = zoom * ppu
  const pxPerUnit2 = (k * DPR) ** 2
  // The ladder reads the BUCKET's representative scale, never the live one; the lab's baseline is
  // quality medium, which is a multiplier of 1.
  const pxPerM = lodScale(PXM)
  const quality = 1

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
  const track = roadOps({
    layout,
    u,
    pitZone,
    lap: { pts: solved.pts, lateral: solved.lateral, centre, dyn },
    ground: scenery.base,
    shadow: shadowFill(lighting),
    inkFull: true,
    // OFF, like the renderer's own flag: a probe that draws what the map does not is measuring a
    // frame nobody sees.
    surfaceInk: false,
  })
  const pitUnder = pitZone ? pitFloorOps(pitZone, lighting, () => '#888888') : []
  const pitOver = pitZone ? pitComplexOps(pitZone, u, lighting, viewAz, () => '#888888') : []
  const pitPts = pitZone ? [...pitZone.buildingPts, ...pitZone.garageFloors.flat()] : []
  const pitDisc = pitPts.length > 0 ? (() => {
    const xs = pitPts.map((p) => p.x)
    const ys = pitPts.map((p) => p.y)
    const bx = (Math.min(...xs) + Math.max(...xs)) / 2
    const by = (Math.min(...ys) + Math.max(...ys)) / 2
    return { cx: bx, cy: by, r: Math.max(...pitPts.map((p) => Math.hypot(p.x - bx, p.y - by))) + u(80) }
  })() : null

  // The shot's own aim. `at` takes a lap FRACTION, which is what `trackFeatures` and the shots walk
  // in; the arc walks the densified centreline by length, as the live map's getPointAtLength does.
  const at = (f: number) => arc.at((((f % 1) + 1) % 1) * arc.length)
  const { cornerF } = trackFeatures(at, arc.length, layout.metresPerUnit, pitDisc)
  const aim = at(cornerF)
  const cx = aim.x
  const cy = aim.y

  const cull = { cx, cy, r: (Math.hypot(VIEW_W, VIEW_H) / 2 / k) * CULL_MARGIN }
  const viewR = (Math.hypot(VIEW_W, VIEW_H) / 2 / k) * 1.05
  const halfW = VIEW_W / 2 / k
  const halfH = VIEW_H / 2 / k
  const box: Box = { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH }
  const pitNear = !pitDisc || Math.hypot(pitDisc.cx - cx, pitDisc.cy - cy) <= cull.r + pitDisc.r

  // The structure shadows' own paths, so the shadows section can be split three ways: a swept hull
  // per building and grandstand, the grove's single megapath, and (in the furniture section) the
  // fence runs' shade. `hide:shadows` removes all three, so a row that names them together cannot
  // say which one it is.
  const structures = [...scenery.stands, ...scenery.buildings]
  const shadowGs = structureShadowGroups(structures, {
    u, extrude: EXTRUDE, lighting, view: viewAz, pxPerM, quality,
    heightM: (r) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
  })
  const structShadowPaths = new Set(shadowGs.flatMap((g) => g.ops.map((op) => op.d)))

  interface Tally { calls: number; mpx: number; ext: number; fan: number; blind: number }
  const zero = (): Tally => ({ calls: 0, mpx: 0, ext: 0, fan: 0, blind: 0 })
  const add = (t: Tally, op: DrawOp, place: (p: Pt) => Pt) => {
    const reach = opReach(op, box, place)
    const ib = inkBox(op, place)
    t.calls += callsOf(op)
    t.mpx += (opArea(op, box, place) * pxPerUnit2) / 1e6
    t.ext += (reach.ext * pxPerUnit2) / 1e6
    t.fan += (reach.fan * pxPerUnit2) / 1e6
    // Submitted with no ink inside the viewport at all: it is here because its group's cull disc,
    // padded by SOLID_PAD_M, still reached the view disc.
    if (ib && overlap(ib, box) <= 0) t.blind += callsOf(op)
  }

  const measure = (hide: ReadonlySet<string>) => {
    const marks: SceneMark[] = []
    const items = sceneryScene(scenery, {
      u, lighting, view: viewAz, ground: !hide.has('ground'), extrude: EXTRUDE, pxPerM, quality,
      hide,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: (r: { storeys?: number }) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
      trees: hide.has('trees')
        ? []
        : scenery.trees.filter((t) => Math.hypot(t.x - cx, t.y - cy) <= cull.r + t.r),
      cull,
      track,
      kerbs: hide.has('kerbs') ? [] : scenery.kerbs
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
      pitUnder: pitNear && !hide.has('pit') ? pitUnder : [],
      pitOver: pitNear && !hide.has('pit') ? pitOver : [],
    }, marks)

    const bySection: Record<string, Tally> = {}
    const whole = zero()
    const struct = zero()
    const grove = zero()
    let m = 0
    let section = 'setup'
    for (let i = 0; i < items.length; i++) {
      while (m < marks.length && marks[m].at === i) section = marks[m++].name
      const item: SceneItem = items[i]
      // The viewport skip drawScene applies before submitting anything.
      if (item.clip && Math.hypot(item.clip.cx - cx, item.clip.cy - cy) > viewR + item.clip.r) continue
      const ops = isGroup(item) ? item.ops : [item]
      const place: (p: Pt) => Pt = isGroup(item)
        ? (() => {
          const cos = Math.cos(item.rot)
          const sin = Math.sin(item.rot)
          return ([x, y]: Pt): Pt => [item.x + x * cos - y * sin, item.y + x * sin + y * cos]
        })()
        : (p) => p
      for (const op of ops) {
        bySection[section] = bySection[section] ?? zero()
        add(bySection[section], op, place)
        add(whole, op, place)
        if (section === 'shadows') add(structShadowPaths.has(op.d) ? struct : grove, op, place)
      }
    }
    return { whole, bySection, struct, grove }
  }

  const full = measure(new Set())
  const noShadows = measure(new Set(['shadows']))

  // What the structure shadows' disc is WORTH, both discs asked of the same shot: the padded
  // footprint each group used to carry against the hull-measured one it carries now. Both go through
  // the compose cull and then the viewport skip, which is the pair of tests a frame actually applies.
  const submitted = (disc: { cx: number; cy: number; r: number }) =>
    Math.hypot(disc.cx - cx, disc.cy - cy) <= cull.r + disc.r
    && Math.hypot(disc.cx - cx, disc.cy - cy) <= viewR + disc.r
  let padCalls = 0
  let hullCalls = 0
  // Index-wise: `structureShadowGroups` maps its input one for one, so group i is structure i.
  for (let i = 0; i < shadowGs.length; i++) {
    const g = shadowGs[i]
    if (g.ops.length === 0) continue
    const calls = g.ops.reduce((s, op) => s + callsOf(op), 0)
    const r = structures[i]
    if (submitted({ cx: r.x, cy: r.y, r: Math.hypot(r.w, r.h) / 2 + u(80) })) padCalls += calls
    if (submitted(g.clip!)) hullCalls += calls
  }
  const secMpx = Object.fromEntries(Object.entries(full.bySection).map(([n, t]) => [n, t.mpx]))
  const totalCalls = full.whole.calls
  const totalMpx = full.whole.mpx

  // ── Exactly what hide:ground removes: the ops groundOps stops emitting, nothing else ──
  const keyOf = (op: DrawOp) => `${op.d}|${op.fill ?? ''}|${op.stroke ?? ''}`
  const kept = new Set(groundOps(scenery, u, { ground: false, pxPerM, quality }).map(keyOf))
  const removed = groundOps(scenery, u, { ground: true, pxPerM, quality })
    .filter((op) => !kept.has(keyOf(op)))
    .filter((op) => !op.clip || Math.hypot(op.clip.cx - cx, op.clip.cy - cy) <= viewR + op.clip.r)
  let gCalls = 0
  let gMpx = 0
  const detail: string[] = []
  for (const op of removed) {
    const calls = callsOf(op)
    const mpx = (opArea(op, box, (p) => p) * pxPerUnit2) / 1e6
    gCalls += calls
    gMpx += mpx
    const ib = inkBox(op, (p) => p)
    const spanW = ib ? (ib.x1 - ib.x0) * k / VIEW_W : 0
    const spanH = ib ? (ib.y1 - ib.y0) * k / VIEW_H : 0
    detail.push(`${' '.repeat(18)}${(op.stroke ? 'stroke' : 'fill').padEnd(6)} `
      + `${(op.fill ?? op.stroke ?? '').padEnd(12)} alpha ${(op.alpha ?? 1).toFixed(2)}  `
      + `${mpx.toFixed(2).padStart(6)} Mpx (${(mpx / VIEWPORT_MPX).toFixed(2)}x the clear)  `
      + `spans ${spanW.toFixed(1)}x${spanH.toFixed(1)} viewports`)
  }

  // What the `hide:shadows` ROW removes, which is the shadows section plus the fence runs' shade
  // over in the furniture section.
  const rowCalls = full.whole.calls - noShadows.whole.calls
  const rowMpx = full.whole.mpx - noShadows.whole.mpx
  const rowExt = full.whole.ext - noShadows.whole.ext
  const rowFan = full.whole.fan - noShadows.whole.fan
  // The fence runs' shade, as the furniture section's own before-and-after: every field is a sum
  // over ops, so subtracting the two tallies names exactly the ops the row took out of it.
  const fu = full.bySection.furniture ?? zero()
  const fuOff = noShadows.bySection.furniture ?? zero()
  const fence: Tally = {
    calls: fu.calls - fuOff.calls, mpx: fu.mpx - fuOff.mpx, ext: fu.ext - fuOff.ext,
    fan: fu.fan - fuOff.fan, blind: fu.blind - fuOff.blind,
  }

  groundRows.push({ id, calls: gCalls, mpx: gMpx })
  shadowRows.push({
    id, calls: rowCalls, mpx: rowMpx, ext: rowExt, fan: rowFan,
    struct: full.struct.calls, blind: full.struct.blind, structExt: full.struct.ext,
    grove: full.grove.calls, groveExt: full.grove.ext,
    fence: fence.calls, fenceExt: fence.ext, fenceFan: fence.fan, fenceBlind: fence.blind,
    padCalls, hullCalls,
  })

  const top = Object.entries(secMpx).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([n, v]) => `${n} ${v.toFixed(1)}`).join('  ')
  console.log(`${id.padEnd(16)} ${String(totalCalls).padStart(4)} calls `
    + `${totalMpx.toFixed(1).padStart(6)} Mpx (${(totalMpx / VIEWPORT_MPX).toFixed(1)}x vp)  | ${top}`)
  console.log(`${' '.repeat(16)}hide:ground removes ${String(gCalls).padStart(2)} calls, `
    + `${gMpx.toFixed(2)} Mpx = ${(gMpx / VIEWPORT_MPX).toFixed(2)}x the clear`)
  for (const line of detail.slice(0, 4)) console.log(line)
  console.log(`${' '.repeat(16)}hide:shadows removes ${String(rowCalls).padStart(3)} calls, `
    + `fill ${rowMpx.toFixed(2)} Mpx, reach ${rowExt.toFixed(1)} Mpx `
    + `(${(rowExt / VIEWPORT_MPX).toFixed(1)}x vp), fan ${rowFan.toFixed(0)} Mpx-edges`)
  console.log(`${' '.repeat(18)}structures ${full.struct.calls} calls `
    + `(${full.struct.blind} blind, reach ${full.struct.ext.toFixed(1)}; `
    + `${padCalls} on the padded footprint disc against ${hullCalls} on the hull's own)  `
    + `grove ${full.grove.calls} (reach ${full.grove.ext.toFixed(1)}, fan ${full.grove.fan.toFixed(0)})  `
    + `fence runs ${fence.calls} (${fence.blind} blind, reach ${fence.ext.toFixed(1)}, `
    + `fan ${fence.fan.toFixed(0)})`)
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const gCallsAll = groundRows.map((r) => r.calls)
const gMpxAll = groundRows.map((r) => r.mpx)
console.log(`\n${'-'.repeat(100)}`)
console.log(`hide:ground over ${groundRows.length} layouts: `
  + `calls median ${med(gCallsAll)} (range ${Math.min(...gCallsAll)}-${Math.max(...gCallsAll)}), `
  + `Mpx median ${med(gMpxAll).toFixed(2)} = ${(med(gMpxAll) / VIEWPORT_MPX).toFixed(2)}x the clear`)
console.log(`hide:shadows over ${shadowRows.length} layouts: `
  + `calls median ${med(shadowRows.map((r) => r.calls))} `
  + `(range ${Math.min(...shadowRows.map((r) => r.calls))}-${Math.max(...shadowRows.map((r) => r.calls))})`)
console.log(`  fill median ${med(shadowRows.map((r) => r.mpx)).toFixed(2)} Mpx `
  + `(${(med(shadowRows.map((r) => r.mpx)) / VIEWPORT_MPX).toFixed(2)}x the clear)  |  `
  + `reach median ${med(shadowRows.map((r) => r.ext)).toFixed(1)} Mpx `
  + `(${(med(shadowRows.map((r) => r.ext)) / VIEWPORT_MPX).toFixed(1)}x the clear)  |  `
  + `fan median ${med(shadowRows.map((r) => r.fan)).toFixed(0)} Mpx-edges`)
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1e-9, b)).toFixed(0)}%`
const allExt = sum(shadowRows.map((r) => r.ext))
console.log(`  structure shadow discs: ${sum(shadowRows.map((r) => r.padCalls))} calls submitted on the `
  + `padded footprint disc, ${sum(shadowRows.map((r) => r.hullCalls))} on the hull's own `
  + `(${pct(sum(shadowRows.map((r) => r.padCalls)) - sum(shadowRows.map((r) => r.hullCalls)), sum(shadowRows.map((r) => r.padCalls)))} fewer)`)
console.log(`  structures  ${sum(shadowRows.map((r) => r.struct))} calls, `
  + `${sum(shadowRows.map((r) => r.blind))} with NO on-screen ink `
  + `(${pct(sum(shadowRows.map((r) => r.blind)), sum(shadowRows.map((r) => r.struct)))} of them), `
  + `reach ${sum(shadowRows.map((r) => r.structExt)).toFixed(0)} Mpx `
  + `(${pct(sum(shadowRows.map((r) => r.structExt)), allExt)} of the row's reach)`)
console.log(`  fence runs  ${sum(shadowRows.map((r) => r.fence))} calls, `
  + `${sum(shadowRows.map((r) => r.fenceBlind))} with NO on-screen ink, `
  + `reach ${sum(shadowRows.map((r) => r.fenceExt)).toFixed(0)} Mpx `
  + `(${pct(sum(shadowRows.map((r) => r.fenceExt)), allExt)}), `
  + `fan ${sum(shadowRows.map((r) => r.fenceFan)).toFixed(0)} Mpx-edges `
  + `(${pct(sum(shadowRows.map((r) => r.fenceFan)), sum(shadowRows.map((r) => r.fan)))})`)
console.log(`  grove       ${sum(shadowRows.map((r) => r.grove))} calls, `
  + `reach ${sum(shadowRows.map((r) => r.groveExt)).toFixed(0)} Mpx `
  + `(${pct(sum(shadowRows.map((r) => r.groveExt)), allExt)})`)
