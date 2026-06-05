// Apply the marque palette to the data files (run: npx tsx scripts/apply-colours.ts).
// Each team object is one line carrying both name: "X" / 'X' and color: '#......'; we look up the
// palette by name and rewrite the hex in place, leaving everything else (id, shortName, carPace) untouched.
import { readFileSync, writeFileSync } from 'node:fs'
import { PALETTE } from './colour-check'

const FILES = ['src/data/history/grids.ts', 'src/data/2026-grid.ts']
const nameRe = /name:\s*['"]([^'"]+)['"]/
const colorRe = /(color:\s*')#[0-9A-Fa-f]{6}(')/
const missing = new Set<string>()

for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let changed = 0
  const out = lines.map((line) => {
    if (!colorRe.test(line)) return line
    const m = line.match(nameRe)
    if (!m) return line
    const want = PALETTE[m[1]]
    if (!want) { missing.add(m[1]); return line }
    const next = line.replace(colorRe, `$1${want}$2`)
    if (next !== line) changed++
    return next
  })
  writeFileSync(file, out.join('\n'))
  console.log(`${file}: ${changed} colours rewritten`)
}
if (missing.size) console.log(`MISSING palette entries: ${[...missing].join(', ')}`)
