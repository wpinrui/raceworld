// Probe: how coarse can the ground grid be? (#elevation)
//
// The ground is a tessellated sheet, so between its vertices it is a CHORD across whatever the
// elevation function actually does. The road lies two millimetres above that sheet. If the chord
// error at a given cell size is bigger than the lift, the grass renders through the tarmac, so the
// cell size is not a look decision, it is a correctness one.
//
// Reports, per circuit and per candidate cell size: the worst and the 99th-percentile gap between
// the exact surface and the sheet, in millimetres, over the corridor where all the curvature is.
//
// Run: npx tsx scripts/elevation-grid.ts [circuitId ...]

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { densifyTrace } from '../src/lib/ui/track-path'
import { makePolylineIndex } from '../src/lib/ui/geom'

const CELLS_U = [1, 2, 4, 8, 16, 32]
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const circuits = ids.length ? ids : ['britain', 'monaco', 'belgium', 'bahrain']

/** Bilinear read of the sheet's four corners, which is exactly what the rasteriser interpolates. */
function chord(
  at: (x: number, y: number) => number, x0: number, y0: number, c: number, fx: number, fy: number,
): number {
  const a = at(x0, y0)
  const b = at(x0 + c, y0)
  const d = at(x0, y0 + c)
  const e = at(x0 + c, y0 + c)
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy
}

for (const id of circuits) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) {
    console.log(`${id}: no such layout`)
    continue
  }
  const mpu = layout.metresPerUnit
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId, metresPerUnit: mpu, viewBox: layout.viewBox,
    pitOutside: layout.pitOutside, biome: layout.biome,
  })
  const slots = buildPitSlots(layout, 10)
  void buildPitZone(layout, slots)
  const { at, trackRange } = scenery.elevation
  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)

  console.log(`\n${id}  (${mpu.toFixed(2)} m/unit, track relief `
    + `${((trackRange.max - trackRange.min) * mpu).toFixed(1)} m)`)
  // Distance to the circuit, so the error can be reported for the band that actually matters. The
  // road and its kerbs live inside the shelf, where the surface is flat across and only the
  // profile's own curvature along the lap can bend it; everything past that is grass and run-off.
  const centreline = densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y }))
  const track = makePolylineIndex(centreline, 40 / mpu)
  const SHELF_U = 10 / mpu

  for (const c of CELLS_U) {
    const onShelf: number[] = []
    const beyond: number[] = []
    // Walk the viewBox, which is where the circuit and its whole graded corridor live. Sample each
    // cell off its corners at points a linear patch is worst at.
    for (let y = vy; y < vy + vh; y += c) {
      for (let x = vx; x < vx + vw; x += c) {
        for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.5, 0.25], [0.25, 0.25]] as const) {
          const px = x + fx * c
          const py = y + fy * c
          const mm = Math.abs(at(px, py) - chord(at, x, y, c, fx, fy)) * mpu * 1000
          ;(track.dist({ x: px, y: py }) <= SHELF_U ? onShelf : beyond).push(mm)
        }
      }
    }
    const band = (xs: number[]) => {
      if (xs.length === 0) return '        n/a'
      xs.sort((p, q) => p - q)
      return `${xs[xs.length - 1].toFixed(1).padStart(8)} mm`
    }
    const quads = Math.ceil(vw / c) * Math.ceil(vh / c)
    console.log(`  cell ${String(c).padStart(2)}u (${(c * mpu).toFixed(0).padStart(3)} m):`
      + `  under the road ${band(onShelf)}   off it ${band(beyond)}`
      + `   ${(quads / 1000).toFixed(0)}k quads`)
  }

  // Cross-fall: how far from level the racing surface is ACROSS its width. The soft projection buys
  // continuity at the price of exactness here, and the price has to be small next to the two percent
  // camber a real road is built with.
  let fall = 0
  const halfW = 6.65 / mpu
  for (let i = 0; i < centreline.length; i++) {
    const a = centreline[i]
    const b = centreline[(i + 1) % centreline.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    fall = Math.max(fall, Math.abs(
      at(a.x + nx * halfW, a.y + ny * halfW) - at(a.x - nx * halfW, a.y - ny * halfW),
    ) * mpu)
  }
  console.log(`  worst cross-fall across the 13.3 m surface: ${(fall * 1000).toFixed(1)} mm`
    + ` (${((fall / 13.3) * 100).toFixed(3)} %, against a real road's ~2 %)`)

  // Where the worst of it lives, and whether it is a STEP. A chord error that shrinks with the cell
  // is sampling; one that does not is a discontinuity in the surface itself, and no grid fixes that.
  let peak = { x: 0, y: 0, step: 0 }
  const probe = 0.01
  for (let y = vy; y < vy + vh; y += 1) {
    for (let x = vx; x < vx + vw; x += 1) {
      const step = Math.max(
        Math.abs(at(x + probe, y) - at(x - probe, y)),
        Math.abs(at(x, y + probe) - at(x, y - probe)),
      )
      if (step > peak.step) peak = { x, y, step }
    }
  }
  console.log(`  steepest 2cm step: ${(peak.step * mpu * 1000).toFixed(1)} mm at `
    + `(${peak.x.toFixed(0)}, ${peak.y.toFixed(0)})`)
}
