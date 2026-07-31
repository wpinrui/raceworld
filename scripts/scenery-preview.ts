// Probe: rasterise the world for a few circuits so it can be eyeballed without starting the app.
//
// It builds the scene through `sceneryScene` and `roadOps` — the exact calls the map makes — and maps
// each `DrawOp` to an SVG path, so what is previewed is what ships. The one thing SVG needs that the
// canvas supplies itself is the gradients and patterns a `ref:` names, which are written out below from
// the same numbers lib/ui/scenery-paint.ts builds them from.
//
// Run: npx tsx scripts/scenery-preview.ts [--terrain] [--mood=afternoon|midday|dusk|overcast|night]
//        [--zoom=N] [--at=fx,fy] [--cars[=N]] [circuitId ...]

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { KERB_BLOCK_M, KERB_WIDTH_M, buildScenery } from '../src/lib/ui/track-scenery'
import { TRACK_WIDTH_M, densifyTrace } from '../src/lib/ui/track-path'
import { PitGarageSigns, pitComplexOps, pitFloorOps } from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone, pitViewAzimuth } from '../src/lib/ui/pit-zone'
import { MOODS, shadowFill, screenUpAzimuth, type Mood } from '../src/lib/ui/lighting'
import { CarSprite } from '../src/components/race/CarSprite'
import {
  CAR_LENGTH_M, CAR_SCALE, FRONT_LEAD_M, SPRITE, carAttitude, carLight, steerAngles,
} from '../src/lib/ui/car-sprite'
import { buildRacingLine, polylineArc } from '../src/lib/ui/racing-line'
import { roadOps } from '../src/lib/ui/road-ops'
import { gridBoxOps, startLineOps } from '../src/lib/ui/road-marks'
import { isGroup, refName, sceneryScene, type DrawOp, type SceneItem } from '../src/lib/ui/scenery-draw'
import { PROFILE_N, lapDynamics, lateralG, sampleLap, trackPhysics } from '../src/lib/ui/lap-dynamics'
import type { Lighting } from '../src/lib/ui/lighting'
import type { TrackLayout } from '../src/data/tracks'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const terrainDetail = argv.includes('--terrain')
const moodArg = (argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon') as Mood
const mood = MOODS[moodArg] ?? MOODS.afternoon
// Crop to a fraction of the viewBox around a normalised centre, so detail that only exists at
// racing zoom (glazing, kerb faces, the ink worn into the tarmac) can be judged from a still.
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

const paintAttr = (v: string) => (refName(v) ? `url(#${refName(v)})` : v)

/** One draw op as an SVG path. A gradient resolves against the shape's own extent in SVG, so the op's
 *  `bbox` (which only the canvas needs) is simply ignored here. */
function opSvg(op: DrawOp): string {
  const parts = [`d="${op.d}"`, `fill="${op.fill ? paintAttr(op.fill) : 'none'}"`]
  if (op.stroke) parts.push(`stroke="${paintAttr(op.stroke)}"`, `stroke-width="${op.width ?? 1}"`)
  if (op.cap) parts.push(`stroke-linecap="${op.cap}"`)
  if (op.alpha != null) parts.push(`opacity="${op.alpha}"`)
  if (op.dash) parts.push(`stroke-dasharray="${op.dash.on} ${op.dash.off}"`, `stroke-dashoffset="${op.dash.shift}"`)
  if (op.evenOdd) parts.push('fill-rule="evenodd"')
  parts.push('stroke-linejoin="round"')
  return `<path ${parts.join(' ')} />`
}

const itemSvg = (item: SceneItem): string => (isGroup(item)
  ? `<g transform="translate(${item.x} ${item.y}) rotate(${(item.rot * 180) / Math.PI})">`
    + `${item.ops.map(opSvg).join('')}</g>`
  : opSvg(item))

/** The gradients and patterns a `ref:` names, from the same numbers the canvas builds them from. */
function defs(u: (m: number) => number, lighting: Lighting): string {
  const deg = (lighting.azimuth * 180) / Math.PI
  const dx = Math.cos(lighting.azimuth)
  const dy = Math.sin(lighting.azimuth)
  const canopy = (id: string, [a, b, c]: [string, string, string]) =>
    `<radialGradient id="${id}" fx="${0.5 - dx * 0.3}" fy="${0.5 - dy * 0.3}">`
    + `<stop offset="0%" stop-color="${a}"/><stop offset="45%" stop-color="${b}"/>`
    + `<stop offset="100%" stop-color="${c}"/></radialGradient>`
  return '<defs>'
    + `<pattern id="tm-seats" width="${u(2.4)}" height="${u(1.5)}" patternUnits="userSpaceOnUse">`
    + `<rect width="${u(2.4)}" height="${u(1.5)}" fill="#3E4552"/>`
    + `<rect y="${u(0.95)}" width="${u(2.4)}" height="${u(0.55)}" fill="#575F6E"/></pattern>`
    + `<pattern id="tm-crowd" width="${u(3.2)}" height="${u(3.2)}" patternUnits="userSpaceOnUse">`
    + `<circle cx="${u(0.7)}" cy="${u(0.8)}" r="${u(0.3)}" fill="#DC143C" opacity="0.5"/>`
    + `<circle cx="${u(2.2)}" cy="${u(1.7)}" r="${u(0.3)}" fill="#00D9FF" opacity="0.45"/>`
    + `<circle cx="${u(1.3)}" cy="${u(2.6)}" r="${u(0.3)}" fill="#E8B923" opacity="0.45"/>`
    + `<circle cx="${u(2.7)}" cy="${u(0.5)}" r="${u(0.3)}" fill="#FFFFFF" opacity="0.4"/></pattern>`
    + `<pattern id="tm-roof" width="${u(3.6)}" height="${u(3.6)}" patternUnits="userSpaceOnUse">`
    + `<rect width="${u(0.35)}" height="${u(3.6)}" fill="#000000" opacity="0.055"/>`
    + `<rect x="${u(0.35)}" width="${u(0.3)}" height="${u(3.6)}" fill="#FFFFFF" opacity="0.04"/></pattern>`
    + `<pattern id="tm-water" width="${u(9)}" height="${u(6)}" patternUnits="userSpaceOnUse">`
    + `<path d="M 0 ${u(2)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0" fill="none" stroke="#A8D4E6" stroke-width="${u(0.35)}" opacity="0.3"/>`
    + `<path d="M ${-u(2)} ${u(4.6)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0" fill="none" stroke="#A8D4E6" stroke-width="${u(0.35)}" opacity="0.2"/></pattern>`
    + `<pattern id="tm-crop" width="${u(11)}" height="${u(11)}" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">`
    + `<rect width="${u(3.4)}" height="${u(11)}" fill="#FFFFFF" opacity="0.05"/></pattern>`
    + canopy('tm-tree0', ['#8FB35F', '#4F7B3A', '#2C4B22'])
    + canopy('tm-tree1', ['#A8B368', '#6B7A35', '#3D4A1E'])
    + `<linearGradient id="tm-bevel" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${deg - 45} 0.5 0.5)">`
    + '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>'
    + '<stop offset="45%" stop-color="#FFFFFF" stop-opacity="0"/>'
    + '<stop offset="100%" stop-color="#000000" stop-opacity="0.22"/></linearGradient>'
    + '<linearGradient id="tm-rake" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.18"/>'
    + '<stop offset="100%" stop-color="#000000" stop-opacity="0.30"/></linearGradient>'
    + '<linearGradient id="tm-rake-flip" x1="0" y1="1" x2="0" y2="0">'
    + '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.18"/>'
    + '<stop offset="100%" stop-color="#000000" stop-opacity="0.30"/></linearGradient>'
    + '</defs>'
}

/** The racing line solved off the circuit's own trace, plus the lap dynamics along it. Everything the
 *  track surface and the cars need, without a browser. */
function solveLap(layout: TrackLayout) {
  const centreArc = polylineArc(densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y })))
  const line = buildRacingLine(centreArc, layout.metresPerUnit)
  const arc = polylineArc(line.pts)
  const pts = Array.from({ length: PROFILE_N }, (_, i) => arc.at((i / PROFILE_N) * arc.length))
  // Same ~3m centreline stations the map samples for the tarmac edge.
  const n = Math.max(512, Math.min(4096, Math.round((centreArc.length * layout.metresPerUnit) / 3)))
  const centre = Array.from({ length: n }, (_, i) => centreArc.at((i / n) * centreArc.length))
  return { line, arc, centre, dyn: lapDynamics(pts, arc.length, trackPhysics(layout.metresPerUnit)) }
}

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

/** The cars, strung round the solved RACING LINE, leaning and steering exactly as much as the lap's own
 *  dynamics say they should at that point. */
function carsMarkup(layout: TrackLayout, lighting: Lighting, n: number): string[] {
  const lap = solveLap(layout)
  const { pts, len } = equalArc(lap.line.pts, PROFILE_N)
  const dyn = lap.dyn
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
    // Wheels turned for the corner a front axle's lead up the road, as the live map does it.
    const steer = steerAngles(
      sampleLap(dyn.curvature, frac + FRONT_LEAD_M / layout.metresPerUnit / len) / layout.metresPerUnit,
      lateralG(dyn, frac, layout.metresPerUnit),
    )
    const sprite = renderToStaticMarkup(createElement(CarSprite, {
      id: `p${i}`, color: LIVERIES[i % LIVERIES.length], length: SPRITE.len, light, spriteRot, attitude, steer,
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
    // Same standardised bearing the map opens on, or the preview would not be checking what ships.
    const az = pitViewAzimuth(layout)
    const lighting = az === null ? mood : { ...mood, azimuth: az }
    const viewAz = az === null ? mood.azimuth : screenUpAzimuth(screenUpAzimuth(az))
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
    const pitSlots = buildPitSlots(layout, 10)
    const pitZone = buildPitZone(layout, pitSlots)
    const lap = solveLap(layout)

    const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
    const m = TRACK_WIDTH_M / mpu / 2 + 8
    const full = { x: vx - m, y: vy - m, w: vw + 2 * m, h: vh + 2 * m }
    const vb = zoom > 1
      ? {
        x: full.x + full.w * cxf - full.w / zoom / 2, y: full.y + full.h * cyf - full.h / zoom / 2,
        w: full.w / zoom, h: full.h / zoom,
      }
      : full

    const { x, y, angle } = layout.start
    const lead = 1.5 / mpu
    const startAt = { x: x + Math.cos(angle) * lead, y: y + Math.sin(angle) * lead, angle }
    const scene = sceneryScene(scenery, {
      u,
      lighting,
      view: viewAz,
      ground: true,
      track: roadOps({
        layout, u, pitZone, pitSlots, ground: scenery.base, shadow: shadowFill(lighting),
        lap: { pts: lap.line.pts, lateral: lap.line.lateral, centre: lap.centre, dyn: lap.dyn },
      }),
      kerbs: scenery.kerbs.flatMap((k): DrawOp[] => [
        { d: k.d, stroke: '#E6E3DC', width: u(KERB_WIDTH_M), cap: 'round' },
        {
          d: k.d, stroke: '#C8352F', width: u(KERB_WIDTH_M), cap: 'butt',
          dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 },
        },
      ]),
      pitUnder: pitZone ? pitFloorOps(pitZone, lighting) : [],
      pitOver: pitZone ? pitComplexOps(pitZone, u, lighting, viewAz) : [],
      overlay: [...startLineOps(startAt, u), ...gridBoxOps([], u)],
    })

    const body = [
      defs(u, lighting),
      // The surface the canvas CLEARS to, which is what the ground plane is at runtime.
      `<rect x="${vb.x - 4000}" y="${vb.y - 4000}" width="${vb.w + 8000}" height="${vb.h + 8000}" fill="${scenery.base}"/>`,
      ...scene.map(itemSvg),
      // The garage boards are the one part of the world that stays real SVG in the map too.
      ...(pitZone ? [renderToStaticMarkup(createElement(PitGarageSigns, {
        zone: pitZone,
        u,
        lighting,
        view: viewAz,
        drivers: () => [
          { name: 'Kimi Raikkonen', nationality: 'FI' },
          { name: 'Felipe Massa', nationality: 'BR' },
        ],
      }))] : []),
      // Last: the cars sit on top of the world, as they do in the map.
      ...(carCount > 0 ? carsMarkup(layout, lighting, carCount) : []),
    ].join('\n')

    // Fixed output width whatever the zoom, so a hard crop is actually inspectable rather than
    // shrinking with the region it selects.
    const outW = Math.round(Math.max(vb.w * 2, 900))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${outW}" height="${Math.round((outW * vb.h) / vb.w)}">${body}</svg>`
    const tag = `${id}${terrainDetail ? '-terrain' : ''}${moodArg === 'afternoon' ? '' : `-${moodArg}`}${zoom > 1 ? `-z${zoom}` : ''}`
    writeFileSync(`${OUT}/${tag}.svg`, svg)
    const counts = `${scene.length} items; trees ${scenery.trees.length}, `
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
