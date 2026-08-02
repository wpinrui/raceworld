// Probe: audit every geometry in the built world for values a shader cannot survive (#photoreal).
//
// `normalize( vNormal )` is the first line of three's lit fragment shader, and a ZERO normal makes
// it NaN. One NaN pixel is invisible drawn straight to the canvas and becomes a black block the
// size of the blur kernel once anything post-processes the frame, which is how a fault that had
// been in the geometry all along only showed up when bloom arrived.
//
// So: NaN and zero-length normals, NaN positions, and degenerate (zero-area) triangles, counted per
// mesh with the material colour that identifies it on screen.
//
// Run: npx tsx scripts/scene3d-geometry-check.ts [--mood=X] [circuitId ...]

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

const AUDIT = `(() => {
  const rows = []
  window.__scene.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry
    const pos = g.getAttribute('position')
    const nrm = g.getAttribute('normal')
    if (!pos) return
    let nanNormal = 0, zeroNormal = 0, nanPos = 0
    if (nrm) {
      for (let i = 0; i < nrm.count; i++) {
        const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i)
        if (x !== x || y !== y || z !== z) { nanNormal++; continue }
        if (x === 0 && y === 0 && z === 0) zeroNormal++
      }
    }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      if (x !== x || y !== y || z !== z) nanPos++
    }
    // Degenerate triangles: zero cross product. They draw nothing themselves, but they are what
    // feeds a zero into an averaged vertex normal.
    let degenerate = 0
    const idx = g.index
    const tris = idx ? idx.count / 3 : pos.count / 3
    for (let t = 0; t < tris; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
      const abx = pos.getX(b) - pos.getX(a), aby = pos.getY(b) - pos.getY(a), abz = pos.getZ(b) - pos.getZ(a)
      const acx = pos.getX(c) - pos.getX(a), acy = pos.getY(c) - pos.getY(a), acz = pos.getZ(c) - pos.getZ(a)
      const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx
      if (cx === 0 && cy === 0 && cz === 0) degenerate++
    }
    if (nanNormal || zeroNormal || nanPos || degenerate) {
      const mats = [].concat(o.material)
      rows.push({
        name: o.name || '(unnamed)',
        parent: o.parent && o.parent.name ? o.parent.name : '',
        colour: mats[0] && mats[0].color ? '#' + mats[0].color.getHexString() : '',
        normalMapped: !!(mats[0] && mats[0].normalMap),
        verts: pos.count, tris,
        nanNormal, zeroNormal, nanPos, degenerate,
      })
    }
  })
  let meshes = 0
  window.__scene.traverse((o) => { if (o.isMesh) meshes++ })
  // Grouped by paint, because the fault belongs to whatever BUILDS a surface, not to one instance
  // of it: twenty kerb meshes with the same defect are one bug, not twenty.
  const byColour = new Map()
  for (const r of rows) {
    const key = r.colour + (r.normalMapped ? ' +normalMap' : '')
    const g = byColour.get(key) || { key, meshes: 0, verts: 0, nanNormal: 0, zeroNormal: 0, nanPos: 0, degenerate: 0 }
    g.meshes++; g.verts += r.verts; g.nanNormal += r.nanNormal
    g.zeroNormal += r.zeroNormal; g.nanPos += r.nanPos; g.degenerate += r.degenerate
    byColour.set(key, g)
  }
  const groups = [...byColour.values()]
    .sort((a, b) => (b.nanNormal + b.zeroNormal) - (a.nanNormal + a.zeroNormal) || b.degenerate - a.degenerate)
  return { meshes, groups, flagged: rows.length }
})()`

interface Group {
  key: string
  meshes: number
  verts: number
  nanNormal: number
  zeroNormal: number
  nanPos: number
  degenerate: number
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
  const viewer = resolve(OUT, 'scene3d-geometry-check.html')
  writeFileSync(viewer, '<!doctype html><html><head><meta charset="utf-8"><title>geometry check</title>'
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
    const r = await page.evaluate(AUDIT) as { meshes: number; groups: Group[]; flagged: number }
    console.log(`\n== ${id} (${mood}): ${r.flagged} of ${r.meshes} meshes flagged ==`)
    console.log('  paint                      meshes   verts    NaNn   zeroN   NaNp   degen')
    for (const g of r.groups) {
      console.log(`  ${g.key.padEnd(26)} ${String(g.meshes).padStart(6)}`
        + ` ${String(g.verts).padStart(7)} ${String(g.nanNormal).padStart(7)}`
        + ` ${String(g.zeroNormal).padStart(7)} ${String(g.nanPos).padStart(6)}`
        + ` ${String(g.degenerate).padStart(7)}`)
    }
  }
  await browser.close()
}

main()
