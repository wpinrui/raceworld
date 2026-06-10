'use client'

import { useLayoutEffect, useRef } from 'react'
import type { Driver, Team, DriverRaceState } from '@/lib/sim/types'
import type { DriverCareer } from '@/lib/news/engine'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { DriverTooltip } from '@/components/world/DriverTooltip'
import { useTeamHighlight } from '@/lib/useTeamHighlight'
import TyreIndicator from './TyreIndicator'

interface RaceTableProps {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  currentLap: number
  totalLaps: number
  gridPos?: Record<string, number>   // starting grid position per driver
  year?: number                      // for the driver hover card (championship line + career fold)
  careers?: Record<string, DriverCareer>
  wdcPosOf?: Map<string, number>
  wdcPtsOf?: Map<string, number>
  selectedDriverId?: string | null
  onSelectDriver?: (id: string) => void
  animate?: boolean
}

// The leader's running race time, e.g. "1h 23min 04.567s" (hours dropped before the one-hour mark).
function formatTotalTime(t: number): string {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = (t % 60).toFixed(3).padStart(6, '0')
  return h > 0 ? `${h}h ${m}min ${s}s` : `${m}min ${s}s`
}

function formatLapTime(lapTimes: number[]): string {
  if (lapTimes.length === 0) return '--'
  const last = lapTimes[lapTimes.length - 1]
  const mins = Math.floor(last / 60)
  const secs = (last % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

export default function RaceTable({ drivers, teams, states, gridPos, year, careers, wdcPosOf, wdcPtsOf, selectedDriverId, onSelectDriver, animate = true }: RaceTableProps) {
  const highlight = useTeamHighlight()
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))

  const sorted = [...states].sort((a, b) => {
    if (a.retired && !b.retired) return 1
    if (!a.retired && b.retired) return -1
    return a.position - b.position
  })
  const leaderTime = sorted.find((s) => !s.retired)?.totalTime ?? 0

  const tableRef = useRef<HTMLTableElement>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const prevTops = useRef(new Map<string, number>())
  const prevOrder = useRef('')
  const rafRef = useRef(0)

  // FLIP: slide each moved row from its old slot to its new one when the order changes (an overtake).
  // Robust to interruption: (1) re-renders that DON'T change the running order (clock ticks, selection)
  // are skipped, so in-flight slides finish untouched; (2) on a real change we CLEAR every row's leftover
  // transform BEFORE measuring, so getBoundingClientRect reports each row's true new slot, never a mid-slide
  // position. Measuring through a live transform is what made offsets compound and rows shoot off-screen
  // ("vanish") when many cars swapped at once.
  useLayoutEffect(() => {
    const rows = rowRefs.current
    const order = sorted.map((s) => s.driverId).join(',')
    if (!animate) {
      rows.forEach((el) => { el.style.transition = ''; el.style.transform = '' })
      prevTops.current = new Map()
      prevOrder.current = order
      return
    }
    if (order === prevOrder.current) return // same running order — leave any running slide alone

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tableTop = tableRef.current?.getBoundingClientRect().top ?? 0
    // Clear leftover/in-flight transforms first so the reads below are true layout positions.
    rows.forEach((el) => { el.style.transition = 'none'; el.style.transform = '' })
    const newTops = new Map<string, number>()
    rows.forEach((el, id) => newTops.set(id, el.getBoundingClientRect().top - tableTop))

    let moved = false
    rows.forEach((el, id) => {
      const oldTop = prevTops.current.get(id)
      const newTop = newTops.get(id)!
      if (oldTop !== undefined && Math.abs(oldTop - newTop) > 0.5) {
        el.style.transform = `translateY(${oldTop - newTop}px)` // invert: snap back to the old slot
        moved = true
      }
    })
    if (moved) rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      rows.forEach((el) => {
        if (el.style.transform) {
          el.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1)'
          el.style.transform = '' // play: slide to the new slot
        }
      })
    })
    prevTops.current = newTops
    prevOrder.current = order
  })

  return (
    <div className="overflow-x-auto">
      <table ref={tableRef} className="w-full border-collapse">
        <thead>
          <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
            <th className="text-left py-1.5 px-2 w-8">P</th>
            <th className="text-left py-1.5 px-2 w-16">Grid</th>
            <th className="text-left py-1.5 px-2">Driver</th>
            <th className="text-left py-1.5 px-2">Team</th>
            <th className="text-right py-1.5 px-2">Gap</th>
            <th className="text-right py-1.5 px-2">Interval</th>
            <th className="text-center py-1.5 px-2">Tyre</th>
            <th className="text-center py-1.5 px-2">Stops</th>
            <th className="text-right py-1.5 px-2">Last Lap</th>
            <th className="text-left py-1.5 px-2">Stints</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ds) => {
            const driver = driverMap.get(ds.driverId)
            const team = driver ? teamMap.get(driver.teamId) : undefined
            const condColor = ds.currentTyre.condition < 20 ? 'text-red-400' : 'text-[#FFFFFF]'
            const gp = gridPos?.[ds.driverId]
            const delta = gp != null ? gp - ds.position : null // places improved (grid -> now); + is up

            const nameSpan = (
              <span className="text-sm font-medium truncate max-w-[130px]">
                {driver?.name ?? ds.driverId}
              </span>
            )

            return (
              <tr
                key={ds.driverId}
                ref={(el) => { if (el) rowRefs.current.set(ds.driverId, el); else rowRefs.current.delete(ds.driverId) }}
                onClick={() => onSelectDriver?.(ds.driverId)}
                style={highlight(driver?.teamId, team?.color)}
                className={`border-b border-[#1a2030] text-[#FFFFFF] cursor-pointer ${
                  ds.driverId === selectedDriverId
                    ? 'bg-[#1a2d3a] border-l-2 border-l-[#00D9FF]'
                    : 'hover:bg-[#1E2431]'
                }`}
              >
                <td className="py-1 px-2 font-bold text-sm">{ds.position}</td>
                <td className="py-1 px-2 tabular-nums text-sm whitespace-nowrap">
                  <span className="text-[#9CA3AF]">{gp ?? '—'}</span>
                  {!ds.retired && delta != null && delta !== 0 && (
                    <span className={`ml-1 text-xs font-semibold ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ({delta > 0 ? '+' : ''}{delta})
                    </span>
                  )}
                </td>
                <td className="py-1 px-2">
                  <div className="flex items-center gap-2">
                    {team && <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                    <NationalityFlag code={driver?.nationality} />
                    {driver && year != null ? (
                      <DriverTooltip
                        driver={driver}
                        year={year}
                        wdcPosition={wdcPosOf?.get(driver.id) ?? null}
                        wdcPoints={wdcPtsOf?.get(driver.id)}
                        career={careers?.[driver.id]}
                        teamName={team?.name}
                        teamColor={team?.color}
                        side="right"
                      >
                        {nameSpan}
                      </DriverTooltip>
                    ) : (
                      nameSpan
                    )}
                  </div>
                </td>
                <td className="py-1 px-2 text-xs text-[#FFFFFF]">
                  {team?.name ?? '---'}
                </td>
                <td className={`py-1 px-2 text-right font-mono text-sm whitespace-nowrap ${ds.retired ? 'text-red-400 font-bold' : ''}`}>
                  {ds.retired
                    ? 'DNF'
                    : ds.position === 1
                      ? formatTotalTime(ds.totalTime)
                      : ds.lapsDown >= 1
                        ? `+${ds.lapsDown} LAP${ds.lapsDown > 1 ? 'S' : ''}`
                        : `+${(ds.totalTime - leaderTime).toFixed(3)}s`}
                </td>
                <td className={`py-1 px-2 text-right font-mono text-sm ${ds.retired ? 'text-red-400 font-bold' : ''}`}>
                  {ds.retired ? 'DNF' : ds.position === 1 ? <span className="text-[#6B7280]">—</span> : `+${ds.gap.toFixed(3)}s`}
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
                <td className="py-1 px-2 text-center text-sm tabular-nums">{ds.pitStops}</td>
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
