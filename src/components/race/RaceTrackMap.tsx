'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { TrackLayout } from '@/data/tracks'
import { Tooltip } from '@/components/ui/Tooltip'

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
  isPlayer?: boolean
  retired?: boolean
}

interface Props {
  layout: TrackLayout
  cars: TrackCarMeta[]
  /** Per-frame sampler: lap progress 0..1 for a car, or null to hide its marker. Read inside rAF. */
  sampleRef: React.MutableRefObject<(id: string) => number | null>
  /** Marker diameter in px (default 22). */
  markerSize?: number
}

export function RaceTrackMap({ layout, cars, sampleRef, markerSize = 22 }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const posRef = useRef(new Map<string, { left: number; top: number }>())

  const vb = useMemo(() => {
    const [x, y, w, h] = layout.viewBox.split(' ').map(Number)
    return { x, y, w, h }
  }, [layout.viewBox])

  useEffect(() => {
    lenRef.current = 0 // re-measure if the layout changes
    let raf = 0
    const tick = () => {
      const path = pathRef.current
      if (path) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        const lenTotal = lenRef.current
        for (const car of cars) {
          const el = elRefs.current.get(car.id)
          if (!el) continue
          const prog = sampleRef.current(car.id)
          if (prog === null) {
            el.style.visibility = 'hidden'
            continue
          }
          el.style.visibility = ''
          const frac = ((prog % 1) + 1) % 1
          const pt = path.getPointAtLength(frac * lenTotal)
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
    <div className="relative w-full h-full">
      <svg viewBox={layout.viewBox} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
        <path ref={pathRef} d={layout.d} fill="none" stroke="#3A4252" strokeWidth={16} strokeLinejoin="round" />
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
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}
