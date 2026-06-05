'use client'

import { useEffect, useState } from 'react'
import { useScrollRestore } from '@/lib/ui/use-scroll-restore'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useRaceClassification } from '@/lib/world/hooks'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { ResultChip } from '@/components/standings/ResultCell'
import { StintBar } from '@/components/world/StintBar'
import { Panel } from '@/components/world/ui'
import { formatLapTime, formatRaceTime, formatGap } from '@/components/world/format'

export default function RaceClassificationPage() {
  const { year: yearStr, round: roundStr } = useParams<{ year: string; round: string }>()
  const year = Number(yearStr)
  const round = Number(roundStr)
  const { classification, loading } = useRaceClassification(year, round)
  const [hydrated, setHydrated] = useState(false)
  const scrollRef = useScrollRestore<HTMLDivElement>(`season:${year}:${round}:scroll`)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  const winnerTime = classification?.rows.find((r) => !r.dnf)?.totalTime ?? null

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !classification && <p className="text-sm text-[#FFFFFF]">Race not found.</p>}

        {classification && (
          <>
            <div className="rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 p-5">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-1 h-7 rounded-sm bg-[#DC143C]" />
                <h1 className="font-display text-2xl tracking-wider uppercase">
                  {classification.circuitName}
                </h1>
                {classification.inProgress && <span className="text-[10px] text-[#00D9FF]">LIVE</span>}
              </div>
              <p className="text-sm text-[#FFFFFF] ml-3.5">
                {classification.year} · Round {classification.round}
              </p>
            </div>

            <Panel title="Classification" flush>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                      <th className="text-center py-2 px-3 font-medium">Pos</th>
                      <th className="text-left py-2 px-3 font-medium">Driver</th>
                      <th className="text-left py-2 px-3 font-medium">Team</th>
                      <th className="text-center py-2 px-2 font-medium">Grid</th>
                      <th className="text-right py-2 px-3 font-medium">Q1</th>
                      <th className="text-right py-2 px-3 font-medium">Q2</th>
                      <th className="text-right py-2 px-3 font-medium">Q3</th>
                      <th className="text-right py-2 px-3 font-medium">Time / Laps</th>
                      <th className="text-right py-2 px-3 font-medium">Pts</th>
                      <th className="text-left py-2 px-3 font-medium">Tyres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classification.rows.map((r) => (
                      <tr key={r.driverId} className="border-b border-[#2A3142]/50">
                        <td className="py-1.5 px-3"><span className="flex justify-center"><ResultChip position={r.dnf ? null : r.finishPosition} /></span></td>
                        <td className="py-1.5 px-3"><DriverLink id={r.driverId} className="text-[#FFFFFF] font-medium">{r.driverName}</DriverLink></td>
                        <td className="py-1.5 px-3"><TeamLink id={r.teamId} className="text-[#FFFFFF]">{r.teamName}</TeamLink></td>
                        <td className="py-1.5 px-2 text-center tabular-nums text-[#FFFFFF]">{r.gridPosition}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{formatLapTime(r.q1)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{formatLapTime(r.q2)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{formatLapTime(r.q3)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">
                          {r.dnf
                            ? `DNF · ${r.lapsCompleted} laps`
                            : r.finishPosition === 1
                              ? formatRaceTime(r.totalTime)
                              : winnerTime != null && r.totalTime != null
                                ? formatGap(r.totalTime - winnerTime)
                                : `${r.lapsCompleted} laps`}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.points || ''}</td>
                        <td className="py-1.5 px-3 w-48"><StintBar stints={r.stints} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Link href={`/world`} className="inline-block text-xs text-[#FFFFFF] hover:text-[#00D9FF]">← World</Link>
          </>
        )}
      </div>
    </div>
  )
}
