// Probe: turntable stills of the lofted 3D car (#3d-port increment 4). The height profile in
// car-mesh.ts is judged against these, angle by angle, the way the 2D sprite was judged against
// scripts/car-preview.ts.
//
// Run: npx tsx scripts/car-preview-3d.ts [--colour=RRGGBB] [--steer]
//   -> scripts/.preview/car-3d-front.png, -side, -rear, -top

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const colour = argv.find((a) => a.startsWith('--colour='))?.split('=')[1] ?? 'E8442E'
const steer = argv.includes('--steer') ? '&steer=1' : ''
const model = argv.includes('--model') ? '&model=1' : ''
const compare = argv.includes('--compare')

async function main() {
  mkdirSync(OUT, { recursive: true })
  const bundle = await build({
    entryPoints: ['scripts/car-preview-3d-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    alias: { '@': resolve('src') },
    logLevel: 'silent',
  })
  const page = resolve(OUT, 'car-3d-viewer.html')
  writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"><title>car 3d</title>'
    + '<style>'
    + 'html,body{margin:0;background:#101318;height:100%;overflow:hidden;color-scheme:dark}'
    + 'canvas{display:block}'
    + '#bar{position:fixed;top:0;left:0;right:0;z-index:1;display:flex;gap:8px;align-items:center;'
    + 'padding:8px 10px;background:rgba(10,12,16,.85);font:13px system-ui,sans-serif;color:#FFFFFF}'
    + '#bar select{background:#1A1F27;color:#FFFFFF;border:1px solid #2A313C;'
    + 'border-radius:4px;padding:4px 8px;font:inherit;cursor:pointer;height:28px}'
    + '#bar select:hover{border-color:#00D9FF}'
    + '#bar label{display:flex;gap:6px;align-items:center}'
    + '#bar input[type=range]{width:150px;accent-color:#00D9FF}'
    + '#swatch{display:flex;gap:3px;margin-left:4px}'
    + '#swatch i{width:16px;height:16px;border-radius:3px;border:1px solid #2A313C}'
    + 'body.shot #bar{display:none}'
    + '</style></head>'
    + '<body><div id="bar">'
    + '<label>Year <select id="year"></select></label>'
    + '<label>Team <select id="team"></select></label>'
    + '<span id="swatch"></span>'
    + '<label>Steer <input id="steer" type="range" min="-24" max="24" step="1" value="0"></label>'
    + '<span id="steerv">0&deg;</span>'
    + '</div><canvas id="gl"></canvas>'
    + `<script>${bundle.outputFiles[0].text}</script></body></html>`)

  let browser = null
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      // file-access flag: the GLB is fetched from disk by the page, and file:// fetches are
      // otherwise blocked cross-"origin" in headless Chromium.
      browser = await chromium.launch({
        channel, headless: true, args: ['--allow-file-access-from-files'],
      })
      break
    } catch {
      // Try the next channel.
    }
  }
  if (!browser) {
    console.error('neither Edge nor Chrome could be launched')
    process.exitCode = 1
    return
  }
  const tab = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  tab.on('pageerror', (err) => console.error(`page error: ${err.message}`))
  tab.on('console', (msg) => console.log(msg.text()))

  /** Render one still and write it, walking name suffixes past any viewer's file lock. */
  const shoot = async (params: string, base: string): Promise<string> => {
    await tab.goto(`${pathToFileURL(page).href}?shot=1&${params}`)
    await tab.waitForFunction('window.__done === true', undefined, { timeout: 60_000 })
    const error = await tab.evaluate('window.__error')
    if (error) {
      console.error(`${base}: ${error}`)
      process.exitCode = 1
      return ''
    }
    for (const suffix of ['', '-new', '-b', '-c']) {
      const file = `${OUT}/${base}${suffix}.png`
      try {
        await tab.locator('#gl').screenshot({ path: file })
        return file
      } catch {
        // Locked by a viewer; try the next name.
      }
    }
    console.error(`${base}: UNWRITABLE, close some image viewers`)
    return ''
  }

  if (compare) {
    // Pairs: ours flanking left, the reference model right, identical light and lens.
    for (const angle of ['front', 'side', 'rear', 'top']) {
      const file = await shoot(`angle=${angle}&colour=${colour}&compare=1`, `car-compare-${angle}`)
      if (file) console.log(`${angle.padEnd(6)} -> ${file}`)
    }
    // Silhouette overlays: ours in red, the model in blue, multiplied so overlap reads dark and
    // either car's overhang keeps its own colour.
    for (const angle of ['oside', 'ofront', 'otop']) {
      const oursFile = await shoot(`angle=${angle}&silhouette=E0322D`, `car-sil-ours-${angle}`)
      const modelFile = await shoot(`angle=${angle}&silhouette=2F55E0&model=1`, `car-sil-model-${angle}`)
      if (!oursFile || !modelFile) continue
      // The composite walks the same suffixes the screenshots do: a viewer holding the last
      // overlay open must never kill the run.
      let out = ''
      for (const suffix of ['', '-new', '-b', '-c']) {
        try {
          out = `${OUT}/car-overlay-${angle}${suffix}.png`
          await sharp(oursFile).composite([{ input: modelFile, blend: 'multiply' }]).toFile(out)
          break
        } catch {
          out = ''
        }
      }
      console.log(`${angle.padEnd(6)} -> ${out || 'UNWRITABLE: close some image viewers'}`)
    }
  } else {
    for (const angle of ['front', 'side', 'rear', 'top', 'under', 'cockpit', 'cockrear', 'cockside', 'cockfront']) {
      const file = await shoot(`angle=${angle}&colour=${colour}${steer}${model}`, `car-3d-${angle}`)
      if (file) console.log(`${angle.padEnd(6)} -> ${file}`)
    }
  }
  await browser.close()
}

main()
