// Probe: the horizontal brightness bands that walk across the GRASS when a zoomed-in camera tilts.
// Reported from the live view at 73 px/m and a near-flat tilt; the road and the standing world do
// not show it, and it is stable the instant the camera stops.
//
// Drives the preview page's `__orbit` (the same `applyOrbitCam`, shadow refit and fog refit the race
// canvas runs per camera move), then reads back a column of pixels down the middle of the frame and
// looks for STEPS in it. A step is the artifact; what zoom brings it out, and which toggle removes
// it, is the diagnosis. The camera is pointed at OPEN GROUND off the circuit, so the column is the
// base plane and nothing else: no road, no tree, no shadow of either to confuse a reading.
//
// Streams a line per viewpoint and per toggle, so the sweep says something after the first one.
//
// Run: npx tsx scripts/scene3d-grass-band.ts [--id=britain] [--pitch=78] [--shots]

import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Page } from 'playwright-core'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const arg = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const id = arg('id', 'britain')
const pitch = Number(arg('pitch', '78'))
const shots = argv.includes('--shots')
const W = 900
const H = 700

/** Zoom scalars to sweep, as the map's own `z`. The report says the bands need real zoom. */
const ZOOMS = [4, 8, 16, 32, 64, 128, 256]

type Col = Array<[number, number, number]>

/** Read the frame and average each row ACROSS THE WHOLE WIDTH, top row first.
 *
 *  Row means, not a single column, and that is the measurement this probe turns on. A band is
 *  full-width by definition; the grain that covers the same ground is not, and averaging 900 pixels
 *  puts it under a tenth of a grey level while leaving a band at its full height. A column reads the
 *  two at the same size and cannot tell them apart. */
const READ_ROWS = `(() => {
  window.__post.render()
  const gl = window.__renderer.getContext()
  const w = window.__renderer.domElement.width
  const h = window.__renderer.domElement.height
  const px = new Uint8Array(4 * w * h)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const rows = []
  for (let y = h - 1; y >= 0; y--) {
    let r = 0, g = 0, b = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      r += px[i]; g += px[i + 1]; b += px[i + 2]
    }
    rows.push([r / w, g / w, b / w])
  }
  return rows
})()`

/** Hold the base ground plane and its material: the biggest mesh in the world by XZ footprint. */
const FIND_GROUND = `(() => {
  const THREE = window.__THREE
  let best = null
  let area = 0
  window.__scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    o.geometry.computeBoundingBox()
    const b = o.geometry.boundingBox
    if (!b) return
    const a = (b.max.x - b.min.x) * (b.max.z - b.min.z)
    if (a > area) { area = a; best = o }
  })
  window.__ground = best
  const m = best && best.material
  return best ? {
    area,
    colour: m.color ? '#' + m.color.getHexString() : null,
    normalMap: !!m.normalMap,
    normalScale: m.normalScale ? m.normalScale.x : null,
    map: !!m.map,
    roughness: m.roughness,
    tris: (best.geometry.index ? best.geometry.index.count : best.geometry.attributes.position.count) / 3,
  } : null
})()`

/** Each toggle: something switched OFF, then back on, so one run answers every suspect. */
const TOGGLES: Array<{ name: string; on: string; off: string }> = [
  {
    name: 'baseline',
    on: 'null',
    off: 'null',
  },
  {
    name: 'ground normalScale 0',
    on: 'window.__ground.material.normalScale.set(0, 0)',
    off: 'window.__ground.material.normalScale.set(window.__saved.ns, window.__saved.ns)',
  },
  {
    name: 'ground normalMap off',
    on: 'window.__ground.material.normalMap = null; window.__ground.material.needsUpdate = true',
    off: 'window.__ground.material.normalMap = window.__saved.nm; window.__ground.material.needsUpdate = true',
  },
  {
    name: 'ground albedo map off',
    on: 'window.__ground.material.map = null; window.__ground.material.needsUpdate = true',
    off: 'window.__ground.material.map = window.__saved.map; window.__ground.material.needsUpdate = true',
  },
  {
    name: 'shadow map off',
    on: 'window.__renderer.shadowMap.enabled = false; window.__scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true })',
    off: 'window.__renderer.shadowMap.enabled = true; window.__scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true })',
  },
  {
    name: 'environment off',
    on: 'window.__scene.environment = null',
    off: 'window.__scene.environment = window.__saved.env',
  },
  {
    name: 'fog off',
    on: 'window.__saved.fogNow = window.__scene.fog; window.__scene.fog = null; window.__scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true })',
    off: 'window.__scene.fog = window.__saved.fogNow; window.__scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true })',
  },
  {
    name: 'bloom off (straight render)',
    on: 'window.__straight = true',
    off: 'window.__straight = false',
  },
  {
    name: 'base plane alone',
    on: 'window.__scene.traverse((o) => { if (o.isMesh && o !== window.__ground) { o.userData.wasVisible = o.visible; o.visible = false } })',
    off: 'window.__scene.traverse((o) => { if (o.isMesh && o !== window.__ground) o.visible = o.userData.wasVisible !== false })',
  },
]

const SAVE = `(() => {
  const m = window.__ground.material
  window.__saved = {
    ns: m.normalScale ? m.normalScale.x : 1,
    nm: m.normalMap,
    map: m.map,
    env: window.__scene.environment,
  }
  // A straight render, for the toggle that takes the composer out of the picture.
  const post = window.__post
  window.__post = { render: () => (window.__straight
    ? window.__renderer.render(window.__scene, window.__camera)
    : post.render()) }
})()`

/** Rows where the profile steps in green, smoothed either side so one noisy row is not an edge. */
function steps(col: Col, eps = 0.25): Array<{ row: number; jump: number }> {
  const win = 5
  const raw: Array<{ row: number; jump: number }> = []
  for (let y = win; y < col.length - win; y++) {
    let a = 0
    let b = 0
    for (let k = 1; k <= win; k++) {
      a += col[y - k][1]
      b += col[y + k][1]
    }
    const jump = (b - a) / win
    if (Math.abs(jump) >= eps) raw.push({ row: y, jump })
  }
  const out: Array<{ row: number; jump: number }> = []
  for (const s of raw) {
    const last = out[out.length - 1]
    if (last && s.row - last.row <= 8) {
      if (Math.abs(s.jump) > Math.abs(last.jump)) out[out.length - 1] = s
    } else out.push(s)
  }
  return out
}

/** Only the rows that are GRASS, and only the ones clear of the HORIZON.
 *
 *  The horizon has to go or it is the only thing this probe ever reports: ground running to the haze
 *  falls tens of grey levels over a few rows, which dwarfs a band by a factor of twenty and pins
 *  every reading to the same handful of rows at the top of the ground. So the first fifth of the
 *  ground column is dropped, and what is left is the near and middle distance the bands were
 *  reported in. */
function grassRows(col: Col): [number, number] {
  let lo = -1
  let hi = -1
  for (let y = 0; y < col.length; y++) {
    const [r, g, b] = col[y]
    if (g > r + 8 && g > b + 8) {
      if (lo < 0) lo = y
      hi = y
    }
  }
  if (lo < 0) return [lo, hi]
  return [lo + Math.round((hi - lo) * 0.2), hi]
}

/** The row-mean green down the ground, for eyes rather than for a threshold. */
function profile(col: Col, lo: number, hi: number, every = 12): string {
  const out: string[] = []
  for (let y = lo; y <= hi; y += every) out.push(`${y}:${col[y][1].toFixed(1)}`)
  return out.join(' ')
}

/** The reading: how far the grass column swings, and the biggest steps in it. */
function measure(col: Col): { span: number; edges: Array<{ row: number; jump: number }>; lo: number; hi: number } {
  const [lo, hi] = grassRows(col)
  if (lo < 0 || hi - lo < 40) return { span: -1, edges: [], lo, hi }
  const inner = col.slice(lo, hi)
  const greens = inner.map((c) => c[1])
  const edges = steps(inner)
    .map((s) => ({ row: lo + s.row, jump: s.jump }))
    .sort((a, b) => Math.abs(b.jump) - Math.abs(a.jump))
  return { span: Math.max(...greens) - Math.min(...greens), edges, lo, hi }
}

function line(m: ReturnType<typeof measure>): string {
  if (m.span < 0) return 'no grass column in shot'
  const top = m.edges.slice(0, 4).map((e) => `${e.row}:${e.jump > 0 ? '+' : ''}${e.jump.toFixed(2)}`)
  return `rows ${m.lo}..${m.hi}  span ${m.span.toFixed(1).padStart(5)}  ${String(m.edges.length).padStart(2)} step(s)`
    + (top.length ? `  ${top.join(' ')}` : '')
}

async function column(page: Page): Promise<Col> {
  return await page.evaluate(READ_ROWS) as Col
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
  for (const f of ['trees.glb', 'low_poly_forest_tree_pack.glb']) {
    copyFileSync(`public/models/${f}`, resolve(OUT, f))
  }
  const html = resolve(OUT, 'grass-band.html')
  writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"></head>'
    + '<body style="margin:0"><canvas id="gl"></canvas>'
    + `<script>${bundle.outputFiles[0].text}</script></body></html>`)

  let browser = null
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      browser = await chromium.launch({
        channel, headless: true, args: ['--allow-file-access-from-files'],
      })
      break
    } catch {
      // next channel
    }
  }
  if (!browser) {
    console.error('neither Edge nor Chrome could be launched')
    process.exitCode = 1
    return
  }
  const page = await browser.newPage()
  page.on('pageerror', (err) => console.error(`page error: ${err.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`page error: ${m.text()}`)
  })

  await page.goto(`${pathToFileURL(html).href}?shot=1&id=${id}&pitch=${pitch}&ez=1&w=${W}&h=${H}`)
  await page.waitForFunction('window.__done === true', undefined, { timeout: 180_000 })
  const err = await page.evaluate('window.__error')
  if (err) {
    console.error(err)
    process.exitCode = 1
    await browser.close()
    return
  }
  await page.setViewportSize({ width: W, height: H })

  const mpu = await page.evaluate('window.__mpu') as number
  const full = await page.evaluate('window.__full') as { x: number; y: number; w: number; h: number }
  const ground = await page.evaluate(FIND_GROUND) as Record<string, unknown> | null
  await page.evaluate(SAVE)
  const pxm = (z: number) => (z * (W / full.w)) / mpu
  console.log(`${id}: ${mpu.toFixed(3)} m/unit, viewBox ${full.w.toFixed(0)}x${full.h.toFixed(0)}u`)
  console.log(`ground plane: ${JSON.stringify(ground)}`)

  // Open ground well clear of the circuit: the base plane on its own.
  const target = { x: full.x - full.w, z: full.y + full.h / 2 }
  const look = (z: number) => page.evaluate(
    `window.__orbit(${JSON.stringify({ tx: target.x, tz: target.z, pitch: (pitch * Math.PI) / 180, z })}, { w: ${W}, h: ${H} })`,
  )

  console.log(`\nzoom sweep at pitch ${pitch}, on open ground`)
  for (const z of ZOOMS) {
    await look(z)
    const m = measure(await column(page))
    console.log(`  z ${String(z).padStart(4)} (${pxm(z).toFixed(0).padStart(4)} px/m)  ${line(m)}`)
    if (shots) await page.locator('#gl').screenshot({ path: `${OUT}/grass-band-z${z}.png` })
  }

  // The shape itself, at the zoom the report came from, printed rather than thresholded.
  const reported = Math.round((73 * mpu) / (W / full.w))
  await look(reported)
  const shot = await column(page)
  const [plo, phi] = grassRows(shot)
  console.log(`\nrow-mean green at z ${reported} (${pxm(reported).toFixed(0)} px/m), rows ${plo}..${phi}`)
  console.log(`  ${profile(shot, plo, phi)}`)
  if (shots) await page.locator('#gl').screenshot({ path: `${OUT}/grass-band-reported.png` })

  // The discriminator. A world-fixed feature (a scenery band, a terrain patch) SLIDES when the
  // camera pans over the ground and turns with the camera's bearing. Anything camera-relative (a
  // filtering level, a depth bias, a fitted box) stays pinned to the same screen row and stays
  // horizontal, because it is a function of distance from the eye and nothing else.
  console.log(`\npan across the ground at z ${reported}, pitch ${pitch}: does the edge move`)
  for (const d of [0, 20, 40, 80, 160]) {
    await page.evaluate(
      `window.__orbit(${JSON.stringify({ tx: target.x + d, tz: target.z, pitch: (pitch * Math.PI) / 180, z: reported })}, { w: ${W}, h: ${H} })`,
    )
    const m = measure(await column(page))
    const edge = m.edges[0]
    console.log(`  +${String(d).padStart(3)}u east  biggest step ${edge ? `row ${edge.row} ${edge.jump.toFixed(2)}` : 'none'}`)
  }
  console.log(`\nturn the camera at z ${reported}, pitch ${pitch}: does the edge stay horizontal`)
  for (const r of [0, 30, 60, 90]) {
    await page.evaluate(
      `window.__orbit(${JSON.stringify({ tx: target.x, tz: target.z, rot: (r * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, z: reported })}, { w: ${W}, h: ${H} })`,
    )
    const m = measure(await column(page))
    const edge = m.edges[0]
    console.log(`  rot ${String(r).padStart(3)}deg   biggest step ${edge ? `row ${edge.row} ${edge.jump.toFixed(2)}` : 'none'}`)
  }
  await page.evaluate(`window.__orbit({ rot: 0 }, { w: ${W}, h: ${H} })`)

  // ...and ACROSS it, which the sweep above did not do: the edge lies east-west, so panning east
  // slides the camera ALONG it and proves nothing. North-south is the axis that tells them apart.
  console.log(`\npan north-south at z ${reported}, pitch ${pitch}: does the edge move`)
  for (const d of [0, 20, 40, 80, 160]) {
    await page.evaluate(
      `window.__orbit(${JSON.stringify({ tx: target.x, tz: target.z + d, pitch: (pitch * Math.PI) / 180, z: reported })}, { w: ${W}, h: ${H} })`,
    )
    const m = measure(await column(page))
    const edge = m.edges[0]
    console.log(`  +${String(d).padStart(3)}u north  biggest step ${edge ? `row ${edge.row} ${edge.jump.toFixed(2)}` : 'none'}`)
  }
  await look(reported)

  // Which mesh is drawing over the ground: hide the big flat ones one at a time and see which
  // takes the step with it.
  const meshes = await page.evaluate(`(() => {
    const out = []
    window.__scene.traverse((o) => {
      if (!o.isMesh || o === window.__ground || o.isInstancedMesh) return
      o.geometry.computeBoundingBox()
      const b = o.geometry.boundingBox
      if (!b) return
      const area = (b.max.x - b.min.x) * (b.max.z - b.min.z)
      const flat = (b.max.y - b.min.y) < 1
      if (!flat || area < 100) return
      o.userData.probeId = out.length
      const m = o.material
      out.push({
        i: out.length, area: Math.round(area),
        colour: m.color ? '#' + m.color.getHexString() : null,
        alpha: m.opacity, transparent: !!m.transparent, offset: m.polygonOffsetFactor,
      })
    })
    return out.sort((a, b) => b.area - a.area).slice(0, 12)
  })()`) as Array<Record<string, unknown>>
  console.log(`\nflat sheets over the ground, biggest first (${meshes.length} shown)`)
  for (const mesh of meshes) {
    await page.evaluate(`window.__scene.traverse((o) => { if (o.userData.probeId === ${mesh.i}) o.visible = false })`)
    const m = measure(await column(page))
    const edge = m.edges[0]
    console.log(`  #${String(mesh.i).padStart(2)} ${String(mesh.colour).padEnd(8)} area ${String(mesh.area).padStart(9)}`
      + ` a${String(mesh.alpha).padEnd(4)} off ${String(mesh.offset).padStart(3)}`
      + `  hidden -> biggest step ${edge ? `row ${edge.row} ${edge.jump.toFixed(2)}` : 'none'}`)
    await page.evaluate(`window.__scene.traverse((o) => { if (o.userData.probeId === ${mesh.i}) o.visible = true })`)
  }

  console.log(`\ntoggles at z ${reported} (${pxm(reported).toFixed(0)} px/m)`)
  await look(reported)
  for (const t of TOGGLES) {
    if (t.on !== 'null') await page.evaluate(t.on)
    const col = await column(page)
    const m = measure(col)
    console.log(`  ${t.name.padEnd(28)} ${line(m)}`)
    console.log(`    ${profile(col, m.lo, m.hi, 24)}`)
    if (shots) await page.locator('#gl').screenshot({ path: `${OUT}/grass-band-${t.name.replace(/[^a-z0-9]+/gi, '-')}.png` })
    if (t.off !== 'null') await page.evaluate(t.off)
  }

  await browser.close()
}

main()
