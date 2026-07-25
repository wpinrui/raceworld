'use client'

// #sim-2d — flatten the static world to one image.
//
// The map's cost is not the number of shapes, it is that ALL of them are re-rasterised every frame.
// The camera follows a car, so the world layer's transform changes each frame, which invalidates the
// whole SVG layer; there is no partial repaint. A few thousand vector paths then get filled and
// stroked on the CPU sixty times a second, including every tree at the far side of the circuit and
// the full-lap track outline stroked thirteen metres wide.
//
// None of that touches the GPU: filling a path is software rasterisation, and the graphics card only
// composites the finished surface. Baking the static half to a bitmap changes what moves under the
// camera from thousands of paths to a single image, which is precisely the operation a GPU is good
// at. Cars and pit crew stay live on top, so nothing interactive or animated is affected.

import { useEffect, useState, type RefObject } from 'react'

/** Resolution of the baked world, in pixels per viewBox unit. High enough to stay sharp at racing
 *  zoom; past the cap the image is scaled down rather than allowed to exceed what a canvas can hold. */
const PX_PER_UNIT = 8
const MAX_PX = 4096

export interface ViewBox { x: number; y: number; w: number; h: number }

/** Rasterise `ref`'s subtree once and return an object URL for it, or null while it is not wanted or
 *  not ready. Re-bakes whenever `key` changes — the caller passes whatever the picture depends on.
 *
 *  The source subtree must be self-contained: it is serialised on its own, so any gradient or pattern
 *  it paints with has to be inside it, not in a sibling `<defs>`. */
export function useSceneryBitmap(
  ref: RefObject<SVGGElement | null>, vb: ViewBox, enabled: boolean, key: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const g = ref.current
    if (!enabled || !g) return undefined
    let live = true
    let made: string | null = null
    const w = Math.min(MAX_PX, Math.round(vb.w * PX_PER_UNIT))
    const h = Math.round((w * vb.h) / vb.w)
    const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"`
      + ` width="${w}" height="${h}">${new XMLSerializer().serializeToString(g)}</svg>`
    const img = new Image()
    img.onload = () => {
      if (!live) return
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      // toBlob rather than toDataURL: a four-megapixel data URL is megabytes of base64 to build and
      // then parse again, and it all happens on the main thread.
      canvas.toBlob((blob) => {
        if (!live || !blob) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      })
    }
    // Serialised markup can hold any character; encodeURIComponent first or btoa throws on non-Latin1.
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(doc)))}`
    // Clearing on the way out rather than on the way in: dropping the URL synchronously as the effect
    // opens is a state write during render, and the picture would flash the live layer anyway.
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
      setUrl(null)
    }
  }, [ref, vb, enabled, key])
  return url
}
