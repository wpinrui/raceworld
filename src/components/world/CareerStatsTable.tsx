'use client'

import Link from 'next/link'
import { TeamLink } from '@/components/world/EntityLink'
import { ChampPill } from '@/components/world/pills'
import type { CareerSeason } from '@/lib/world/types'

// Per-season career basics: year, team, races, wins, podiums, poles, WDC, points.
export function CareerStatsTable({ seasons, driverId }: { seasons: CareerSeason[]; driverId: string }) {
  if (seasons.length === 0) {
    return <p className="px-5 py-4 text-sm text-[#FFFFFF]">No seasons yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
            <th className="text-left py-2 px-4 font-medium">Year</th>
            <th className="text-left py-2 px-3 font-medium">Team</th>
            <th className="text-right py-2 px-3 font-medium">Races</th>
            <th className="text-right py-2 px-3 font-medium">Wins</th>
            <th className="text-right py-2 px-3 font-medium">Podiums</th>
            <th className="text-right py-2 px-3 font-medium">Poles</th>
            <th className="text-center py-2 px-3 font-medium">WDC</th>
            <th className="text-right py-2 px-4 font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={`${s.year}-${s.teamId}`} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
              <td className="py-2 px-4 tabular-nums whitespace-nowrap">
                <Link href={`/world/driver/${driverId}/${s.year}`} className="text-[#FFFFFF] hover:text-[#00D9FF] font-medium">{s.year}</Link>
                {s.inProgress && <span className="ml-1.5 text-[10px] text-[#00D9FF]">LIVE</span>}
              </td>
              <td className="py-2 px-3 whitespace-nowrap"><TeamLink id={s.teamId} className="text-[#FFFFFF]">{s.teamName}</TeamLink></td>
              <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.races}</td>
              <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.wins}</td>
              <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.podiums}</td>
              <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.poles}</td>
              <td className="py-2 px-3"><span className="flex justify-center"><ChampPill position={s.championshipFinish} /></span></td>
              <td className="py-2 px-4 text-right tabular-nums font-semibold text-[#FFFFFF]">{s.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
