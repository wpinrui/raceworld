'use client'

import type { Driver, Team, DriverRaceState, RacePhase } from '@/lib/sim/types'
import TyreIndicator from './TyreIndicator'

interface RaceTableProps {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  currentLap: number
  totalLaps: number
  phase: RacePhase
  selectedDriverId?: string | null
  onSelectDriver?: (id: string) => void
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

export default function RaceTable({ drivers, teams, states, phase, selectedDriverId, onSelectDriver }: RaceTableProps) {
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))

  const sorted = [...states].sort((a, b) => {
    if (a.retired && !b.retired) return 1
    if (!a.retired && b.retired) return -1
    return a.position - b.position
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[#6B7280] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
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
            const rowColor = ds.retired ? 'text-[#6B7280]' : 'text-[#E8EAED]'
            const condColor = ds.currentTyre.condition < 20 ? 'text-red-400' : 'text-[#6B7280]'

            return (
              <tr
                key={ds.driverId}
                onClick={() => onSelectDriver?.(ds.driverId)}
                className={`border-b border-[#1a2030] ${rowColor} transition-colors cursor-pointer ${
                  ds.driverId === selectedDriverId
                    ? 'bg-[#1a2d3a] border-l-2 border-l-[#00D9FF]'
                    : 'hover:bg-[#1E2431]'
                }`}
              >
                <td className="py-1 px-2 font-mono font-bold text-sm">{ds.position}</td>
                <td className="py-1 px-2">
                  <div className="flex items-center gap-2">
                    {team && (
                      <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                    )}
                    <span className="text-sm font-medium truncate max-w-[130px]">
                      {driver?.name ?? ds.driverId}
                    </span>
                  </div>
                </td>
                <td className="py-1 px-2 font-mono text-xs text-[#A0A9B8]">
                  {team?.shortName ?? '---'}
                </td>
                <td className={`py-1 px-2 text-right font-mono text-sm ${ds.retired ? 'text-red-400 font-bold' : ''}`}>
                  {formatGap(ds.gap, ds.retired)}
                </td>
                <td className="py-1 px-2">
                  <div className="flex items-center gap-1.5 justify-center">
                    <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
                    {!ds.retired && (
                      <span className={`font-mono text-xs ${condColor}`}>
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
                        <span className="font-mono text-xs text-[#6B7280]">{s.laps}</span>
                      </div>
                    ))}
                    {/* Current stint */}
                    <div className="flex items-center gap-0.5">
                      <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
                      <span className="font-mono text-xs text-[#E8EAED]">{ds.stintLap}</span>
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
