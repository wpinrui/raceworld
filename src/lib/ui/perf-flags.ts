// The renderer's mitigations, as switches (#sim-2d).
//
// Every entry here is something the map does purely to be faster: a cache, a batch, a cull, a write it
// declines to make. Each one was added because a measurement said it would help, and not one of them has
// been measured again since. A mitigation that stopped earning its keep looks exactly like one that
// still does, because the only evidence either way is a number nobody re-takes.
//
// So each is a boolean that the hot site reads, and the perf lab turns off one at a time and re-measures.
// The DELTA is the answer: with the mitigation off the frame gets slower by exactly what the mitigation
// was saving, and if it does not get slower then the mitigation is saving nothing and is pure complexity.
//
// The cost of reading these in production is a monomorphic property load off a module-scope object, which
// is why they can sit inside the per-op loop without a second thought. They are ALWAYS true outside the
// lab, and the lab restores them in a `finally`.

export interface PerfFlags {
  /** Path2D objects cached by their path data, so a path is parsed once rather than once a frame. */
  pathCache: boolean
  /** The mirror of the canvas context's ink, so a fill colour is written when it CHANGES. */
  paintState: boolean
  /** The per-item disc test in `drawScene`: an item wholly off screen is not handed to the rasteriser. */
  itemCull: boolean
  /** `mergeByPaint`: ops that paint identically become one path, so a grove is one draw call. */
  mergePaint: boolean
  /** `batchFlat`: a placed group carrying no gradient is baked into the flat run and merged with it. */
  batchFlat: boolean
  /** The per-object geometry memo, so a zoom notch rebuilds the objects whose rung moved and no others. */
  geomCache: boolean
  /** The still-camera repaint guard: a camera that has not moved does not repaint the static world. */
  cameraGuard: boolean
  /** The cull disc: the scene is composed against a disc around the shot, not the whole circuit. */
  cullDisc: boolean
  /** The detail ladder: an object is drawn at the rung its own on-screen size resolves to. */
  lodRungs: boolean
  /** The deferred swap: a new scene's paths are parsed in slices before it replaces the old one. */
  warmSwap: boolean
  /** `setVis` write elision: a visibility that is already what it should be is not written again. */
  visElide: boolean
}

export type PerfFlag = keyof PerfFlags

/** What each switch turns off, in the words a result table needs. `claim` is what the mitigation is
 *  BELIEVED to buy, which is the thing the lab is there to confirm or refute. */
export const PERF_FLAG_INFO: Record<PerfFlag, { label: string; claim: string; site: string }> = {
  pathCache: {
    label: 'Path2D cache',
    claim: 'parsing is the expensive half of drawing a path, so each is parsed once',
    site: 'SceneryCanvas.pathFor',
  },
  paintState: {
    label: 'Ink state mirror',
    claim: 'the scene is paint-ordered, so most style writes would be the same value twice',
    site: 'SceneryCanvas.applyOp',
  },
  itemCull: {
    label: 'Viewport item skip',
    claim: 'the cull disc is wider than the shot, so much of the scene has no pixels on screen',
    site: 'SceneryCanvas.drawScene',
  },
  mergePaint: {
    label: 'Paint batching',
    claim: 'a hundred flat canopies of one green cost one draw call instead of a hundred',
    site: 'lod.mergeByPaint',
  },
  batchFlat: {
    label: 'Group baking',
    claim: 'a placed group with no gradient joins the flat run rather than costing a save/restore',
    site: 'scenery-draw.batchFlat',
  },
  geomCache: {
    label: 'Object geometry memo',
    claim: 'a notch rebuilds the few objects whose rung moved, not the whole circuit (8ms, 28ms on Monaco)',
    site: 'scenery-draw.objectMemo',
  },
  cameraGuard: {
    label: 'Still-camera guard',
    claim: 'a parked follow camera would otherwise repaint the identical picture sixty times a second',
    site: 'RaceTrackMap.applyCam',
  },
  cullDisc: {
    label: 'Scene cull disc',
    claim: 'composing the whole circuit every step is geometry for things nowhere near the shot',
    site: 'RaceTrackMap.composeScene',
  },
  lodRungs: {
    label: 'Detail ladder',
    claim: 'an object sheds its internal shading once that shading is smaller than the eye can separate',
    site: 'lod.rungFor',
  },
  warmSwap: {
    label: 'Warmed scene swap',
    claim: 'parsing a fresh scene inside the next paint was a 33-50ms frame on every disc move',
    site: 'RaceTrackMap.swapScene',
  },
  visElide: {
    label: 'Visibility write elision',
    claim: 'thirty style writes a frame that say what the element already said',
    site: 'RaceTrackMap.setVis',
  },
}

export const PERF_FLAGS = Object.keys(PERF_FLAG_INFO) as PerfFlag[]

const ALL_ON = (): PerfFlags => {
  const out = {} as PerfFlags
  for (const k of PERF_FLAGS) out[k] = true
  return out
}

/** The live switches. Mutated in place rather than replaced, so every hot site can hold this object. */
export const PERF: PerfFlags = ALL_ON()

/** Turn the named mitigations off and every other one on. One call per lab cell. */
export function setPerfFlags(off: readonly PerfFlag[]): void {
  for (const k of PERF_FLAGS) PERF[k] = true
  for (const k of off) PERF[k] = false
}

/** Back to shipping behaviour. The lab calls this in a `finally`; tests call it in teardown. */
export function resetPerfFlags(): void {
  setPerfFlags([])
}
