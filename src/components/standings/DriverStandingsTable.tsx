'use client'

import { Star } from 'lucide-react'
import type { DriverStanding, Team } from '@/lib/sim/types'
import { ResultCell } from './ResultCell'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { useFollowed } from '@/lib/store/useFollowed'

interface Props {
  standings: DriverStanding[]
  teams: Team[]
  totalRounds: number
  completedRounds: number
}

export function DriverStandingsTable({ standings, teams, totalRounds, completedRounds }: Props) {
  const followed = useFollowed()
  const card = useLiveDriverCards()
  return (
    <div className="overflow-x-auto rounded-xl bg-[#1E2431]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[#FFFFFF] text-xs tracking-wider uppercase border-b border-[#2A3142]">
            <th className="text-left py-2 px-3 w-8 sticky left-0 bg-[#1E2431]">P</th>
            <th className="text-left py-2 px-3 sticky left-8 bg-[#1E2431] min-w-[140px]">Driver</th>
            <th className="text-left py-2 px-3 min-w-[80px]">Team</th>
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
            const isFollowed = followed.drivers.has(standing.driverId)
            return (
              <tr
                key={standing.driverId}
                className="border-b border-[#2A3142]/50 hover:bg-[#2A3142]/40 transition-colors"
              >
                <td className="py-1.5 px-3 font-bold text-[#FFFFFF] sticky left-0 bg-[#1E2431]">
                  {idx + 1}
                </td>
                <td className="py-1.5 px-3 sticky left-8 bg-[#1E2431]">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: teamColor }} />
                    <DriverHover id={standing.driverId} card={card}><DriverLink id={standing.driverId} className={`font-semibold whitespace-nowrap ${isFollowed ? 'text-[#00D9FF]' : 'text-[#FFFFFF]'}`}>{standing.driverName}</DriverLink></DriverHover>
                    {isFollowed && <Star size={11} className="fill-[#00D9FF] text-[#00D9FF] shrink-0" />}
                  </div>
                </td>
                <td className="py-1.5 px-3 text-[#FFFFFF] text-xs"><TeamLink id={standing.teamId}>{standing.teamName}</TeamLink></td>
                {Array.from({ length: totalRounds }, (_, i) => (
                  i < completedRounds
                    ? <ResultCell key={i} position={standing.results[i] ?? null} />
                    : <td key={i} className="px-0.5 py-0.5"><div className="w-8 h-7" /></td>
                ))}
                <td className="py-1.5 px-3 text-right font-bold text-[#FFFFFF]">{standing.points}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
