'use client'

import { useState, useEffect } from 'react'
import { Trophy } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { DriverStandingsTable } from '@/components/standings/DriverStandingsTable'
import { ConstructorStandingsTable } from '@/components/standings/ConstructorStandingsTable'
import { actionGetArchivedSeasons, actionGetSeasonStandings } from '@/lib/db/actions'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import { isOffSeason } from '@/lib/sim/types'
import type { DbSeason } from '@/lib/db/queries'

type Tab = 'drivers' | 'constructors'

interface ArchivedView {
  seasonId: number
  year: number
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
}

export default function StandingsPage() {
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

  async function loadArchivedSeason(s: DbSeason) {
    setLoadingArchive(true)
    const data = await actionGetSeasonStandings(s.id)
    setSelectedArchive({ seasonId: s.id, year: s.year, ...data })
    setLoadingArchive(false)
  }

  const totalRounds = calendar2026.length
  const completedRounds = season.raceResults.length

  const displayDrivers = selectedArchive ? selectedArchive.driverStandings : season.driverStandings
  const displayConstructors = selectedArchive ? selectedArchive.constructorStandings : season.constructorStandings
  const displayYear = selectedArchive ? selectedArchive.year : season.year

  // At year end the standings are final — celebrate the two champions.
  const showChampions = isOffSeason(season.phase) && !selectedArchive
  const champDriver = displayDrivers[0]
  const champConstructor = displayConstructors[0]

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-full px-4 py-6">

        {/* Champion trophies (year end only) */}
        {showChampions && (champDriver || champConstructor) && (
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            {champDriver && (
              <div className="flex items-center gap-4 rounded-xl bg-[#1E2431] border border-[#E8C547]/40 px-5 py-4">
                <Trophy size={28} className="text-[#E8C547] shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#A0A9B8]">{season.year} World Champion</p>
                  <p className="font-display text-lg tracking-wide text-[#FFFFFF]">{champDriver.driverName}</p>
                  <p className="text-xs text-[#A0A9B8] tabular-nums">{champDriver.points} pts · {champDriver.teamName}</p>
                </div>
              </div>
            )}
            {champConstructor && (
              <div className="flex items-center gap-4 rounded-xl bg-[#1E2431] border border-[#E8C547]/40 px-5 py-4">
                <Trophy size={28} className="text-[#E8C547] shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#A0A9B8]">{season.year} Constructors&apos; Champion</p>
                  <p className="font-display text-lg tracking-wide text-[#FFFFFF]">{champConstructor.teamName}</p>
                  <p className="text-xs text-[#A0A9B8] tabular-nums">{champConstructor.points} pts</p>
                </div>
              </div>
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
                className="px-3 py-1.5 rounded-lg bg-[#2A3142] text-[#FFFFFF] text-xs border border-[#303848] focus:border-[#00D9FF] outline-none"
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
                      : 'text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#2A3142]'
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
