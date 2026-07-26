// Probe: render the SAME circuit through both pipelines — the real SVG layers in RaceTrackMap's
// document order, and the canvas's sceneryScene stream mapped op-for-op to SVG paths — so paint
// order and geometry can be compared pixel to pixel without starting the app. What this cannot
// check is canvas rasterisation itself (tile resolution, gradient sampling); it checks that the
// two renderers describe the same picture in the same order.
// Run: npx tsx scripts/canvas-order-preview.ts [circuitId ...] [--zoom=N] [--at=fx,fy]

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery, KERB_BLOCK_M, KERB_WIDTH_M, type Scenery } from '../src/lib/ui/track-scenery'
import {
  LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, TARMAC_WIDTH_M, TRACK_WIDTH_M,
} from '../src/lib/ui/track-path'
import {
  SceneryLayer, SceneryShadowLayer, ScenerySolidsLayer, TrackFurnitureLayer, EXTRUDE,
} from '../src/components/race/SceneryLayer'
import {
  PitBuilding, PitBuildingShadow, PitGarageFloors, pitComplexOps, pitFloorOps,
} from '../src/components/race/PitBuilding'
import { buildPitSlots, buildPitZone, pitCameraRotation, pitViewAzimuth } from '../src/lib/ui/pit-zone'
import { MOODS, screenUpAzimuth } from '../src/lib/ui/lighting'
import {
  isGroup, refName, sceneryScene, type DrawOp, type SceneItem,
} from '../src/lib/ui/scenery-draw'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const zoom = Number(argv.find((a) => a.startsWith('--zoom='))?.split('=')[1] ?? 1)
const [cxf, cyf] = (argv.find((a) => a.startsWith('--at='))?.split('=')[1] ?? '0.5,0.5').split(',').map(Number)
/** Camera rotation, in the same turns the map's own control uses. The default 0 renders the world in
 *  its authored orientation, which is NOT the shot the player opens on: the camera is standardised to
 *  `pitCameraRotation`, and which face of a solid is visible follows that. `--rot=pit` takes it. */
const rotArg = argv.find((a) => a.startsWith('--rot='))?.split('=')[1] ?? '0'
const named = argv.filter((a) => !a.startsWith('--'))
const ids = named.length ? named : ['britain']

mkdirSync(OUT, { recursive: true })

const paintAttr = (v: string) => (refName(v) ? `url(#${refName(v)})` : v)

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

const itemSvg = (i: SceneItem): string => (isGroup(i)
  ? `<g transform="translate(${i.x} ${i.y}) rotate(${(i.rot * 180) / Math.PI})">${i.ops.map(opSvg).join('')}</g>`
  : opSvg(i))

async function main() {
  for (const id of ids) {
    const layout = TRACK_LAYOUTS[id]
    if (!layout) {
      console.log(`${id}: no such layout`)
      continue
    }
    const az = pitViewAzimuth(layout)
    const lighting = az === null ? MOODS.afternoon : { ...MOODS.afternoon, azimuth: az }
    const view = screenUpAzimuth(rotArg === 'pit' ? (pitCameraRotation(layout) ?? 0) : Number(rotArg))
    const mpu = layout.metresPerUnit
    const u = (m: number) => m / mpu
    const scenery = buildScenery(layout.trace, layout.pit, {
      circuitId: layout.circuitId,
      metresPerUnit: mpu,
      viewBox: layout.viewBox,
      pitOutside: layout.pitOutside,
      biome: layout.biome,
    })
    const zone = buildPitZone(layout, buildPitSlots(layout, 10))

    const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
    const m = TRACK_WIDTH_M / mpu / 2 + 8
    const full = { x: vx - m, y: vy - m, w: vw + 2 * m, h: vh + 2 * m }
    const vb = zoom > 1
      ? {
        x: full.x + full.w * cxf - full.w / zoom / 2, y: full.y + full.h * cyf - full.h / zoom / 2,
        w: full.w / zoom, h: full.h / zoom,
      }
      : full

    // ── A: the SVG document, layer for layer in RaceTrackMap's order ──
    const kerbPaths = scenery.kerbs.flatMap((k) => [
      renderToStaticMarkup(createElement('path', {
        d: k.d, fill: 'none', stroke: '#E6E3DC', strokeWidth: u(KERB_WIDTH_M), strokeLinecap: 'round',
      })),
      renderToStaticMarkup(createElement('path', {
        d: k.d, fill: 'none', stroke: '#C8352F', strokeWidth: u(KERB_WIDTH_M),
        strokeDasharray: `${u(KERB_BLOCK_M)} ${u(KERB_BLOCK_M)}`,
      })),
    ])
    const svgBody = [
      renderToStaticMarkup(createElement('rect', {
        x: vb.x - 4000, y: vb.y - 4000, width: vb.w + 8000, height: vb.h + 8000, fill: scenery.base,
      })),
      renderToStaticMarkup(createElement(SceneryLayer, { scenery, u, lighting, detail: 'full' })),
      ...(zone ? [renderToStaticMarkup(createElement(PitGarageFloors, { zone, lighting }))] : []),
      renderToStaticMarkup(createElement('path', {
        d: layout.d, fill: 'none', stroke: '#D8D8D2', strokeWidth: u(TRACK_WIDTH_M), strokeLinejoin: 'round',
      })),
      renderToStaticMarkup(createElement('path', {
        d: layout.pit.fastD, fill: 'none', stroke: '#D8D8D2', strokeWidth: u(LANE_WIDTH_M), strokeLinecap: 'round',
      })),
      ...(zone ? [renderToStaticMarkup(createElement('path', { d: zone.work, fill: '#D8D8D2', stroke: '#D8D8D2', strokeWidth: u(2 * LANE_LINE_M) }))] : []),
      renderToStaticMarkup(createElement('path', {
        d: layout.d, fill: 'none', stroke: '#33383E', strokeWidth: u(TARMAC_WIDTH_M), strokeLinejoin: 'round',
      })),
      renderToStaticMarkup(createElement('path', {
        d: layout.pit.fastD, fill: 'none', stroke: '#33383E', strokeWidth: u(LANE_TARMAC_M), strokeLinecap: 'round',
      })),
      ...(zone ? [
        renderToStaticMarkup(createElement('path', { d: zone.work, fill: '#33383E' })),
        renderToStaticMarkup(createElement(PitBuildingShadow, { zone, u, lighting })),
        renderToStaticMarkup(createElement(PitBuilding, { zone, u, lighting, view })),
      ] : []),
      ...kerbPaths,
      renderToStaticMarkup(createElement(SceneryShadowLayer, { scenery, u, lighting, view, detail: 'full' })),
      renderToStaticMarkup(createElement(ScenerySolidsLayer, { scenery, u, lighting, view, detail: 'full' })),
      renderToStaticMarkup(createElement(TrackFurnitureLayer, { scenery, u, lighting, view, detail: 'full' })),
    ].join('\n')

    // ── B: the canvas's scene, mapped op-for-op to SVG. Defs come from the SVG layer so both sides
    // resolve the same names to the same paints. ──
    const emptyScenery = {
      ...scenery, bands: [], fields: [], fences: [], tyreWalls: [], marshals: [],
      terrain: [], runoffs: [], kerbs: [], stands: [], buildings: [], trees: [],
    } as Scenery
    const defs = renderToStaticMarkup(createElement(SceneryLayer, { scenery: emptyScenery, u, lighting, detail: 'full' }))
    const items = sceneryScene(scenery, {
      u, lighting, view, ground: true, extrude: EXTRUDE,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: (r) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
      trees: scenery.trees,
      // No ground op: the renderer FILLS the canvas with scenery.base rather than clearing it, so on
      // this side the ground is the page under the ops. Side A paints its own rect for the same reason.
      track: [
        { d: layout.d, stroke: '#D8D8D2', width: u(TRACK_WIDTH_M) },
        { d: layout.pit.fastD, stroke: '#D8D8D2', width: u(LANE_WIDTH_M), cap: 'round' },
        ...(zone ? [{ d: zone.work, fill: '#D8D8D2', stroke: '#D8D8D2', width: u(2 * LANE_LINE_M) }] : []),
        { d: layout.d, stroke: '#33383E', width: u(TARMAC_WIDTH_M) },
        { d: layout.pit.fastD, stroke: '#33383E', width: u(LANE_TARMAC_M), cap: 'round' as const },
        ...(zone ? [{ d: zone.work, fill: '#33383E' }] : []),
      ],
      kerbs: scenery.kerbs.flatMap((k) => [
        { d: k.d, stroke: '#E6E3DC', width: u(KERB_WIDTH_M), cap: 'round' as const },
        {
          d: k.d, stroke: '#C8352F', width: u(KERB_WIDTH_M), cap: 'butt' as const,
          dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 },
        },
      ]),
      pitUnder: zone ? pitFloorOps(zone, lighting) : [],
      pitOver: zone ? pitComplexOps(zone, u, lighting, view) : [],
    })
    const ground = renderToStaticMarkup(createElement('rect', {
      x: vb.x - 4000, y: vb.y - 4000, width: vb.w + 8000, height: vb.h + 8000, fill: scenery.base,
    }))
    const canvasBody = defs + ground + items.map(itemSvg).join('\n')

    const outW = Math.round(Math.max(vb.w * 2, 1400))
    const outH = Math.round((outW * vb.h) / vb.w)
    const tag = `${id}${zoom > 1 ? `-z${zoom}` : ''}`
    for (const [side, body] of [['svg', svgBody], ['canvas', canvasBody]] as const) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${outW}" height="${outH}">${body}</svg>`
      writeFileSync(`${OUT}/${tag}-${side}.svg`, svg)
      await sharp(Buffer.from(svg)).png().toFile(`${OUT}/${tag}-${side}.png`)
      console.log(`${tag}-${side}.png  ${outW}x${outH}`)
    }
  }
}

main()
