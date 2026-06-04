'use client'

import { Star } from 'lucide-react'
import type { ConstructorStanding, Driver, Team } from '@/lib/sim/types'
import { ResultCell } from './ResultCell'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { useFollowed } from '@/lib/store/useFollowed'

interface Props {
  standings: ConstructorStanding[]
  drivers: Driver[]
  teams: Team[]
  totalRounds: number
  completedRounds: number
}

export function ConstructorStandingsTable({ standings, drivers, teams, totalRounds, completedRounds }: Props) {
  const followed = useFollowed()
  return (
    <div className="overflow-x-auto rounded-xl bg-[#1E2431]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[#FFFFFF] text-xs tracking-wider uppercase border-b border-[#2A3142]">
            <th className="text-left py-2 px-3 w-8 sticky left-0 bg-[#1E2431]">P</th>
            <th className="text-left py-2 px-3 sticky left-8 bg-[#1E2431] min-w-[140px]">Constructor</th>
            <th className="text-left py-2 px-3 min-w-[130px]">Driver</th>
            {Array.from({ length: totalRounds }, (_, i) => (
              <th key={i} className="text-center py-2 px-0.5 w-9 text-[10px]">
                {String(i + 1).padStart(2, '0')}
              </th>
            ))}
            <th className="text-right py-2 px-3 w-16">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((standing, idx) => {
            const team = teams.find((t) => t.id === standing.teamId)
            const teamColor = team?.color ?? '#FFFFFF'
            const teamDrivers = drivers.filter((d) => d.teamId === standing.teamId)

            return teamDrivers.map((driver, driverIdx) => {
              const driverResults: (number | null)[] = standing.results[driverIdx] ?? Array(completedRounds).fill(null)
              const isFirst = driverIdx === 0
              const isLast = driverIdx === teamDrivers.length - 1

              return (
                <tr
                  key={`${standing.teamId}-${driver.id}`}
                  className={`${isLast ? 'border-b border-[#2A3142]' : 'border-b border-[#2A3142]/20'} hover:bg-[#2A3142]/40 transition-colors`}
                >
                  {isFirst && (
                    <td
                      rowSpan={teamDrivers.length}
                      className="py-2 px-3 font-bold text-[#FFFFFF] sticky left-0 bg-[#1E2431] align-middle"
                    >
                      {idx + 1}
                    </td>
                  )}
                  {isFirst && (
                    <td
                      rowSpan={teamDrivers.length}
                      className="py-2 px-3 sticky left-8 bg-[#1E2431] align-middle"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: teamColor }} />
                        <TeamLink id={standing.teamId} className={`font-semibold whitespace-nowrap ${followed.teams.has(standing.teamId) ? 'text-[#00D9FF]' : 'text-[#FFFFFF]'}`}>{standing.teamName}</TeamLink>
                        {followed.teams.has(standing.teamId) && <Star size={11} className="fill-[#00D9FF] text-[#00D9FF] shrink-0" />}
                      </div>
                    </td>
                  )}
                  <td className="py-1.5 px-3 text-xs whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <DriverLink id={driver.id} className={followed.drivers.has(driver.id) ? 'text-[#00D9FF]' : 'text-[#FFFFFF]'}>{driver.name}</DriverLink>
                      {followed.drivers.has(driver.id) && <Star size={10} className="fill-[#00D9FF] text-[#00D9FF] shrink-0" />}
                    </span>
                  </td>
                  {Array.from({ length: totalRounds }, (_, i) => (
                    i < completedRounds
                      ? <ResultCell key={i} position={driverResults[i] ?? null} />
                      : <td key={i} className="px-0.5 py-0.5"><div className="w-8 h-7" /></td>
                  ))}
                  {isFirst && (
                    <td
                      rowSpan={teamDrivers.length}
                      className="py-2 px-3 text-right font-bold text-[#FFFFFF] align-middle"
                    >
                      {standing.points}
                    </td>
                  )}
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}
