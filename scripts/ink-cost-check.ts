// Scratch probe: how much of a racing-zoom frame the SURFACE INK is, which
// scripts/canvas-cost-check.ts does not model at all (it stops at the four road strokes).
//
// Counts ops after the viewport skip, and estimates INKED AREA in device pixels: for a stroke that is
// the length of the polyline actually inside the viewport times the stroke width. Area is the currency
// GPU raster is billed in, so this is the number that matters, not the op count.

import { TRACK_LAYOUTS } from '../src/data/tracks'
import { densifyTrace, TARMAC_WIDTH_M, TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { buildRacingLine, polylineArc } from '../src/lib/ui/racing-line'
import { lapDynamics, trackPhysics } from '../src/lib/ui/lap-dynamics'
import { edgeOps, grainOps, marbleOps, rubberOps, skidOps } from '../src/lib/ui/track-surface'
import type { DrawOp } from '../src/lib/ui/scenery-draw'

const VIEW_W = 1600
const VIEW_H = 900
const RACE_Z = 20
const DPR = Number(process.env.DPR ?? 1.5)
const TRACK_M = 1.6

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['hungary', 'hockenheim', 'monaco']

// Walk a path's coordinate stream as polylines (all our ink is M/L only).
function polylines(d: string): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  for (const part of d.split('M').slice(1)) {
    const nums = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    const pts: Array<[number, number]> = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
    if (pts.length) out.push(pts)
  }
  return out
}

// Length of the polyline inside an axis-aligned world-space box (segment midpoint test; the segments
// are a few units long against a viewport tens of units across, so the error is small).
function visibleLen(d: string, box: { x0: number; y0: number; x1: number; y1: number }): number {
  let len = 0
  for (const pts of polylines(d)) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]
      const [bx, by] = pts[i]
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      if (mx < box.x0 || mx > box.x1 || my < box.y0 || my > box.y1) continue
      len += Math.hypot(bx - ax, by - ay)
    }
  }
  return len
}

console.log(`Surface-ink cost at racing zoom (${RACE_Z}x, ${VIEW_W}x${VIEW_H}, dpr ${DPR})`)
console.log('ops = after the per-op clip-disc viewport skip. Mpx = estimated inked device pixels PER FRAME.')
console.log('The whole viewport is %s Mpx, so "Mpx" divided by that is how many times over the ink repaints the screen.\n',
  ((VIEW_W * DPR * VIEW_H * DPR) / 1e6).toFixed(2))

for (const id of ids) {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) { console.log(`${id}: unknown`); continue }
  const u = (m: number) => m / layout.metresPerUnit
  const pad = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const vb = { x: vx - pad, y: vy - pad, w: vw + 2 * pad, h: vh + 2 * pad }
  const ppu = Math.min(VIEW_W / vb.w, VIEW_H / vb.h)

  const centre = densifyTrace(layout.trace).map(([x, y]) => ({ x, y }))
  const arc = polylineArc(centre)
  const solved = buildRacingLine(arc, layout.metresPerUnit)
  const dyn = lapDynamics(solved.pts, arc.length, trackPhysics(layout.metresPerUnit))

  const s = {
    u, line: solved.pts, curvature: dyn.curvature, long: dyn.long, trackM: TRACK_M,
    tarmac: '#33383E', centre, ground: '#3E5A34', shadow: '#1A2418',
    ribbonHalfM: TRACK_WIDTH_M / 2, lineWidthM: (TRACK_WIDTH_M - TARMAC_WIDTH_M) / 2,
    tarmacHalfM: TARMAC_WIDTH_M / 2, lateral: solved.lateral, detail: 'full' as const,
  }
  const groups: Array<[string, DrawOp[]]> = [
    ['edge/apron', edgeOps(s)],
    ['grain', grainOps(s)],
    ['rubber', rubberOps(s)],
    ['marbles', marbleOps(s)],
    ['skids', skidOps(s)],
  ]

  // Park the camera at each station round the lap; report the worst shot and the median.
  const k = RACE_Z * ppu // device-independent px per unit
  const viewR = (Math.hypot(VIEW_W, VIEW_H) / 2 / k) * 1.05
  const halfW = VIEW_W / 2 / k
  const halfH = VIEW_H / 2 / k
  const stride = Math.max(1, Math.floor(centre.length / 160))
  const shots: Array<{ frac: number; ops: number; mpx: number; by: Record<string, number> }> = []
  for (let i = 0; i < centre.length; i += stride) {
    const c = centre[i]
    const box = { x0: c.x - halfW, y0: c.y - halfH, x1: c.x + halfW, y1: c.y + halfH }
    let ops = 0
    let mpx = 0
    const by: Record<string, number> = {}
    for (const [name, list] of groups) {
      for (const op of list) {
        if (op.clip && Math.hypot(op.clip.cx - c.x, op.clip.cy - c.y) > viewR + op.clip.r) continue
        ops++
        const len = visibleLen(op.d, box)
        if (len === 0) continue
        // stroke area in device px: visible length * width, both in units, scaled by (k*dpr)^2
        const area = len * (op.width ?? 1) * (k * DPR) ** 2
        mpx += area / 1e6
        by[name] = (by[name] ?? 0) + area / 1e6
      }
    }
    shots.push({ frac: i / centre.length, ops, mpx, by })
  }
  const sorted = [...shots].sort((a, b) => a.mpx - b.mpx)
  const med = sorted[Math.floor(sorted.length / 2)]
  const worst = sorted[sorted.length - 1]
  const fmt = (sh: typeof med) => `${String(sh.ops).padStart(4)} ops  ${sh.mpx.toFixed(1).padStart(6)} Mpx  `
    + Object.entries(sh.by).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${v.toFixed(1)}`).join('  ')
  const totalOps = groups.reduce((n, [, l]) => n + l.length, 0)
  console.log(`${id}  (${totalOps} ink ops in the whole lap)`)
  console.log(`  median shot  ${fmt(med)}`)
  console.log(`  worst  ${(worst.frac * 100).toFixed(0)}%  ${fmt(worst)}`)
  console.log('')
}
