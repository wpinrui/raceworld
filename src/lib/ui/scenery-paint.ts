// #sim-2d — the gradients and patterns an op names, built for a canvas.
//
// The SVG layer answers `ref:tm-tree0` with `url(#tm-tree0)` and lets the document hold the paint.
// A canvas has no document to hold it, so the same names are built here from the same numbers. Kept
// beside the drawing description rather than inside the canvas component: what a tree canopy looks
// like is part of the picture, and the two renderers have to agree on it.

import { type Lighting, dirAt } from './lighting'

/** Canopy ramps. The lit side IS the gradient's focal point, pulled toward the sun, so a tree's
 *  shading follows the light instead of being baked in when it was generated. */
const TREE_STOPS: Array<[string, string, string]> = [
  ['#8FB35F', '#4F7B3A', '#2C4B22'],
  ['#A8B368', '#6B7A35', '#3D4A1E'],
]

/** The one colour a canopy is painted below the near rung, per variant.
 *
 *  The middle stop, which sits at 45% of the radius: on a disc that is very close to the ramp's
 *  area-weighted mean, so a flat canopy reads at the same brightness as the shaded one it replaces
 *  rather than as a lighter or darker tree. Exported because dropping the gradient is what lets a
 *  hundred canopies share a paint and become one draw call. */
export const TREE_FLAT: string[] = TREE_STOPS.map((stops) => stops[1])

/** Seating rake: pale at the back under the roof, darkening toward the trackside front, so which way
 *  a stand faces is legible at a glance rather than implied by a thin roof band. */
const RAKE_TOP = 'rgba(255,255,255,0.18)'
const RAKE_BOTTOM = 'rgba(0,0,0,0.30)'

export interface PaintCtx {
  lighting: Lighting
  /** Metres to viewBox units. */
  u: (m: number) => number
  /** Bounds of the shape being painted. Gradients in SVG resolve against the path's own extent, so a
   *  canvas has to be told it; a tile pattern does not care and may be given anything. */
  bounds: { x: number; y: number; w: number; h: number }
  /** Device pixels one viewBox unit currently covers (zoom times stage scale times dpr). Tiles are
   *  rasterised to match: an SVG pattern is vector and stays crisp at any zoom, but a tile baked at
   *  a fixed low resolution upscales at racing zoom until its crowd dots blur into nothing. */
  pxPerUnit?: number
}

/** Paints are cached because `drawScene` asks for one per op per frame. Uncached, every tree canopy
 *  allocated a fresh radial gradient and every tiled fill rasterised a fresh DOM canvas into a fresh
 *  pattern, sixty times a second — thousands of allocations a frame, measured by
 *  scripts/canvas-cost-check.ts. A gradient is keyed on everything it is built from, so a cache hit
 *  is pixel-identical to a rebuild. Cleared wholesale when oversized: the set turns over on a track
 *  or light change and not at all in between. */
const gradientCache = new Map<string, CanvasGradient>()
const patternCache = new Map<string, CanvasPattern>()

/** Build the paint an op named. Returns null for an unknown name so a caller can fail loudly rather
 *  than silently drawing the wrong colour. */
export function canvasPaint(
  name: string, ctx: CanvasRenderingContext2D, p: PaintCtx,
): CanvasGradient | CanvasPattern | null {
  const { x, y, w, h } = p.bounds
  if (name.startsWith('tm-tree') || name === 'tm-bevel' || name === 'tm-rake' || name === 'tm-rake-flip') {
    const key = `${name}|${p.lighting.azimuth}|${x},${y},${w},${h}`
    let g = gradientCache.get(key)
    if (!g) {
      const built = buildGradient(name, ctx, p)
      if (!built) return null
      if (gradientCache.size > 30000) gradientCache.clear()
      gradientCache.set(key, built)
      g = built
    }
    return g
  }
  // Tiles rebuild when the zoom crosses a power-of-two band, so they are always rasterised within
  // 2x of the resolution they are shown at — a handful of rebuilds across the whole zoom range.
  const px = tileRes(p)
  const key = `${name}|${p.u(1)}|${px}`
  let pat = patternCache.get(key)
  if (!pat) {
    const built = tilePaint(name, ctx, p, px)
    if (!built) return null
    if (patternCache.size > 200) patternCache.clear()
    patternCache.set(key, built)
    pat = built
  }
  return pat
}

/** Tile raster density in device pixels per viewBox unit: the next power of two above what is on
 *  screen, clamped so far zoom-out never drops detail below legibility and extreme zoom-in cannot
 *  ask for a megapixel tile. */
function tileRes(p: PaintCtx): number {
  const need = p.pxPerUnit ?? 8
  return Math.min(256, Math.max(8, 2 ** Math.ceil(Math.log2(need))))
}

function buildGradient(
  name: string, ctx: CanvasRenderingContext2D, p: PaintCtx,
): CanvasGradient | null {
  const { x, y, w, h } = p.bounds
  if (name === 'tm-tree0' || name === 'tm-tree1') {
    const dir = dirAt(p.lighting.azimuth)
    const stops = TREE_STOPS[name === 'tm-tree0' ? 0 : 1]
    const cx = x + w / 2
    const cy = y + h / 2
    const r = Math.max(w, h) / 2
    // Focal point pulled toward the sun by the same 0.3 of the radius the SVG uses.
    const g = ctx.createRadialGradient(cx - dir.x * r * 0.6, cy - dir.y * r * 0.6, 0, cx, cy, r)
    g.addColorStop(0, stops[0])
    g.addColorStop(0.45, stops[1])
    g.addColorStop(1, stops[2])
    return g
  }
  if (name === 'tm-rake' || name === 'tm-rake-flip') {
    const flip = name === 'tm-rake-flip'
    const g = ctx.createLinearGradient(x, flip ? y + h : y, x, flip ? y : y + h)
    g.addColorStop(0, RAKE_TOP)
    g.addColorStop(1, RAKE_BOTTOM)
    return g
  }
  if (name === 'tm-bevel') {
    // One ramp across the silhouette, turned to face the sun.
    const a = p.lighting.azimuth
    const r = Math.max(w, h) / 2
    const cx = x + w / 2
    const cy = y + h / 2
    const g = ctx.createLinearGradient(
      cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
    )
    g.addColorStop(0, 'rgba(255,255,255,0.16)')
    g.addColorStop(0.45, 'rgba(255,255,255,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.22)')
    return g
  }
  return null
}

/** The repeating fills: seats, crowd, roof decking, water and crop rows. Each is drawn once into an
 *  offscreen canvas at the same metre sizes the SVG pattern uses, then repeated. */
function tilePaint(
  name: string, ctx: CanvasRenderingContext2D, p: PaintCtx, px: number,
): CanvasPattern | null {
  const spec = TILES[name]
  if (!spec) return null
  // Tiles are built in DEVICE pixels so they stay crisp, then scaled back into viewBox units by the
  // pattern transform. A tile authored in viewBox units would be a couple of pixels across.
  const tile = document.createElement('canvas')
  tile.width = Math.max(1, Math.round(p.u(spec.w) * px))
  tile.height = Math.max(1, Math.round(p.u(spec.h) * px))
  const tctx = tile.getContext('2d')
  if (!tctx) return null
  tctx.scale((tile.width / p.u(spec.w)), (tile.height / p.u(spec.h)))
  spec.draw(tctx, p.u)
  const pattern = ctx.createPattern(tile, 'repeat')
  if (!pattern) return null
  // The rotation first, then the scale back into viewBox units — the same order SVG applies its
  // patternTransform, so a rotated lattice (crop rows) lands at the same angle.
  const m = new DOMMatrix().rotate(spec.rot ?? 0)
  pattern.setTransform(m.scale(p.u(spec.w) / tile.width, p.u(spec.h) / tile.height))
  return pattern
}

interface TileSpec {
  /** Tile size in metres. */
  w: number
  h: number
  /** Lattice rotation in degrees, mirroring the SVG pattern's patternTransform. */
  rot?: number
  draw: (ctx: CanvasRenderingContext2D, u: (m: number) => number) => void
}

const TILES: Record<string, TileSpec> = {
  'tm-seats': {
    w: 2.4,
    h: 1.5,
    draw: (c, u) => {
      c.fillStyle = '#3E4552'
      c.fillRect(0, 0, u(2.4), u(1.5))
      c.fillStyle = '#575F6E'
      c.fillRect(0, u(0.95), u(2.4), u(0.55))
    },
  },
  'tm-crowd': {
    w: 3.2,
    h: 3.2,
    draw: (c, u) => {
      const dot = (cx: number, cy: number, fill: string, alpha: number) => {
        c.globalAlpha = alpha
        c.fillStyle = fill
        c.beginPath()
        c.arc(u(cx), u(cy), u(0.3), 0, Math.PI * 2)
        c.fill()
      }
      dot(0.7, 0.8, '#DC143C', 0.5)
      dot(2.2, 1.7, '#00D9FF', 0.45)
      dot(1.3, 2.6, '#E8B923', 0.45)
      dot(2.7, 0.5, '#FFFFFF', 0.4)
      c.globalAlpha = 1
    },
  },
  'tm-roof': {
    w: 3.6,
    h: 3.6,
    draw: (c, u) => {
      c.globalAlpha = 0.055
      c.fillStyle = '#000000'
      c.fillRect(0, 0, u(0.35), u(3.6))
      c.globalAlpha = 0.04
      c.fillStyle = '#FFFFFF'
      c.fillRect(u(0.35), 0, u(0.3), u(3.6))
      c.globalAlpha = 1
    },
  },
  'tm-crop': {
    w: 11,
    h: 11,
    // The SVG pattern carries patternTransform="rotate(24)"; without it the rows run axis-aligned.
    rot: 24,
    draw: (c, u) => {
      c.globalAlpha = 0.05
      c.fillStyle = '#FFFFFF'
      c.fillRect(0, 0, u(3.4), u(11))
      c.globalAlpha = 1
    },
  },
  'tm-water': {
    w: 9,
    h: 6,
    draw: (c, u) => {
      c.strokeStyle = '#A8D4E6'
      c.lineWidth = u(0.35)
      for (const [y, alpha] of [[2, 0.3], [4.6, 0.2]] as const) {
        c.globalAlpha = alpha
        c.beginPath()
        c.moveTo(0, u(y))
        c.quadraticCurveTo(u(2.2), u(y) - u(1.4), u(4.5), u(y))
        c.quadraticCurveTo(u(6.8), u(y) + u(1.4), u(9), u(y))
        c.stroke()
      }
      c.globalAlpha = 1
    },
  },
}
