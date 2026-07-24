import { TRACK_LAYOUTS } from '../src/data/tracks'
const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number)
const ptsOf = (d: string) => { const n = nums(d); const o: [number, number][] = []; for (let i = 0; i < n.length - 1; i += 2) o.push([n[i], n[i + 1]]); return o }
for (const id of ['abu-dhabi', 'china', 'estoril', 'hungary', 'usa', 'portimao', 'qatar', 'netherlands']) {
  const L = TRACK_LAYOUTS[id]
  const p = ptsOf(L.pit.d)
  let worst = 1, wi = -1
  let prev: [number, number] | null = null, previ = -1
  for (let i = 1; i < p.length; i++) {
    const seg: [number, number] = [p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]]
    const l = Math.hypot(seg[0], seg[1])
    if (l * L.metresPerUnit < 0.3) continue
    if (prev) {
      const pl = Math.hypot(prev[0], prev[1])
      const dot = (seg[0] * prev[0] + seg[1] * prev[1]) / (l * pl)
      if (dot < worst) { worst = dot; wi = i }
    }
    prev = seg; previ = i
  }
  // k index in the 0..80 station array: d has 1 + 2*(STEPS-1) + 1 points roughly
  const frac = wi / (p.length - 1)
  console.log(`${id}: worst dot ${worst.toFixed(2)} at parsed idx ${wi}/${p.length - 1} (${(frac * 100).toFixed(0)}% along the lane), pt=${JSON.stringify(p[wi])}`)
}
