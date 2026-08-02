// Probe: the grandstand viewer. Bundles the browser half into one standalone HTML page you open
// from disk, and (with --shot) rasterises a set of angles for each massing so the model can be
// judged from stills.
//
// Run: npx tsx scripts/grandstand-preview.ts [--shot]
//   -> scripts/.preview/grandstand-viewer.html   (open this)
//   -> scripts/.preview/stand-<massing>-<angle>.png

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { skinFiles } from '../src/lib/scene3d/standtex3d'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const wantShots = argv.includes('--shot')
// Empties the stand. Colour-matching a surface is impossible with four thousand people in tan shirts
// standing on it: every measurement of the timber picks up their clothing too.
const fill = argv.includes('--no-crowd') ? 0 : 90
// The stills sweep whichever axis is under review; the massing is settled, so it is roofs now.
const MASSINGS = ['twoTier']
const ROOFS = ['cantilever']
const SEATS = ['bucket']
const ANGLES = ['three', 'front']

const CSS = `
html,body{margin:0;background:#101318;height:100%;overflow:hidden;color-scheme:dark}
canvas{display:block}
#bar{position:fixed;top:0;left:0;right:0;z-index:1;display:flex;gap:14px;align-items:center;
flex-wrap:wrap;padding:8px 10px;background:rgba(10,12,16,.85);font:13px system-ui,sans-serif;
color:#FFFFFF}
#bar label{display:flex;gap:6px;align-items:center}
#bar select,#bar button{background:#1A1F27;color:#FFFFFF;border:1px solid #2A313C;border-radius:4px;
padding:4px 10px;font:inherit;cursor:pointer;height:28px}
#bar select:hover,#bar button:hover{border-color:#00D9FF}
#bar input[type=range]{width:110px;accent-color:#00D9FF}
#bar span.v{color:#00D9FF;min-width:26px;font:12px ui-monospace,monospace}
#hud{position:fixed;bottom:10px;left:10px;z-index:1;padding:10px 12px;border-radius:6px;
background:rgba(10,12,16,.85);font:12px ui-monospace,monospace;color:#FFFFFF;white-space:pre;
line-height:1.6;pointer-events:none}
#hud b{color:#00D9FF;font-weight:600}
body.shot #bar,body.shot #hud{display:none}
`

const BAR = `
<label>Massing <select id="massing">
<option value="plinth">A concrete plinth</option>
<option value="columns">B lifted on columns</option>
<option value="twoTier" selected>C two tier</option>
</select></label>
<label>Roof <select id="roof">
<option value="cantilever" selected>A cantilever truss</option>
<option value="pitched">B pitched on columns</option>
<option value="canopy">C tensile canopy</option>
<option value="none">none</option>
</select></label>
<label>Seat <select id="seat">
<option value="shell">A shell</option>
<option value="bucket" selected>B bucket</option>
<option value="bench">C bench</option>
<option value="off">off</option>
</select></label>
<label>LOD <select id="lod">
<option value="auto" selected>auto</option><option value="high">high</option>
<option value="mid">mid</option>
<option value="low">low</option>
</select></label>
<label>Crowd <input id="fill" type="range" min="0" max="100" step="5" value="90"></label>
<span class="v" id="fillv">90</span>
<label>Width <input id="width" type="range" min="20" max="140" step="2" value="64"></label>
<span class="v" id="widthv">64</span>
<label>Rows <input id="rows" type="range" min="6" max="40" step="1" value="20"></label>
<span class="v" id="rowsv">20</span>
<label>Upper <input id="upper" type="range" min="0" max="30" step="1" value="14"></label>
<span class="v" id="upperv">14</span>
<label>Rise <input id="rise" type="range" min="28" max="60" step="1" value="42"></label>
<span class="v" id="risev">42</span>
<label>Run <input id="run" type="range" min="70" max="110" step="1" value="85"></label>
<span class="v" id="runv">85</span>
<button id="tex" class="on">Textures</button>
<button data-view="pair">Old vs new</button><button data-view="three">3/4</button><button data-view="front">Front</button>
<button data-view="side">Side</button><button data-view="rear">Rear</button>
<button data-view="seat">Seat</button><button data-view="band">Band</button><button data-view="under">Under</button><button data-view="crest">Crest</button><button data-view="top">Top</button>
`

async function main() {
  mkdirSync(OUT, { recursive: true })
  const web = 'public/materials/web'
  if (!existsSync(web)) {
    console.error(`no converted maps at ${web}: run npx tsx scripts/material-web.ts first`)
    process.exitCode = 1
    return
  }
  // Packed INTO the page as data: URIs rather than copied beside it. A page opened off file:// is a
  // unique origin, so a file:// image is cross-origin data that WebGL will not upload: it throws
  // SecurityError and the sampler reads black, which turns every roughness map into a mirror. Only
  // the maps that are actually sampled get packed, each no larger than the surface can resolve, so
  // the page stays a handful of megabytes instead of the 235 MB the downloads are.
  const inline: Record<string, string> = {}
  let bytes = 0
  for (const { file, maxPx, normal } of skinFiles()) {
    const src = join(web, file)
    if (!existsSync(src)) {
      console.error(`missing ${src}: run npx tsx scripts/material-web.ts`)
      process.exitCode = 1
      return
    }
    // maxPx 0 means "do not touch it": the inverse-histogram lookup is a 256x1 function table and
    // resizing it would resample the histogram itself.
    const img = maxPx > 0
      ? sharp(src).resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
      : sharp(src)
    // Normals stay lossless. JPEG's ringing around an edge becomes a shading ripple in a normal map,
    // and a deck is exactly the large flat surface where that reads.
    const buf = normal
      ? await img.png({ compressionLevel: 9 }).toBuffer()
      : await img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer()
    inline[file] = `data:image/${normal ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`
    bytes += buf.length
  }
  console.log(`packed ${Object.keys(inline).length} maps, ${(bytes / 1048576).toFixed(1)} MB`)
  const bundle = await build({
    entryPoints: ['scripts/grandstand-preview-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    alias: { '@': resolve('src') },
    logLevel: 'silent',
  })
  const page = resolve(OUT, 'grandstand-viewer.html')
  writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8">'
    + '<title>grandstand</title>'
    + `<style>${CSS}</style></head><body>`
    + `<div id="bar">${BAR}</div><div id="hud"></div><canvas id="gl"></canvas>`
    + `<script>window.__standTex=${JSON.stringify(inline)}</script>`
    + `<script>${bundle.outputFiles[0].text}</script></body></html>`)
  console.log(`viewer -> ${page}`)
  if (!wantShots) return

  let browser = null
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      // No file-access flag: the maps ride inside the page, so the headless run and the page you
      // open by hand are loading exactly the same thing. A flag here would have hidden the bug.
      browser = await chromium.launch({ channel, headless: true })
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
  const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  tab.on('pageerror', (err) => console.error(`page error: ${err.message}`))

  // Round-based, massing by massing: every angle of one option lands before the next starts, so a
  // Ctrl-C still leaves a complete set to look at.
  for (const massing of MASSINGS) {
    for (const roof of ROOFS) {
      for (const seat of SEATS) {
        for (const angle of ANGLES) {
          await tab.goto(`${pathToFileURL(page).href}?shot=1&massing=${massing}&roof=${roof}`
            + `&seat=${seat}&angle=${angle}&fill=${fill}`)
          await tab.waitForFunction('window.__done === true', undefined, { timeout: 120_000 })
          const error = await tab.evaluate('window.__error')
          if (error) {
            console.error(`${seat}/${angle}: ${error}`)
            process.exitCode = 1
            break
          }
          let written = ''
          for (const suffix of ['', '-new', '-b']) {
            try {
              const file = `${OUT}/stand-${seat}-${angle}${suffix}.png`
              await tab.locator('#gl').screenshot({ path: file })
              written = file
              break
            } catch {
              // Locked by an open viewer; try the next name.
            }
          }
          const stats = await tab.evaluate('window.__standStats') as {
            meshes: number; triangles: number
          }
          console.log(`${seat.padEnd(7)} ${angle.padEnd(6)} -> ${written || 'UNWRITABLE'}`
            + `  ${stats.meshes} meshes, ${Math.round(stats.triangles).toLocaleString()} tris`)
        }
      }
    }
  }
  await browser.close()
}

main()
