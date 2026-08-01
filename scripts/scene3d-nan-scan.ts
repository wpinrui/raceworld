// Probe: find NON-FINITE pixels in the 3D scene render (#photoreal).
//
// Nothing about one bad pixel is visible until a pass blurs it, which is why this was invisible
// before the post chain and unmissable after: a single NaN texel spreads across the blur's whole
// kernel and composites as a BLACK BLOCK the size of that kernel. Nine taps at half resolution -> a
// ~17px square; UnrealBloomPass's five mip levels -> a rectangle hundreds of pixels wide. Same
// fault, two sizes. Drawn straight to the canvas the same pixel is one black dot nobody ever saw.
//
// MULTISAMPLED, which is the whole reason the first version of this probe found nothing. The scene
// target asks for `samples: 4`, and a NaN produced at a sample position off the pixel centre
// survives the resolve (an average with NaN is NaN) while a single-sample scan reads straight past
// it. Every round below scans both ways, so the difference between the two numbers IS the evidence.
//
// Run: npx tsx scripts/scene3d-nan-scan.ts [--mood=X] [circuitId ...]

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const mood = argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon'
const named = argv.filter((a) => !a.startsWith('--'))
const ids = named.length ? named : ['britain']

/** Runs in the page: place the camera, render to a float target with and without multisampling, and
 *  count what comes back non-finite. */
const SCAN = `(opts) => {
  const THREE = window.__THREE, renderer = window.__renderer
  const scene = window.__scene, camera = window.__camera
  const full = window.__full
  const w = opts.w, h = opts.h

  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  const grid = window.__gridAt
  window.__orbit({
    tx: opts.atGrid && grid ? grid.x : full.x + full.w * opts.fx,
    tz: opts.atGrid && grid ? grid.z : full.y + full.h * opts.fy,
    pitch: (opts.pitch * Math.PI) / 180,
    rot: (opts.rot * Math.PI) / 180,
    z: opts.zoom,
  }, { w, h })

  const buf = new Float32Array(w * h * 4)
  const scan = (samples) => {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, samples })
    renderer.setRenderTarget(rt)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf)
    renderer.setRenderTarget(null)
    rt.dispose()
    let nan = 0, inf = 0, peak = 0
    const spots = []
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 3; c++) {
        const v = buf[i * 4 + c]
        if (v === v && v > peak && v !== Infinity) peak = v
        if (Number.isFinite(v)) continue
        if (v !== v) nan++; else inf++
        if (spots.length < 10) spots.push([i % w, (h - 1) - ((i / w) | 0)])
        break
      }
    }
    return { nan, inf, peak, spots }
  }

  return { one: scan(0), msaa: scan(4) }
}`

interface Scan {
  nan: number
  inf: number
  peak: number
  spots: Array<[number, number]>
}

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
  const viewer = resolve(OUT, 'scene3d-nan-scan.html')
  writeFileSync(viewer, '<!doctype html><html><head><meta charset="utf-8"><title>nan scan</title>'
    + '<style>html,body{margin:0;background:#101318;height:100%;overflow:hidden}canvas{display:block}'
    + '#bar{display:none}</style></head><body><div id="bar">'
    + '<select id="circuit"></select><select id="mood"></select>'
    + '<button id="top"></button><button id="tilt"></button><span id="stat"></span>'
    + `</div><canvas id="gl"></canvas><script>${bundle.outputFiles[0].text}</script></body></html>`)

  let browser = null
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      browser = await chromium.launch({ channel, headless: true })
      break
    } catch {
      // playwright-core drives what the machine has.
    }
  }
  if (!browser) {
    console.error('neither Edge nor Chrome could be launched')
    process.exitCode = 1
    return
  }

  const page = await browser.newPage()
  page.on('pageerror', (err) => console.error(`page error: ${err.message}`))
  let worst = 0
  for (const id of ids) {
    await page.goto(`${pathToFileURL(viewer).href}?shot=1`
      + `&id=${id}&mood=${mood}&cars=12&pitch=70&ez=35&at=0.5,0.5&grid=20`)
    await page.waitForFunction('window.__done === true', undefined, { timeout: 180_000 })
    const error = await page.evaluate('window.__error')
    if (error) {
      console.error(`${id}: ${error}`)
      process.exitCode = 1
      continue
    }
    console.log(`\n== ${id} (${mood}) ==`)
    console.log('  viewpoint                        1 sample        4 samples (the live target)')
    // The grid first: it is the one place the live scene paints road the probe never did, and it is
    // where the reported artifact was shot.
    for (const pitch of [55, 65, 70, 75, 80]) {
      for (const rot of [0, 30, 90, 150, 210, 300]) {
        for (const zoom of [35, 60, 100]) {
          const opts = { w: 1600, h: 900, fx: 0.5, fy: 0.5, pitch, rot, zoom, atGrid: 1 }
          const r = await page.evaluate(`(${SCAN})(${JSON.stringify(opts)})`) as {
            one: Scan; msaa: Scan
          }
          worst = Math.max(worst, r.msaa.nan + r.msaa.inf)
          const label = `GRID pitch ${pitch} rot ${rot} zoom ${zoom}`
          const spots = r.msaa.spots.slice(0, 4).map(([x, y]) => `${x},${y}`).join(' ')
          console.log(`  ${label.padEnd(30)} NaN ${String(r.one.nan).padStart(5)}`
            + ` Inf ${String(r.one.inf).padStart(4)}`
            + `   NaN ${String(r.msaa.nan).padStart(5)} Inf ${String(r.msaa.inf).padStart(4)}`
            + `   ${spots}`)
        }
      }
    }
    for (const zoom of [35, 80]) {
      for (const pitch of [55, 70, 80]) {
        for (const fy of [0.35, 0.5, 0.65]) {
          for (const fx of [0.35, 0.5, 0.65]) {
            const opts = { w: 1600, h: 900, fx, fy, pitch, rot: 0, zoom, atGrid: 0 }
            const r = await page.evaluate(`(${SCAN})(${JSON.stringify(opts)})`) as {
              one: Scan; msaa: Scan
            }
            worst = Math.max(worst, r.msaa.nan + r.msaa.inf)
            const label = `at ${fx},${fy} pitch ${pitch} zoom ${zoom}`
            const spots = r.msaa.spots.slice(0, 4).map(([x, y]) => `${x},${y}`).join(' ')
            console.log(`  ${label.padEnd(30)} NaN ${String(r.one.nan).padStart(5)}`
              + ` Inf ${String(r.one.inf).padStart(4)}`
              + `   NaN ${String(r.msaa.nan).padStart(5)} Inf ${String(r.msaa.inf).padStart(4)}`
              + `   ${spots}`)
          }
        }
      }
    }
  }
  console.log(`\nworst round: ${worst} non-finite pixels with the live target's multisampling`)
  await browser.close()
}

main()
