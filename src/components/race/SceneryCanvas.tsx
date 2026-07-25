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

/** The camera transform onto a target of `cw` x `ch` CSS pixels, exactly as the world div applies
 *  its own: translate(cam) rotate scale about the middle, then viewBox units. */
function applyCamera(
  ctx: CanvasRenderingContext2D, cam: Camera, vb: ViewBox,
  cw: number, ch: number, dpr: number, ppu: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.translate((cw / 2) * dpr + cam.x * dpr, (ch / 2) * dpr + cam.y * dpr)
  ctx.rotate(cam.rot)
  ctx.scale(cam.z * ppu * dpr, cam.z * ppu * dpr)
  ctx.translate(-(vb.x + vb.w / 2), -(vb.y + vb.h / 2))
  ctx.lineJoin = 'round'
}

function drawItem(ctx: CanvasRenderingContext2D, item: SceneItem, paintFor: PaintFor): void {
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

/** The static world baked to a bitmap at the CURRENT camera, refreshed in the background.
 *
 *  The lap benchmark proved the remaining hitches were not script at all: every CPU timer sat flat
 *  while frames still blew the vsync budget wherever the scene was dense (worst at the pit complex,
 *  gone only with every static layer off). That is the GPU re-rasterising a few hundred vector ops
 *  — gradients, patterns, dashes — every frame. The picture between two cull steps is STATIC, so it
 *  is rasterised once here, spread over a few frames within a small time budget, and each frame
 *  just blits one image. Sub-pixel resampling while panning is exactly what the composited SVG
 *  world always did, so the racing look is unchanged; during an active zoom the blit scales (soft,
 *  briefly) and a fresh bake lands sharp at the new zoom as soon as the camera settles.
 *
 *  Unlike the abandoned whole-circuit bitmap, the buffer covers only the cull disc's viewport
 *  margin at live zoom — sharpness costs a viewport-and-a-half of pixels, not 350 megapixels.
 *
 *  Two buffers ping-pong: the front blits while the back bakes, so a bake never allocates. */
export class SceneBaker {
  /** How much wider than the viewport the bake extends, matching the cull disc's margin. */
  static readonly MARGIN = 1.45
  /** Milliseconds of bake work per frame — small enough to never cost a vsync itself. */
  static readonly BUDGET_MS = 2.5

  private buffers: [HTMLCanvasElement, HTMLCanvasElement] | null = null
  private frontState: { canvas: HTMLCanvasElement; scene: Scene; cam: Camera; w: number; h: number; dpr: number; ppu: number } | null = null
  private job: {
    canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scene: Scene; cam: Camera
    w: number; h: number; dpr: number; ppu: number; paintFor: PaintFor; i: number
  } | null = null

  get front() { return this.frontState }
  get baking() { return this.job !== null }

  /** Begin baking `scene` as seen by `cam` (any in-flight bake is replaced). */
  start(
    scene: Scene, cam: Camera, vb: ViewBox, size: { w: number; h: number },
    dpr: number, ppu: number, paintFor: PaintFor,
  ): void {
    const w = Math.round(size.w * SceneBaker.MARGIN)
    const h = Math.round(size.h * SceneBaker.MARGIN)
    if (!this.buffers) this.buffers = [document.createElement('canvas'), document.createElement('canvas')]
    const canvas = this.buffers[this.frontState?.canvas === this.buffers[0] ? 1 : 0]
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    if (canvas.width !== pw) canvas.width = pw
    if (canvas.height !== ph) canvas.height = ph
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    applyCamera(ctx, cam, vb, w, h, dpr, ppu)
    this.job = { canvas, ctx, scene, cam: { ...cam }, w, h, dpr, ppu, paintFor, i: 0 }
  }

  /** Bake for at most `budgetMs`; promotes the back buffer to front when the last op lands. */
  step(budgetMs: number): void {
    const job = this.job
    if (!job) return
    const t0 = performance.now()
    while (job.i < job.scene.length && performance.now() - t0 < budgetMs) {
      drawItem(job.ctx, job.scene[job.i++], job.paintFor)
    }
    if (job.i >= job.scene.length) {
      job.ctx.globalAlpha = 1
      this.frontState = {
        canvas: job.canvas, scene: job.scene, cam: job.cam,
        w: job.w, h: job.h, dpr: job.dpr, ppu: job.ppu,
      }
      this.job = null
    }
  }

  /** Blit the front bake under the current camera: the world transform, then the inverse of the
   *  bake's own, so the image lands exactly where a live draw would put every op. */
  blit(
    ctx: CanvasRenderingContext2D, cam: Camera, vb: ViewBox,
    size: { w: number; h: number }, dpr: number, ppu: number,
  ): boolean {
    const b = this.frontState
    if (!b) return false
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size.w * dpr, size.h * dpr)
    applyCamera(ctx, cam, vb, size.w, size.h, dpr, ppu)
    ctx.translate(vb.x + vb.w / 2, vb.y + vb.h / 2)
    const s = 1 / (b.cam.z * b.ppu * b.dpr)
    ctx.scale(s, s)
    ctx.rotate(-b.cam.rot)
    ctx.translate(-((b.w / 2) * b.dpr + b.cam.x * b.dpr), -((b.h / 2) * b.dpr + b.cam.y * b.dpr))
    ctx.drawImage(b.canvas, 0, 0)
    return true
  }

  /** Whether the front bake still serves `scene` under `cam`, or a fresh one should start. */
  stale(scene: Scene, cam: Camera, size: { w: number; h: number }): boolean {
    const b = this.frontState
    if (!b) return true
    return b.scene !== scene
      || Math.abs(cam.z - b.cam.z) > b.cam.z * 0.001
      || cam.rot !== b.cam.rot
      // Camera translation is in screen px; past this drift the margin starts running out.
      || Math.hypot(cam.x - b.cam.x, cam.y - b.cam.y) > Math.min(size.w, size.h) * 0.15
  }

  invalidate(): void {
    this.frontState = null
    this.job = null
  }
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
  // Viewport centre, then the camera, then viewBox units — the stage's own middle is also the
  // viewport's, because the stage is centred in it.
  applyCamera(ctx, cam, vb, size.w, size.h, dpr, ppu)
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
    drawItem(ctx, scene[i], paintFor)
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
