'use client'

// #sim-2d — the static world on a canvas.
//
// Not inside the transformed world div: a canvas in there would be scaled as a raster and go soft the
// moment the camera zoomed. This one is viewport-sized at device resolution and takes the camera as
// `ctx.setTransform`, so it redraws vectors at the exact current zoom — as sharp at 60x as at 1x, with
// no tiles and no memory to hold.
//
// It walks the `DrawOp` list `sceneryScene` describes and paints it, in order, in full. Nothing here
// caches, culls, batches or skips: what the scene says is what the frame draws.

import { useEffect, useRef } from 'react'
import type { DrawOp, SceneItem } from '@/lib/ui/scenery-draw'
import { isGroup, refName } from '@/lib/ui/scenery-draw'
import type { Camera, ViewBox } from '@/lib/ui/geom'

// One definition, in lib/ui/geom.ts, since a camera belongs to neither renderer. Re-exported so every
// existing importer keeps reading it from the drawing surface it drives.
export type { Camera, ViewBox } from '@/lib/ui/geom'

/** A scene is ONE sequence of flat ops and placed groups, painted in order. Splitting ops from
 *  groups and painting them as two passes put every solid over the trees and kerbs in front of it. */
export type Scene = SceneItem[]

/** Paints named by ops, supplied by the caller because they belong to the look rather than the shape. */
export type PaintFor = (
  name: string, ctx: CanvasRenderingContext2D, bbox: DrawOp['bbox'],
) => string | CanvasGradient | CanvasPattern

function applyOp(ctx: CanvasRenderingContext2D, op: DrawOp, paintFor: PaintFor): void {
  const path = new Path2D(op.d)
  ctx.globalAlpha = op.alpha ?? 1
  if (op.fill) {
    const ref = refName(op.fill)
    ctx.fillStyle = ref ? paintFor(ref, ctx, op.bbox) : op.fill
    ctx.fill(path, op.evenOdd ? 'evenodd' : 'nonzero')
  }
  if (op.stroke) {
    const ref = refName(op.stroke)
    ctx.strokeStyle = ref ? paintFor(ref, ctx, op.bbox) : op.stroke
    ctx.lineWidth = op.width ?? 1
    ctx.lineCap = op.cap ?? 'butt'
    ctx.setLineDash(op.dash ? [op.dash.on, op.dash.off] : [])
    ctx.lineDashOffset = op.dash?.shift ?? 0
    ctx.stroke(path)
  }
}

/** Draw a whole scene under a camera. Exported so the render loop can call it directly rather than
 *  going through React, which has no business running sixty times a second.
 *
 *  `ppu` is the STAGE's pixels per viewBox unit at zoom 1. It is a parameter rather than derived
 *  from the canvas size because the canvas covers the whole viewport while the world is fitted to
 *  the stage — the two widths differ whenever the stage letterboxes. */
export function drawScene(
  ctx: CanvasRenderingContext2D, scene: Scene, cam: Camera, vb: ViewBox,
  size: { w: number; h: number }, dpr: number, ppu: number, paintFor: PaintFor,
  /** The ground's own colour. The surface is FILLED with it rather than cleared and then covered by a
   *  world-sized ground op, which also means the camera can never pan off the end of the world,
   *  because there is no end of it to reach.
   *
   *  Required, not optional: the context is created opaque, so a clear would be BLACK rather than
   *  see-through, and every pixel has to be written every frame for that to be sound. */
  clearTo: string,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = clearTo
  // The BACKING STORE's own size, never the CSS size times the caller's dpr. Moving the window to a
  // monitor of a different density changes devicePixelRatio without changing the element's box, so no
  // ResizeObserver fires and the two disagree — and on an opaque canvas the strip left unwritten is
  // black, not transparent.
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  // Viewport centre, then the camera, then viewBox units. Mirrors the world div's own transform:
  // translate(cam) rotate scale, about the middle of the stage — which is also the middle of the
  // viewport, because the stage is centred in it.
  ctx.translate((size.w / 2) * dpr + cam.x * dpr, (size.h / 2) * dpr + cam.y * dpr)
  ctx.rotate(cam.rot)
  ctx.scale(cam.z * ppu * dpr, cam.z * ppu * dpr)
  ctx.translate(-(vb.x + vb.w / 2), -(vb.y + vb.h / 2))
  ctx.lineJoin = 'round'
  for (const item of scene) {
    if (isGroup(item)) {
      ctx.save()
      ctx.translate(item.x, item.y)
      ctx.rotate(item.rot)
      for (const op of item.ops) applyOp(ctx, op, paintFor)
      ctx.restore()
    } else {
      applyOp(ctx, item, paintFor)
    }
  }
  ctx.globalAlpha = 1
}

/** A canvas sized to its container at device resolution. The caller drives it from the render loop
 *  through the ref it hands back, so a camera move never goes near React.
 *
 *  The context is OPAQUE: the surface is completely covered every frame, so an alpha channel buys
 *  nothing and costs the compositor a blend of the whole viewport. That is only correct while the
 *  canvas is mounted exclusively for the live view; the map view must not mount it, or its letterbox
 *  would come out black instead of showing the page through. */
export function SceneryCanvas({ canvasRef, className, onResize }: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  className?: string
  /** Called after the backing store has been resized. Setting `canvas.width` CLEARS the surface, so
   *  without this the world stays blank until something else happens to repaint it — which, with a
   *  free camera, is nothing. */
  onResize?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef(onResize)
  useEffect(() => { resizeRef.current = onResize }, [onResize])
  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = box.getBoundingClientRect()
      const w = Math.round(width * dpr)
      const h = Math.round(height * dpr)
      // Guarded: assigning the same width still clears the surface, and a ResizeObserver fires for
      // plenty of changes that do not move these two numbers.
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      resizeRef.current?.()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [canvasRef])
  return (
    <div ref={boxRef} className={className}>
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
