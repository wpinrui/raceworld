'use client'

import { useEffect, useRef, useState } from 'react'
import type { Driver, Team } from '@/lib/sim/types'
import type { CarSchedule, BoardRow } from './useQualifyingEngine'
import { Tooltip } from '@/components/ui/Tooltip'
import { useSeasonStore } from '@/lib/store/season-store'

const VB_W = 320, VB_H = 220
// Rounded-rectangle "Indianapolis" oval, drawn CLOCKWISE from top-centre (= the start/finish line).
const RX = 26, RY = 30, RW = 268, RH = 160, CR = 56
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

// Where a car is at time t: which lap of its run, whether it's a timed (flying) lap, and progress 0..1.
function carAt(sc: CarSchedule, t: number): { timed: boolean; prog: number } | null {
  if (t < sc.launch || t >= sc.end) return null
  let acc = sc.launch
  for (const seg of sc.segs) {
    if (t < acc + seg.dur) return { timed: seg.timed, prog: (t - acc) / seg.dur }
    acc += seg.dur
  }
  return null
}

export function TrackMap({ clockRef, schedule, rows, drivers, teams }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const posRef = useRef(new Map<string, { left: number; top: number }>())
  const stateRef = useRef('')
  const [markers, setMarkers] = useState<{ carId: string; timed: boolean }[]>([])

  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const posOf = new Map(rows.map((r, i) => [r.carId, i + 1]))
  const playerTeamId = useSeasonStore((s) => (s.teamManagerMode ? s.playerTeamId : null))

  // Private rAF: read the shared clock, move markers via direct DOM writes (no per-frame React render).
  // The rendered marker list only changes when a car joins/leaves the track or flips flying<->cruising.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const path = pathRef.current
      if (path) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        const len = lenRef.current
        const t = clockRef.current
        const current: { carId: string; timed: boolean }[] = []
        for (const sc of schedule) {
          const at = carAt(sc, t)
          if (!at) continue
          current.push({ carId: sc.carId, timed: at.timed })
          const pt = path.getPointAtLength(Math.min(0.9999, Math.max(0, at.prog)) * len)
          const left = (pt.x / VB_W) * 100, top = (pt.y / VB_H) * 100
          posRef.current.set(sc.carId, { left, top })
          const el = elRefs.current.get(sc.carId)
          if (el) { el.style.left = `${left}%`; el.style.top = `${top}%` }
        }
        const key = current.map((c) => `${c.carId}:${c.timed ? 1 : 0}`).join(',')
        if (key !== stateRef.current) { stateRef.current = key; setMarkers(current) }
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
      <div className="relative w-full max-w-[620px] mx-auto" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 w-full h-full">
          <path ref={pathRef} d={OVAL_PATH} fill="none" stroke="#3A4252" strokeWidth={12} strokeLinejoin="round" />
          <path d={OVAL_PATH} fill="none" stroke="#1E2431" strokeWidth={5} strokeLinejoin="round" strokeDasharray="2 6" />
          <line x1={CX} y1={RY - 10} x2={CX} y2={RY + 10} stroke="#FFFFFF" strokeWidth={2.5} />
        </svg>
        {markers.map(({ carId, timed }) => {
          const d = driverMap.get(carId)
          const team = d ? teamMap.get(d.teamId) : undefined
          const pos = posOf.get(carId) ?? 0
          const isMine = !!playerTeamId && d?.teamId === playerTeamId
          // Your-team cars get a bright white ring so they stand out on the map.
          const myRing = isMine ? '0 0 0 2.5px #FFFFFF, 0 0 7px rgba(255,255,255,0.7)' : undefined
          const inner = timed ? (
            <div
              className="flex items-center justify-center rounded-full text-[11px] font-bold text-[#FFFFFF]"
              style={{ width: 26, height: 26, backgroundColor: team?.color ?? '#888', border: '1.5px solid rgba(0,0,0,0.5)', boxShadow: myRing }}
            >
              <span style={{ WebkitTextStroke: '0.7px rgba(0,0,0,0.9)', paintOrder: 'stroke' }}>{pos > 0 ? pos : ''}</span>
            </div>
          ) : (
            // cruising (in-lap / out-lap): a small grey ring, no number
            <div className="rounded-full" style={{ width: 14, height: 14, border: isMine ? '2px solid #FFFFFF' : '2px solid #6B7280', backgroundColor: 'rgba(15,20,25,0.6)', boxShadow: myRing }} />
          )
          return (
            <Tooltip key={carId} content={<div><div className="font-semibold">{d?.name ?? carId}</div><div className="text-[#9CA3AF]">{team?.name ?? ''}</div></div>}>
              <div
                ref={(el) => {
                  if (!el) { elRefs.current.delete(carId); return }
                  elRefs.current.set(carId, el)
                  const p = posRef.current.get(carId)        // set initial spot in the ref callback (commit, not render)
                  el.style.left = p ? `${p.left}%` : '50%'
                  el.style.top = p ? `${p.top}%` : `${(RY / VB_H) * 100}%`
                }}
                className="absolute cursor-default shadow shadow-black/40"
                style={{ transform: 'translate(-50%, -50%)' }}
              >
                {inner}
              </div>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
