'use client'

import { useLayoutEffect, useRef } from 'react'
import type { Driver, Team, DriverRaceState } from '@/lib/sim/types'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import TyreIndicator from './TyreIndicator'

interface RaceTableProps {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  currentLap: number
  totalLaps: number
  selectedDriverId?: string | null
  onSelectDriver?: (id: string) => void
  animate?: boolean
}

function formatGap(gap: number, retired: boolean): string {
  if (retired) return 'DNF'
  if (gap === 0) return 'LEADER'
  return `+${gap.toFixed(3)}s`
}

function formatLapTime(lapTimes: number[]): string {
  if (lapTimes.length === 0) return '--'
  const last = lapTimes[lapTimes.length - 1]
  const mins = Math.floor(last / 60)
  const secs = (last % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

export default function RaceTable({ drivers, teams, states, selectedDriverId, onSelectDriver, animate = true }: RaceTableProps) {
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))

  const sorted = [...states].sort((a, b) => {
    if (a.retired && !b.retired) return 1
    if (!a.retired && b.retired) return -1
    return a.position - b.position
  })

  const tableRef = useRef<HTMLTableElement>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const prevTops = useRef(new Map<string, number>())

  // FLIP: when the order changes (an overtake), slide each moved row from its old slot to its new one.
  // Positions are measured relative to the table, so container scrolling doesn't trigger spurious slides.
  useLayoutEffect(() => {
    const rows = rowRefs.current
    if (!animate) {
      rows.forEach((el) => { el.style.transform = ''; el.style.transition = '' })
      prevTops.current = new Map()
      return
    }
    const tableTop = tableRef.current?.getBoundingClientRect().top ?? 0
    const newTops = new Map<string, number>()
    rows.forEach((el, id) => newTops.set(id, el.getBoundingClientRect().top - tableTop))
    let moved = false
    rows.forEach((el, id) => {
      const oldTop = prevTops.current.get(id)
      const newTop = newTops.get(id)!
      if (oldTop !== undefined && Math.abs(oldTop - newTop) > 0.5) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${oldTop - newTop}px)` // invert: snap back to the old slot
        moved = true
      }
    })
    if (moved) requestAnimationFrame(() => {
      rows.forEach((el) => { el.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1)'; el.style.transform = '' })
    })
    prevTops.current = newTops
  })

  return (
    <div className="overflow-x-auto">
      <table ref={tableRef} className="w-full border-collapse">
        <thead>
          <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
            <th className="text-left py-1.5 px-2 w-8">P</th>
            <th className="text-left py-1.5 px-2">Driver</th>
            <th className="text-left py-1.5 px-2">Team</th>
            <th className="text-right py-1.5 px-2">Gap</th>
            <th className="text-center py-1.5 px-2">Tyre</th>
            <th className="text-right py-1.5 px-2">Last Lap</th>
            <th className="text-left py-1.5 px-2">Stints</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ds) => {
            const driver = driverMap.get(ds.driverId)
            const team = driver ? teamMap.get(driver.teamId) : undefined
            const condColor = ds.currentTyre.condition < 20 ? 'text-red-400' : 'text-[#FFFFFF]'

            return (
              <tr
                key={ds.driverId}
                ref={(el) => { if (el) rowRefs.current.set(ds.driverId, el); else rowRefs.current.delete(ds.driverId) }}
                onClick={() => onSelectDriver?.(ds.driverId)}
                className={`border-b border-[#1a2030] text-[#FFFFFF] cursor-pointer ${
                  ds.driverId === selectedDriverId
                    ? 'bg-[#1a2d3a] border-l-2 border-l-[#00D9FF]'
                    : 'hover:bg-[#1E2431]'
                }`}
              >
                <td className="py-1 px-2 font-bold text-sm">{ds.position}</td>
                <td className="py-1 px-2">
                  <div className="flex items-center gap-2">
                    {team && <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                    <NationalityFlag code={driver?.nationality} />
                    <span className="text-sm font-medium truncate max-w-[130px]">
                      {driver?.name ?? ds.driverId}
                    </span>
                  </div>
                </td>
                <td className="py-1 px-2 text-xs text-[#FFFFFF]">
                  {team?.name ?? '---'}
                </td>
                <td className={`py-1 px-2 text-right font-mono text-sm ${ds.retired ? 'text-red-400 font-bold' : ''}`}>
                  {formatGap(ds.gap, ds.retired)}
                </td>
                <td className="py-1 px-2">
                  <div className="flex items-center gap-1.5 justify-center">
                    <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
                    {!ds.retired && (
                      <span className={`text-xs ${condColor}`}>
                        {ds.currentTyre.condition}%
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1 px-2 text-right font-mono text-sm">
                  {formatLapTime(ds.lapTimes)}
                </td>
                <td className="py-1 px-2">
                  <div className="flex items-center gap-1.5">
                    {ds.stintHistory.map((s, i) => (
                      <div key={i} className="flex items-center gap-0.5">
                        <TyreIndicator compound={s.compound} size="sm" />
                        <span className="text-xs text-[#FFFFFF]">{s.laps}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-0.5">
                      <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
                      <span className="text-xs text-[#FFFFFF]">{ds.stintLap}</span>
                    </div>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
