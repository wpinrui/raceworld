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
import { PERF } from '@/lib/ui/perf-flags'

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
  // The perf lab turns the cache off to find out what it is worth: without it every op on screen is
  // re-parsed on every frame, which is the state this whole file exists to avoid.
  if (!PERF.pathCache) return new Path2D(d)
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

/** The context state `applyOp` has already set, mirrored on the JS side.
 *
 *  Every one of these setters costs something real per call: a colour string has to be parsed,
 *  `setLineDash` takes a fresh array, and the scene is walked op by op sixty times a second. The
 *  scene is also ORDERED BY PAINT wherever it can be (`mergeByPaint`), so consecutive ops share
 *  their ink far more often than not and most of those writes are the same value twice.
 *
 *  `undefined` means "unknown, write it": what a group's save/restore leaves behind, since a restore
 *  reverts the real context underneath the mirror. */
interface PaintState {
  fill?: string | CanvasGradient | CanvasPattern
  stroke?: string | CanvasGradient | CanvasPattern
  width?: number
  cap?: CanvasLineCap
  alpha?: number
  dashed?: boolean
  shift?: number
}

const NO_DASH: number[] = []

/** Forget the mirror. Called around save/restore, which moves the real state without going through
 *  `applyOp`, so anything remembered about it is no longer true. */
function forget(s: PaintState): void {
  s.fill = undefined
  s.stroke = undefined
  s.width = undefined
  s.cap = undefined
  s.alpha = undefined
  s.dashed = undefined
  s.shift = undefined
}

function applyOp(
  ctx: CanvasRenderingContext2D, op: DrawOp, paintFor: PaintFor, s: PaintState,
): void {
  // Forgetting the mirror before every op is exactly "write every setter every time", which is what the
  // mirror is measured against.
  if (!PERF.paintState) forget(s)
  const path = pathFor(op.d)
  const alpha = op.alpha ?? 1
  if (s.alpha !== alpha) {
    ctx.globalAlpha = alpha
    s.alpha = alpha
  }
  if (op.fill) {
    const ref = refName(op.fill)
    const paint = ref ? paintFor(ref, ctx, op.bbox) : op.fill
    if (s.fill !== paint) {
      ctx.fillStyle = paint
      s.fill = paint
    }
    ctx.fill(path, op.evenOdd ? 'evenodd' : 'nonzero')
  }
  if (op.stroke) {
    const ref = refName(op.stroke)
    const paint = ref ? paintFor(ref, ctx, op.bbox) : op.stroke
    if (s.stroke !== paint) {
      ctx.strokeStyle = paint
      s.stroke = paint
    }
    const width = op.width ?? 1
    if (s.width !== width) {
      ctx.lineWidth = width
      s.width = width
    }
    const cap = op.cap ?? 'butt'
    if (s.cap !== cap) {
      ctx.lineCap = cap
      s.cap = cap
    }
    // A dash is rare (the kerbs, and nothing else), so the common path is to leave the empty pattern
    // in place rather than hand the rasteriser a fresh array per op to expand.
    if (op.dash) {
      ctx.setLineDash([op.dash.on, op.dash.off])
      s.dashed = true
      if (s.shift !== op.dash.shift) {
        ctx.lineDashOffset = op.dash.shift
        s.shift = op.dash.shift
      }
    } else if (s.dashed !== false) {
      ctx.setLineDash(NO_DASH)
      s.dashed = false
    }
    ctx.stroke(path)
  }
}

/** Where a paint reports itself: section times, and what the frame put through the rasteriser. */
export interface SceneTiming {
  marks: SceneMark[]
  out: Record<string, number>
  /** Draw calls issued (a fill and a stroke on one op are two). */
  drawn?: number
  /** Scene items the viewport test dropped before they cost anything. */
  skipped?: number
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
   *  world-sized ground op — one full-surface write a frame instead of two, which at racing zoom is
   *  about a quarter of everything the frame paints. It also means the camera can never pan off the end
   *  of the world, because there is no end of it to reach.
   *
   *  Required, not optional: the context is created opaque, so a clear would be BLACK rather than
   *  see-through, and every pixel has to be written every frame for that to be sound. */
  clearTo: string,
  /** When given, paint time is attributed per scene section into `out` (ms by section name) —
   *  what the fps readout shows so a slow corner names its own cost. `drawn` and `skipped` come back
   *  with it: the renderer is draw-call bound, so the number of calls a frame actually issued is the
   *  one figure a paint time can be read against. */
  timing?: SceneTiming,
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
  // What the viewport can actually see, as a disc in world units: the scene is composed against
  // the CULL disc (deliberately wider, moved with hysteresis), so on most frames much of it lies
  // wholly off screen — feeding those ops to the rasteriser is work with no pixels. Skipping by
  // each item's own conservative disc is exact: either entirely invisible, or drawn whole.
  const k = cam.z * ppu
  const cos = Math.cos(-cam.rot)
  const sin = Math.sin(-cam.rot)
  const viewX = vb.x + vb.w / 2 + (-cam.x * cos - -cam.y * sin) / k
  const viewY = vb.y + vb.h / 2 + (-cam.x * sin + -cam.y * cos) / k
  const viewR = (Math.hypot(size.w, size.h) / 2 / k) * 1.05
  // Compared SQUARED: this runs once per scene item per frame, and Math.hypot carries an
  // overflow-safe scaling path that a distance test against a known-finite radius does not need.
  const offscreen = (c: NonNullable<SceneItem['clip']>) => {
    const dx = c.cx - viewX
    const dy = c.cy - viewY
    const reach = viewR + c.r
    return dx * dx + dy * dy > reach * reach
  }
  const state: PaintState = {}
  let m = 0
  let drawn = 0
  let skipped = 0
  const callsOf = (op: DrawOp) => (op.fill ? 1 : 0) + (op.stroke ? 1 : 0)
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
    if (PERF.itemCull && item.clip && offscreen(item.clip)) {
      skipped++
      continue
    }
    if (isGroup(item)) {
      ctx.save()
      ctx.translate(item.x, item.y)
      ctx.rotate(item.rot)
      for (const op of item.ops) applyOp(ctx, op, paintFor, state)
      ctx.restore()
      // The restore reverted the ink underneath the mirror, so nothing about it is known any more.
      forget(state)
      if (timing) for (const op of item.ops) drawn += callsOf(op)
    } else {
      applyOp(ctx, item, paintFor, state)
      if (timing) drawn += callsOf(item)
    }
  }
  if (timing) {
    close('setup')
    timing.drawn = drawn
    timing.skipped = skipped
  }
  ctx.globalAlpha = 1
}

/** The one 2D context for a canvas, created OPAQUE and kept.
 *
 *  Opaque because the surface is completely covered every frame — `drawScene` fills it with the
 *  ground colour rather than clearing it — so an alpha channel buys nothing and costs the compositor
 *  a blend of the whole viewport on every frame. It is only correct while the canvas is mounted
 *  exclusively for the live view; the map view must not mount it, or its letterbox would come out
 *  black instead of showing the page through.
 *
 *  Kept because context options are fixed at creation: a second `getContext` with different options
 *  silently returns the first context, so asking per frame both wastes the lookup and hides the
 *  mistake. */
const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()

export function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const hit = ctxCache.get(canvas)
  if (hit) return hit
  const made = canvas.getContext('2d', { alpha: false })
  if (!made) return null
  ctxCache.set(canvas, made)
  return made
}

/** A canvas sized to its container at device resolution. The caller drives it from the render loop
 *  through the ref it hands back, so a camera move never goes near React. */
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
