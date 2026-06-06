'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useTeamSeason } from '@/lib/world/hooks'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { ResultChip } from '@/components/standings/ResultCell'
import { ChampPill } from '@/components/world/pills'
import { Panel, StatTile } from '@/components/world/ui'

export default function TeamSeasonPage() {
  const { id, year: yearStr } = useParams<{ id: string; year: string }>()
  const year = Number(yearStr)
  const { detail, loading } = useTeamSeason(id, year)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !detail && <p className="text-sm text-[#FFFFFF]">No data for this season.</p>}

        {detail && (
          <>
            <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{detail.year} Season{detail.inProgress && <span className="ml-1.5 text-[#00D9FF]">LIVE</span>}</p>
                <h1 className="font-display text-2xl tracking-wider uppercase mt-1">
                  <TeamLink id={detail.teamId} className="text-[#FFFFFF]">{detail.teamName}</TeamLink>
                </h1>
                <p className="text-sm text-[#FFFFFF] mt-0.5">
                  {detail.drivers.map((d, i) => (
                    <span key={d.driverId}>{i > 0 && ' · '}<DriverLink id={d.driverId} className="text-[#FFFFFF]">{d.driverName}</DriverLink></span>
                  ))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1">Constructors</p>
                <ChampPill position={detail.finalPosition} />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Races" value={detail.totals.races} />
              <StatTile label="Wins" value={detail.totals.wins} />
              <StatTile label="Podiums" value={detail.totals.podiums} />
              <StatTile label="Points" value={detail.totals.points} />
            </div>

            <Panel title="Race by race" flush>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                      <th className="text-left py-2 px-4 font-medium">Rd</th>
                      <th className="text-left py-2 px-3 font-medium">Grand Prix</th>
                      <th className="text-left py-2 px-3 font-medium">Cars (grid → finish)</th>
                      <th className="text-right py-2 px-4 font-medium">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.races.map((r) => (
                      <tr key={r.round} className="border-b border-[#2A3142]/50">
                        <td className="py-1.5 px-4 tabular-nums text-[#FFFFFF] align-top">{r.round}</td>
                        <td className="py-1.5 px-3 align-top">
                          <Link href={`/world/season/${detail.year}/${r.round}`} className="text-[#FFFFFF] hover:text-[#00D9FF]">{r.circuitName}</Link>
                        </td>
                        <td className="py-1.5 px-3">
                          <div className="flex flex-col gap-1.5">
                            {r.cars.map((c) => (
                              <span key={c.driverId} className="flex items-center gap-2">
                                <ResultChip position={c.dnf ? null : c.finishPosition} year={detail.year} />
                                <DriverLink id={c.driverId} className="text-[#FFFFFF]">{c.driverName}</DriverLink>
                                <span className="text-[#FFFFFF] tabular-nums">(P{c.gridPosition})</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-1.5 px-4 text-right tabular-nums text-[#FFFFFF] align-top">{r.points || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Link href={`/world/team/${detail.teamId}`} className="inline-block text-xs text-[#FFFFFF] hover:text-[#00D9FF]">← {detail.teamName}</Link>
          </>
        )}
      </div>
    </div>
  )
}
