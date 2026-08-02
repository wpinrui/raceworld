// Probe: catch the bloom chain's BLACK BLOCKS (#photoreal). Bloom only ever ADDS, so any pixel that
// comes out of the composite darker than the same pixel rendered straight to the canvas is the bug,
// and this finds them by rendering both and differencing.
//
// Reported as clusters, not as a count: the size and shape of a block is the evidence. A block the
// width of the blur kernel means one bad texel spread by the blur; single-pixel speckle spread over
// the whole frame means the composite is sampling the scene off-centre.
//
// Two sweeps, and both are needed because the two faults answer to different things:
//   --sizes   canvas size and device pixel ratio, at one viewpoint
//   default   viewpoints across the whole circuit, at one canvas size
//
// One line per round with the running worst case, so a run says something after the first round and
// can be stopped at any time.
//
// Run: npx tsx scripts/scene3d-bloom-repro.ts [--sizes] [--mood=X] [--shots] [circuitId ...]

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const mood = argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon'
const sizeSweep = argv.includes('--sizes')
const wantShots = argv.includes('--shots')
const named = argv.filter((a) => !a.startsWith('--'))
const ids = named.length ? named : ['britain']

/** The live canvas is a browser viewport at whatever the machine's scaling is, which is not any of
 *  the probe's fixed still sizes. Both odd and fractional cases are in here deliberately: the chain
 *  halves its resolution for the blur, and half of an odd number is where a hand-written chain goes
 *  wrong. */
const SIZES: Array<[number, number, number]> = [
  [1600, 900, 1],
  [2100, 1400, 1],
  [1683, 1051, 1],
  [1400, 933, 1.5],
  [1280, 800, 1.25],
  [1024, 640, 2],
]

/** Runs in the page: place the camera, composite, render straight, difference, cluster. */
const DIFF = `(opts) => {
  const renderer = window.__renderer, post = window.__post
  const scene = window.__scene, camera = window.__camera
  const gl = renderer.getContext()
  const full = window.__full

  renderer.setPixelRatio(opts.dpr)
  renderer.setSize(opts.cssW, opts.cssH, false)
  post.setSize(opts.cssW, opts.cssH, opts.dpr)
  window.__orbit({
    tx: full.x + full.w * opts.fx,
    tz: full.y + full.h * opts.fy,
    pitch: (opts.pitch * Math.PI) / 180,
    rot: (opts.rot * Math.PI) / 180,
    z: opts.zoom,
  }, { w: opts.cssW, h: opts.cssH })

  const w = renderer.domElement.width, h = renderer.domElement.height
  const grab = () => {
    const px = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return px
  }

  post.render()
  const composited = grab()
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  const plain = grab()

  // Bloom adds. Darker than the straight render by more than a rounding step is the fault.
  const bad = new Uint8Array(w * h)
  let count = 0
  for (let i = 0; i < w * h; i++) {
    const d = (plain[i * 4] - composited[i * 4]) + (plain[i * 4 + 1] - composited[i * 4 + 1])
      + (plain[i * 4 + 2] - composited[i * 4 + 2])
    if (d > 24) { bad[i] = 1; count++ }
  }

  const clusters = []
  const stack = []
  for (let s = 0; s < w * h; s++) {
    if (!bad[s]) continue
    let x0 = s % w, x1 = x0, y0 = (s / w) | 0, y1 = y0, n = 0
    stack.push(s); bad[s] = 0
    while (stack.length) {
      const p = stack.pop()
      const x = p % w, y = (p / w) | 0
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q >= 0 && q < w * h && bad[q]) { bad[q] = 0; stack.push(q) }
      }
    }
    clusters.push({ x: x0, y: h - 1 - y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n })
  }
  clusters.sort((a, b) => b.n - a.n)
  // Leave the composite on the canvas, so a caller that wants the picture screenshots what it just
  // measured rather than a straight render.
  post.render()
  return { count, total: clusters.length, clusters: clusters.slice(0, 6), w, h }
}`

interface Diff {
  count: number
  total: number
  w: number
  h: number
  clusters: Array<{ x: number; y: number; w: number; h: number; n: number }>
}

interface Round {
  label: string
  opts: Record<string, number>
}

function sizeRounds(): Round[] {
  return SIZES.flatMap(([cssW, cssH, dpr]) => [0, 9].map((rot) => ({
    label: `${cssW}x${cssH} dpr ${dpr} rot ${rot}`,
    opts: { cssW, cssH, dpr, fx: 0.5, fy: 0.5, pitch: 70, rot, zoom: 35 },
  })))
}

/** Viewpoints across the circuit: the artifact is anchored to something in the world, so the sweep
 *  that matters is over WHERE the camera looks, not over how big the canvas is. */
function viewRounds(): Round[] {
  const rounds: Round[] = []
  for (const zoom of [35, 80]) {
    for (const pitch of [55, 70, 80]) {
      for (const fy of [0.3, 0.5, 0.7]) {
        for (const fx of [0.3, 0.5, 0.7]) {
          rounds.push({
            label: `at ${fx},${fy} pitch ${pitch} zoom ${zoom}`,
            opts: { cssW: 2100, cssH: 1400, dpr: 1, fx, fy, pitch, rot: 0, zoom },
          })
        }
      }
    }
  }
  return rounds
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
  const viewer = resolve(OUT, 'scene3d-bloom-repro.html')
  writeFileSync(viewer, '<!doctype html><html><head><meta charset="utf-8"><title>bloom repro</title>'
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
  const rounds = sizeSweep ? sizeRounds() : viewRounds()
  let worst = 0
  for (const id of ids) {
    await page.goto(`${pathToFileURL(viewer).href}?shot=1`
      + `&id=${id}&mood=${mood}&cars=12&pitch=70&ez=35&at=0.5,0.5`)
    await page.waitForFunction('window.__done === true', undefined, { timeout: 180_000 })
    const error = await page.evaluate('window.__error')
    if (error) {
      console.error(`${id}: ${error}`)
      process.exitCode = 1
      continue
    }
    console.log(`\n== ${id} (${mood}) ==`)
    for (const { label, opts } of rounds) {
      const r = await page.evaluate(`(${DIFF})(${JSON.stringify(opts)})`) as Diff
      worst = Math.max(worst, r.count)
      const shapes = r.clusters.map((c) => `${c.w}x${c.h}@${c.x},${c.y}`).join(' ')
      console.log(`  ${label.padEnd(32)} ${r.w}x${r.h}`
        + `  dark ${String(r.count).padStart(6)}px in ${String(r.total).padStart(4)} blocks  ${shapes}`)
      if (wantShots && r.count > 0) {
        const file = `${OUT}/${id}-bloom-${label.replace(/[^\w]+/g, '_')}.png`
        await page.setViewportSize({ width: opts.cssW, height: opts.cssH })
        await page.locator('#gl').screenshot({ path: file })
        console.log(`    -> ${file}`)
      }
    }
  }
  console.log(`\nworst round: ${worst} darker-than-plain pixels`)
  await browser.close()
}

main()
