'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, Minus } from 'lucide-react'
import type { Driver, Team, DriverRaceState, DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import { getPoints } from '@/lib/sim/points'
import { useTeamHighlight } from '@/lib/useTeamHighlight'

interface Props {
  states: DriverRaceState[]
  drivers: Driver[]
  teams: Team[]
  baselineDrivers: DriverStanding[]
  baselineConstructors: ConstructorStanding[]
  year: number // selects the era points table for the live projection (issue #63)
}

interface LiveRow {
  id: string
  label: string
  color: string
  livePoints: number
  delta: number // baseline rank − live rank; positive = gained places
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 0) return <span className="flex items-center text-[#10B981]"><ChevronUp size={13} />{delta}</span>
  if (delta < 0) return <span className="flex items-center text-[#DC143C]"><ChevronDown size={13} />{-delta}</span>
  return <span className="text-[#FFFFFF]"><Minus size={12} /></span>
}

export function LiveChampionship({ states, drivers, teams, baselineDrivers, baselineConstructors, year }: Props) {
  const [tab, setTab] = useState<'drivers' | 'constructors'>('drivers')

  const posById = new Map<string, number | null>()
  for (const s of states) posById.set(s.driverId, s.retired ? null : s.position)

  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const driverTeam = new Map(drivers.map((d) => [d.id, d.teamId]))
  const highlight = useTeamHighlight()

  // ── Live drivers' championship ──
  const driverBaselineRank = new Map(baselineDrivers.map((d, i) => [d.driverId, i]))
  const driverRows: LiveRow[] = baselineDrivers
    .map((d) => ({
      id: d.driverId,
      label: d.driverName,
      color: teamMap.get(d.teamId)?.color ?? '#FFFFFF',
      livePoints: d.points + getPoints(posById.get(d.driverId) ?? null, year),
      baselineRank: driverBaselineRank.get(d.driverId) ?? 0,
    }))
    .sort((a, b) => b.livePoints - a.livePoints || a.baselineRank - b.baselineRank)
    .map((r, i) => ({ id: r.id, label: r.label, color: r.color, livePoints: r.livePoints, delta: r.baselineRank - i }))

  // ── Live constructors' championship ──
  const teamLivePoints = new Map<string, number>()
  for (const c of baselineConstructors) teamLivePoints.set(c.teamId, c.points)
  for (const d of drivers) {
    if (d.teamId === '') continue
    const add = getPoints(posById.get(d.id) ?? null, year)
    if (add) teamLivePoints.set(d.teamId, (teamLivePoints.get(d.teamId) ?? 0) + add)
  }
  const ctorBaselineRank = new Map(baselineConstructors.map((c, i) => [c.teamId, i]))
  const ctorRows: LiveRow[] = baselineConstructors
    .map((c) => ({
      id: c.teamId,
      label: c.teamName,
      color: teamMap.get(c.teamId)?.color ?? '#FFFFFF',
      livePoints: teamLivePoints.get(c.teamId) ?? c.points,
      baselineRank: ctorBaselineRank.get(c.teamId) ?? 0,
    }))
    .sort((a, b) => b.livePoints - a.livePoints || a.baselineRank - b.baselineRank)
    .map((r, i) => ({ id: r.id, label: r.label, color: r.color, livePoints: r.livePoints, delta: r.baselineRank - i }))

  const rows = tab === 'drivers' ? driverRows : ctorRows

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-6 bg-[#00D9FF] rounded-sm" />
          <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">Championship</h2>
        </div>
        <div className="flex rounded overflow-hidden border border-[#2A3142]">
          {(['drivers', 'constructors'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                tab === t ? 'bg-[#00D9FF] text-[#0F1419]' : 'text-[#FFFFFF] hover:bg-[#2A3142]'
              }`}
            >
              {t === 'drivers' ? 'Drv' : 'Ctr'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-[#1a2030]"
                style={highlight(tab === 'constructors' ? r.id : driverTeam.get(r.id), r.color, tab === 'constructors' ? undefined : r.id)}>
                <td className="py-1 pr-1 font-bold text-[#FFFFFF] w-5 text-right">{i + 1}</td>
                <td className="py-1 px-1 w-8"><DeltaArrow delta={r.delta} /></td>
                <td className="py-1 px-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-[#FFFFFF] text-xs truncate">{r.label}</span>
                  </div>
                </td>
                <td className="py-1 pl-1 text-right font-bold text-[#FFFFFF] tabular-nums">{r.livePoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
