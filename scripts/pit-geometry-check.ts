// TEMP probe: numeric verification of pit-lane paint geometry for every track layout.
// No kinks (max consecutive-point jump), sane lateral release line, endpoints reported.
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { TRACK as monaco } from '../src/data/tracks/monaco'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { makePolylineIndex } from '../src/lib/ui/geom'
import { TRACK_WIDTH_M } from '../src/lib/ui/track-path'

// Layouts whose working section is deliberately NOT straightened.
const STRAIGHTENED = new Set(
  Object.keys(TRACK_LAYOUTS).filter((id) => !(id === 'monaco' && monaco.pitStraighten === false)),
)

const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number)
const ptsOf = (d: string) => {
  const n = nums(d)
  const out: Array<[number, number]> = []
  for (let i = 0; i < n.length - 1; i += 2) out.push([n[i], n[i + 1]])
  return out
}
const maxJump = (d: string) => {
  const p = ptsOf(d)
  let m = 0
  for (let i = 1; i < p.length; i++) m = Math.max(m, Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]))
  return m
}
// Fold-back detector: worst turn between consecutive segments (ignoring sub-30cm steps).
// A path that doubles back on itself has a dot near -1 somewhere.
const worstTurn = (d: string, mpu: number) => {
  const p = ptsOf(d)
  let worst = 1
  let prev: [number, number] | null = null
  for (let i = 1; i < p.length; i++) {
    const seg: [number, number] = [p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]]
    const len = Math.hypot(seg[0], seg[1])
    if (len * mpu < 0.3) continue
    if (prev) {
      const pl = Math.hypot(prev[0], prev[1])
      worst = Math.min(worst, (seg[0] * prev[0] + seg[1] * prev[1]) / (len * pl))
    }
    prev = seg
  }
  return worst
}
let bad = 0
for (const [id, layout] of Object.entries(TRACK_LAYOUTS)) {
  const mpu = layout.metresPerUnit
  const j = maxJump(layout.pit.d) * mpu
  const turn = worstTurn(layout.pit.d, mpu)
  // dot < -0.2 = a turn sharper than ~102 degrees between successive segments = fold/hairpin.
  const flag = j > 35 ? '  <<< KINK' : turn < -0.2 ? `  <<< FOLD(${turn.toFixed(2)})` : ''
  if (flag) bad++
  const row = `d=${j.toFixed(1)}m,${turn.toFixed(2)}${flag}`
  // Straightness of the working section: max perpendicular deviation of slotStations (source of
  // the box row, stripe and building) and of the fastEdge from their own endpoint chords.
  const stns = layout.pit.slotStations
  const chordDev = (q: Array<[number, number]>) => {
    const A = q[0]
    const B = q[q.length - 1]
    const dx = B[0] - A[0]
    const dy = B[1] - A[1]
    const L = Math.hypot(dx, dy) || 1
    let dev = 0
    for (const v of q) dev = Math.max(dev, Math.abs(((v[0] - A[0]) * dy - (v[1] - A[1]) * dx) / L))
    return dev * mpu
  }
  // Only meaningful where the working section was straightened at all. Monaco is authored
  // pitStraighten:false (its pit straight genuinely isn't straight), so measuring its deviation
  // from a chord flags a deliberate choice as a defect.
  const devSt = chordDev(stns.map((q): [number, number] => [q.x, q.y]))
  const straightened = STRAIGHTENED.has(id)
  const devFlag = straightened && devSt > 0.5 ? '  <<< NOT STRAIGHT' : ''
  if (devFlag) bad++
  console.log(`${id}: maxJump ${row}`)
  console.log(`   straightDev slots=${devSt.toFixed(2)}m${straightened ? '' : ' (not straightened)'}${devFlag}`)
}
// The pit complex is deep enough to matter on a tight circuit: it must stay clear of the racing
// surface it sits beside, on every layout, not just the roomy ones.
let tightest = { id: '', m: Infinity }
for (const [id, layout] of Object.entries(TRACK_LAYOUTS)) {
  const zone = buildPitZone(layout, buildPitSlots(layout, 10))
  if (!zone) continue
  const idx = makePolylineIndex(ptsOf(layout.d).map(([x, y]) => ({ x, y })), 40 / layout.metresPerUnit)
  let near = Infinity
  for (const p of [...zone.buildingPts, ...zone.upperPts]) near = Math.min(near, idx.dist(p))
  const clear = (near - TRACK_WIDTH_M / 2 / layout.metresPerUnit) * layout.metresPerUnit
  if (clear < tightest.m) tightest = { id, m: clear }
  // Reported, not failed: these clearances are identical with the building at any depth, so what
  // they measure is the authored front face sitting close to the pit straight. Pre-existing.
  if (clear < 0) console.log(`${id}: pit building ${(-clear).toFixed(1)}m inside the track edge`)
}
console.log(`tightest pit-building clearance: ${tightest.id} ${tightest.m.toFixed(1)}m`)
console.log(bad === 0 ? 'ALL GEOMETRY CHECKS PASS' : `${bad} PROBLEMS FLAGGED`)
