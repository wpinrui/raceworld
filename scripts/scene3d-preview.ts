// Probe: render the 3D world for a few circuits without starting the app (#3d-port). The scene is
// built through the same calls the 3D view will make — `buildScenery`, the pit builders, then
// `buildWorld3D` — so what is previewed is what will ship. esbuild bundles the browser entry beside
// this file into one HTML page; a headless system browser (Edge, else Chrome) rasterises it; and the
// page itself is left in the output directory as a hand-orbitable viewer, openable straight from disk.
//
// Run: npx tsx scripts/scene3d-preview.ts [--tilt=deg] [--zoom=N] [--at=fx,fy] [--mood=X] [circuitId ...]
//   -> scripts/.preview/<id>-3d[-mood][-zN].png (top-down), ...-tilt.png (diorama), scene3d-viewer.html
//
// `--pitch=deg` adds a third shot per circuit, ...-eye.png: the LIVE orbit camera at that pitch off
// vertical (the map allows up to 80), through the same `applyOrbitCam` the race view uses. It is the
// only way to see the horizon here, because the two ortho shots above cannot contain one. `--eye-zoom`
// is the map's own zoom scalar (default 20, its ZOOM_DEFAULT) and `--rot` rolls the camera.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const tilt = Number(argv.find((a) => a.startsWith('--tilt='))?.split('=')[1] ?? 24)
const zoom = Number(argv.find((a) => a.startsWith('--zoom='))?.split('=')[1] ?? 1)
const at = argv.find((a) => a.startsWith('--at='))?.split('=')[1] ?? '0.5,0.5'
const mood = argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon'
const carsArg = argv.find((a) => a === '--cars' || a.startsWith('--cars='))
const cars = carsArg ? Number(carsArg.split('=')[1] ?? 12) : 0
const pitchArg = argv.find((a) => a.startsWith('--pitch='))?.split('=')[1]
const eyeZoom = Number(argv.find((a) => a.startsWith('--eye-zoom='))?.split('=')[1] ?? 20)
const rot = Number(argv.find((a) => a.startsWith('--rot='))?.split('=')[1] ?? 0)
const named = argv.filter((a) => !a.startsWith('--'))
const ids = named.length ? named : ['britain', 'monaco', 'belgium', 'bahrain']

async function main() {
  mkdirSync(OUT, { recursive: true })
  const bundle = await build({
    entryPoints: ['scripts/scene3d-preview-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    alias: { '@': resolve('src') },
    logLevel: 'silent',
  })
  const viewer = resolve(OUT, 'scene3d-viewer.html')
  writeFileSync(viewer, '<!doctype html><html><head><meta charset="utf-8"><title>scene3d preview</title>'
    + '<style>'
    + 'html,body{margin:0;background:#101318;height:100%;overflow:hidden;color-scheme:dark}'
    + 'canvas{display:block}'
    + '#bar{position:fixed;top:0;left:0;right:0;z-index:1;display:flex;gap:8px;align-items:center;'
    + 'padding:8px 10px;background:rgba(10,12,16,.85);font:13px system-ui,sans-serif;color:#FFFFFF}'
    + '#bar select,#bar button{background:#1A1F27;color:#FFFFFF;border:1px solid #2A313C;'
    + 'border-radius:4px;padding:4px 10px;font:inherit;cursor:pointer}'
    + '#bar select:hover,#bar button:hover{border-color:#00D9FF}'
    + '#bar select:focus-visible,#bar button:focus-visible{outline:1px solid #00D9FF;outline-offset:1px}'
    + '#bar :disabled{color:#6B7280;border-color:#2A313C;cursor:default}'
    + '#stat{margin-left:auto;color:#FFFFFF}'
    + 'body.shot #bar{display:none}'
    + '</style></head>'
    + '<body><div id="bar">'
    + '<select id="circuit"></select>'
    + '<select id="mood"></select>'
    + '<button id="top">Top</button>'
    + '<button id="tilt">Tilt</button>'
    + '<span id="stat"></span>'
    + '</div><canvas id="gl"></canvas>'
    + `<script>${bundle.outputFiles[0].text}</script></body></html>`)

  let browser = null
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      browser = await chromium.launch({ channel, headless: true })
      break
    } catch {
      // Try the next channel: playwright-core downloads nothing, it drives what the machine has.
    }
  }
  if (!browser) {
    console.error('neither Edge nor Chrome could be launched; the viewer HTML was still written')
    process.exitCode = 1
    return
  }

  const page = await browser.newPage()
  page.on('pageerror', (err) => console.error(`page error: ${err.message}`))
  for (const id of ids) {
    const z = `${mood === 'afternoon' ? '' : `-${mood}`}${zoom > 1 ? `-z${zoom}` : ''}${cars > 0 ? '-cars' : ''}`
    const common = `id=${id}&zoom=${zoom}&at=${at}&mood=${mood}&cars=${cars}`
    const shots = [
      { tag: `-3d${z}`, note: 'tilt  0', query: `${common}&tilt=0` },
      { tag: `-3d${z}-tilt`, note: `tilt ${tilt}`, query: `${common}&tilt=${tilt}` },
      ...(pitchArg === undefined ? [] : [{
        tag: `-3d${z}-eye`,
        note: `pitch ${pitchArg}`,
        query: `${common}&pitch=${pitchArg}&ez=${eyeZoom}&rot=${rot}`,
      }]),
    ]
    for (const { tag, note, query } of shots) {
      await page.goto(`${pathToFileURL(viewer).href}?shot=1&${query}`)
      await page.waitForFunction('window.__done === true', undefined, { timeout: 120_000 })
      const error = await page.evaluate('window.__error')
      if (error) {
        console.error(`${id}${tag}: ${error}`)
        process.exitCode = 1
        continue
      }
      const stats = await page.evaluate('window.__stats') as {
        meshes: number; triangles: number; w: number; h: number
        horizon?: [number, number, number]; fogSpan?: [number, number]
      }
      await page.setViewportSize({ width: stats.w, height: stats.h })
      const file = `${OUT}/${id}${tag}.png`
      await page.locator('#gl').screenshot({ path: file })
      const haze = stats.horizon
        ? `, haze ${stats.horizon.map((c) => c.toFixed(2)).join('/')}`
          + ` over ${stats.fogSpan?.map((v) => Math.round(v)).join('..')}u`
        : ', no sky'
      console.log(`${(id + tag).padEnd(20)} ${note.padStart(9)} -> ${file}   `
        + `(${stats.meshes} meshes, ${stats.triangles} triangles${haze})`)
    }
  }
  await browser.close()
}

main()
