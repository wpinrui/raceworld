// Turn the ambientCG PNG sets under public/materials into maps a browser should actually load.
//
// The downloads are lossless PNG for every channel, which is right for an archive and wrong for a
// runtime: a 2K colour map is 25 MB of PNG and about 1 MB of JPEG at a quality nobody can tell apart
// once it is tiled across a grandstand. Normals stay PNG, because JPEG's chroma subsampling shows up
// in a normal map as shading noise across exactly the kind of large flat surface a deck is.
//
// Run: npx tsx scripts/material-web.ts
//   public/materials/<Set>/<Set>_<res>-PNG_<Channel>.png -> public/materials/web/<set>-<channel>.<ext>

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const SRC = 'public/materials'
const OUT = join(SRC, 'web')

/** The channels worth shipping, and what each becomes. Ambient occlusion is skipped: three needs a
 *  second UV set for it and outdoors, under a sky that is already the ambient, it earns nothing.
 *  Displacement is skipped because nothing here is tessellated. */
/** Mean brightness to normalise a colour map to, 0-255, for the sets whose albedo the model actually
 *  uses.
 *
 *  A scan's colour map is a PHOTOGRAPH, taken under whatever light the scanner had, and it is not the
 *  same thing as a diffuse albedo. These two concretes come in at 32% and 37% mean luma against the
 *  63% grey the flat-colour model was built and judged against, so dropping them in unchanged halves
 *  the brightness of the single biggest surface on the stand and the whole thing goes to charcoal.
 *  Renormalising the mean keeps every bit of the blotching and staining, which is the reason to use a
 *  scan at all, and puts the average back where the design put it.
 *
 *  Measured per file rather than hard-coded as a gain, so swapping a scan for another re-lands on the
 *  same value instead of silently inheriting the last one's correction. */
const ALBEDO_TARGET: Record<string, number> = {
  concrete042a: 196,
  concrete044a: 190,
  concrete046: 174,
}

/** Colour shifts applied to a scan's albedo, as multipliers on an HSV-like reading of it.
 *
 *  A scan is a photograph of one particular piece of material, and the species it happened to be
 *  photographed on is not a design decision anyone made here. `wood058` measures 160,121,91: a mid
 *  orange-brown.
 *
 *  The wanted look is beech or bamboo, and these numbers were SOLVED for rather than eyeballed. The
 *  target is a rendered pixel of #deb77a; the scene multiplies this surface by about 0.89 per
 *  channel, measured off an empty stand; so the albedo that renders as that is 249,205,138; and these
 *  three values are what a fit against the actual scan lands on, to within a unit per channel.
 *
 *  An earlier guess desaturated it toward "pale", which was the wrong direction. Beech is not a grey
 *  wood, it is a light warm one, and it wants considerably MORE saturation than the scan has, not
 *  less.
 *
 *  The grain, which is what the scan is actually FOR, is untouched: this moves where the whole
 *  distribution sits, not the variation within it. Applied to the colour map only, because rotating
 *  the hue of a normal map would rotate its normals. */
const TINT: Record<string, { hue: number; saturation: number; brightness: number }> = {
  wood058: { hue: 10, saturation: 1.683, brightness: 1.588 },
}

const CHANNELS: Record<string, { name: string; png: boolean }> = {
  Color: { name: 'color', png: false },
  NormalGL: { name: 'normal', png: true },
  Roughness: { name: 'rough', png: false },
  Metalness: { name: 'metal', png: false },
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const sets = readdirSync(SRC).filter((d) => {
    const p = join(SRC, d)
    return d !== 'web' && statSync(p).isDirectory()
  })
  if (sets.length === 0) {
    console.error(`no material folders under ${SRC}`)
    process.exitCode = 1
    return
  }
  // Set by set, printing as each lands: the whole run is a couple of hundred megabytes of PNG decode
  // and there is no reason to stare at a blank terminal through it.
  for (const set of sets) {
    const dir = join(SRC, set)
    const slug = set.toLowerCase()
    for (const file of readdirSync(dir)) {
      const m = /_(?:\d+K)-PNG_([A-Za-z]+)\.png$/.exec(file)
      const channel = m ? CHANNELS[m[1]] : undefined
      if (!channel) continue
      const to = join(OUT, `${slug}-${channel.name}.${channel.png ? 'png' : 'jpg'}`)
      let img = sharp(join(dir, file))
      const { width, height } = await img.metadata()
      let note = ''
      const target = channel.name === 'color' ? ALBEDO_TARGET[slug] : undefined
      if (target !== undefined) {
        const [r, g, b] = (await img.stats()).channels.slice(0, 3).map((c) => c.mean)
        const mean = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const gain = target / mean
        img = sharp(join(dir, file)).linear(gain, 0)
        note = `  luma ${mean.toFixed(0)} -> ${target} (x${gain.toFixed(2)})`
      }
      const tint = channel.name === 'color' ? TINT[slug] : undefined
      if (tint) {
        img = img.modulate(tint)
        note += `  hue +${tint.hue} sat x${tint.saturation} val x${tint.brightness}`
      }
      await (channel.png
        ? img.png({ compressionLevel: 9 }).toFile(to)
        : img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(to))
      const kb = Math.round(statSync(to).size / 1024)
      console.log(
        `${slug.padEnd(20)} ${channel.name.padEnd(7)} ${width}x${height}  ${kb} KB${note}`,
      )
    }
  }
  console.log(`\n${sets.length} sets -> ${OUT}`)
  if (!existsSync(OUT)) process.exitCode = 1
}

main()
