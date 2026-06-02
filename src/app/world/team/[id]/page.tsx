'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useTeamCareer } from '@/lib/world/hooks'
import { OverallRing } from '@/components/setup/OverallRing'
import { DriverLink } from '@/components/world/EntityLink'
import { ChampPill } from '@/components/world/pills'
import { Panel, StatTile, TabBar } from '@/components/world/ui'

type Tab = 'overview' | 'seasons'

export default function TeamPage() {
  const { id } = useParams<{ id: string }>()
  const { career, loading } = useTeamCareer(id)
  const [tab, setTab] = useState<Tab>('overview')
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !career && <p className="text-sm text-[#FFFFFF]">Team not found.</p>}

        {career && (() => {
          const current = career.seasons.find((s) => s.inProgress)
          return (
            <>
              {/* Header band */}
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

              <TabBar<Tab>
                tabs={[{ key: 'overview', label: 'Overview' }, { key: 'seasons', label: 'Seasons & Races' }]}
                active={tab}
                onChange={setTab}
              />

              {tab === 'overview' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                    <StatTile label="Titles" value={career.honours.constructorTitles} />
                    <StatTile label="Best" value={career.honours.bestFinish != null ? `P${career.honours.bestFinish}` : '—'} />
                    <StatTile label="Seasons" value={career.totals.seasons} />
                    <StatTile label="Wins" value={career.totals.wins} />
                    <StatTile label="Podiums" value={career.totals.podiums} />
                    <StatTile label="Points" value={career.totals.points} />
                  </div>

                  {career.honours.titleYears.length > 0 && (
                    <Panel title="Constructors' Championships">
                      <p className="text-sm text-[#FFFFFF]">{career.honours.titleYears.join(' · ')}</p>
                    </Panel>
                  )}

                  <div className="grid gap-5 lg:grid-cols-2">
                    {career.currentSquad && career.currentSquad.length > 0 && (
                      <Panel title="Current Squad">
                        <div className="flex flex-wrap gap-4">
                          {career.currentSquad.map((d) => (
                            <div key={d.driverId} className="flex items-center gap-3 rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3">
                              <OverallRing overall={d.overall} />
                              <DriverLink id={d.driverId} className="font-medium text-[#FFFFFF]">{d.driverName}</DriverLink>
                            </div>
                          ))}
                        </div>
                      </Panel>
                    )}

                    {current && (
                      <Panel title={`This Season — ${current.year}`}>
                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{career.currentPosition != null ? `P${career.currentPosition}` : '—'}</p>
                            <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Position</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{current.points}</p>
                            <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Points</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{current.wins}</p>
                            <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Wins</p>
                          </div>
                          <Link href={`/world/team/${id}/${current.year}`} className="ml-auto text-xs text-[#FFFFFF] hover:text-[#00D9FF]">race by race →</Link>
                        </div>
                      </Panel>
                    )}
                  </div>
                </div>
              )}

              {tab === 'seasons' && (
                <Panel title="History" flush>
                  {career.seasons.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-[#FFFFFF]">No seasons yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                            <th className="text-left py-2 px-4 font-medium">Season</th>
                            <th className="text-center py-2 px-3 font-medium">Pos</th>
                            <th className="text-right py-2 px-3 font-medium">Points</th>
                            <th className="text-right py-2 px-3 font-medium">Wins</th>
                            <th className="text-left py-2 px-4 font-medium">Drivers</th>
                          </tr>
                        </thead>
                        <tbody>
                          {career.seasons.map((s) => (
                            <tr key={s.year} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                              <td className="py-2 px-4 tabular-nums">
                                <Link href={`/world/team/${id}/${s.year}`} className="text-[#FFFFFF] hover:text-[#00D9FF] font-medium">{s.year}</Link>
                                {s.inProgress && <span className="ml-1.5 text-[10px] text-[#00D9FF]">LIVE</span>}
                              </td>
                              <td className="py-2 px-3"><span className="flex justify-center"><ChampPill position={s.inProgress ? career.currentPosition : s.finalPosition} /></span></td>
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
                </Panel>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
