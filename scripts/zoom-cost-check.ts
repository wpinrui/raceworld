// Probe: what a ZOOM GESTURE costs the 2D map, which is the one camera move that rebuilds geometry.
//
// The detail ladder (lib/ui/lod.ts) decides how much of each object is drawn from how many screen pixels
// it covers, so crossing a rung boundary changes the picture and the scene has to be recomposed. A wheel
// notch is 1.18x and the rungs are keyed in half-octaves, so a boundary falls about every second notch:
// a player zooming out to find the field and back in to watch a car crosses a dozen of them each way.
// Every one of those is a synchronous rebuild, and it lands in a frame.
//
// So this walks the camera notch by notch along the path a player actually drives, composes on exactly
// the commits the renderer would commit on, and reports the worst single compose — the frame the stutter
// lives in. Also reported: how many of the composed ops survive the per-frame viewport skip, since the
// renderer is draw-call bound and that is the number a frame pays.
//
// Canvas raster time itself needs a browser (use the in-game `n` benchmark for that); this counts and
// times the work the main thread does before the rasteriser sees anything.
//
// Run: npm run zoom:check  [circuit...]

import { performance } from 'node:perf_hooks'
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery, KERB_BLOCK_M, KERB_WIDTH_M } from '../src/lib/ui/track-scenery'
import { TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { EXTRUDE } from '../src/components/race/SceneryLayer'
import { pitComplexOps, pitFloorOps } from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone, pitViewAzimuth } from '../src/lib/ui/pit-zone'
import { MOODS, screenUpAzimuth } from '../src/lib/ui/lighting'
import { sceneryScene, type DrawOp, type SceneItem } from '../src/lib/ui/scenery-draw'
import { QUALITY, lodBucket, lodScale } from '../src/lib/ui/lod'

// Mirrors RaceTrackMap: a 1600x900 viewport, the wheel's own step, and the zoom limits the camera
// clamps to. Bearing 0 — nothing here depends on it.
const VIEW_W = 1600
const VIEW_H = 900
const CULL_MARGIN = 1.45
const ZOOM_STEP = 1.18
const ZOOM_MIN = 0.6
const ZOOM_MAX = 60
const RACE_Z = 20

const flatten = (items: SceneItem[]): DrawOp[] => items.flatMap((i) => ('ops' in i ? i.ops : [i]))

const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const circuits = ids.length ? ids : Object.keys(TRACK_LAYOUTS).sort()

console.log(`Zoom gesture through the detail ladder: ${RACE_Z}x -> ${ZOOM_MIN}x -> ${RACE_Z}x -> ${ZOOM_MAX}x -> ${RACE_Z}x`)
console.log('One compose per notch that crosses a rung boundary, which is what the renderer recomposes on.')
console.log('"worst" is the longest single compose in the sweep. "drawn" is composed ops that survive the')
console.log('viewport skip at racing zoom, meaned over 40 shots round the lap.\n')
console.log('circuit            composes    total ms   worst ms    mean ms  |  ops at 20x   drawn')
console.log('-'.repeat(86))

const worstOf: Array<{ id: string; worst: number }> = []
for (const id of circuits) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) { console.log(`${id}: no such layout`); continue }
  const u = (m: number) => m / layout.metresPerUnit
  // The same padded viewBox RaceTrackMap derives: the authored one hugs the racing line.
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
  const pitZone = buildPitZone(layout, buildPitSlots(layout, 10))
  // The stage letterboxes to the viewBox's aspect, exactly as the fit layout effect does.
  const ppu = Math.floor(vb.w * Math.min(VIEW_W / vb.w, VIEW_H / vb.h)) / vb.w
  // Memoised in RaceTrackMap and never rebuilt by a camera move, so built once here too.
  const pitUnder = pitZone ? pitFloorOps(pitZone, lighting, () => '#888888') : []
  const pitOver = pitZone ? pitComplexOps(pitZone, u, lighting, viewAz, () => '#888888') : []

  const composeAt = (z: number, cx = layout.start.x, cy = layout.start.y) => {
    const disc = { cx, cy, r: (Math.hypot(VIEW_W, VIEW_H) / 2 / z / ppu) * CULL_MARGIN }
    const trees = scenery.trees.filter((t) => Math.hypot(t.x - disc.cx, t.y - disc.cy) <= disc.r + t.r)
    const kerbs = scenery.kerbs
      .filter((k) => Math.hypot(k.cx - disc.cx, k.cy - disc.cy) <= disc.r + k.r)
      .flatMap((k): DrawOp[] => {
        const clip = { cx: k.cx, cy: k.cy, r: k.r + u(KERB_WIDTH_M) }
        return [
          { d: k.d, stroke: '#E6E3DC', width: u(KERB_WIDTH_M), cap: 'round', clip },
          {
            d: k.d, stroke: '#C8352F', width: u(KERB_WIDTH_M), cap: 'butt',
            dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 }, clip,
          },
        ]
      })
    return sceneryScene(scenery, {
      u, lighting, view: viewAz, ground: true, extrude: EXTRUDE,
      // Through the bucket's own representative scale, never the live one — the renderer does the same,
      // so a rung is a pure function of the bucket and flips at the same place in both directions.
      pxPerM: lodScale(ppu * z / layout.metresPerUnit), quality: QUALITY.medium,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: (r) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
      trees, cull: disc, track: [], kerbs, pitUnder, pitOver,
    })
  }

  // The zoom path a player drives: out to find the field, back to racing, in to the limit, back again.
  const path: number[] = []
  let z = RACE_Z
  const walk = (to: number) => {
    while (Math.abs(z - to) > 1e-6) {
      z = to < z ? Math.max(to, z / ZOOM_STEP) : Math.min(to, z * ZOOM_STEP)
      path.push(z)
    }
  }
  walk(ZOOM_MIN); walk(RACE_Z); walk(ZOOM_MAX); walk(RACE_Z)

  composeAt(RACE_Z) // as a live map already is, before the gesture starts
  const ms: number[] = []
  let bucket = lodBucket(ppu * RACE_Z / layout.metresPerUnit)
  for (const zz of path) {
    const b = lodBucket(ppu * zz / layout.metresPerUnit)
    if (b === bucket) continue
    bucket = b
    const t0 = performance.now()
    composeAt(zz)
    ms.push(performance.now() - t0)
  }
  const total = ms.reduce((s, v) => s + v, 0)
  const worst = ms.length ? Math.max(...ms) : 0
  worstOf.push({ id, worst })

  // What a frame actually submits: composed against the cull disc, then skipped per item against the
  // viewport, which is exactly the pair of gates drawScene sits behind.
  const stations = layout.trace
  const shots = 40
  let composed = 0
  let drawn = 0
  const viewR = (Math.hypot(VIEW_W, VIEW_H) / 2 / RACE_Z / ppu) * 1.05
  for (let i = 0; i < shots; i++) {
    const [sx, sy] = stations[Math.floor((i / shots) * stations.length)]
    const items = composeAt(RACE_Z, sx, sy)
    composed += flatten(items).length
    for (const it of items) {
      const c = it.clip
      if (!c || Math.hypot(c.cx - sx, c.cy - sy) <= viewR + c.r) {
        drawn += 'ops' in it ? it.ops.length : 1
      }
    }
  }
  console.log(
    `${id.padEnd(18)} ${String(ms.length).padStart(8)} ${total.toFixed(1).padStart(11)} `
    + `${worst.toFixed(1).padStart(10)} ${(total / Math.max(1, ms.length)).toFixed(2).padStart(10)}  |  `
    + `${(composed / shots).toFixed(0).padStart(10)} ${(drawn / shots).toFixed(0).padStart(7)}`,
  )
}

if (worstOf.length > 1) {
  console.log('-'.repeat(86))
  const heaviest = [...worstOf].sort((a, b) => b.worst - a.worst).slice(0, 5)
  console.log(`Heaviest single compose: ${heaviest.map((w) => `${w.id} ${w.worst.toFixed(1)}ms`).join(', ')}`)
}
