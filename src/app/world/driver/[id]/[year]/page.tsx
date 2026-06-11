'use client'

import { useHydrated } from '@/lib/ui/use-hydrated'
import { useScrollRestore } from '@/lib/ui/use-scroll-restore'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useDriverSeason } from '@/lib/world/hooks'
import { DriverLink } from '@/components/world/EntityLink'
import { ResultChip } from '@/components/standings/ResultCell'
import { StintBar } from '@/components/world/StintBar'
import { ChampPill } from '@/components/world/pills'
import { Panel, StatTile } from '@/components/world/ui'
import { formatLapTime } from '@/lib/format'

export default function DriverSeasonPage() {
  const { id, year: yearStr } = useParams<{ id: string; year: string }>()
  const year = Number(yearStr)
  const { detail, loading } = useDriverSeason(id, year)
  const hydrated = useHydrated()
  const scrollRef = useScrollRestore<HTMLDivElement>(`driverseason:${id}:${year}:scroll`)
  if (!hydrated) return null

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !detail && <p className="text-sm text-[#FFFFFF]">No data for this season.</p>}

        {detail && (
          <>
            <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{detail.year} Season</p>
                <h1 className="font-display text-2xl tracking-wider uppercase mt-1">
                  <DriverLink id={detail.driverId} className="text-[#FFFFFF]">{detail.driverName}</DriverLink>
                </h1>
                <p className="text-sm text-[#FFFFFF] mt-0.5">{detail.teamName}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1">Championship</p>
                <ChampPill position={detail.championshipFinish} />
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <StatTile label="Races" value={detail.totals.races} />
              <StatTile label="Wins" value={detail.totals.wins} />
              <StatTile label="Podiums" value={detail.totals.podiums} />
              <StatTile label="Poles" value={detail.totals.poles} />
              <StatTile label="Points" value={detail.totals.points} />
              <StatTile label="DNFs" value={detail.totals.dnfs} />
            </div>

            <Panel title="Race by race" flush>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                      <th className="text-left py-2 px-4 font-medium">Rd</th>
                      <th className="text-left py-2 px-3 font-medium">Grand Prix</th>
                      <th className="text-center py-2 px-2 font-medium">Grid</th>
                      <th className="text-center py-2 px-3 font-medium">Result</th>
                      <th className="text-right py-2 px-3 font-medium">Q1</th>
                      <th className="text-right py-2 px-3 font-medium">Q2</th>
                      <th className="text-right py-2 px-3 font-medium">Q3</th>
                      <th className="text-right py-2 px-3 font-medium">Pts</th>
                      <th className="text-left py-2 px-3 font-medium">Tyres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.races.map((r) => (
                      <tr key={r.round} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                        <td className="py-1.5 px-4 tabular-nums text-[#FFFFFF]">{r.round}</td>
                        <td className="py-1.5 px-3">
                          <Link href={`/world/season/${detail.year}/${r.round}`} className="text-[#FFFFFF] hover:text-[#00D9FF]">{r.circuitName}</Link>
                        </td>
                        <td className="py-1.5 px-2 text-center tabular-nums text-[#FFFFFF]">{r.gridPosition}</td>
                        <td className="py-1.5 px-3"><span className="flex justify-center"><ResultChip position={r.dnf ? null : r.finishPosition} year={detail.year} /></span></td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{formatLapTime(r.q1)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{formatLapTime(r.q2)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{formatLapTime(r.q3)}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.points || ''}</td>
                        <td className="py-1.5 px-3 w-44"><StintBar stints={r.stints} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Link href={`/world/driver/${detail.driverId}`} className="inline-block text-xs text-[#FFFFFF] hover:text-[#00D9FF]">← {detail.driverName}</Link>
          </>
        )}
      </div>
    </div>
  )
}
