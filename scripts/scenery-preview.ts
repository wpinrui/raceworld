// Probe: rasterise the real scenery components for a few circuits so the world can be eyeballed
// without starting the app. Mirrors the draw order RaceTrackMap uses (ground, scenery, track
// ribbon, kerbs, furniture). Follows scripts/team-colours-preview.ts: emit a static artefact to
// look at before merging.
// Run: npx tsx scripts/scenery-preview.ts [--low] [--terrain] [--mood=afternoon|midday|dusk|overcast|night] [circuitId ...]
// --low renders the zoom-out LOD tier, which is the one that has regressed performance before.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { TARMAC_WIDTH_M, TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { SceneryLayer, SceneryShadowLayer, ScenerySolidsLayer, TrackFurnitureLayer } from '../src/components/race/SceneryLayer'
import { PitBuilding, PitBuildingDefs, PitBuildingShadow } from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { MOODS, type Mood } from '../src/lib/ui/lighting'


const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const low = argv.includes('--low')
const terrainDetail = argv.includes('--terrain')
const detail = low ? 'low' : 'full'
const moodArg = (argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon') as Mood
const lighting = MOODS[moodArg] ?? MOODS.afternoon
// Crop to a fraction of the viewBox around a normalised centre, so detail that only exists at
// racing zoom (glazing, kerb faces, tyre stacks) can actually be judged from a still.
const zoom = Number(argv.find((a) => a.startsWith('--zoom='))?.split('=')[1] ?? 1)
const [cxf, cyf] = (argv.find((a) => a.startsWith('--at='))?.split('=')[1] ?? '0.5,0.5').split(',').map(Number)
const named = argv.filter((a) => !a.startsWith('--'))
const ids = named.length ? named : ['britain', 'monaco', 'belgium', 'bahrain']

mkdirSync(OUT, { recursive: true })

async function main() {
for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) {
    console.log(`${id}: no such layout`)
    continue
  }
  const mpu = layout.metresPerUnit
  const u = (m: number) => m / mpu
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: mpu,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
    terrainDetail,
  })

  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const m = TRACK_WIDTH_M / mpu / 2 + 8
  const full = { x: vx - m, y: vy - m, w: vw + 2 * m, h: vh + 2 * m }
  const vb = zoom > 1
    ? {
      x: full.x + full.w * cxf - full.w / zoom / 2, y: full.y + full.h * cyf - full.h / zoom / 2,
      w: full.w / zoom, h: full.h / zoom,
    }
    : full

  const body = [
    renderToStaticMarkup(createElement('rect', {
      x: vb.x - 4000, y: vb.y - 4000, width: vb.w + 8000, height: vb.h + 8000, fill: scenery.base,
    })),
    renderToStaticMarkup(createElement(SceneryLayer, { scenery, u, lighting, detail })),
    renderToStaticMarkup(createElement('path', {
      d: layout.d, fill: 'none', stroke: '#D8D8D2', strokeWidth: u(TRACK_WIDTH_M), strokeLinejoin: 'round',
    })),
    renderToStaticMarkup(createElement('path', {
      d: layout.d, fill: 'none', stroke: '#33383E', strokeWidth: u(TARMAC_WIDTH_M), strokeLinejoin: 'round',
    })),
    ...scenery.kerbs.flatMap((k) => [
      renderToStaticMarkup(createElement('path', {
        d: k.d, fill: 'none', stroke: '#E6E3DC', strokeWidth: u(1.3), strokeLinecap: 'round',
      })),
      renderToStaticMarkup(createElement('path', {
        d: k.d, fill: 'none', stroke: '#C8352F', strokeWidth: u(1.3), strokeDasharray: `${u(3)} ${u(3)}`,
      })),
    ]),
    renderToStaticMarkup(createElement(SceneryShadowLayer, { scenery, u, lighting, detail })),
    renderToStaticMarkup(createElement(ScenerySolidsLayer, { scenery, u, lighting, detail })),
    renderToStaticMarkup(createElement(TrackFurnitureLayer, { scenery, u, lighting, detail })),
    ...(() => {
      // The pit complex, drawn from the same pure geometry the map uses, so this preview checks it
      // rather than checking the scenery alone.
      const zone = buildPitZone(layout, buildPitSlots(layout, 10))
      if (!zone) return []
      return [
        renderToStaticMarkup(createElement('path', {
          d: layout.pit.fastD, fill: 'none', stroke: '#33383E', strokeWidth: u(4.2),
          strokeLinejoin: 'round', strokeLinecap: 'round',
        })),
        renderToStaticMarkup(createElement('path', { d: zone.work, fill: '#33383E' })),
        renderToStaticMarkup(createElement('defs', {}, createElement(PitBuildingDefs, { u }))),
        renderToStaticMarkup(createElement(PitBuildingShadow, { zone, u, lighting })),
        renderToStaticMarkup(createElement(PitBuilding, { zone, u, lighting })),
      ]
    })(),
  ].join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${Math.round(vb.w * 2 * Math.min(zoom, 14))}" height="${Math.round(vb.h * 2 * Math.min(zoom, 14))}">${body}</svg>`
  const tag = `${id}${low ? '-low' : ''}${terrainDetail ? '-terrain' : ''}${moodArg === 'afternoon' ? '' : `-${moodArg}`}${zoom > 1 ? `-z${zoom}` : ''}`
  writeFileSync(`${OUT}/${tag}.svg`, svg)
  // Counted off the rendered markup, not estimated: an estimate drifts from the renderer the moment
  // the renderer changes, and a wrong performance number is worse than none.
  const els = (svg.match(/<(path|rect|circle|ellipse|g|clipPath|pattern|linearGradient|radialGradient)[ >]/g) ?? []).length
  const tfs = (svg.match(/transform="/g) ?? []).length
  const counts = `${els} elements, ${tfs} transforms; trees ${scenery.trees.length}, `
    + `stands ${scenery.stands.length}, buildings ${scenery.buildings.length}`
  try {
    await sharp(Buffer.from(svg)).png().toFile(`${OUT}/${tag}.png`)
    console.log(`${tag.padEnd(16)} ${layout.biome.padEnd(10)} ${moodArg.padEnd(9)} -> ${OUT}/${tag}.png   (${counts})`)
  } catch (err) {
    console.log(`${id.padEnd(12)} SVG written, raster failed: ${(err as Error).message}`)
  }
}
}

main()
