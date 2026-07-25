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
import { SPRITE, carAttitude, carLight } from '../src/lib/ui/car-sprite'
import { MOODS, dirAt, type Mood } from '../src/lib/ui/lighting'

const OUT = 'scripts/.preview'
const argv = process.argv.slice(2)
const moodArg = (argv.find((a) => a.startsWith('--mood='))?.split('=')[1] ?? 'afternoon') as Mood
const lighting = MOODS[moodArg] ?? MOODS.afternoon
const light = carLight(lighting)

const W = 1100
const H = 1360
const RING = { cx: 550, cy: 470, r: 330, n: 16 }
const CAR = 150 // sprite length in output pixels
const LIVERIES = ['#E8442E', '#2F7BE8', '#F2C230', '#39B26A', '#B565E0', '#E8792E', '#39C4C4', '#E85BA0']

/** One sprite as a <g>, placed and turned. A nested <svg> would clip the contact shadow's tail. */
function car(i: number, x: number, y: number, spriteRot: number, lat: number, long: number, color?: string): string {
  const sprite = renderToStaticMarkup(createElement(CarSprite, {
    id: `c${i}`,
    color: color ?? LIVERIES[i % LIVERIES.length],
    length: SPRITE.len,
    light,
    spriteRot,
    attitude: carAttitude(lat, long),
  }))
  const body = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const scale = CAR / SPRITE.len
  return `<g transform="translate(${x} ${y}) rotate(${(spriteRot * 180) / Math.PI}) scale(${scale}) `
    + `translate(${-SPRITE.cx} ${-SPRITE.cy})">${body}</g>`
}

const label = (x: number, y: number, s: string, anchor = 'middle') =>
  `<text x="${x}" y="${y}" fill="#FFFFFF" font-family="sans-serif" font-size="18" text-anchor="${anchor}">${s}</text>`

function main() {
  mkdirSync(OUT, { recursive: true })
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `${parts.join('\n')}</svg>`
  const tag = `cars-${moodArg}`
  writeFileSync(`${OUT}/${tag}.svg`, svg)
  sharp(Buffer.from(svg)).png().toFile(`${OUT}/${tag}.png`)
    .then(() => console.log(`${tag} -> ${OUT}/${tag}.png`))
    .catch((err: Error) => console.log(`${tag}: SVG written, raster failed: ${err.message}`))
}

main()
