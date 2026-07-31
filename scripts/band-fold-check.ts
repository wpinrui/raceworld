// Probe: at what camera scale do the relief bands stop being a picture and become a wash?
//
// The bands are the most expensive thing a close frame paints: two ops, alpha 0.30, and between them
// about one full viewport of blended coverage on top of a surface the clear has already written in
// full (`npm run close:fill`). They are coverage-bound rather than reach-bound, so nothing that trims
// or culls geometry touches them. What CAN touch them is that a band is a region, not an outline: with
// no contour inside the cull disc, every pixel of the shot takes the same stack of band fills, and that
// stack is a colour the surface could simply have been cleared to.
//
// So the question is not "which scale looks like one band" but "at which scale does the disc stop
// spanning a boundary", and that is a measurement rather than a threshold to pick. A band is drawn as
// the region at or ABOVE a level, lowest first, so the bands STACK: a point above both levels takes
// both fills. This walks a lap at each scale, asks how often the disc holds no contour at all, and
// prints what the resulting wash would be.
//
// The test is `bandsCovering`, which is the renderer's own: asked of the grid the contours were traced
// from, one cell of margin, nested band counts. So what this prints is the hit rate the shipped fold
// actually gets rather than an approximation of it.
//
// Run: npm run band:check  [circuit ...]

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { densifyTrace } from '../src/lib/ui/track-path'
import { mapPathPoints } from '../src/lib/ui/extrude'
import { bandWash } from '../src/lib/ui/terrain-field'

const VIEW_W = 1600
const VIEW_H = 900
/** 1.45 is the cull disc, which is what a COMPOSE-time decision has to hold for: the camera travels
 *  inside the disc between composes, so a colour chosen at compose time has to be right everywhere in
 *  it. `--margin=1` asks the same question of the viewport alone, which is what a decision taken per
 *  FRAME could use instead. The gap between the two is what that extra machinery would buy. */
const CULL_MARGIN = Number(
  process.argv.slice(2).find((a) => a.startsWith('--margin='))?.split('=')[1] ?? 1.45,
)
/** Stations walked per lap. The camera follows the track, so the track is where the question is asked. */
const STATIONS = 160

const argv = process.argv.slice(2)
const ids = argv.filter((a) => !a.startsWith('--'))
if (ids.length === 0) ids.push(...Object.keys(TRACK_LAYOUTS).sort())

/** Screen pixels per metre, coarsest first. 2 is racing scale, 6 is the close shot, 20 is the wheel's
 *  limit; the rest fill in the range so a crossover lands between printed columns rather than at an end. */
const SCALES = [0.6, 1, 1.5, 2, 3, 4, 6, 8, 12, 20]

/** The cull disc's radius in METRES, which depends on the viewport and the scale and on nothing about
 *  the circuit: half the viewport diagonal in pixels, divided by pixels per metre, times the margin. */
const discRadiusM = (pxPerM: number) => ((Math.hypot(VIEW_W, VIEW_H) / 2) / pxPerM) * CULL_MARGIN


console.log('Relief bands: how often the cull disc holds no band contour, walking a lap at each scale.')
console.log(`Viewport ${VIEW_W}x${VIEW_H}, cull margin ${CULL_MARGIN}, ${STATIONS} stations a lap.`)
console.log('A disc with no contour in it takes one constant stack of band fills over the whole shot,')
console.log('which is a colour the clear could carry instead of two viewport-sized blended fills.\n')

const header = `${'circuit'.padEnd(16)}` + SCALES.map((s) => `${s}px/m`.padStart(8)).join('')
console.log(header)
console.log(`${'disc radius m'.padEnd(16)}` + SCALES.map((s) => discRadiusM(s).toFixed(0).padStart(8)).join(''))
console.log('-'.repeat(header.length))

const foldable: number[][] = SCALES.map(() => [])
const washes = new Map<string, number>()
const violations: string[] = []

for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) { console.log(`${id}: unknown layout`); continue }
  const mpu = layout.metresPerUnit
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: mpu,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
  })

  const centre = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  const stations = Array.from({ length: STATIONS }, (_, i) =>
    centre[Math.floor((i / STATIONS) * centre.length)])

  // Every vertex the bands actually DRAW. The fold is decided off the grid the contours were traced
  // from; this is the other representation of the same thing, and the two agreeing is the whole
  // picture-identity claim. A vertex inside a disc the fold accepted is a contour that would have
  // been on screen and was replaced by a flat wash.
  const drawn: Array<{ x: number; y: number }> = []
  for (const b of scenery.bands) {
    mapPathPoints(b.d, (x, y) => {
      drawn.push({ x, y })
      return { x, y }
    })
  }

  const row: string[] = []
  for (let si = 0; si < SCALES.length; si++) {
    const rU = discRadiusM(SCALES[si]) / mpu
    let clean = 0
    for (const c of stations) {
      const wash = bandWash(scenery.bands, scenery.bandField, scenery.base, {
        cx: c.x, cy: c.y, r: rU,
      })
      if (wash === null) continue
      clean++
      washes.set(wash, (washes.get(wash) ?? 0) + 1)
      if (drawn.some((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= rU * rU)) {
        violations.push(`${id} at ${SCALES[si]}px/m near ${c.x.toFixed(0)},${c.y.toFixed(0)}`)
      }
    }
    const frac = clean / stations.length
    foldable[si].push(frac)
    row.push(`${(frac * 100).toFixed(0)}%`.padStart(8))
  }
  console.log(`${id.padEnd(16)}${row.join('')}`)
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
console.log('-'.repeat(header.length))
console.log(`${'median'.padEnd(16)}` + foldable.map((f) => `${(med(f) * 100).toFixed(0)}%`.padStart(8)).join(''))
console.log(`${'worst layout'.padEnd(16)}` + foldable.map((f) => `${(Math.min(...f) * 100).toFixed(0)}%`.padStart(8)).join(''))
console.log(`\nShots folded with a drawn contour inside the disc: ${violations.length}`)
for (const v of violations.slice(0, 10)) console.log(`  ${v}`)
console.log(`Distinct washes over every foldable shot: ${washes.size}`)
for (const [hex, n] of [...washes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${hex}  ${n} shots`)
}
