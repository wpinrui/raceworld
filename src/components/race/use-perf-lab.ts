'use client'

// The perf lab's driver (#sim-2d): it owns the camera for the length of a run and nothing else.
//
// Kept out of RaceTrackMap because that file is already the largest thing in the repo, and kept out of
// the modal because the modal must be able to render without measuring anything. What connects the three
// is `PerfLabHarness`: a handful of imperative handles the map hands over, which is also the whole list
// of things a run is allowed to touch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_LAB_CONFIG, blocksOf, frameStats, planCells, shotById,
  type Cell, type CellConfig, type CellResult, type Camera, type LabConfig, type ShotWorld,
} from '@/lib/ui/perf-bench'
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

const zeroSections = (a: Record<string, number>, b: Record<string, number>) => {
  const out: Record<string, number> = {}
  for (const k of Object.keys(a)) {
    const d = (a[k] ?? 0) - (b[k] ?? 0)
    if (d > 0) out[k] = +d.toFixed(2)
  }
  return out
}

/** `cars` is a parameter rather than something read back off the harness because the plan depends on it
 *  (a field of nothing cannot exercise the visibility-write elision) and the plan is rendered. */
export function usePerfLab(harness: PerfLabHarness, cars: number) {
  const [open, setOpen] = useState(false)
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

  /** One cell: drive the shot's camera for warmup+measured frames and read every counter as a delta. */
  const runCell = useCallback(async (cell: Cell, world: ShotWorld, cfg: LabConfig): Promise<CellResult> => {
    const h = harnessRef.current
    const shot = shotById(cell.shot)
    const n = cfg.frames
    const deltas: number[] = []
    const before = h.paintTally()
    const p0 = { ...before, sections: { ...before.sections } }
    const t0 = { ...h.tickTally() }
    let last = performance.now()
    for (let i = -cfg.warmup; i < n; i++) {
      h.setCamera(shot.pose(i, n, world))
      const now = await nextFrame()
      // Warmup frames pay the configuration switch, which is a render the lab caused rather than
      // anything the game does. They move the camera so the shot is already in motion, and vote on
      // nothing.
      if (i >= 0) deltas.push(now - last)
      last = now
      if (abortRef.current) break
    }
    const p1 = h.paintTally()
    const t1 = h.tickTally()
    const paints = p1.n - p0.n
    const msPerPaint = paints > 0 ? (p1.ms - p0.ms) / paints : 0
    const frac = deltas.length > 0 ? paints / deltas.length : 0
    const tickMs = t1.n > t0.n ? Math.max(0, t1.sum - t0.sum) / (t1.n - t0.n) : 0
    return {
      cell,
      stats: frameStats(deltas),
      paint: {
        msPerPaint,
        frac,
        calls: paints > 0 ? Math.round((p1.drawn - p0.drawn) / paints) : 0,
        skipped: paints > 0 ? Math.round((p1.skipped - p0.skipped) / paints) : 0,
        sections: paints > 0
          ? Object.fromEntries(Object.entries(zeroSections(p1.sections, p0.sections))
            .map(([k, v]) => [k, +(v / paints).toFixed(2)]))
          : {},
      },
      scene: h.scene(),
      tickMs,
      // Per FRAME, not per paint: a still camera under the repaint guard paints on a fraction of its
      // frames, and the whole point of the guard is that the frames it skips cost nothing.
      busyMs: tickMs + msPerPaint * frac,
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
        // Two frames for the render the configuration change commits, then a forced compose so the
        // scene being measured is the scene the configuration describes.
        await waitFrames(2)
        await h.settle()
        results.push(await runCell(cell, world, config))
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
