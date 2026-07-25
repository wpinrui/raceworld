'use client'

// #sim-2d — the static world on a canvas.
//
// Not inside the transformed world div: a canvas in there would be scaled as a raster and go soft the
// moment the camera zoomed, which is the wall the pre-baked bitmap hit (racing zoom is 20x, so a baked
// circuit needs ~350 megapixels to stay sharp). This one is viewport-sized at device resolution and
// takes the camera as `ctx.setTransform`, so it redraws vectors at the exact current zoom — as sharp
// at 60x as at 1x, with no tiles and no memory to hold.
//
// It draws the same `DrawOp`s the SVG layer does, so there is one definition of the picture. Path2D
// objects are built once and cached by their path data: parsing is the expensive half of drawing a
// path, and the geometry only changes when the bearing does.

import { useEffect, useRef } from 'react'
import type { DrawOp, SceneItem, SceneMark } from '@/lib/ui/scenery-draw'
import { isGroup, refName } from '@/lib/ui/scenery-draw'

export interface Camera { x: number; y: number; z: number; rot: number }
export interface ViewBox { x: number; y: number; w: number; h: number }

/** A scene is ONE sequence of flat ops and placed groups, painted in order. Splitting ops from
 *  groups and painting them as two passes put every solid over the trees and kerbs in front of it. */
export type Scene = SceneItem[]

/** Paints named by ops, supplied by the caller because they belong to the look rather than the shape. */
export type PaintFor = (
  name: string, ctx: CanvasRenderingContext2D, bbox: DrawOp['bbox'],
) => string | CanvasGradient | CanvasPattern

const cache = new Map<string, Path2D>()

/** Path2D for some path data, built once. Over the cap the OLDEST quarter goes, not the whole set:
 *  a wholesale clear made the next frame re-parse every path on screen at once, which is exactly
 *  the hitch this cache exists to prevent. */
function pathFor(d: string): Path2D {
  let p = cache.get(d)
  if (!p) {
    p = new Path2D(d)
    if (cache.size > 40000) {
      let toDrop = cache.size / 4
      for (const key of cache.keys()) {
        if (toDrop-- <= 0) break
        cache.delete(key)
      }
    }
    cache.set(d, p)
  }
  return p
}

/** Parse a scene's paths into the cache in small time-boxed slices, then report ready.
 *
 *  A cull step swaps in freshly-built path strings — new trees, the grove's shadow megapath, kerb
 *  curves, on the pit straight the whole complex — and parsing them all inside the next paint was a
 *  33-50ms frame, the one hitch the lap benchmark left standing. The disc is wider than the
 *  viewport, so everything entering is still off screen: the renderer can keep painting the OLD
 *  scene for the few frames this takes and swap when the cache is warm. */
export function warmScene(scene: Scene, onReady: () => void): { cancel: () => void } {
  let cancelled = false
  const ds: string[] = []
  for (const item of scene) {
    if (isGroup(item)) for (const op of item.ops) ds.push(op.d)
    else ds.push(item.d)
  }
  let i = 0
  const step = () => {
    if (cancelled) return
    const t0 = performance.now()
    // A warm entry is a Map hit, so a mostly-cached scene completes in one slice.
    while (i < ds.length && performance.now() - t0 < 3) pathFor(ds[i++])
    if (i < ds.length) requestAnimationFrame(step)
    else onReady()
  }
  requestAnimationFrame(step)
  return { cancel: () => { cancelled = true } }
}

function applyOp(ctx: CanvasRenderingContext2D, op: DrawOp, paintFor: PaintFor): void {
  const path = pathFor(op.d)
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
    ctx.setLineDash([])
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
  /** When given, paint time is attributed per scene section into `out` (ms by section name) —
   *  what the fps readout shows so a slow corner names its own cost. */
  timing?: { marks: SceneMark[]; out: Record<string, number> },
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size.w * dpr, size.h * dpr)
  // Viewport centre, then the camera, then viewBox units. Mirrors the world div's own transform:
  // translate(cam) rotate scale, about the middle of the stage — which is also the middle of the
  // viewport, because the stage is centred in it.
  ctx.translate((size.w / 2) * dpr + cam.x * dpr, (size.h / 2) * dpr + cam.y * dpr)
  ctx.rotate(cam.rot)
  ctx.scale(cam.z * ppu * dpr, cam.z * ppu * dpr)
  ctx.translate(-(vb.x + vb.w / 2), -(vb.y + vb.h / 2))
  ctx.lineJoin = 'round'
  let m = 0
  let section = 'setup'
  let tPrev = timing ? performance.now() : 0
  const close = (next: string) => {
    const now = performance.now()
    timing!.out[section] = (timing!.out[section] ?? 0) + (now - tPrev)
    tPrev = now
    section = next
  }
  for (let i = 0; i < scene.length; i++) {
    if (timing) {
      while (m < timing.marks.length && timing.marks[m].at === i) {
        close(timing.marks[m].name)
        m++
      }
    }
    const item = scene[i]
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
  if (timing) close('setup')
  ctx.globalAlpha = 1
}

/** A canvas sized to its container at device resolution. The caller drives it from the render loop
 *  through the ref it hands back, so a camera move never goes near React. */
export function SceneryCanvas({ canvasRef, className }: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  className?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = box.getBoundingClientRect()
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
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
