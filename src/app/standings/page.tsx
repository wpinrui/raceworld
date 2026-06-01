'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { ResultCell } from '@/components/standings/ResultCell'
import { actionGetArchivedSeasons, actionGetSeasonStandings, actionArchiveSeason } from '@/lib/db/actions'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import type { DbSeason } from '@/lib/db/queries'

type Tab = 'drivers' | 'constructors'

interface ArchivedView {
  seasonId: number
  year: number
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
}

export default function StandingsPage() {
  const router = useRouter()
  const season = useSeasonStore()
  const [tab, setTab] = useState<Tab>('drivers')
  const [archivedSeasons, setArchivedSeasons] = useState<DbSeason[]>([])
  const [selectedArchive, setSelectedArchive] = useState<ArchivedView | null>(null)
  const [loadingArchive, setLoadingArchive] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    actionGetArchivedSeasons().then(setArchivedSeasons)
  }, [])

  const isEndOfSeason = season.phase === 'end-of-season'

  async function loadArchivedSeason(s: DbSeason) {
    setLoadingArchive(true)
    const data = await actionGetSeasonStandings(s.id)
    setSelectedArchive({ seasonId: s.id, year: s.year, ...data })
    setLoadingArchive(false)
  }

  function handleArchiveAndNewSeason() {
    if (season.dbSeasonId) {
      actionArchiveSeason(season.dbSeasonId)
    }
    season.startNewSeason()
    router.push('/setup')
  }

  function handleReturnToSetup() {
    season.resetToIdle()
    router.push('/setup')
  }

  const totalRounds = calendar2026.length
  const completedRounds = season.raceResults.length

  // Displayed data: archived season or current season
  const displayDrivers = selectedArchive ? selectedArchive.driverStandings : season.driverStandings
  const displayConstructors = selectedArchive ? selectedArchive.constructorStandings : season.constructorStandings
  const displayYear = selectedArchive ? selectedArchive.year : season.year

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#E8EAED]">
      <div className="max-w-full px-4 py-6">

        {/* End-of-season banner */}
        {isEndOfSeason && !selectedArchive && (
          <div className="mb-6 rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-1 h-6 rounded-sm bg-[#00D9FF]" />
                  <h2 className="font-display text-xl tracking-wider uppercase text-[#E8EAED]">
                    Season {season.year} Complete
                  </h2>
                </div>
                {displayDrivers[0] && (
                  <p className="text-[#A0A9B8] text-sm ml-3.5">
                    World Champion:{' '}
                    <span className="text-[#00D9FF] font-semibold">{displayDrivers[0].driverName}</span>
                    {' '}·{' '}
                    <span className="tabular-nums">{displayDrivers[0].points} pts</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleReturnToSetup}
                  className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#A0A9B8] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors"
                >
                  Return to Setup
                </button>
                <button
                  onClick={handleArchiveAndNewSeason}
                  className="px-5 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors"
                >
                  Archive &amp; Start {season.year + 1} →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header + controls */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-6 rounded-sm bg-[#DC143C]" />
            <h1 className="font-display text-2xl tracking-wider uppercase">Standings</h1>
            <span className="ml-2 text-sm text-[#A0A9B8] tabular-nums">{displayYear}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Archive season selector */}
            {archivedSeasons.length > 0 && (
              <select
                value={selectedArchive?.seasonId ?? ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    setSelectedArchive(null)
                    return
                  }
                  const s = archivedSeasons.find((a) => a.id === Number(e.target.value))
                  if (s) loadArchivedSeason(s)
                }}
                className="px-3 py-1.5 rounded-lg bg-[#2A3142] text-[#E8EAED] text-xs border border-[#303848] focus:border-[#00D9FF] outline-none"
              >
                <option value="">Current Season ({season.year})</option>
                {archivedSeasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.year} (archived)
                  </option>
                ))}
              </select>
            )}

            {/* Tabs */}
            <div className="flex rounded-lg overflow-hidden border border-[#2A3142]">
              {(['drivers', 'constructors'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    tab === t
                      ? 'bg-[#00D9FF] text-[#0F1419]'
                      : 'text-[#A0A9B8] hover:text-[#E8EAED] hover:bg-[#2A3142]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingArchive && (
          <p className="text-[#A0A9B8] text-sm animate-pulse mb-4">Loading archived season...</p>
        )}

        {/* Driver standings */}
        {tab === 'drivers' && (
          <div className="overflow-x-auto rounded-xl bg-[#1E2431]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[#A0A9B8] text-xs tracking-wider uppercase border-b border-[#2A3142]">
                  <th className="text-left py-2 px-3 w-8 sticky left-0 bg-[#1E2431]">P</th>
                  <th className="text-left py-2 px-3 sticky left-8 bg-[#1E2431] min-w-[140px]">Driver</th>
                  <th className="text-left py-2 px-3 min-w-[80px]">Team</th>
                  <th className="text-right py-2 px-3 w-16">Pts</th>
                  <th className="text-right py-2 px-3 w-12">Wins</th>
                  {Array.from({ length: totalRounds }, (_, i) => (
                    <th key={i} className="text-center py-2 px-0.5 w-9 text-[10px]">
                      {String(i + 1).padStart(2, '0')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayDrivers.map((standing, idx) => {
                  const team = season.teams.find((t) => t.id === standing.teamId) ??
                    (selectedArchive ? null : null)
                  const teamColor = team?.color ?? '#A0A9B8'
                  return (
                    <tr
                      key={standing.driverId}
                      className="border-b border-[#2A3142]/50 hover:bg-[#2A3142]/40 transition-colors"
                    >
                      <td className="py-1.5 px-3 tabular-nums font-bold text-[#A0A9B8] sticky left-0 bg-[#1E2431]">
                        {idx + 1}
                      </td>
                      <td className="py-1.5 px-3 sticky left-8 bg-[#1E2431]">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: teamColor }} />
                          <span className="font-semibold text-[#E8EAED] whitespace-nowrap">{standing.driverName}</span>
                        </div>
                      </td>
                      <td className="py-1.5 px-3 text-[#A0A9B8] text-xs">{standing.teamName}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums font-bold text-[#E8EAED]">{standing.points}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-[#A0A9B8]">{standing.wins}</td>
                      {Array.from({ length: totalRounds }, (_, i) => {
                        if (i >= completedRounds && !selectedArchive) {
                          return <ResultCell key={i} position={undefined} round={i} />
                        }
                        return <ResultCell key={i} position={standing.results[i] ?? null} />
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Constructor standings */}
        {tab === 'constructors' && (
          <div className="rounded-xl bg-[#1E2431] overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[#A0A9B8] text-xs tracking-wider uppercase border-b border-[#2A3142]">
                  <th className="text-left py-2 px-3 w-8">P</th>
                  <th className="text-left py-2 px-3">Constructor</th>
                  <th className="text-right py-2 px-3 w-16">Pts</th>
                  <th className="text-right py-2 px-3 w-12">Wins</th>
                </tr>
              </thead>
              <tbody>
                {displayConstructors.map((standing, idx) => {
                  const team = season.teams.find((t) => t.id === standing.teamId)
                  return (
                    <tr
                      key={standing.teamId}
                      className="border-b border-[#2A3142]/50 hover:bg-[#2A3142]/40 transition-colors"
                    >
                      <td className="py-2 px-3 tabular-nums font-bold text-[#A0A9B8]">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: team?.color ?? '#A0A9B8' }}
                          />
                          <span className="font-semibold text-[#E8EAED]">{standing.teamName}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-bold text-[#E8EAED]">{standing.points}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[#A0A9B8]">{standing.wins}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Progress indicator */}
        {!selectedArchive && (
          <p className="mt-4 text-xs text-[#A0A9B8] text-right">
            {completedRounds}/{totalRounds} rounds completed
          </p>
        )}
      </div>
    </div>
  )
}
