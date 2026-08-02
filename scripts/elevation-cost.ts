// Probe: what the graded ground costs to build (#elevation). The world is built once per circuit,
// but it is built on the render path, so "once" still has to be quick.
//
// Run: npx tsx scripts/elevation-cost.ts [circuitId ...]

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { buildWorld3D } from '../src/lib/scene3d/world3d'
import { GROUND_CELL_M, NORMAL_STEP_M, terrainSheet } from '../src/lib/scene3d/terrain3d'
import { CORRIDOR_M } from '../src/lib/ui/track-scenery'
import { MOODS } from '../src/lib/ui/lighting'

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const circuits = ids.length ? ids : ['britain', 'monaco', 'belgium', 'bahrain']

const ms = (label: string, run: () => unknown) => {
  const t0 = performance.now()
  const out = run()
  console.log(`  ${label.padEnd(22)} ${(performance.now() - t0).toFixed(0).padStart(6)} ms`)
  return out
}

for (const id of circuits) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) continue
  const mpu = layout.metresPerUnit
  console.log(`\n${id}`)
  const scenery = ms('buildScenery', () => buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId, metresPerUnit: mpu, viewBox: layout.viewBox,
    pitOutside: layout.pitOutside, biome: layout.biome,
  })) as ReturnType<typeof buildScenery>
  const slots = buildPitSlots(layout, 10)
  const zone = buildPitZone(layout, slots)
  const u = (m: number) => m / mpu
  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const pad = u(CORRIDOR_M)
  const sheet = ms('terrainSheet', () => terrainSheet(scenery.elevation, {
    inner: { x0: vx - pad, y0: vy - pad, x1: vx + vw + pad, y1: vy + vh + pad },
    outer: { x0: vx - 4000, y0: vy - 4000, x1: vx + vw + 4000, y1: vy + vh + 4000 },
    cell: u(GROUND_CELL_M), sink: u(0.03),
  })) as ReturnType<typeof terrainSheet>
  console.log(`  sheet vertices         ${(sheet.getAttribute('position').count / 1000).toFixed(0).padStart(6)} k`)
  const world = ms('buildWorld3D', () => buildWorld3D({
    layout, scenery, pitZone: zone, pitSlots: slots, lap: null,
    lighting: MOODS.afternoon,
  })) as ReturnType<typeof buildWorld3D>
  console.log(`  scene triangles        ${(world.stats.triangles / 1000).toFixed(0).padStart(6)} k`)
}
