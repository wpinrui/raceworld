// Generate a static HTML preview of the chosen team colours (run: npx tsx scripts/team-colours-preview.ts).
// Renders, on the game's dark UI background: a per-marque legend, then every season's full grid so the
// within-season differentiability and the cross-season consistency can both be eyeballed before merge.
import { writeFileSync } from 'node:fs'
import { historicalGrids } from '../src/data/history/grids'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Per-marque (one colour per name, in first-seen order) for the legend.
const seen = new Map<string, string>()
const order: string[] = []
for (const g of historicalGrids) for (const t of g.teams) {
  if (!seen.has(t.name)) { seen.set(t.name, t.color); order.push(t.name) }
}

const chip = (name: string, color: string, hex: boolean) => `
  <div class="chip">
    <div class="sw" style="background:${color}"><span>${esc(name)}</span></div>
    ${hex ? `<div class="hex">${color}</div>` : ''}
  </div>`

const legend = `
  <section>
    <h2>Marque palette (${order.length} marques)</h2>
    <div class="grid">
      ${[...order].sort((a, b) => a.localeCompare(b)).map((n) => chip(n, seen.get(n)!, true)).join('')}
    </div>
  </section>`

const seasons = [...historicalGrids].sort((a, b) => b.year - a.year).map((g) => `
  <section>
    <h2>${g.year} <span class="count">${g.teams.length} teams</span></h2>
    <div class="grid">
      ${g.teams.map((t) => chip(t.name, t.color, true)).join('')}
    </div>
  </section>`).join('')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>RaceWorld team colours</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0F1419; color: #FFFFFF; font: 14px/1.4 system-ui, sans-serif; padding: 28px 32px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lede { color: #FFFFFF; opacity: .7; margin: 0 0 28px; max-width: 70ch; }
  section { margin: 0 0 26px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 10px; border-bottom: 1px solid #2A3142; padding-bottom: 6px; }
  .count { float: right; opacity: .5; font-weight: 400; letter-spacing: 0; text-transform: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; }
  .chip { background: #1E2431; border: 1px solid #2A3142; border-radius: 8px; overflow: hidden; }
  .sw { height: 54px; display: flex; align-items: center; justify-content: center; padding: 4px; }
  .sw span { font-size: 12px; font-weight: 700; color: #FFFFFF; text-shadow: 0 1px 2px rgba(0,0,0,.6); text-align: center; }
  .hex { font: 11px/1 ui-monospace, monospace; color: #FFFFFF; opacity: .65; padding: 6px; text-align: center; }
</style></head>
<body>
  <h1>RaceWorld team colours</h1>
  <p class="lede">One identity colour per marque, applied across every season it appears. Goal order: every team in a season is tellable apart, the colour reads as that team's identity, and where possible it suits the era. Swatches sit on the in-game dark background; names are shown in the same pure-white the UI uses.</p>
  ${legend}
  ${seasons}
</body></html>`

writeFileSync('team-colours.html', html)
console.log(`Wrote team-colours.html (${order.length} marques, ${historicalGrids.length} seasons)`)
