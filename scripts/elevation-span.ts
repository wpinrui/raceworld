// Probe: how much height the graded world actually carries (#elevation). The lap's own rise and
// fall, and the span of the land across the framed viewBox.
//
// Run: npx tsx scripts/elevation-span.ts [circuitId ...]

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
for (const id of ids.length ? ids : ['britain', 'monaco', 'belgium', 'bahrain', 'austria', 'japan']) {
  const l = TRACK_LAYOUTS[id]
  if (!l) continue
  const s = buildScenery(l.trace, l.pit, {
    circuitId: l.circuitId, metresPerUnit: l.metresPerUnit, viewBox: l.viewBox,
    pitOutside: l.pitOutside, biome: l.biome,
  })
  const [vx, vy, vw, vh] = l.viewBox.split(' ').map(Number)
  let lo = Infinity
  let hi = -Infinity
  for (let j = 0; j <= 48; j++) {
    for (let i = 0; i <= 48; i++) {
      const h = s.elevation.at(vx + (vw * i) / 48, vy + (vh * j) / 48)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
    }
  }
  const m = l.metresPerUnit
  const lap = (s.elevation.trackRange.max - s.elevation.trackRange.min) * m
  console.log(`${id.padEnd(10)} ${(l.biome ?? 'temperate').padEnd(10)}`
    + ` lap rise/fall ${lap.toFixed(1).padStart(6)} m    land across the view ${((hi - lo) * m).toFixed(1).padStart(6)} m`)
}
