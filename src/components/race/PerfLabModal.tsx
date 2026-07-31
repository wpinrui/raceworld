'use client'

// The perf lab's screen (#sim-2d): pick the run, watch it, read it, copy it.
//
// Three states in one component because they are one thing to the person using it. Picking comes first
// and on purpose: a full matrix is seven shots against twenty-five variants and nobody wants all of it
// every time, so the selection is made before a frame is measured and the estimate updates as it is made.
//
// While a run is going the panel COLLAPSES to a strip in the corner. A full-screen overlay in front of
// the canvas occludes it, and an occluded canvas rasterises less: the modal would be measuring itself.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, ClipboardCopy, Gauge, Play, RotateCcw, Square, X,
} from 'lucide-react'
import {
  SHOTS, VARIANTS, estimateSeconds, verdictFor,
  type LabConfig, type ShotId, type VariantGroup, type VerdictKind,
} from '@/lib/ui/perf-bench'
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
        {note && <span className="block text-[11px] text-[#9CA3AF]">{note}</span>}
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
                type="number" min={key === 'frames' ? 30 : 0} max={600} step={10}
                value={config[key]}
                onChange={(e) => setConfig({ ...config, [key]: Math.max(0, Number(e.target.value) || 0) })}
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

const HEADS: ReadonlyArray<readonly [string, string]> = [
  ['fps', 'w-14'], ['1% low', 'w-16'], ['p95 ms', 'w-16'], ['max ms', 'w-16'],
  ['long', 'w-12'], ['cpu ms', 'w-16'], ['calls', 'w-16'],
]

function ResultsPane({ lab }: { lab: PerfLab }) {
  return (
    <div className="max-h-[62vh] overflow-y-auto font-mono text-[11px]">
      {lab.blocks.map((b) => (
        <div key={b.shot.id} className="mb-5">
          <div className="mb-1 text-[12px] font-semibold text-[#FFFFFF]">
            {b.shot.label}
            <span className="ml-2 font-normal text-[#9CA3AF]">{b.shot.note}</span>
          </div>
          {b.baseline && (
            <>
              {b.vsync && (
                <div className="mb-1 text-[11px] text-[#F59E0B]">
                  Vsync bound: {(b.baseline.stats.atFloor * 100).toFixed(0)}% of baseline frames sat on
                  the display floor, so these verdicts compare cpu ms, not frame time.
                </div>
              )}
              <div className="mb-1 text-[11px] text-[#9CA3AF]">
                noise floor {b.noiseMs.toFixed(2)}ms/frame ·
                {' '}{b.baseline.scene.items} items, {b.baseline.scene.ops} ops,
                {' '}{b.baseline.scene.pathKb.toFixed(0)}KB paths, {b.baseline.scene.nodes} nodes ·
                {' '}tick {b.baseline.tickMs.toFixed(2)}ms ·
                {' '}paint {b.baseline.paint.msPerPaint.toFixed(2)}ms on
                {' '}{(b.baseline.paint.frac * 100).toFixed(0)}% of frames ·
                {' '}{b.baseline.paint.skipped} items skipped/frame
              </div>
            </>
          )}
          <div className="flex border-b border-[#2A3142] pb-1 text-[#9CA3AF]">
            <span className="flex-1">configuration</span>
            {HEADS.map(([h, w]) => <span key={h} className={`${w} text-right`}>{h}</span>)}
            <span className="w-40 pl-3">verdict</span>
          </div>
          {[b.baseline, ...b.rows, b.repeat].map((r, i, all) => {
            if (!r) return null
            const v = b.baseline && r.cell.group !== 'baseline'
              ? verdictFor(r, b.baseline, b.noiseMs, b.vsync)
              : null
            const prev = all[i - 1]
            const head = r.cell.group !== 'baseline' && r.cell.group !== prev?.cell.group
              ? GROUP_LABEL[r.cell.group]
              : null
            return (
              <div key={`${r.cell.key}-${i}`}>
                {head && (
                  <div className="pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                    {head}
                  </div>
                )}
                <div className="flex border-b border-[#1B2130] py-0.5">
                <span className="flex-1 truncate text-[#FFFFFF]">{r.cell.label}</span>
                {[
                  r.stats.fps.toFixed(0), r.stats.low1.toFixed(0), r.stats.p95Ms.toFixed(1),
                  r.stats.maxMs.toFixed(1), String(r.stats.longFrames),
                  r.busyMs.toFixed(2), String(r.paint.calls),
                ].map((cell, j) => (
                  <span key={HEADS[j][0]} className={`${HEADS[j][1]} text-right text-[#FFFFFF]`}>{cell}</span>
                ))}
                <span className="w-40 truncate pl-3" style={{ color: v ? VERDICT_COLOR[v.kind] : '#9CA3AF' }}>
                  {v ? v.text : ''}
                </span>
                </div>
              </div>
            )
          })}
          {b.skipped.map((c) => (
            <div key={c.key} className="flex py-0.5 text-[#9CA3AF]">
              <span className="flex-1 truncate">{c.label}</span>
              <span className="pl-3">skipped: {c.skip}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function PerfLabModal({ lab }: { lab: PerfLab }) {
  const [copied, setCopied] = useState(false)
  if (!lab.open) return null

  const { state, config, plan } = lab
  const runnable = plan.filter((c) => !c.skip).length

  // Running: a strip, not a sheet. The map has to be measured with nothing in front of it.
  if (state.phase === 'running') {
    const total = state.cells.filter((c) => !c.skip).length
    const done = state.results.length
    return (
      <div
        className="absolute left-1/2 top-2 z-40 -translate-x-1/2 rounded-lg border border-[#2A3142] bg-[#1E2431]/95 px-3 py-2"
        // The strip lives inside the map, which takes a pointer-down as the start of a camera drag.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 font-mono text-[12px] text-[#FFFFFF]">
          <Gauge size={16} color="#00D9FF" />
          <span>{done}/{total}</span>
          <span className="w-64 truncate">{state.status}</span>
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

  const copy = async () => {
    await navigator.clipboard.writeText(lab.copyText())
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
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
