'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { ProgressionPanel } from '@/components/standings/ProgressionPanel'
import { DriverStandingsTable } from '@/components/standings/DriverStandingsTable'
import { ConstructorStandingsTable } from '@/components/standings/ConstructorStandingsTable'
import { RetirementsPanel } from '@/components/standings/RetirementsPanel'
import { ReshufflePanel } from '@/components/standings/ReshufflePanel'
import { MarketPanel } from '@/components/standings/MarketPanel'
import {
  actionGetArchivedSeasons,
  actionGetSeasonStandings,
  actionArchiveSeason,
  actionInsertConstructorStandings,
  actionGetRecentConstructorHistory,
} from '@/lib/db/actions'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import type { DbSeason } from '@/lib/db/queries'

type Tab = 'drivers' | 'constructors'
type EosTab = 'progression' | 'retirements' | 'reshuffle' | 'market'

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
  const [eosTab, setEosTab] = useState<EosTab>('progression')
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

  async function handleArchiveAndNewSeason() {
    if (season.dbSeasonId) {
      await actionArchiveSeason(season.dbSeasonId)
      const constructorFinalPositions = season.constructorStandings.map((cs, idx) => ({
        teamId: cs.teamId,
        finalPosition: idx + 1,
        points: cs.points,
      }))
      await actionInsertConstructorStandings(season.dbSeasonId, constructorFinalPositions)
    }
    const freshHistory = await actionGetRecentConstructorHistory(5)
    season.loadConstructorHistory(freshHistory)
    season.startNewSeason()
    router.push('/setup')
  }

  function handleReturnToSetup() {
    season.resetToIdle()
    router.push('/setup')
  }

  const totalRounds = calendar2026.length
  const completedRounds = season.raceResults.length

  const displayDrivers = selectedArchive ? selectedArchive.driverStandings : season.driverStandings
  const displayConstructors = selectedArchive ? selectedArchive.constructorStandings : season.constructorStandings
  const displayYear = selectedArchive ? selectedArchive.year : season.year

  const summary = season.endOfSeasonSummary

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#E8EAED]">
      <div className="max-w-full px-4 py-6">

        {/* End-of-season panel */}
        {isEndOfSeason && !selectedArchive && (
          <div className="mb-6 rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 overflow-hidden">
            {/* Champion header */}
            <div className="p-5 flex items-center justify-between flex-wrap gap-4 border-b border-[#2A3142]">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-1 h-6 rounded-sm bg-[#00D9FF]" />
                  <h2 className="font-display text-xl tracking-wider uppercase text-[#E8EAED]">
                    Season {season.year} Complete
                  </h2>
                </div>
                {displayDrivers[0] && (
                  <p className="text-[#FFFFFF] text-sm ml-3.5">
                    World Champion:{' '}
                    <span className="text-[#00D9FF] font-semibold">{displayDrivers[0].driverName}</span>
                    {' '}·{' '}
                    <span className="tabular-nums">{displayDrivers[0].points} pts</span>
                  </p>
                )}
                {season.constructorStandings[0] && (
                  <p className="text-[#A0A9B8] text-sm ml-3.5">
                    Constructors:{' '}
                    <span className="text-[#E8EAED] font-semibold">{season.constructorStandings[0].teamName}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleReturnToSetup}
                  className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors"
                >
                  Return to Setup
                </button>
                <button
                  onClick={handleArchiveAndNewSeason}
                  className="px-5 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors"
                >
                  Start {season.year + 1} Season →
                </button>
              </div>
            </div>

            {/* Sub-tabs (only if summary is available) */}
            {summary && (
              <>
                <div className="flex border-b border-[#2A3142]">
                  {(
                    [
                      ['progression', 'Driver Stats'],
                      ['retirements', `Retirements (${summary.retiredDriverIds.length})`],
                      ['reshuffle', 'Car Reshuffle'],
                      ['market', `Transfers (${summary.marketMoves.length})`],
                    ] as [EosTab, string][]
                  ).map(([t, label]) => (
                    <button
                      key={t}
                      onClick={() => setEosTab(t)}
                      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${
                        eosTab === t
                          ? 'text-[#00D9FF] border-[#00D9FF]'
                          : 'text-[#A0A9B8] border-transparent hover:text-[#E8EAED]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="p-5">
                  {eosTab === 'progression' && (
                    <ProgressionPanel summary={summary} drivers={season.drivers} />
                  )}
                  {eosTab === 'retirements' && (
                    <RetirementsPanel summary={summary} drivers={season.drivers} />
                  )}
                  {eosTab === 'reshuffle' && (
                    <ReshufflePanel summary={summary} teams={season.teams} />
                  )}
                  {eosTab === 'market' && (
                    <MarketPanel summary={summary} teams={season.teams} />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Header + controls */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-6 rounded-sm bg-[#DC143C]" />
            <h1 className="font-display text-2xl tracking-wider uppercase">Standings</h1>
            <span className="ml-2 text-sm text-[#FFFFFF] tabular-nums">{displayYear}</span>
          </div>

          <div className="flex items-center gap-3">
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

            <div className="flex rounded-lg overflow-hidden border border-[#2A3142]">
              {(['drivers', 'constructors'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    tab === t
                      ? 'bg-[#00D9FF] text-[#0F1419]'
                      : 'text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#2A3142]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingArchive && (
          <p className="text-[#FFFFFF] text-sm animate-pulse mb-4">Loading archived season...</p>
        )}

        {/* Driver standings */}
        {tab === 'drivers' && (
          <DriverStandingsTable
            standings={displayDrivers}
            teams={season.teams}
            totalRounds={totalRounds}
            completedRounds={completedRounds}
          />
        )}

        {/* Constructor standings */}
        {tab === 'constructors' && (
          <ConstructorStandingsTable
            standings={displayConstructors}
            drivers={season.drivers}
            teams={season.teams}
            totalRounds={totalRounds}
            completedRounds={completedRounds}
          />
        )}

      </div>
    </div>
  )
}
