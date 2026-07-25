'use client'

// #sim-2d — flatten the static world to images.
//
// The map's cost is not the number of shapes, it is that ALL of them are re-rasterised every frame.
// The camera follows a car, so the world layer's transform changes each frame, which invalidates the
// whole SVG layer; there is no partial repaint. A few thousand vector paths then get filled and
// stroked on the CPU sixty times a second, including every tree at the far side of the circuit and
// the full-lap track outline stroked thirteen metres wide.
//
// None of that touches the GPU: filling a path is software rasterisation, and the graphics card only
// composites the finished surface. Baking the static half changes what moves under the camera from
// thousands of paths to a handful of images, which is precisely what a GPU is good at. Cars and pit
// crew stay live on top, so nothing interactive or animated is affected.
//
// It is TILED rather than one image because a single one cannot be both sharp and legal: a canvas has
// a hard size limit, so one image spanning a whole circuit has to be scaled down to fit it, and
// racing zoom then magnifies a surface with fewer pixels than the screen. Tiles keep the resolution
// and let the browser skip the ones that are off screen.

import { useEffect, useState, type RefObject } from 'react'

/** Resolution of the baked world, in pixels per viewBox unit.
 *
 *  This is the sharpness dial and it does not reach far enough to cover a whole circuit. Racing zoom
 *  is 20x, which puts roughly 32 screen pixels on a viewBox unit, and a circuit baked at that is about
 *  350 megapixels; the maximum zoom would be three gigapixels. So a full-circuit bake is sharp for the
 *  zoomed-out views and soft once the camera comes in, and no tile size changes that. */
const PX_PER_UNIT = 8
/** Largest tile edge. Well inside what browsers accept, so no tile is ever silently downscaled. */
const MAX_TILE_PX = 2048

export interface ViewBox { x: number; y: number; w: number; h: number }
export interface Tile { url: string; x: number; y: number; w: number; h: number }

/** Rasterise `ref`'s subtree into tiles covering `vb`, or null while it is not wanted or not ready.
 *  Re-bakes whenever `key` changes — the caller passes whatever the picture depends on.
 *
 *  The source subtree must be self-contained: it is serialised on its own, so any gradient or pattern
 *  it paints with has to be inside it, not in a sibling `<defs>`. */
export function useSceneryBitmap(
  ref: RefObject<SVGGElement | null>, vb: ViewBox, enabled: boolean, key: string,
): Tile[] | null {
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  useEffect(() => {
    const g = ref.current
    if (!enabled || !g) return undefined
    let live = true
    const made: string[] = []
    // Serialised once and reparsed per tile: the markup is identical, only the viewBox differs.
    const inner = new XMLSerializer().serializeToString(g)
    const cols = Math.max(1, Math.ceil((vb.w * PX_PER_UNIT) / MAX_TILE_PX))
    const rows = Math.max(1, Math.ceil((vb.h * PX_PER_UNIT) / MAX_TILE_PX))
    const tw = vb.w / cols
    const th = vb.h / rows
    const px = Math.round(tw * PX_PER_UNIT)
    const py = Math.round(th * PX_PER_UNIT)

    const bake = (col: number, row: number) => new Promise<Tile | null>((resolve) => {
      const x = vb.x + col * tw
      const y = vb.y + row * th
      const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${tw} ${th}"`
        + ` width="${px}" height="${py}">${inner}</svg>`
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = px
        canvas.height = py
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0, px, py)
        // toBlob rather than toDataURL: a multi-megapixel data URL is megabytes of base64 to build
        // and then parse again, all of it on the main thread.
        canvas.toBlob((blob) => {
          if (!blob) { resolve(null); return }
          const url = URL.createObjectURL(blob)
          made.push(url)
          resolve({ url, x, y, w: tw, h: th })
        })
      }
      img.onerror = () => resolve(null)
      // Serialised markup can hold any character; encode first or btoa throws on anything non-Latin1.
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(doc)))}`
    })

    // One at a time. Several multi-megapixel canvases alive at once is a lot of memory to hold for no
    // gain, and the live layer is still on screen until the whole set is ready.
    void (async () => {
      const out: Tile[] = []
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const tile = await bake(col, row)
          if (!live) return
          if (tile) out.push(tile)
        }
      }
      if (live) setTiles(out)
    })()

    // Cleared on the way out rather than the way in: dropping them as the effect opens is a state
    // write during render, and the live layer would be shown for that frame anyway.
    return () => {
      live = false
      for (const url of made) URL.revokeObjectURL(url)
      setTiles(null)
    }
  }, [ref, vb, enabled, key])
  return tiles
}
