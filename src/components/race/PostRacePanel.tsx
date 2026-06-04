'use client'

import type { RaceResult, Team } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'
import { DriverLink } from '@/components/world/EntityLink'

interface Props {
  results: RaceResult[]
  teams: Team[]
  currentRound: number
}

export function PostRacePanel({ results, teams, currentRound }: Props) {
  const isLastRound = currentRound >= calendar2026.length
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-6 bg-[#00D9FF] rounded-sm" />
          <h2 className="font-semibold text-sm tracking-widest uppercase text-[#FFFFFF]">Race Results</h2>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-[#FFFFFF] text-xs tracking-wider uppercase border-b border-[#2A3142]">
              <th className="text-left py-1 px-1 w-8">Pos</th>
              <th className="text-left py-1 px-1">Driver</th>
              <th className="text-right py-1 px-1 w-8">Pts</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const team = teams.find((t) => t.id === r.teamId)
              return (
                <tr key={r.driverId} className="border-b border-[#1a2030]">
                  <td className="py-1 px-1 font-bold text-[#FFFFFF]">
                    {r.dnf ? <span className="text-[#C084FC] text-xs">DNF</span> : r.finishPosition}
                  </td>
                  <td className="py-1 px-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-0.5 h-4 rounded-full" style={{ backgroundColor: team?.color ?? '#FFFFFF' }} />
                      <DriverLink id={r.driverId} className="text-[#FFFFFF] truncate">{r.driverName}</DriverLink>
                    </div>
                  </td>
                  <td className="py-1 px-1 text-right font-bold">
                    {r.points > 0
                      ? <span className="text-[#00D9FF]">{r.points}</span>
                      : <span className="text-[#FFFFFF]">0</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 p-4 border-t border-[#2A3142]">
        <p className="text-xs text-[#FFFFFF]">
          Round {currentRound}/{calendar2026.length} complete — hit <span className="font-semibold text-[#00D9FF]">{isLastRound ? 'End Race' : 'End Race'}</span> (top right) to bank the result and continue.
        </p>
      </div>
    </div>
  )
}
