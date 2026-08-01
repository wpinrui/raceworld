import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

async function main() {
  const page = resolve('scripts/.preview/car-3d-viewer.html')
  let browser = null
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      browser = await chromium.launch({ channel, headless: true, args: ['--allow-file-access-from-files'] })
      break
    } catch { /* next */ }
  }
  if (!browser) throw new Error('no browser')
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  tab.on('pageerror', (e) => console.error(`PAGE ERROR: ${e.message}`))
  tab.on('console', (m) => { if (m.type() === 'error') console.error(`console: ${m.text()}`) })
  await tab.goto(pathToFileURL(page).href)
  await tab.waitForTimeout(3000)
  for (const v of [1000, 800, 640, 520, 400, 240, 60]) {
    await tab.evaluate((value) => {
      const el = document.getElementById('zoom') as HTMLInputElement
      el.value = String(value)
      el.dispatchEvent(new Event('input'))
    }, v)
    await tab.waitForTimeout(700)
    console.log(`\n===== slider ${v} =====`)
    console.log(await tab.locator('#hud').innerText())
    await tab.screenshot({ path: `scripts/.preview/fleet-${v}.png` })
  }
  await browser.close()
}

main()
