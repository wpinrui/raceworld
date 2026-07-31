'use client'

// The perf lab's screen (#sim-2d): pick the run, watch it, read it, copy it.
//
// Three states in one component because they are one thing to the person using it. Picking comes first
// and on purpose: a full matrix is seven shots against twenty-five variants and nobody wants all of it
// every time, so the selection is made before a frame is measured and the estimate updates as it is made.
//
// While a run is going the panel COLLAPSES to a strip in the corner. A full-screen overlay in front of
// the canvas occludes it, and an occluded canvas rasterises less: the modal would be measuring itself.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, ClipboardCopy, Gauge, Play, RotateCcw, Square, X,
} from 'lucide-react'
import {
  COLUMNS, VARIANTS, baselineSummary, estimateSeconds, traceSummary, verdictFor,
  type LabConfig, type VariantGroup, type VerdictKind,
} from '@/lib/ui/perf-bench'
import { SHOTS, type ShotId } from '@/lib/ui/perf-shots'
import { Tooltip } from '@/components/ui/Tooltip'
import type { PerfLab } from './use-perf-lab'

const VERDICT_COLOR: Record<VerdictKind, string> = {
  saves: '#10B981',
  nothing: '#F59E0B',
  backfires: '#DC143C',
  cost: '#FFFFFF',
}

const GROUP_LABEL: Record<VariantGroup, string> = {
  mitigation: 'Mitigations',
  layer: 'Layers',
  quality: 'Quality presets',
  renderer: 'Renderer',
}

const GROUPS = Object.keys(GROUP_LABEL) as VariantGroup[]

/** Below this a cell cannot carry a 1% low worth the name, let alone a stable mean. */
const MIN_FRAMES = 30

const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`

function Box({ on, label, note, onClick }: {
  on: boolean; label: string; note?: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-[#232A38] cursor-pointer"
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border"
        style={{ borderColor: on ? '#00D9FF' : '#3A4356', background: on ? '#00D9FF' : 'transparent' }}
      >
        {on && <Check size={12} color="#0F1419" strokeWidth={4} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] text-[#FFFFFF]">{label}</span>
        {note && <span className="block text-[11px] text-[#FFFFFF]">{note}</span>}
      </span>
    </button>
  )
}

function ConfigPane({ config, setConfig }: {
  config: LabConfig; setConfig: (c: LabConfig) => void
}) {
  const toggleShot = (id: ShotId) => setConfig({
    ...config,
    shots: config.shots.includes(id) ? config.shots.filter((s) => s !== id) : [...config.shots, id],
  })
  const toggleVariant = (id: string) => setConfig({
    ...config,
    variants: config.variants.includes(id)
      ? config.variants.filter((v) => v !== id)
      : [...config.variants, id],
  })
  const toggleGroup = (g: VariantGroup) => {
    const ids = VARIANTS.filter((v) => v.group === g).map((v) => v.id)
    const allOn = ids.every((id) => config.variants.includes(id))
    setConfig({
      ...config,
      variants: allOn
        ? config.variants.filter((v) => !ids.includes(v))
        : [...new Set([...config.variants, ...ids])],
    })
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-[#FFFFFF]">Shots</div>
        {SHOTS.map((s) => (
          <Box
            key={s.id} on={config.shots.includes(s.id)} label={s.label} note={s.note}
            onClick={() => toggleShot(s.id)}
          />
        ))}
        <div className="mt-3 flex items-center gap-4">
          {([['frames', 'Measured frames'], ['warmup', 'Warmup frames']] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[12px] text-[#FFFFFF]">
              {label}
              <input
                type="number" min={key === 'frames' ? MIN_FRAMES : 0} max={600} step={10}
                value={config[key]}
                onChange={(e) => setConfig({
                  ...config,
                  // Clamped to what the field advertises: a cell of nought frames measures nothing and
                  // ends the run on its first cell with a report of no rows and no reason given.
                  [key]: Math.max(key === 'frames' ? MIN_FRAMES : 0, Number(e.target.value) || 0),
                })}
                className="w-16 rounded border border-[#2A3142] bg-[#151A22] px-1.5 py-1 text-[#FFFFFF]"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="max-h-[52vh] overflow-y-auto pr-1">
        {GROUPS.map((g) => {
          const mine = VARIANTS.filter((v) => v.group === g)
          const on = mine.filter((v) => config.variants.includes(v.id)).length
          return (
            <div key={g} className="mb-2">
              <button
                type="button"
                onClick={() => toggleGroup(g)}
                className="mb-0.5 flex w-full items-center justify-between rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-[#FFFFFF] hover:bg-[#232A38] cursor-pointer"
              >
                <span>{GROUP_LABEL[g]}</span>
                <span className="text-[#00D9FF]">{on}/{mine.length}</span>
              </button>
              {mine.map((v) => (
                <Box
                  key={v.id} on={config.variants.includes(v.id)} label={v.label} note={v.reads}
                  onClick={() => toggleVariant(v.id)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Tailwind widths for the shared column model, BY KEY: a positional list beside COLUMNS renders
 *  `className="undefined"` the first time a column is added. The numbers and their precision live in
 *  perf-bench.ts, so this table and the pasted one cannot disagree about either. */
const COL_W: Record<string, string> = {
  fps: 'w-14', low1: 'w-16', p95: 'w-16', max: 'w-16', long: 'w-12', cpu: 'w-16', calls: 'w-16',
}
const widthOf = (key: string) => COL_W[key] ?? 'w-16'

function ShotBlockView({ b }: { b: PerfLab['blocks'][number] }) {
  const rows = [b.baseline, ...b.rows, b.repeat]
  // The baseline's own trace, which is where the crossings-or-steady-state question is read. The full
  // per-row traces are in the pasted report; the window carries the one line that decides it.
  const trace = b.baseline?.trace ? traceSummary(b.baseline.trace) : null
  return (
    <div className="mb-5">
      <div className="mb-1 text-[12px] font-semibold text-[#FFFFFF]">
        {b.shot.label}
        <span className="ml-2 font-normal">{b.shot.note}</span>
      </div>
      {b.vsync && b.baseline && (
        <div className="mb-1 text-[11px] text-[#F59E0B]">
          Vsync bound: {(b.baseline.stats.atFloor * 100).toFixed(0)}% of baseline frames sat on the
          display floor, so these verdicts compare cpu ms, not frame time.
        </div>
      )}
      {b.baseline && (
        <div className="mb-1 text-[11px] text-[#FFFFFF]">
          noise floor {b.noiseMs.toFixed(2)}{b.noiseUnit} | {baselineSummary(b.baseline)}
        </div>
      )}
      {trace && (
        <div className="mb-1 text-[11px] text-[#FFFFFF]">
          {trace.crossings} crossings, {trace.swaps} swaps | {trace.longFrames} long
          ({trace.longAtCrossing} within a frame of one, {trace.longSteady} nowhere near one) |
          {' '}{trace.crossingMs.toFixed(1)}ms on crossing frames vs {trace.steadyMs.toFixed(1)}ms on the rest
        </div>
      )}
      <div className="flex border-b border-[#2A3142] pb-1 text-[#FFFFFF]">
        <span className="flex-1">configuration</span>
        {COLUMNS.map((c) => <span key={c.key} className={`${widthOf(c.key)} text-right`}>{c.head}</span>)}
        <span className="w-40 pl-3">verdict</span>
      </div>
      {rows.map((r, i) => {
        if (!r) return null
        const v = b.baseline && r.cell.group !== 'baseline'
          ? verdictFor({ row: r, baseline: b.baseline, noiseMs: b.noiseMs, basis: b.basis })
          : null
        const prev = rows[i - 1]
        const head = r.cell.group !== 'baseline' && r.cell.group !== prev?.cell.group
          ? GROUP_LABEL[r.cell.group]
          : null
        return (
          <div key={`${r.cell.key}-${i}`}>
            {head && (
              <div className="pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#FFFFFF]">
                {head}
              </div>
            )}
            <div className="flex border-b border-[#1B2130] py-0.5">
              <span className="flex-1 truncate text-[#FFFFFF]">{r.cell.label}</span>
              {COLUMNS.map((c) => (
                <span key={c.key} className={`${widthOf(c.key)} text-right text-[#FFFFFF]`}>
                  {c.of(r).toFixed(c.dp)}
                </span>
              ))}
              <span className="w-40 truncate pl-3" style={{ color: v ? VERDICT_COLOR[v.kind] : '#FFFFFF' }}>
                {v ? v.text : ''}
              </span>
            </div>
          </div>
        )
      })}
      {b.skipped.map((c) => (
        <div key={c.key} className="flex py-0.5 text-[#FFFFFF]">
          <span className="flex-1 truncate">{c.label}</span>
          <span className="pl-3">skipped: {c.skip}</span>
        </div>
      ))}
    </div>
  )
}

const ResultsPane = ({ lab }: { lab: PerfLab }) => (
  <div className="max-h-[62vh] overflow-y-auto font-mono text-[11px]">
    {lab.blocks.map((b) => <ShotBlockView key={b.shot.id} b={b} />)}
  </div>
)

/** A strip, not a sheet: an overlay in front of the canvas occludes it, and an occluded canvas
 *  rasterises less, so the modal would be measuring itself. */
function RunningStrip({ lab }: { lab: PerfLab }) {
  const total = lab.state.cells.filter((c) => !c.skip).length
  const done = lab.state.results.length
  return (
    <div
      className="absolute left-1/2 top-2 z-40 -translate-x-1/2 rounded-lg border border-[#2A3142] bg-[#1E2431]/95 px-3 py-2"
      // The strip lives inside the map, which takes a pointer-down as the start of a camera drag.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 font-mono text-[12px] text-[#FFFFFF]">
        <Gauge size={16} color="#00D9FF" />
        <span>{done}/{total}</span>
        <span className="w-64 truncate">{lab.state.status}</span>
        <button
          type="button"
          onClick={lab.abort}
          className="flex items-center gap-1 rounded bg-[#2A3142] px-2 py-1 hover:bg-[#303848] cursor-pointer"
        >
          <Square size={12} /> Stop
        </button>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-[#2A3142]">
        <div className="h-full bg-[#00D9FF]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

export function PerfLabModal({ lab }: { lab: PerfLab }) {
  const [copied, setCopied] = useState(false)
  // Cleared on a timer that is cancelled if the panel goes first, so a close mid-flash cannot set state
  // on an unmounted tree.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(id)
  }, [copied])
  if (!lab.open) return null

  const { state, config, plan } = lab
  const runnable = plan.filter((c) => !c.skip).length

  if (state.phase === 'running') return <RunningStrip lab={lab} />

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lab.copyText())
      setCopied(true)
    } catch {
      // No clipboard permission. The console still gets it, so a run is never trapped in the window.
      console.log(lab.copyText())
      setCopied(true)
    }
  }

  // Through a portal, and not for tidiness. The map owns a native wheel listener that zooms the camera
  // and preventDefaults, and a React handler inside its subtree cannot stop a native listener that sits
  // below the React root: scrolling the variant list would zoom the circuit. Out of the subtree, both
  // that and the camera-drag pointer handlers stop being reachable at all.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 flex w-full max-w-5xl flex-col rounded-lg border border-[#2A3142] bg-[#1E2431] p-5">
        <div className="mb-3 flex items-center gap-3">
          <Gauge size={18} color="#00D9FF" />
          <h3 className="flex-1 text-sm font-semibold uppercase tracking-widest text-[#FFFFFF]">
            Renderer perf lab
          </h3>
          {state.phase === 'done' && (
            <>
              <Tooltip content="Every row plus the full configuration, as text">
                <button
                  type="button"
                  onClick={copy}
                  className="flex items-center gap-1.5 rounded bg-[#00D9FF] px-3 py-1.5 text-[12px] font-bold uppercase tracking-widest text-[#0F1419] hover:bg-[#009CB8] cursor-pointer"
                >
                  <ClipboardCopy size={14} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={lab.reset}
                className="flex items-center gap-1.5 rounded bg-[#2A3142] px-3 py-1.5 text-[12px] font-bold uppercase tracking-widest text-[#FFFFFF] hover:bg-[#303848] cursor-pointer"
              >
                <RotateCcw size={14} /> New run
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => lab.setOpen(false)}
            className="rounded p-1 text-[#FFFFFF] hover:bg-[#232A38] cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {state.phase === 'config' ? (
          <>
            <ConfigPane config={config} setConfig={lab.setConfig} />
            <div className="mt-4 flex items-center gap-4 border-t border-[#2A3142] pt-3">
              <span className="text-[12px] text-[#FFFFFF]">
                {runnable} cells · about {mmss(estimateSeconds(plan, config))}
              </span>
              {state.status && <span className="text-[12px] text-[#F59E0B]">{state.status}</span>}
              <button
                type="button"
                onClick={lab.start}
                disabled={runnable === 0}
                className="ml-auto flex items-center gap-1.5 rounded bg-[#00D9FF] px-4 py-2 text-[12px] font-bold uppercase tracking-widest text-[#0F1419] hover:bg-[#009CB8] disabled:bg-[#2A3142] disabled:text-[#6B7280] cursor-pointer"
              >
                <Play size={14} /> Run
              </button>
            </div>
          </>
        ) : (
          <ResultsPane lab={lab} />
        )}
      </div>
    </div>,
    document.body,
  )
}
