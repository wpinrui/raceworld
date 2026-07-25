// Probe: per-frame cost audit of the canvas scenery renderer at racing zoom.
//
// drawScene walks every op in the scene each camera frame. "pat/frame" and "grad/frame" count the
// paint lookups that walk makes — each one was a fresh DOM <canvas>-plus-CanvasPattern or a fresh
// CanvasGradient before scenery-paint.ts grew its caches, and with the caches they are what the
// caches absorb. Dash cycles are what setLineDash makes the rasteriser expand per frame.
// Canvas raster time itself needs a browser, so this counts work instead of timing paint.
//
// Also timed: the sceneryScene rebuild that runs on every cull commit (the zoom stutter), with the
// full tree set versus the disc-culled set the renderer feeds it.
// Run: npx tsx scripts/canvas-cost-check.ts

import { performance } from 'node:perf_hooks'
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery, KERB_BLOCK_M, KERB_WIDTH_M } from '../src/lib/ui/track-scenery'
import { TARMAC_WIDTH_M, TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { EXTRUDE } from '../src/components/race/SceneryLayer'
import { pitComplexOps, pitFloorOps } from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone, pitViewAzimuth } from '../src/lib/ui/pit-zone'
import { MOODS, screenUpAzimuth } from '../src/lib/ui/lighting'
import { sceneryScene, type DrawOp } from '../src/lib/ui/scenery-draw'

// Mirrors RaceTrackMap: a 1600x900 stage, racing zoom 20x, camera parked on the S/F line,
// cull disc from updateCull (CULL_MARGIN 1.45). Bearing 0 — the counts do not depend on it.
const VIEW_W = 1600
const VIEW_H = 900
const RACE_Z = 20
const CULL_MARGIN = 1.45
const GRADIENTS = new Set(['tm-tree0', 'tm-tree1', 'tm-bevel', 'tm-rake', 'tm-rake-flip'])
const TILES = new Set(['tm-seats', 'tm-crowd', 'tm-roof', 'tm-crop', 'tm-water'])

/** Chord-sum length of a path's coordinate stream. Q control points are skipped, so curved runs
 *  come out a few percent short — fine for a cost count, wrong for geometry. */
function pathLen(d: string): number {
  let len = 0
  let x = 0; let y = 0; let started = false
  const re = /([MLQTZz])|(-?\d+(?:\.\d+)?)/g
  let cmd = ''
  const nums: number[] = []
  let m: RegExpExecArray | null
  const flush = () => {
    if (cmd === 'M' && nums.length >= 2) { x = nums[0]; y = nums[1]; started = true }
    if (cmd === 'L' && nums.length >= 2) {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        if (started) len += Math.hypot(nums[i] - x, nums[i + 1] - y)
        x = nums[i]; y = nums[i + 1]; started = true
      }
    }
    if ((cmd === 'Q' || cmd === 'T') && nums.length >= 2) {
      const step = cmd === 'Q' ? 4 : 2
      for (let i = 0; i + step - 1 < nums.length; i += step) {
        const ex = nums[i + step - 2]; const ey = nums[i + step - 1]
        if (started) len += Math.hypot(ex - x, ey - y)
        x = ex; y = ey
      }
    }
    nums.length = 0
  }
  while ((m = re.exec(d))) {
    if (m[1]) { flush(); cmd = m[1].toUpperCase() } else nums.push(Number(m[2]))
  }
  flush()
  return len
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const ids = Object.keys(TRACK_LAYOUTS).sort()
console.log(`Canvas per-frame cost at racing zoom (${RACE_Z}x, ${VIEW_W}x${VIEW_H}) over ${ids.length} layouts`)
console.log('"pat/frame" = DOM canvases + CanvasPatterns built per frame at HEAD; "grad/frame" = CanvasGradients.')
console.log('"rebuild" = sceneryScene ms (median/worst of 30) with all trees (HEAD) vs disc-culled trees.\n')
console.log('circuit             ops  pat/frame  grad/frame  dashOps  dashCycles  |  rebuild all      culled   trees all->cull')
console.log('-'.repeat(118))

const totals = { pats: 0, grads: 0, cycles: 0 }
for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  const u = (m: number) => m / layout.metresPerUnit
  // The same padded viewBox RaceTrackMap derives — the authored one hugs the racing line.
  const pad = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const vb = { x: vx - pad, y: vy - pad, w: vw + 2 * pad, h: vh + 2 * pad }
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: layout.metresPerUnit,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
  })
  const lighting = { ...MOODS.afternoon, azimuth: pitViewAzimuth(layout) ?? MOODS.afternoon.azimuth }
  const viewAz = screenUpAzimuth(0)
  const pitSlots = buildPitSlots(layout, 10)
  const pitZone = buildPitZone(layout, pitSlots)

  // The cull disc updateCull would commit with the camera on the S/F line at racing zoom.
  const ppu = Math.min(VIEW_W / vb.w, VIEW_H / vb.h)
  const disc = {
    cx: layout.start.x,
    cy: layout.start.y,
    r: (Math.hypot(VIEW_W, VIEW_H) / 2 / RACE_Z / ppu) * CULL_MARGIN,
  }
  const visibleKerbs = scenery.kerbs.filter((k) => Math.hypot(k.cx - disc.cx, k.cy - disc.cy) <= disc.r + k.r)
  const culledTrees = scenery.trees.filter((t) => Math.hypot(t.x - disc.cx, t.y - disc.cy) <= disc.r + t.r)

  const trackOps: DrawOp[] = [
    { d: `M ${vb.x - 4000} ${vb.y - 4000} h ${vb.w + 8000} v ${vb.h + 8000} h ${-(vb.w + 8000)} Z`, fill: scenery.base },
    { d: layout.d, stroke: '#D8D8D2', width: u(TRACK_WIDTH_M) },
    { d: layout.pit.fastD, stroke: '#D8D8D2', width: u(5.5), cap: 'round' },
    { d: layout.d, stroke: '#33383E', width: u(TARMAC_WIDTH_M) },
    { d: layout.pit.fastD, stroke: '#33383E', width: u(4.2), cap: 'round' },
  ]
  const kerbOps: DrawOp[] = visibleKerbs.flatMap((k) => [
    { d: k.d, stroke: '#E6E3DC', width: u(KERB_WIDTH_M), cap: 'round' as const },
    {
      d: k.d, stroke: '#C8352F', width: u(KERB_WIDTH_M), cap: 'butt' as const,
      dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 },
    },
  ])
  // Pit ops are memoised separately in RaceTrackMap and never rebuilt on a cull commit, so they are
  // built once here too — the rebuild timing below has to measure what a commit actually re-runs.
  const pitUnder = pitZone ? pitFloorOps(pitZone, lighting, () => '#888888') : []
  const pitOver = pitZone ? pitComplexOps(pitZone, u, lighting, viewAz, () => '#888888') : []
  const opts = (trees: typeof scenery.trees) => ({
    u, lighting, view: viewAz, full: true, ground: true, extrude: EXTRUDE,
    storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
    marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4, tyreM: 1.5,
    solidHeightM: (r: { storeys?: number }) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
    trees,
    track: trackOps,
    kerbs: kerbOps,
    pitUnder,
    pitOver,
  })

  const items = sceneryScene(scenery, opts(scenery.trees))
  const allOps = items.flatMap((i) => ('ops' in i ? i.ops : [i]))
  let pats = 0
  let grads = 0
  let dashOps = 0
  let cycles = 0
  for (const op of allOps) {
    for (const paint of [op.fill, op.stroke]) {
      if (!paint?.startsWith('ref:')) continue
      const name = paint.slice(4)
      if (TILES.has(name)) pats++
      if (GRADIENTS.has(name)) grads++
    }
    if (op.dash) {
      dashOps++
      cycles += pathLen(op.d) / (op.dash.on + op.dash.off)
    }
  }

  const timeIt = (trees: typeof scenery.trees) => {
    const xs: number[] = []
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now()
      sceneryScene(scenery, opts(trees))
      xs.push(performance.now() - t0)
    }
    return { med: median(xs), max: Math.max(...xs) }
  }
  const full = timeIt(scenery.trees)
  const culled = timeIt(culledTrees)

  totals.pats += pats
  totals.grads += grads
  totals.cycles += cycles
  console.log(
    `${id.padEnd(18)} ${String(allOps.length).padStart(5)} ${String(pats).padStart(9)} `
    + `${String(grads).padStart(11)} ${String(dashOps).padStart(8)} ${String(Math.round(cycles)).padStart(11)}  |  `
    + `${full.med.toFixed(1).padStart(6)}/${full.max.toFixed(1).padStart(5)}  ${culled.med.toFixed(1).padStart(6)}/${culled.max.toFixed(1).padStart(5)}`
    + `   ${String(scenery.trees.length).padStart(5)}->${culledTrees.length}`,
  )
}

console.log('-'.repeat(118))
console.log(
  `TOTALS/frame at HEAD  patterns rebuilt ${totals.pats}  gradients allocated ${totals.grads}  `
  + `dash cycles expanded ${Math.round(totals.cycles)}`,
)
// Cull commits over a zoom gesture: r scales with 1/z and commits every 30% change (CULL_SLACK),
// each one a React re-render plus the "rebuild all" time above.
const commits = (z0: number, z1: number) => Math.ceil(Math.abs(Math.log(z1 / z0)) / Math.log(1.3))
console.log(
  `Zoom gesture cull commits (each = React re-render + scene rebuild): `
  + `${RACE_Z}x->0.6x ${commits(RACE_Z, 0.6)}, ${RACE_Z}x->60x ${commits(RACE_Z, 60)}`,
)
