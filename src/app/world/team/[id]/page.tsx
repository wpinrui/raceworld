'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTeamCareer } from '@/lib/world/hooks'
import { OverallRing } from '@/components/setup/OverallRing'
import { DriverLink } from '@/components/world/EntityLink'

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3 text-center">
      <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">{label}</p>
    </div>
  )
}

export default function TeamPage() {
  const { id } = useParams<{ id: string }>()
  const { career, loading } = useTeamCareer(id)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !career && <p className="text-sm text-[#FFFFFF]">Team not found.</p>}

        {career && (
          <>
            {/* Header */}
            <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center gap-4 flex-wrap">
              <div className="w-1.5 h-10 rounded-sm" style={{ backgroundColor: career.teamColor ?? '#6B7280' }} />
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-2xl tracking-wider uppercase">{career.teamName}</h1>
                <p className="text-sm text-[#FFFFFF] mt-0.5">
                  {career.currentPosition != null
                    ? <>Currently P{career.currentPosition} · car pace {career.carPace}</>
                    : <span className="italic">Not on the current grid</span>}
                </p>
              </div>
            </div>

            {/* Honours + totals */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <StatTile label="Titles" value={career.honours.constructorTitles} />
              <StatTile label="Best" value={career.honours.bestFinish != null ? `P${career.honours.bestFinish}` : '—'} />
              <StatTile label="Seasons" value={career.totals.seasons} />
              <StatTile label="Wins" value={career.totals.wins} />
              <StatTile label="Podiums" value={career.totals.podiums} />
              <StatTile label="Points" value={career.totals.points} />
            </div>
            {career.honours.titleYears.length > 0 && (
              <p className="text-sm text-[#FFFFFF] -mt-3">
                Constructors&apos; champions: {career.honours.titleYears.join(', ')}
              </p>
            )}

            {/* Current squad */}
            {career.currentSquad && career.currentSquad.length > 0 && (
              <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5">
                <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-3">Current Squad</p>
                <div className="flex flex-wrap gap-4">
                  {career.currentSquad.map((d) => (
                    <div key={d.driverId} className="flex items-center gap-3 rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3">
                      <OverallRing overall={d.overall} />
                      <DriverLink id={d.driverId} className="font-medium text-[#FFFFFF]">{d.driverName}</DriverLink>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Season-by-season */}
            <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
              <p className="px-5 py-3 text-[10px] uppercase tracking-widest text-[#FFFFFF] border-b border-[#2A3142]">History</p>
              {career.seasons.length === 0 ? (
                <p className="px-5 py-4 text-sm text-[#FFFFFF]">No completed seasons yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                        <th className="text-left py-2 px-4 font-medium">Season</th>
                        <th className="text-right py-2 px-3 font-medium">Pos</th>
                        <th className="text-right py-2 px-3 font-medium">Points</th>
                        <th className="text-right py-2 px-3 font-medium">Wins</th>
                        <th className="text-left py-2 px-4 font-medium">Drivers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {career.seasons.map((s) => (
                        <tr key={s.year} className="border-b border-[#2A3142]/50">
                          <td className="py-2 px-4 tabular-nums text-[#FFFFFF]">
                            {s.year}{s.inProgress && <span className="ml-1.5 text-[10px] text-[#00D9FF]">LIVE</span>}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.finalPosition != null ? `P${s.finalPosition}` : '—'}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.points}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.wins}</td>
                          <td className="py-2 px-4 text-[#FFFFFF]">
                            {s.drivers.map((d, i) => (
                              <span key={d.driverId}>
                                {i > 0 && ', '}
                                <DriverLink id={d.driverId} className="text-[#FFFFFF]">{d.driverName}</DriverLink>
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
