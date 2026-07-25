// #sim-2d — tree culling. Trees are more than half of every element on the map and they only exist at
// racing zoom, which is exactly when the least of the circuit is on screen. These pin the two things
// that would make culling worse than not culling: dropping something still visible, and keeping
// everything anyway.

import { describe, it, expect } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { buildScenery } from './track-scenery'
import { visibleTrees, type Cull } from '@/components/race/SceneryLayer'

const sceneryFor = (id: string) => {
  const layout = TRACK_LAYOUTS[id]
  return buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: layout.metresPerUnit,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
  })
}

describe('visibleTrees', () => {
  const trees = sceneryFor('britain').trees

  it('renders everything when there is no cull, which is what the preview and the map view want', () => {
    expect(visibleTrees(trees, null)).toBe(trees)
    expect(visibleTrees(trees, undefined)).toBe(trees)
  })

  it('never drops a tree any part of which is inside the disc', () => {
    const cull: Cull = { cx: trees[0].x, cy: trees[0].y, r: 60 }
    const kept = new Set(visibleTrees(trees, cull))
    for (const t of trees) {
      const d = Math.hypot(t.x - cull.cx, t.y - cull.cy)
      // Anything whose canopy reaches the disc has to survive, or it pops in mid-frame.
      if (d - t.r <= cull.r) expect(kept.has(t), `dropped a tree ${d.toFixed(1)} away`).toBe(true)
    }
  })

  it('actually cuts the count at a racing-zoom radius', () => {
    // The whole point: if a plausible viewport keeps nearly everything, culling is pure overhead.
    const cull: Cull = { cx: trees[0].x, cy: trees[0].y, r: 120 }
    expect(visibleTrees(trees, cull).length).toBeLessThan(trees.length * 0.5)
  })

  it('sheds the FURTHEST trees first when it is over budget', () => {
    // Shedding must take the horizon off, not punch a hole in the grove being driven past.
    const cull: Cull = { cx: trees[0].x, cy: trees[0].y, r: 400 }
    const all = visibleTrees(trees, cull)
    const capped = visibleTrees(trees, cull, 20)
    expect(capped).toHaveLength(20)
    const worstKept = Math.max(...capped.map((t) => Math.hypot(t.x - cull.cx, t.y - cull.cy)))
    for (const t of all) {
      if (capped.includes(t)) continue
      expect(Math.hypot(t.x - cull.cx, t.y - cull.cy)).toBeGreaterThanOrEqual(worstKept)
    }
  })

  it('leaves the set alone when it is inside budget', () => {
    const cull: Cull = { cx: trees[0].x, cy: trees[0].y, r: 120 }
    const near = visibleTrees(trees, cull)
    expect(visibleTrees(trees, cull, near.length)).toEqual(near)
    expect(visibleTrees(trees, cull, 1e6)).toEqual(near)
  })

  it('caps even without a disc, which is what the budget falls back to', () => {
    expect(visibleTrees(trees, null, 7)).toHaveLength(7)
  })

  it('keeps the lot when the disc covers the circuit', () => {
    const xs = trees.map((t) => t.x)
    const ys = trees.map((t) => t.y)
    const cull: Cull = {
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      r: 1e5,
    }
    expect(visibleTrees(trees, cull)).toHaveLength(trees.length)
  })
})
