'use client'

import type { EndOfSeasonSummary, Team, MarketMove } from '@/lib/sim/types'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

interface Props {
  summary: EndOfSeasonSummary
  teams: Team[]
}

export function MarketPanel({ summary, teams }: Props) {
  const teamColorMap = new Map(teams.map((t) => [t.id, t.color]))
  const teamNameMap = new Map(teams.map((t) => [t.id, t.name]))

  const sorted = [...summary.marketMoves].sort((a, b) => b.mediaScore - a.mediaScore)
  const realMoves = sorted.filter((m) => !m.isResignation)
  const reSignings = sorted.filter((m) => m.isResignation)
  const dropped = [...(summary.droppedDrivers ?? [])].sort((a, b) => b.mediaScore - a.mediaScore)

  if (sorted.length === 0 && dropped.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No market activity this off-season.</p>
  }

  const teamPill = (teamId: string, label: string) => {
    const color = teamColorMap.get(teamId)
    return (
      <span className="flex items-center gap-1.5">
        {color && <span className="inline-block w-1.5 h-3.5 rounded-sm" style={{ backgroundColor: color }} />}
        <TeamLink id={teamId} className="text-[#FFFFFF]">{label}</TeamLink>
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Real changes — transfers and new signings */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">
          Transfers &amp; Signings {realMoves.length > 0 && <span className="text-[#00D9FF]">· {realMoves.length}</span>}
        </p>
        {realMoves.length === 0 ? (
          <p className="text-sm text-[#FFFFFF]">No driver changed teams this off-season.</p>
        ) : (
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
                {realMoves.map((m: MarketMove) => {
                  const isRookie = m.mediaScore === 0
                  return (
                    <tr key={m.driverId} className="border-b border-[#2A3142]/50">
                      <td className="py-2 pr-4">
                        <DriverLink id={m.driverId} className="text-[#FFFFFF] font-medium">{m.driverName}</DriverLink>
                        {isRookie && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] rounded px-1.5 py-0.5">
                            NEW
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {m.fromTeamId
                          ? teamPill(m.fromTeamId, teamNameMap.get(m.fromTeamId) ?? m.fromTeamId)
                          : <span className="text-[#FFFFFF] italic">Free Agent</span>}
                      </td>
                      <td className="py-2 px-3">{teamPill(m.toTeamId, m.toTeamName)}</td>
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
        )}
      </div>

      {/* Re-signings — stayed put */}
      {reSignings.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">
            Re-signings <span className="text-[#FFFFFF]">· {reSignings.length}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                  <th className="text-left pb-2 pr-4 font-medium">Driver</th>
                  <th className="text-left pb-2 px-3 font-medium">Team</th>
                  <th className="text-right pb-2 px-3 font-medium">Contract</th>
                  <th className="text-right pb-2 font-medium">Media</th>
                </tr>
              </thead>
              <tbody>
                {reSignings.map((m) => (
                  <tr key={m.driverId} className="border-b border-[#2A3142]/50">
                    <td className="py-2 pr-4"><DriverLink id={m.driverId} className="text-[#FFFFFF] font-medium">{m.driverName}</DriverLink></td>
                    <td className="py-2 px-3">{teamPill(m.toTeamId, m.toTeamName)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">
                      {m.contractLength}yr
                      <span className="text-[#FFFFFF] ml-1 text-xs">(until {m.contractExpiresAfterSeason})</span>
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-[#00D9FF]">{m.mediaScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dropped — lost their seat, no new deal */}
      {dropped.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">
            Dropped <span className="text-[#DC143C]">· {dropped.length}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                  <th className="text-left pb-2 pr-4 font-medium">Driver</th>
                  <th className="text-left pb-2 px-3 font-medium">Released by</th>
                  <th className="text-right pb-2 font-medium">Media</th>
                </tr>
              </thead>
              <tbody>
                {dropped.map((d) => (
                  <tr key={d.driverId} className="border-b border-[#2A3142]/50">
                    <td className="py-2 pr-4"><DriverLink id={d.driverId} className="text-[#FFFFFF] font-medium">{d.driverName}</DriverLink></td>
                    <td className="py-2 px-3">{teamPill(d.fromTeamId, d.fromTeamName)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-[#FFFFFF]">{d.mediaScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
