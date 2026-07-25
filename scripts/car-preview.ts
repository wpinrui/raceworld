// Probe: the car sprite alone, big, at every heading, so the fake light on it can actually be judged
// (#sim-2d increment B). The scenery preview draws cars at their true footprint, which is a handful of
// pixels -- correct, and useless for checking whether a highlight is locked to the world or painted on
// the sprite.
//
// A ring of cars all pointing different ways is the whole test: if the light is world-locked, EVERY
// highlight faces the same corner of the image and every shadow falls the same way, however the car
// underneath it is turned. If any of them turns with its car, the ring gives it away at a glance.
// Run: npx tsx scripts/car-preview.ts [--mood=afternoon|midday|dusk|overcast|night]

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { CarSprite } from '../src/components/race/CarSprite'
import {
  SPRITE, STRAIGHT, WHEELBASE_M, carAttitude, carLight, steerAngles, type Steer,
} from '../src/lib/ui/car-sprite'
import { MOODS, dirAt, type Mood } from '../src/lib/ui/lighting'
import { PROFILE_N, lapDynamics, lateralG, trackPhysics } from '../src/lib/ui/lap-dynamics'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const moodArg = (argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon') as Mood
const lighting = MOODS[moodArg] ?? MOODS.afternoon
const light = carLight(lighting)

const W = 1100
const H = 1740
const RING = { cx: 550, cy: 470, r: 330, n: 16 }
const CAR = 150 // sprite length in output pixels
const LIVERIES = ['#E8442E', '#2F7BE8', '#F2C230', '#39B26A', '#B565E0', '#E8792E', '#39C4C4', '#E85BA0']

/** One sprite as a <g>, placed and turned. A nested <svg> would clip the contact shadow's tail. */
function car(i: number, x: number, y: number, spriteRot: number, lat: number, long: number, color?: string, steer: Steer = STRAIGHT): string {
  const sprite = renderToStaticMarkup(createElement(CarSprite, {
    id: `c${i}`,
    color: color ?? LIVERIES[i % LIVERIES.length],
    length: SPRITE.len,
    light,
    spriteRot,
    attitude: carAttitude(lat, long),
    steer,
  }))
  const body = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const scale = CAR / SPRITE.len
  return `<g transform="translate(${x} ${y}) rotate(${(spriteRot * 180) / Math.PI}) scale(${scale}) `
    + `translate(${-SPRITE.cx} ${-SPRITE.cy})">${body}</g>`
}

const label = (x: number, y: number, s: string, anchor = 'middle') =>
  `<text x="${x}" y="${y}" fill="#FFFFFF" font-family="sans-serif" font-size="18" text-anchor="${anchor}">${s}</text>`

/** One car, big, for judging the parts rather than the lighting: suspension geometry and steering. */
function detail() {
  const L = 760
  const w = Math.round(L * SPRITE.aspect) + 120
  const steer = steerAngles(1 / 14) // a hairpin, where the lock is actually visible
  const sprite = renderToStaticMarkup(createElement(CarSprite, {
    // With a compound fitted, because the band on the tyre's outer edge is the clearest read on steering
    // angle: the tyre itself is drawn as a rounded pill, and a rotated pill hides its own angle.
    id: 'detail', color: '#C8CCD4', length: SPRITE.len, light, spriteRot: 0, steer, compound: 'soft',
  }))
  const body = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const k = L / SPRITE.len
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${L + 130}" `
    + `viewBox="0 0 ${w} ${L + 130}"><rect width="${w}" height="${L + 130}" fill="#33383E"/>`
    + label(w / 2, 40, `hairpin lock: inner ${steer.right.toFixed(1)}deg, outer ${steer.left.toFixed(1)}deg`)
    + `<g transform="translate(${w / 2} ${L / 2 + 80}) scale(${k}) translate(${-SPRITE.cx} ${-SPRITE.cy})">`
    + `${body}</g></svg>`
  writeFileSync(`${OUT}/car-detail.svg`, svg)
  return sharp(Buffer.from(svg)).png().toFile(`${OUT}/car-detail.png`)
    .then(() => console.log(`car-detail -> ${OUT}/car-detail.png`))
}

function main() {
  mkdirSync(OUT, { recursive: true })
  if (argv.includes('--detail')) { detail(); return }
  const d = dirAt(lighting.azimuth)
  const parts: string[] = [
    // Tarmac, so the sprite is judged against what it actually drives on.
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#33383E" />`,
    label(W / 2, 44, `mood ${moodArg} -- azimuth ${(lighting.azimuth * 180 / Math.PI).toFixed(0)}deg, `
      + `elevation ${lighting.elevation}, warmth ${lighting.warmth}, ambient ${lighting.ambient}`),
    // Where the sun is, drawn from the same numbers the cars read, so the picture can be checked
    // against it rather than against a memory of which way the light was meant to go.
    `<line x1="${RING.cx - d.x * 120}" y1="${RING.cy - d.y * 120}" x2="${RING.cx + d.x * 120}" `
      + `y2="${RING.cy + d.y * 120}" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="6 6" />`,
    `<circle cx="${RING.cx - d.x * 120}" cy="${RING.cy - d.y * 120}" r="16" fill="#FFF3D0" />`,
    label(RING.cx + d.x * 150, RING.cy + d.y * 150 + 6, 'shadows point here'),
  ]

  // Ring: 16 headings, every car level, so the ONLY thing changing between them is which way it faces.
  for (let i = 0; i < RING.n; i++) {
    const th = (i * 2 * Math.PI) / RING.n
    parts.push(car(i, RING.cx + Math.cos(th) * RING.r, RING.cy + Math.sin(th) * RING.r, th + Math.PI / 2, 0, 0))
  }

  // Attitude row: one heading, every load. The shadow and the wheels stay put while the body moves.
  const ROW_Y = 1120
  const cases: Array<[string, number, number]> = [
    ['level', 0, 0],
    ['right-hander', 1, 0],
    ['left-hander', -1, 0],
    ['braking', 0, -1],
    ['on the throttle', 0, 1],
  ]
  parts.push(label(W / 2, ROW_Y - 210, 'at the limit, nose up the screen'))
  cases.forEach(([name, lat, long], i) => {
    const x = (W / (cases.length + 1)) * (i + 1)
    // One livery across the row, or the comparison is between colours instead of between attitudes.
    parts.push(car(i + RING.n, x, ROW_Y, 0, lat, long, '#C8CCD4'))
    parts.push(label(x, ROW_Y + 140, name))
  })

  // Steering row: corner radii from a Monaco hairpin to a flat-out sweep, each wheel where the geometry
  // says it has to be for that radius. The two front wheels are deliberately NOT parallel (Ackermann);
  // the inner one is on a tighter circle and turns further.
  const STEER_Y = 1520
  const radii = [12, 25, 50, 120, 400]
  parts.push(label(W / 2, STEER_Y - 210, `steering: lock for each radius at the limit, wheelbase ${WHEELBASE_M.toFixed(2)}m`))
  radii.forEach((r, i) => {
    const x = (W / (radii.length + 1)) * (i + 1)
    // Run the real profile round a circle of this radius, in metres, so the load driving the slip-angle
    // term is the one the shipped code would compute rather than a number typed in here.
    const n = PROFILE_N
    const pts = Array.from({ length: n }, (_, k) => {
      const th = (k * 2 * Math.PI) / n
      return { x: r * Math.cos(th), y: r * Math.sin(th) }
    })
    const dyn = lapDynamics(pts, 2 * Math.PI * r, trackPhysics(1))
    const g = lateralG(dyn, 0, 1)
    const steer = steerAngles(dyn.curvature[0], g) // positive curvature: turning to the car's right
    parts.push(car(i + RING.n + cases.length, x, STEER_Y, 0, 0, 0, '#C8CCD4', steer))
    parts.push(label(x, STEER_Y + 140, `R ${r}m at ${g.toFixed(1)}g`))
    parts.push(label(x, STEER_Y + 164, `${steer.right.toFixed(1)}deg / ${steer.left.toFixed(1)}deg`))
  })

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `${parts.join('\n')}</svg>`
  const tag = `cars-${moodArg}`
  writeFileSync(`${OUT}/${tag}.svg`, svg)
  sharp(Buffer.from(svg)).png().toFile(`${OUT}/${tag}.png`)
    .then(() => console.log(`${tag} -> ${OUT}/${tag}.png`))
    .catch((err: Error) => console.log(`${tag}: SVG written, raster failed: ${err.message}`))
}

main()
