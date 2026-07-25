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
import {
  PitBuilding, PitBuildingShadow, PitGarageFloors, PitGarageSigns,
} from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone, pitViewAzimuth } from '../src/lib/ui/pit-zone'
import { MOODS, type Mood } from '../src/lib/ui/lighting'
import { densifyTrace } from '../src/lib/ui/track-path'
import { CarSprite } from '../src/components/race/CarSprite'
import { CAR_LENGTH_M, CAR_SCALE, SPRITE, carAttitude, carLight } from '../src/lib/ui/car-sprite'
import { PROFILE_N, lapDynamics, sampleLap, trackPhysics } from '../src/lib/ui/lap-dynamics'
import type { Lighting } from '../src/lib/ui/lighting'
import type { TrackLayout } from '../src/data/tracks'


const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const low = argv.includes('--low')
const terrainDetail = argv.includes('--terrain')
const detail = low ? 'low' : 'full'
const moodArg = (argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon') as Mood
const mood = MOODS[moodArg] ?? MOODS.afternoon
// Crop to a fraction of the viewBox around a normalised centre, so detail that only exists at
// racing zoom (glazing, kerb faces, tyre stacks) can actually be judged from a still.
const zoom = Number(argv.find((a) => a.startsWith('--zoom='))?.split('=')[1] ?? 1)
const [cxf, cyf] = (argv.find((a) => a.startsWith('--at='))?.split('=')[1] ?? '0.5,0.5').split(',').map(Number)
// Cars round the lap, each at its real heading, so the contact shadow and the world-locked sheen can
// be checked at every angle at once -- which is the only way to tell whether they are locked to the
// world or just painted on the sprite.
const carsArg = argv.find((a) => a === '--cars' || a.startsWith('--cars='))
const carCount = carsArg ? Number(carsArg.split('=')[1] ?? 12) : 0
const named = argv.filter((a) => !a.startsWith('--'))
const ids = named.length ? named : ['britain', 'monaco', 'belgium', 'bahrain']

const LIVERIES = ['#E8442E', '#2F7BE8', '#F2C230', '#39B26A', '#B565E0', '#E8792E', '#39C4C4', '#E85BA0']

/** Resample a closed polyline to `n` points of equal arc length: what the profile physics assumes. */
function equalArc(pts: { x: number; y: number }[], n: number) {
  const cum = [0]
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i % pts.length]
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const len = cum[pts.length]
  const out: { x: number; y: number }[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const target = (i / n) * len
    while (j < pts.length - 1 && cum[j + 1] < target) j++
    const a = pts[j]
    const b = pts[(j + 1) % pts.length]
    const seg = cum[j + 1] - cum[j] || 1
    const f = (target - cum[j]) / seg
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
  }
  return { pts: out, len }
}

/** The cars, strung round the CENTRELINE (the solved racing line needs the browser's path API) and
 *  leaning exactly as much as the lap's own dynamics say they should at that point. */
function carsMarkup(layout: TrackLayout, lighting: Lighting, n: number): string[] {
  const dense = densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y }))
  const { pts, len } = equalArc(dense, PROFILE_N)
  const dyn = lapDynamics(pts, len, trackPhysics(layout.metresPerUnit))
  const light = carLight(lighting)
  const carLen = (CAR_LENGTH_M * CAR_SCALE) / layout.metresPerUnit
  const scale = carLen / SPRITE.len
  return Array.from({ length: n }, (_, i) => {
    const frac = i / n
    const st = Math.round(frac * PROFILE_N) % PROFILE_N
    const here = pts[st]
    const ahead = pts[(st + 2) % PROFILE_N]
    const spriteRot = Math.atan2(ahead.y - here.y, ahead.x - here.x) + Math.PI / 2
    const attitude = carAttitude(sampleLap(dyn.lat, frac), sampleLap(dyn.long, frac))
    const sprite = renderToStaticMarkup(createElement(CarSprite, {
      id: `p${i}`, color: LIVERIES[i % LIVERIES.length], length: SPRITE.len, light, spriteRot, attitude,
    }))
    // The sprite is its own <svg>, and a nested one CLIPS to its viewBox, which would cut the contact
    // shadow's tail off. So it goes in as a <g> instead, scaled from sprite units into track units.
    const body = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
    return `<g transform="translate(${here.x} ${here.y}) rotate(${(spriteRot * 180) / Math.PI}) `
      + `scale(${scale}) translate(${-SPRITE.cx} ${-SPRITE.cy})">${body}</g>`
  })
}

mkdirSync(OUT, { recursive: true })

async function main() {
for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) {
    console.log(`${id}: no such layout`)
    continue
  }
  // Same standardised bearing the map uses, or the preview would not be checking what ships.
  const az = pitViewAzimuth(layout)
  const lighting = az === null ? mood : { ...mood, azimuth: az }
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
    renderToStaticMarkup(createElement(SceneryShadowLayer, { scenery, u, lighting, view: az ?? mood.azimuth, detail })),
    renderToStaticMarkup(createElement(ScenerySolidsLayer, { scenery, u, lighting, view: az ?? mood.azimuth, detail })),
    renderToStaticMarkup(createElement(TrackFurnitureLayer, { scenery, u, lighting, view: az ?? mood.azimuth, detail })),
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
        renderToStaticMarkup(createElement(PitGarageFloors, { zone, lighting })),
        renderToStaticMarkup(createElement(PitBuildingShadow, { zone, u, lighting })),
        renderToStaticMarkup(createElement(PitBuilding, { zone, u, lighting, view: az ?? mood.azimuth })),
        renderToStaticMarkup(createElement(PitGarageSigns, {
          zone, u, lighting, view: az ?? mood.azimuth,
          drivers: () => [
            { name: 'Kimi Raikkonen', nationality: 'FI' },
            { name: 'Felipe Massa', nationality: 'BR' },
          ],
        })),
      ]
    })(),
    // Last: the cars sit on top of the world, as they do in the map.
    ...(carCount > 0 ? carsMarkup(layout, lighting, carCount) : []),
  ].join('\n')

  // Fixed output width whatever the zoom, so a hard crop is actually inspectable rather than
  // shrinking with the region it selects.
  const outW = Math.round(Math.max(vb.w * 2, 900))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${outW}" height="${Math.round((outW * vb.h) / vb.w)}">${body}</svg>`
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
