// Enumerate team lineage timelines + transitions (run: npx tsx scripts/team-transitions.ts).
// A lineage = a stable team id across seasons. Rebrand = name change between consecutive seasons on the
// same id; arrival = a lineage's first season after the opening year; departure = its last season before
// the final year; gap = a non-consecutive jump (lineage left and returned).
import { historicalGrids } from '../src/data/history/grids'

const byId = new Map<string, { year: number; name: string }[]>()
for (const g of [...historicalGrids].sort((a, b) => a.year - b.year)) for (const t of g.teams) {
  if (!byId.has(t.id)) byId.set(t.id, [])
  byId.get(t.id)!.push({ year: g.year, name: t.name })
}
const years = historicalGrids.map((g) => g.year)
const minY = Math.min(...years), maxY = Math.max(...years)

for (const [id, seqRaw] of [...byId.entries()].sort()) {
  const seq = seqRaw.sort((a, b) => a.year - b.year)
  const first = seq[0], last = seq[seq.length - 1]
  const rebrands: string[] = []
  const gaps: string[] = []
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].name !== seq[i - 1].name) rebrands.push(`${seq[i - 1].name} -> ${seq[i].name} @${seq[i].year}`)
    if (seq[i].year !== seq[i - 1].year + 1) gaps.push(`${seq[i - 1].year}..${seq[i].year}`)
  }
  const arrival = first.year > minY ? `ARRIVE ${first.name} @${first.year}` : `(grid-1 ${first.name})`
  const departure = last.year < maxY ? `DEPART ${last.name} @${last.year}` : `(active thru ${last.year})`
  // distinct names across the lineage, in order
  const names = seq.map((s) => s.name).filter((n, i, a) => i === 0 || n !== a[i - 1])
  console.log(`\n[${id}]  ${first.year}-${last.year}  ${names.join(' / ')}`)
  console.log(`   ${arrival}  |  ${departure}`)
  if (rebrands.length) console.log(`   rebrands: ${rebrands.join('  |  ')}`)
  if (gaps.length) console.log(`   GAPS: ${gaps.join(', ')}`)
}
