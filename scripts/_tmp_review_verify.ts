import { TRACK_LAYOUTS } from '../src/data/tracks'
import { CIRCUIT_BIOMES } from '../src/lib/ui/biomes'
import { CIRCUITS } from '../src/data/calendars/circuits'

const ids = Object.keys(TRACK_LAYOUTS)
console.log(`TRACK_LAYOUTS ids: ${ids.length}`)
const missingBiome = ids.filter((id) => !(id in CIRCUIT_BIOMES))
console.log('layouts missing a CIRCUIT_BIOMES entry:', missingBiome.length ? missingBiome : 'none')
const extraBiome = Object.keys(CIRCUIT_BIOMES).filter((id) => !(id in TRACK_LAYOUTS))
console.log('CIRCUIT_BIOMES keys with no layout:', extraBiome.length ? extraBiome : 'none')
const notInCircuits = ids.filter((id) => !(id in CIRCUITS))
console.log('layout ids absent from CIRCUITS registry:', notInCircuits.length ? notInCircuits : 'none')
const circuitsNoLayout = Object.keys(CIRCUITS).filter((id) => !(id in TRACK_LAYOUTS))
console.log('CIRCUITS with no layout (fallback):', circuitsNoLayout)

// NaN / finite scan over every produced geometry string + numbers
const badNum = (s: string) => /NaN|Infinity|undefined/.test(s)
let problems = 0
for (const [id, L] of Object.entries(TRACK_LAYOUTS)) {
  const checks: Array<[string, string]> = [['d', L.d], ['pit.d', L.pit.d], ['pit.fastD', L.pit.fastD]]
  L.pit.hatches.forEach((h, i) => checks.push([`hatch[${i}]`, h]))
  for (const [k, v] of checks) if (badNum(v)) { console.log(`NaN/undefined in ${id}.${k}`); problems++ }
  if (!Number.isFinite(L.metresPerUnit) || L.metresPerUnit <= 0) { console.log(`${id}: bad metresPerUnit ${L.metresPerUnit}`); problems++ }
  if (!Number.isFinite(L.start.angle)) { console.log(`${id}: bad start angle`); problems++ }
  if (!Number.isFinite(L.pit.box.x) || !Number.isFinite(L.pit.box.y)) { console.log(`${id}: bad pit box`); problems++ }
  for (const s of L.pit.slotStations) {
    if (![s.x, s.y, s.nx, s.ny, s.rot].every(Number.isFinite)) { console.log(`${id}: non-finite slotStation`); problems++; break }
  }
  if (L.pit.slotStations.length === 0) { console.log(`${id}: ZERO slotStations`); problems++ }
  if (L.pit.hatches.length === 0) console.log(`${id}: no hatch wedges (${L.pit.slotStations.length} slots)`)
}
console.log(problems === 0 ? 'geometry finite: OK' : `${problems} finite/NaN problems`)
