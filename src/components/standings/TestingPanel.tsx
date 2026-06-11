'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { PreSeasonTest, Team, FuelBand } from '@/lib/sim/types'
import TyreIndicator from '@/components/race/TyreIndicator'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { useTeamHighlight } from '@/lib/useTeamHighlight'
import { formatLapTime } from '@/lib/format'

interface Props {
  test: PreSeasonTest | null
  wccYear: number                 // the season whose WCC finish the comparison column shows (prior season)
  prevFinish: Map<string, number> // team -> that season's WCC finish (empty in a first season)
  teams: Team[]
}

const FUEL_STYLE: Record<FuelBand, string> = {
  full: 'text-[#DC143C]',
  heavy: 'text-[#F59E0B]',
  medium: 'text-[#FFFFFF]',
  light: 'text-[#10B981]',
}

type SortKey = 'time' | 'pace' | 'wcc'

export function TestingPanel({ test, wccYear, prevFinish, teams }: Props) {
  const card = useLiveDriverCards()
  const highlight = useTeamHighlight()
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode)
  const talentOn = useSettingsStore((s) => s.talents['data-room'] ?? false)
  // In Team Manager mode the true-pace reveal is a Data Room talent; without it, keep pace hidden.
  const gateAllowsReveal = !teamManagerMode || talentOn
  const [revealToggle, setRevealToggle] = useState(false)
  const reveal = revealToggle && gateAllowsReveal
  const [sortKey, setSortKey] = useState<SortKey>('time')

  if (!test || test.entries.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No testing data.</p>
  }

  const colorOf = (teamId: string) => teams.find((t) => t.id === teamId)?.color ?? '#6B7280'
  const fastest = Math.min(...test.entries.map((e) => e.lapTime))

  // True pace is only known under god mode, so that sort only applies while revealed.
  const activeSort: SortKey = sortKey === 'pace' && !reveal ? 'time' : sortKey
  const rows = [...test.entries].sort((a, b) => {
    if (activeSort === 'pace') return b.carPace - a.carPace
    if (activeSort === 'wcc') {
      return (prevFinish.get(a.teamId) ?? Infinity) - (prevFinish.get(b.teamId) ?? Infinity)
    }
    return a.lapTime - b.lapTime
  })
  const headClass = (key: SortKey) =>
    `cursor-pointer select-none transition-colors ${activeSort === key ? 'text-[#00D9FF]' : 'text-[#FFFFFF] hover:text-[#00D9FF]'}`

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-5">
        <p className="text-sm text-[#FFFFFF]">
          Pre-season test · <span className="text-[#FFFFFF]">{test.circuitName}</span>
        </p>
        {gateAllowsReveal && (
          <button
            onClick={() => setRevealToggle((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#303848] transition-colors"
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            {reveal ? 'Hide true pace' : 'God mode: reveal pace'}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
              <th className="text-left pb-2 pl-5 pr-3 font-medium w-12">#</th>
              <th className="text-left pb-2 pr-4 font-medium">Driver</th>
              <th className="text-left pb-2 px-3 font-medium">Team</th>
              <th className="text-center pb-2 px-3 font-medium">Tyre</th>
              <th className="text-left pb-2 px-3 font-medium">Fuel</th>
              <th className={`text-right pb-2 px-3 font-medium ${headClass('time')}`} onClick={() => setSortKey('time')}>Time</th>
              <th className="text-right pb-2 px-3 font-medium">Gap</th>
              {reveal && (
                <th className={`text-right pb-2 px-3 font-medium ${headClass('pace')}`} onClick={() => setSortKey('pace')}>
                  True Pace
                </th>
              )}
              <th className={`text-right pb-2 pl-3 pr-5 font-medium whitespace-nowrap ${headClass('wcc')}`} onClick={() => setSortKey('wcc')}>
                {wccYear} WCC
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={e.teamId} style={highlight(e.teamId, colorOf(e.teamId))} className="border-b border-[#2A3142]/50">
                <td className="py-2 pl-5 pr-3 tabular-nums text-[#FFFFFF]">{i + 1}</td>
                <td className="py-2 pr-4"><DriverHover id={e.driverId} card={card}><DriverLink id={e.driverId} className="text-[#FFFFFF] font-medium">{e.driverName}</DriverLink></DriverHover></td>
                <td className="py-2 px-3">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-2 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: colorOf(e.teamId) }} />
                    <TeamLink id={e.teamId} className="text-[#FFFFFF]">{e.teamName}</TeamLink>
                  </span>
                </td>
                <td className="py-2 px-3">
                  <span className="flex justify-center">
                    <TyreIndicator compound={e.tyre} size="sm" />
                  </span>
                </td>
                <td className={`py-2 px-3 font-semibold capitalize ${FUEL_STYLE[e.fuelBand]}`}>{e.fuelBand}</td>
                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF] font-semibold">{formatLapTime(e.lapTime)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">
                  {i === 0 ? '—' : `+${(e.lapTime - fastest).toFixed(3)}`}
                </td>
                {reveal && (
                  <td className="py-2 px-3 text-right tabular-nums text-[#00D9FF] font-semibold">{e.carPace.toFixed(1)}</td>
                )}
                <td className="py-2 pl-3 pr-5 text-right tabular-nums text-[#FFFFFF]">
                  {prevFinish.has(e.teamId) ? `P${prevFinish.get(e.teamId)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
