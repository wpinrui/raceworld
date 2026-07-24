const t0 = Date.now()
import('../src/data/tracks').then(({ TRACK_LAYOUTS }) => {
  const t1 = Date.now()
  console.log(`TRACK_LAYOUTS module build: ${t1 - t0} ms (includes tsx compile)`)
  const counts: Record<number, string[]> = {}
  let zero = 0
  for (const [id, L] of Object.entries(TRACK_LAYOUTS)) {
    const n = L.pit.hatches.length
    ;(counts[n] ??= []).push(id)
    if (n === 0) zero++
  }
  for (const k of Object.keys(counts).sort()) console.log(`  hatches=${k}: ${counts[+k].length} tracks -> ${counts[+k].join(', ')}`)
  console.log(`zero-hatch tracks: ${zero}/${Object.keys(TRACK_LAYOUTS).length}`)
  // slot station counts + straight-section length in metres
  for (const [id, L] of Object.entries(TRACK_LAYOUTS)) {
    const s = L.pit.slotStations
    const a = s[0], b = s[s.length - 1]
    const lenM = Math.hypot(b.x - a.x, b.y - a.y) * L.metresPerUnit
    if (lenM < 150 || lenM > 900) console.log(`  ${id}: pit straight ${lenM.toFixed(0)} m  <<< out of plausible range`)
  }
})
