'use client'

// The perf lab's driver (#sim-2d): it owns the camera for the length of a run and nothing else.
//
// Kept out of RaceTrackMap because that file is already the largest thing in the repo, and kept out of
// the modal because the modal must be able to render without measuring anything. What connects the three
// is `PerfLabHarness`: a handful of imperative handles the map hands over, which is also the whole list
// of things a run is allowed to touch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_LAB_CONFIG, blocksOf, cellMetrics, frameStats, planCells,
  type Cell, type CellConfig, type CellResult, type Counters, type FrameSample, type LabConfig,
} from '@/lib/ui/perf-bench'
import { lodBucket } from '@/lib/ui/lod'
import { pxPerMOf, shotById, type Camera, type ShotWorld } from '@/lib/ui/perf-shots'
import { formatReport, type LabReport } from '@/lib/ui/perf-report'
import { resetPerfFlags } from '@/lib/ui/perf-flags'

export interface PerfLabHarness {
  /** Circuit, viewport and field size, for the report header. */
  info: () => { circuit: string; dpr: number; viewport: { w: number; h: number }; cars: number }
  /** Where the shots aim, measured off the live map. Null until the track path has been laid out. */
  world: () => ShotWorld | null
  /** Put the camera exactly here. No follow, no easing: a scripted frame is a scripted frame. */
  setCamera: (cam: Camera) => void
  /** Layers, quality, renderer and mitigation switches for one cell. */
  applyConfig: (cfg: CellConfig) => void
  /** Force a compose and resolve once the picture about to be measured is the one on screen. */
  settle: () => Promise<void>
  /** Paint timing on, with the fps readout closed. */
  timing: (on: boolean) => void
  paintTally: () => { n: number; ms: number; drawn: number; skipped: number; sections: Record<string, number> }
  tickTally: () => { n: number; sum: number }
  /** Scenes that have LANDED since the map mounted, for the per-frame trace. */
  swapTally: () => number
  /** Composes since the map mounted and the main-thread time they took, the warm's slices included.
   *  Neither the painter nor the race loop runs this work, so without it a cell's cpu time omits it. */
  composeTally: () => { n: number; ms: number }
  scene: () => { items: number; ops: number; pathKb: number; nodes: number }
  /** Everything the player had before the run: camera, follow lock, layers, quality, renderer, cap. */
  restore: () => void
}

export type LabPhase = 'config' | 'running' | 'done'

export interface LabState {
  phase: LabPhase
  cells: Cell[]
  results: CellResult[]
  /** Index of the cell being measured, for the progress line. */
  at: number
  status: string
  report: LabReport | null
}

const nextFrame = () => new Promise<number>((res) => { requestAnimationFrame(res) })
const waitFrames = async (n: number) => { for (let i = 0; i < n; i++) await nextFrame() }

/** Both tallies plus the caller's painted-frame count, as one reading. Sections are COPIED: the map
 *  accumulates into the same object every frame, so a reference would read as its own future. */
const snapshot = (h: PerfLabHarness, paintedFrames: number): Counters => {
  const p = h.paintTally()
  const t = h.tickTally()
  const c = h.composeTally()
  return {
    n: p.n, ms: p.ms, drawn: p.drawn, skipped: p.skipped, sections: { ...p.sections },
    tickN: t.n, tickSum: t.sum, composeN: c.n, composeSum: c.ms, paintedFrames,
  }
}

/** `cars` is a parameter rather than something read back off the harness because the plan depends on it
 *  (a field of nothing cannot exercise the visibility-write elision) and the plan is rendered. */
export function usePerfLab(harness: PerfLabHarness, cars: number, openOnMount = false) {
  const [open, setOpen] = useState(openOnMount)
  const [config, setConfig] = useState<LabConfig>(DEFAULT_LAB_CONFIG)
  const [state, setState] = useState<LabState>({
    phase: 'config', cells: [], results: [], at: 0, status: '', report: null,
  })
  const abortRef = useRef(false)
  const runningRef = useRef(false)
  // The map rebuilds its handles every render (they close over live state), and a run reads them only
  // from async callbacks, so the latest set is published after each commit rather than during it.
  const harnessRef = useRef(harness)
  useEffect(() => { harnessRef.current = harness })

  /** One cell: drive the shot's camera for warmup+measured frames, and read every counter across the
   *  MEASURED window only.
   *
   *  The window matters more than it looks. Snapshotting the counters before the warmup instead of at
   *  the first measured frame folds the configuration switch, its React render and its forced compose
   *  into the cell's cpu time, which at the shipped defaults is twenty warmup frames charged against
   *  ninety measured ones: an overstatement of about a fifth on the very number the vsync verdict is
   *  read from. Frames and counters have to span the same frames.
   *
   *  Returns null when the run was stopped part way through: a cell that got four frames is not a row,
   *  and scoring it against a full baseline would print a verdict out of nothing. */
  const runCell = useCallback(async (
    cell: Cell, world: ShotWorld, cfg: LabConfig,
  ): Promise<CellResult | null> => {
    const h = harnessRef.current
    const shot = shotById(cell.shot)
    const n = cfg.frames
    // Primitive arrays, filled in place. The trace is a per-frame record and the measured window is the
    // one place in this file that must not be allocating: the objects are assembled after the last
    // frame, out of the numbers, where nothing is being timed.
    const ms = new Float64Array(n)
    const px = new Float64Array(n)
    const bucket = new Int16Array(n)
    const swaps = new Uint8Array(n)
    let count = 0
    let painted = 0
    let mark: Counters | null = null
    let paintsAt = h.paintTally().n
    let swapsAt = h.swapTally()
    let last = performance.now()
    for (let i = -cfg.warmup; i < n; i++) {
      // Read at the first MEASURED frame, not before the warmup.
      if (i === 0) mark = snapshot(h, painted)
      const cam = shot.pose(i, n, world)
      h.setCamera(cam)
      const now = await nextFrame()
      const paintsNow = h.paintTally().n
      const swapsNow = h.swapTally()
      // One sample a frame: a single frame can paint more than once (a cull step composes and paints
      // inside the camera's own paint), so counting paints would put this fraction above one.
      if (i >= 0) {
        const pxPerM = pxPerMOf(cam.z, world)
        ms[count] = now - last
        px[count] = pxPerM
        bucket[count] = lodBucket(pxPerM)
        swaps[count] = swapsNow > swapsAt ? 1 : 0
        count++
        if (paintsNow > paintsAt) painted++
      }
      paintsAt = paintsNow
      swapsAt = swapsNow
      last = now
      if (abortRef.current) return null
    }
    if (!mark) return null
    const deltas = Array.from(ms.subarray(0, count))
    const trace: FrameSample[] = Array.from({ length: count }, (_, k) => ({
      i: k, ms: ms[k], pxPerM: px[k], bucket: bucket[k], swapped: swaps[k] === 1,
    }))
    return {
      cell,
      stats: frameStats(deltas),
      ...cellMetrics(mark, snapshot(h, painted), count),
      scene: h.scene(),
      trace,
    }
  }, [])

  const start = useCallback(async () => {
    const h = harnessRef.current
    if (runningRef.current) return
    const world = h.world()
    if (!world) {
      setState((s) => ({ ...s, status: 'the track path has not been laid out yet' }))
      return
    }
    const info = h.info()
    const cells = planCells(config, cars)
    runningRef.current = true
    abortRef.current = false
    setState({ phase: 'running', cells, results: [], at: 0, status: 'starting', report: null })
    h.timing(true)
    const results: CellResult[] = []
    try {
      for (let i = 0; i < cells.length; i++) {
        if (abortRef.current) break
        const cell = cells[i]
        if (cell.skip) continue
        setState((s) => ({
          ...s, at: i, results: [...results],
          status: `${shotById(cell.shot).label} - ${cell.label}`,
        }))
        h.applyConfig(cell.config)
        // Two frames for the render the configuration change commits, then the shot's own opening
        // camera, then a forced compose. The camera comes BEFORE the settle deliberately: a compose is
        // against the cull disc the camera left behind, so settling first would compose the previous
        // cell's shot and hand this one its recompose to pay inside the window.
        await waitFrames(2)
        if (abortRef.current) break
        h.setCamera(shotById(cell.shot).pose(-config.warmup, config.frames, world))
        await h.settle()
        if (abortRef.current) break
        const done = await runCell(cell, world, config)
        // Null means the run was stopped inside the cell. A truncated cell is not a row.
        if (!done) break
        results.push(done)
      }
    } finally {
      h.restore()
      resetPerfFlags()
      h.timing(false)
      runningRef.current = false
    }
    const report: LabReport = {
      circuit: info.circuit,
      at: new Date().toISOString(),
      dpr: info.dpr,
      viewport: info.viewport,
      cars: info.cars,
      config,
      aborted: abortRef.current,
      cells,
      results,
    }
    setState({
      phase: 'done', cells, results, at: cells.length,
      status: abortRef.current ? 'aborted' : 'done', report,
    })
  }, [config, cars, runCell])

  const abort = useCallback(() => { abortRef.current = true }, [])

  // What the current selection would run, for the cell count and the estimate on the configuration
  // screen. The run re-plans from the same inputs rather than taking this, so the two cannot diverge.
  const plan = useMemo(() => planCells(config, cars), [config, cars])

  const reset = useCallback(() => {
    setState({ phase: 'config', cells: [], results: [], at: 0, status: '', report: null })
  }, [])

  /** The finished run grouped by shot, which is how both the table and the copy read it. */
  const blocks = useMemo(
    () => blocksOf(state.cells, new Map(state.results.map((r) => [r.cell.key, r]))),
    [state.cells, state.results],
  )

  const copyText = useCallback(
    () => (state.report ? formatReport(state.report) : ''),
    [state.report],
  )

  return { open, setOpen, config, setConfig, state, blocks, plan, start, abort, reset, copyText }
}

export type PerfLab = ReturnType<typeof usePerfLab>
