'use client'

import { useEffect, useRef, useState } from 'react'
import type { Driver, Team } from '@/lib/sim/types'
import type { CarSchedule, BoardRow } from './useQualifyingEngine'
import { Tooltip } from '@/components/ui/Tooltip'

const VB_W = 320, VB_H = 220
// Rounded-rectangle "Indianapolis" oval, drawn CLOCKWISE from top-centre (= the start/finish line).
const RX = 30, RY = 35, RW = 260, RH = 150, CR = 52
const CX = RX + RW / 2
const OVAL_PATH = [
  `M ${CX} ${RY}`,
  `H ${RX + RW - CR}`, `A ${CR} ${CR} 0 0 1 ${RX + RW} ${RY + CR}`,
  `V ${RY + RH - CR}`, `A ${CR} ${CR} 0 0 1 ${RX + RW - CR} ${RY + RH}`,
  `H ${RX + CR}`, `A ${CR} ${CR} 0 0 1 ${RX} ${RY + RH - CR}`,
  `V ${RY + CR}`, `A ${CR} ${CR} 0 0 1 ${RX + CR} ${RY}`,
  `H ${CX}`, 'Z',
].join(' ')

interface Props {
  clockRef: React.MutableRefObject<number>
  schedule: CarSchedule[]
  rows: BoardRow[]
  drivers: Driver[]
  teams: Team[]
}

export function TrackMap({ clockRef, schedule, rows, drivers, teams }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const onTrackRef = useRef<string[]>([])
  const [onTrack, setOnTrack] = useState<string[]>([])

  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const posOf = new Map(rows.map((r, i) => [r.carId, i + 1]))

  // Smooth motion: a private rAF reads the shared clock and mutates marker positions directly (no React
  // re-render per frame). The rendered marker SET only changes when a car joins/leaves the track.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const path = pathRef.current
      if (path) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        const len = lenRef.current
        const t = clockRef.current
        const current: string[] = []
        for (const sc of schedule) {
          if (t < sc.launch || t >= sc.end) continue
          current.push(sc.carId)
          const inLap1 = t < sc.launch + sc.lap1Dur
          const prog = inLap1 ? (t - sc.launch) / sc.lap1Dur : (t - (sc.launch + sc.lap1Dur)) / sc.lap2Dur
          const pt = path.getPointAtLength((Math.min(0.9999, Math.max(0, prog))) * len)
          const el = elRefs.current.get(sc.carId)
          if (el) { el.style.left = `${(pt.x / VB_W) * 100}%`; el.style.top = `${(pt.y / VB_H) * 100}%` }
        }
        const prev = onTrackRef.current
        if (current.length !== prev.length || current.some((id, i) => id !== prev[i])) {
          onTrackRef.current = current
          setOnTrack(current)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule])

  return (
    <div className="flex flex-col h-full min-h-0 p-4">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="w-1 h-5 bg-[#DC143C] rounded-sm" />
        <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">Track</h2>
      </div>
      <div className="relative w-full max-w-[460px] mx-auto" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 w-full h-full">
          <path ref={pathRef} d={OVAL_PATH} fill="none" stroke="#3A4252" strokeWidth={11} strokeLinejoin="round" />
          <path d={OVAL_PATH} fill="none" stroke="#1E2431" strokeWidth={5} strokeLinejoin="round" strokeDasharray="2 6" />
          <line x1={CX} y1={RY - 9} x2={CX} y2={RY + 9} stroke="#FFFFFF" strokeWidth={2.5} />
        </svg>
        {onTrack.map((carId) => {
          const d = driverMap.get(carId)
          const team = d ? teamMap.get(d.teamId) : undefined
          const pos = posOf.get(carId) ?? 0
          return (
            <Tooltip key={carId} content={<div><div className="font-semibold">{d?.name ?? carId}</div><div className="text-[#9CA3AF]">{team?.name ?? ''}</div></div>}>
              <div
                ref={(el) => { if (el) elRefs.current.set(carId, el); else elRefs.current.delete(carId) }}
                className="absolute flex items-center justify-center rounded-full text-[9px] font-bold text-[#FFFFFF] cursor-default shadow shadow-black/40"
                style={{ left: '50%', top: `${(RY / VB_H) * 100}%`, width: 18, height: 18, transform: 'translate(-50%, -50%)', backgroundColor: team?.color ?? '#888', border: '1px solid rgba(0,0,0,0.45)' }}
              >
                {pos > 0 ? pos : ''}
              </div>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
