// Packing the scanned maps into a probe page, shared by every probe that needs them.
//
// Packed INTO the page as data: URIs rather than copied beside it. A page opened off file:// is a
// unique origin, so a file:// image is cross-origin data that WebGL will not upload: it throws
// SecurityError and the sampler reads black, which turns every roughness map into a mirror. Only the
// maps `skinFiles` actually asks for get packed, each no larger than the surface can resolve, so a
// page stays a handful of megabytes instead of the 235 MB the downloads are.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { skinFiles } from '../src/lib/scene3d/standtex3d'

export const MATERIALS_WEB = 'public/materials/web'

/** Every map a skin needs, as data: URIs keyed by file name, ready for `window.__standTex`.
 *
 *  Returns null and explains itself when the converted maps are not there, rather than throwing:
 *  a probe that cannot find textures should still render the world without them. */
export async function packSkinMaps(
  web = MATERIALS_WEB,
): Promise<{ inline: Record<string, string>; bytes: number } | null> {
  if (!existsSync(web)) {
    console.error(`no converted maps at ${web}: run npx tsx scripts/material-web.ts first`)
    return null
  }
  const inline: Record<string, string> = {}
  let bytes = 0
  for (const { file, maxPx, normal } of skinFiles()) {
    const src = join(web, file)
    if (!existsSync(src)) {
      console.error(`missing ${src}: run npx tsx scripts/material-web.ts`)
      return null
    }
    // maxPx 0 means "do not touch it": the inverse-histogram lookup is a 256x1 function table and
    // resizing it would resample the histogram itself.
    const img = maxPx > 0
      ? sharp(src).resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
      : sharp(src)
    // Normals stay lossless. JPEG's ringing around an edge becomes a shading ripple in a normal map,
    // and a deck is exactly the large flat surface where that reads.
    const buf = normal
      ? await img.png({ compressionLevel: 9 }).toBuffer()
      : await img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer()
    inline[file] = `data:image/${normal ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`
    bytes += buf.length
  }
  return { inline, bytes }
}
