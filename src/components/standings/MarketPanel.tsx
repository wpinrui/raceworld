'use client'

import type { EndOfSeasonSummary, Team } from '@/lib/sim/types'

interface Props {
  summary: EndOfSeasonSummary
  teams: Team[]
}

export function MarketPanel({ summary, teams }: Props) {
  const teamColorMap = new Map(teams.map((t) => [t.id, t.color]))
  const teamNameMap = new Map(teams.map((t) => [t.id, t.name]))

  const moves = [...summary.marketMoves].sort((a, b) => b.mediaScore - a.mediaScore)

  if (moves.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No market activity this off-season.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
            <th className="text-left pb-2 pr-4 font-medium">Driver</th>
            <th className="text-left pb-2 px-3 font-medium">From</th>
            <th className="text-left pb-2 px-3 font-medium">To</th>
            <th className="text-right pb-2 px-3 font-medium">Contract</th>
            <th className="text-right pb-2 font-medium">Media</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => {
            const toColor = teamColorMap.get(m.toTeamId)
            const fromColor = m.fromTeamId ? teamColorMap.get(m.fromTeamId) : undefined
            const isRookie = m.mediaScore === 0
            return (
              <tr key={m.driverId} className="border-b border-[#2A3142]/50">
                <td className="py-2 pr-4">
                  <span className="text-[#FFFFFF] font-medium">{m.driverName}</span>
                  {isRookie && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] rounded px-1.5 py-0.5">
                      NEW
                    </span>
                  )}
                </td>
                <td className="py-2 px-3">
                  {m.fromTeamId ? (
                    <span className="flex items-center gap-1.5">
                      {fromColor && (
                        <span className="inline-block w-1.5 h-3.5 rounded-sm" style={{ backgroundColor: fromColor }} />
                      )}
                      <span className="text-[#FFFFFF]">{teamNameMap.get(m.fromTeamId!) ?? m.fromTeamId}</span>
                    </span>
                  ) : (
                    <span className="text-[#FFFFFF] italic">Free Agent</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <span className="flex items-center gap-1.5">
                    {toColor && (
                      <span className="inline-block w-1.5 h-3.5 rounded-sm" style={{ backgroundColor: toColor }} />
                    )}
                    <span className="text-[#FFFFFF]">{m.toTeamName}</span>
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">
                  {m.contractLength}yr
                  <span className="text-[#FFFFFF] ml-1 text-xs">(until {m.contractExpiresAfterSeason})</span>
                </td>
                <td className="py-2 text-right tabular-nums font-semibold text-[#00D9FF]">
                  {isRookie ? '—' : m.mediaScore.toFixed(1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
