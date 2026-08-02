// The offline half of histogram-preserving blending (Heitz & Neyret, HPG 2018).
//
// The reason a naive 3-way blend of a texture against itself looks wrong is statistics. Averaging
// three samples of a distribution narrows its variance: contrast collapses, edges soften, and colours
// appear that were never in the input. Heitz and Neyret's answer is to do the blending in a space
// where averaging IS correct. Gaussian distributions are closed under linear combination, so if the
// input is first remapped so each channel is a Gaussian, three of them can be blended analytically
// with mean and variance preserved, then mapped back through the inverse.
//
// Both halves of that remapping are per-texture and fixed, so they are computed here rather than in a
// shader: a Gaussianised copy of the colour map, and a 256-wide lookup table that undoes it.
//
// Run: npx tsx scripts/material-gauss.ts
//   public/materials/web/<set>-color.jpg -> <set>-gauss.png and <set>-lut.png

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const WEB = 'public/materials/web'
/** Which sets get the treatment.
 *
 *  Only stochastic, non-periodic inputs: the paper is explicit that this is for moss, granite, sand,
 *  bark and the like, and that STRUCTURED textures are outside it. A brick wall Gaussianised and
 *  reblended stops being brickwork. Concrete is borderline (it has faint form lines), which is why it
 *  is not on this list and gets per-tile randomisation instead. */
const SETS = ['grass004', 'grass008', 'ground037']
const LUT_W = 256
/** How many standard deviations the Gaussianised range covers. The paper's choice; wide enough that
 *  clipping the tails costs nothing and narrow enough to keep 8-bit precision usable. */
const SIGMA_SPAN = 6

/** Inverse error function, Giles' rational approximation. Accurate to about 1e-9, which is four
 *  orders past what an 8-bit channel can hold. */
function erfInv(x: number): number {
  let w = -Math.log((1 - x) * (1 + x))
  let p: number
  if (w < 5) {
    w -= 2.5
    p = 2.81022636e-8
    p = 3.43273939e-7 + p * w
    p = -3.5233877e-6 + p * w
    p = -4.39150654e-6 + p * w
    p = 0.00021858087 + p * w
    p = -0.00125372503 + p * w
    p = -0.00417768164 + p * w
    p = 0.246640727 + p * w
    p = 1.50140941 + p * w
  } else {
    w = Math.sqrt(w) - 3
    p = -0.000200214257
    p = 0.000100950558 + p * w
    p = 0.00134934322 + p * w
    p = -0.00367342844 + p * w
    p = 0.00573950773 + p * w
    p = -0.0076224613 + p * w
    p = 0.00943887047 + p * w
    p = 1.00167406 + p * w
    p = 2.83297682 + p * w
  }
  return p * x
}

/** Error function, Abramowitz and Stegun 7.1.26. */
function erf(x: number): number {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

/** The normal CDF, which is the rank a Gaussian value sits at. */
const gaussCdf = (g: number) => 0.5 * (1 + erf(g / Math.SQRT2))

async function main() {
  for (const set of SETS) {
    const src = join(WEB, `${set}-color.jpg`)
    if (!existsSync(src)) {
      console.error(`missing ${src}: run npx tsx scripts/material-web.ts first`)
      process.exitCode = 1
      return
    }
    const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info
    const n = width * height
    const gauss = Buffer.alloc(n * 3)
    const lut = Buffer.alloc(LUT_W * 3)

    // Per channel, independently: the transform is a rank mapping, so all it needs is the sorted
    // order of the pixels. A pixel at rank r of n sits at quantile (r + 0.5) / n, and the Gaussian
    // value with that quantile is what it becomes.
    for (let c = 0; c < 3; c++) {
      const order = new Uint32Array(n)
      for (let i = 0; i < n; i++) order[i] = i
      const value = (i: number) => data[i * channels + c]
      // Counting sort on the 256 possible values rather than a comparison sort: this runs over a
      // million pixels per channel and the keys are bytes.
      const counts = new Uint32Array(257)
      for (let i = 0; i < n; i++) counts[value(i) + 1]++
      for (let v = 1; v <= 256; v++) counts[v] += counts[v - 1]
      const cursor = counts.slice()
      const sorted = new Uint32Array(n)
      for (let i = 0; i < n; i++) sorted[cursor[value(i)]++] = i

      for (let r = 0; r < n; r++) {
        const u = (r + 0.5) / n
        const g = erfInv(2 * u - 1) * Math.SQRT2
        const norm = Math.min(1, Math.max(0, g / SIGMA_SPAN + 0.5))
        gauss[sorted[r] * 3 + c] = Math.round(norm * 255)
      }
      // And the inverse: for each Gaussian level, which input value had that quantile.
      for (let i = 0; i < LUT_W; i++) {
        const g = ((i + 0.5) / LUT_W - 0.5) * SIGMA_SPAN
        const rank = Math.min(n - 1, Math.max(0, Math.floor(gaussCdf(g) * n)))
        lut[i * 3 + c] = value(sorted[rank])
      }
    }

    const gaussPath = join(WEB, `${set}-gauss.png`)
    const lutPath = join(WEB, `${set}-lut.png`)
    await sharp(gauss, { raw: { width, height, channels: 3 } }).png().toFile(gaussPath)
    await sharp(lut, { raw: { width: LUT_W, height: 1, channels: 3 } }).png().toFile(lutPath)
    console.log(`${set.padEnd(12)} ${width}x${height} gaussianised -> ${gaussPath}`)
    console.log(`${''.padEnd(12)} ${LUT_W}x1 inverse         -> ${lutPath}`)
  }
}

main()
