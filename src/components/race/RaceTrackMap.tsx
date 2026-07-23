'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TrackLayout } from '@/data/tracks'
import { Tooltip } from '@/components/ui/Tooltip'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// 2D top-down race view (#sim-overhaul phase 6): the circuit outline with one numbered dot per car.
// Rendering follows the qualifying TrackMap pattern: a private rAF reads per-car lap progress from
// `sampleRef` (0..1 fraction of the current lap, S/F = 0) and moves markers via direct DOM writes, so
// nothing re-renders per frame. React only re-renders when the car list / positions / colors change.

export interface TrackCarMeta {
  id: string
  /** Live race position (drives the dot's number). */
  pos: number
  color: string
  name: string
  team?: string
  nationality?: string
  isPlayer?: boolean
  retired?: boolean
}

/** One frame of a car's position: lap progress 0..1 (racing line), or pit-lane progress when `pit`. */
export type TrackSample = { prog: number; pit?: boolean } | null

interface Props {
  layout: TrackLayout
  cars: TrackCarMeta[]
  /** Per-frame sampler: where a car is right now, or null to hide its marker. Read inside rAF. */
  sampleRef: React.MutableRefObject<(id: string) => TrackSample>
  /** Marker diameter in px (default 22). */
  markerSize?: number
  /** Show a flag + name label beside each marker. */
  showLabels?: boolean
}

const TRACK_STROKE = 16

export function RaceTrackMap({ layout, cars, sampleRef, markerSize = 22, showLabels = false }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const pitPathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const pitLenRef = useRef(0)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const posRef = useRef(new Map<string, { left: number; top: number }>())
  const outerRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })

  // Pad the authored viewBox: it hugs the racing line, so half the track stroke (and the markers) would
  // otherwise be clipped wherever the path touches an edge.
  const vb = useMemo(() => {
    const [x, y, w, h] = layout.viewBox.split(' ').map(Number)
    const m = TRACK_STROKE / 2 + 8
    return { x: x - m, y: y - m, w: w + 2 * m, h: h + 2 * m }
  }, [layout.viewBox])

  // Fit an inner stage of the track's exact aspect ratio inside whatever box we're given, so the marker
  // layer's percentage coordinates line up with the SVG at any viewport size.
  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el) return
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      const scale = Math.min(width / vb.w, height / vb.h)
      setStage({ w: Math.floor(vb.w * scale), h: Math.floor(vb.h * scale) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [vb])

  useEffect(() => {
    lenRef.current = 0 // re-measure if the layout changes
    pitLenRef.current = 0
    let raf = 0
    const tick = () => {
      const path = pathRef.current
      const pitPath = pitPathRef.current
      if (path && pitPath) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        if (!pitLenRef.current) pitLenRef.current = pitPath.getTotalLength()
        for (const car of cars) {
          const el = elRefs.current.get(car.id)
          if (!el) continue
          const sample = sampleRef.current(car.id)
          if (sample === null) {
            el.style.visibility = 'hidden'
            continue
          }
          el.style.visibility = ''
          const pt = sample.pit
            ? pitPath.getPointAtLength(Math.min(1, Math.max(0, sample.prog)) * pitLenRef.current)
            : path.getPointAtLength((((sample.prog % 1) + 1) % 1) * lenRef.current)
          const left = ((pt.x - vb.x) / vb.w) * 100
          const top = ((pt.y - vb.y) / vb.h) * 100
          posRef.current.set(car.id, { left, top })
          el.style.left = `${left}%`
          el.style.top = `${top}%`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cars, layout, vb, sampleRef])

  // S/F line: a short tick perpendicular to the direction of travel at path start.
  const sf = useMemo(() => {
    const { x, y, angle } = layout.start
    const nx = Math.cos(angle + Math.PI / 2)
    const ny = Math.sin(angle + Math.PI / 2)
    const half = 13
    return { x1: x - nx * half, y1: y - ny * half, x2: x + nx * half, y2: y + ny * half }
  }, [layout.start])

  return (
    <div ref={outerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="relative" style={{ width: stage.w, height: stage.h }}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="absolute inset-0 w-full h-full">
        {/* Pit lane: a narrower, dimmer ribbon under the track, with a tick at the pit box. */}
        <path ref={pitPathRef} d={layout.pit.d} fill="none" stroke="#2A3142" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={layout.pit.box.x} cy={layout.pit.box.y} r={3} fill="#5C6779" />
        <path ref={pathRef} d={layout.d} fill="none" stroke="#3A4252" strokeWidth={TRACK_STROKE} strokeLinejoin="round" />
        <path d={layout.d} fill="none" stroke="#232A38" strokeWidth={10} strokeLinejoin="round" />
        <line x1={sf.x1} y1={sf.y1} x2={sf.x2} y2={sf.y2} stroke="#FFFFFF" strokeWidth={3} />
      </svg>
      {cars.map((car) => {
        const ring = car.isPlayer ? '0 0 0 2.5px #FFFFFF, 0 0 7px rgba(255,255,255,0.7)' : undefined
        return (
          <Tooltip
            key={car.id}
            content={
              <div>
                <div className="font-semibold">{car.name}</div>
                {car.team && <div className="text-[#9CA3AF]">{car.team}</div>}
              </div>
            }
          >
            <div
              ref={(el) => {
                if (!el) { elRefs.current.delete(car.id); return }
                elRefs.current.set(car.id, el)
                const p = posRef.current.get(car.id) // keep the last spot across re-renders (commit, not render)
                el.style.left = p ? `${p.left}%` : '50%'
                el.style.top = p ? `${p.top}%` : '50%'
              }}
              className="absolute cursor-default"
              style={{ transform: 'translate(-50%, -50%)', opacity: car.retired ? 0.35 : 1 }}
            >
              <div
                className="flex items-center justify-center rounded-full font-bold text-[#FFFFFF] shadow shadow-black/40"
                style={{
                  width: markerSize,
                  height: markerSize,
                  fontSize: Math.round(markerSize * 0.45),
                  backgroundColor: car.color,
                  border: '1.5px solid rgba(0,0,0,0.5)',
                  boxShadow: ring,
                }}
              >
                <span style={{ WebkitTextStroke: '0.7px rgba(0,0,0,0.9)', paintOrder: 'stroke' }}>{car.pos}</span>
              </div>
              {showLabels && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 flex items-center gap-1 whitespace-nowrap pointer-events-none">
                  {car.nationality && <NationalityFlag code={car.nationality} />}
                  <span
                    className="text-xs font-semibold text-[#FFFFFF]"
                    style={{ WebkitTextStroke: '1px #000000', paintOrder: 'stroke' }}
                  >
                    {car.name}
                  </span>
                </div>
              )}
            </div>
          </Tooltip>
        )
      })}
      </div>
    </div>
  )
}
