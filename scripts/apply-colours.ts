// Apply the marque palette to the data files (run: npx tsx scripts/apply-colours.ts).
// Each team object is one line carrying both name: "X" / 'X' and color: '#......'; we look up the
// palette by name and rewrite the hex in place, leaving everything else (id, shortName, carPace) untouched.
import { readFileSync, writeFileSync } from 'node:fs'
import { colourFor } from './colour-check'

// 2026-grid.ts is a flat array with no per-season `year:` line; it's the 2026 default grid.
const FILES: { path: string; defaultYear: number }[] = [
  { path: 'src/data/history/grids.ts', defaultYear: 0 },
  { path: 'src/data/2026-grid.ts', defaultYear: 2026 },
]
const yearRe = /year:\s*(\d{4})/
const nameRe = /name:\s*['"]([^'"]+)['"]/
const colorRe = /(color:\s*')#[0-9A-Fa-f]{6}(')/
const missing = new Set<string>()

for (const { path, defaultYear } of FILES) {
  let year = defaultYear
  let changed = 0
  const out = readFileSync(path, 'utf8').split('\n').map((line) => {
    const y = line.match(yearRe)
    if (y) year = Number(y[1])
    if (!colorRe.test(line)) return line
    const m = line.match(nameRe)
    if (!m) return line
    const want = colourFor(year, m[1])
    if (!want) { missing.add(m[1]); return line }
    const next = line.replace(colorRe, `$1${want}$2`)
    if (next !== line) changed++
    return next
  })
  writeFileSync(path, out.join('\n'))
  console.log(`${path}: ${changed} colours rewritten`)
}
if (missing.size) console.log(`MISSING palette entries: ${[...missing].join(', ')}`)
