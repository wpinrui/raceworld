// Probe: the sky's resource lifecycle against a REAL WebGL context (#photoreal).
//
// Unit tests cannot reach this. `buildSky` renders, so it needs a GL context, and jsdom has none;
// the sky is therefore invisible to vitest and was shipped once already with a crash in it. The
// crash was pure lifecycle: React runs effect cleanups in declaration order, so `Scene3DCanvas`
// tore its renderer down before the cube it had baked, and three then walked the cube's six
// framebuffer handles out of a property map that `renderer.dispose()` had just emptied.
//
// So the orders the app actually performs are checked here, in a headless browser, the same way
// `scene3d-preview` renders its stills.
//
// Run: npx tsx scripts/scene3d-lifecycle-check.ts

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const OUT = 'scripts/.preview'

interface Case { name: string; must: 'pass' | 'report'; error: string | null }

async function main() {
  mkdirSync(OUT, { recursive: true })
  const bundle = await build({
    entryPoints: ['scripts/scene3d-lifecycle-entry.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    alias: { '@': resolve('src') },
    logLevel: 'silent',
  })
  const page = resolve(OUT, 'scene3d-lifecycle.html')
  writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8">'
    + '<title>scene3d lifecycle</title></head><body>'
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
    console.error('neither Edge nor Chrome could be launched')
    process.exitCode = 1
    return
  }

  const tab = await browser.newPage()
  tab.on('pageerror', (err) => console.error(`page error: ${err.message}`))
  await tab.goto(pathToFileURL(page).href)
  await tab.waitForFunction('window.__done === true', undefined, { timeout: 120_000 })
  const cases = await tab.evaluate('window.__cases') as Case[]
  await browser.close()

  for (const c of cases) {
    const verdict = c.error ? `THREW ${c.error}` : 'ok'
    if (c.must === 'pass' && c.error) process.exitCode = 1
    console.log(`${c.must === 'pass' ? 'MUST PASS' : '   report'}  ${c.name.padEnd(46)} ${verdict}`)
  }
  if (process.exitCode === 1) console.error('\na sequence the app performs is throwing')
}

main()
