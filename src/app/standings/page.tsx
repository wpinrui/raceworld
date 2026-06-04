'use client'

import { useState, useEffect, useMemo } from 'react'
import { Trophy } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import { DriverStandingsTable } from '@/components/standings/DriverStandingsTable'
import { ConstructorStandingsTable } from '@/components/standings/ConstructorStandingsTable'
import { TeammateH2HPanel } from '@/components/standings/TeammateH2HPanel'
import { PowerRankingsPanel } from '@/components/standings/PowerRankingsPanel'
import { AllTimeStatsTable, type AllTimeColumn } from '@/components/standings/AllTimeStatsTable'
import { actionGetArchivedSeasons, actionGetSeasonStandings, actionGetAllTimeDriverStats, actionGetAllTimeTeamStats } from '@/lib/db/actions'
import type { DriverStanding, ConstructorStanding } from '@/lib/sim/types'
import { isOffSeason } from '@/lib/sim/types'
import type { DbSeason, AllTimeDriverStat, AllTimeTeamStat } from '@/lib/db/queries'
import { foldLiveDriverStats, foldLiveTeamStats } from '@/lib/world/alltime'
import { historicalDrivers } from '@/data/history/drivers'
import { historicalGrids } from '@/data/history/grids'

type Tab = 'drivers' | 'constructors' | 'h2h' | 'power' | 'alltime'

const TABS: [Tab, string][] = [
  ['drivers', 'Drivers'],
  ['constructors', 'Constructors'],
  ['h2h', 'Teammates'],
  ['power', 'Power Rankings'],
  ['alltime', 'All-Time'],
]

const DRIVER_ALLTIME_COLS: AllTimeColumn<AllTimeDriverStat>[] = [
  { key: 'name', label: 'Driver' },
  { key: 'seasons', label: 'Seasons', type: 'num' },
  { key: 'races', label: 'Races', type: 'num' },
  { key: 'firstYear', label: 'First', type: 'year' },
  { key: 'lastYear', label: 'Last', type: 'year' },
  { key: 'wins', label: 'Wins', type: 'num' },
  { key: 'poles', label: 'Poles', type: 'num' },
  { key: 'podiums', label: 'Podiums', type: 'num' },
  { key: 'points', label: 'Points', type: 'num' },
  { key: 'retirements', label: 'DNFs', type: 'num' },
  { key: 'wdc', label: 'WDC', type: 'num' },
]

const TEAM_ALLTIME_COLS: AllTimeColumn<AllTimeTeamStat>[] = [
  { key: 'name', label: 'Constructor' },
  { key: 'seasons', label: 'Seasons', type: 'num' },
  { key: 'races', label: 'Races', type: 'num' },
  { key: 'firstYear', label: 'First', type: 'year' },
  { key: 'lastYear', label: 'Last', type: 'year' },
  { key: 'wins', label: 'Wins', type: 'num' },
  { key: 'poles', label: 'Poles', type: 'num' },
  { key: 'podiums', label: 'Podiums', type: 'num' },
  { key: 'points', label: 'Points', type: 'num' },
  { key: 'retirements', label: 'DNFs', type: 'num' },
  { key: 'wdc', label: 'WDC', type: 'num' },
  { key: 'wcc', label: 'WCC', type: 'num' },
]

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
  const [allTimeDrivers, setAllTimeDrivers] = useState<AllTimeDriverStat[]>([])
  const [allTimeTeams, setAllTimeTeams] = useState<AllTimeTeamStat[]>([])
  const [openDrivers, setOpenDrivers] = useState(true)
  const [openTeams, setOpenTeams] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  // Nationality by id for the all-time flags — archived rows carry no nationality, so resolve from the
  // historical dataset (covers teams/drivers that have since dropped off the grid) and the 2026 grid,
  // with the live store last (most current). Anything unknown falls back to rest-of-world.
  const driverNation = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of historicalDrivers) m.set(d.id, d.nationality)
    for (const d of drivers2026) m.set(d.id, d.nationality)
    for (const d of season.drivers) if (d.nationality) m.set(d.id, d.nationality)
    return m
  }, [season.drivers])
  const teamNation = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of historicalGrids) for (const t of g.teams) m.set(t.id, t.nationality)
    for (const t of teams2026) m.set(t.id, t.nationality)
    for (const t of season.teams) if (t.nationality) m.set(t.id, t.nationality)
    return m
  }, [season.teams])

  // Fold the in-progress season's tallies into the archived all-time rows so the tables count it too.
  const liveForAllTime = useMemo(() => {
    const championId = season.endOfSeasonSummary?.driverChampion || null
    return {
      year: season.year,
      raceResults: season.raceResults,
      driverChampionId: championId,
      constructorChampionId: season.endOfSeasonSummary?.constructorChampion || null,
      driverChampionTeamId: championId ? (season.drivers.find((d) => d.id === championId)?.teamId ?? null) : null,
    }
  }, [season.year, season.raceResults, season.drivers, season.endOfSeasonSummary])
  const foldedDrivers = useMemo(() => foldLiveDriverStats(allTimeDrivers, liveForAllTime), [allTimeDrivers, liveForAllTime])
  const foldedTeams = useMemo(() => foldLiveTeamStats(allTimeTeams, liveForAllTime), [allTimeTeams, liveForAllTime])

  useEffect(() => {
    setHydrated(true)
    actionGetArchivedSeasons().then(setArchivedSeasons)
    actionGetAllTimeDriverStats().then(setAllTimeDrivers).catch(() => setAllTimeDrivers([]))
    actionGetAllTimeTeamStats().then(setAllTimeTeams).catch(() => setAllTimeTeams([]))
    // Deep-link support: /standings?tab=constructors etc. (e.g. from the home dashboard).
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'drivers' || t === 'constructors' || t === 'h2h' || t === 'power' || t === 'alltime') setTab(t)
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
    <div className="h-full flex flex-col overflow-hidden bg-[#0F1419] text-[#FFFFFF]">
      <div className="shrink-0 max-w-full px-4 pt-6">

        {/* Champion trophies (year end only) */}
        {showChampions && (champDriver || champConstructor) && (
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            {champDriver && (
              <div className="flex items-center gap-4 rounded-xl bg-[#1E2431] border border-[#E8C547]/40 px-5 py-4">
                <Trophy size={28} className="text-[#E8C547] shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{season.year} World Champion</p>
                  <p className="font-display text-lg tracking-wide text-[#FFFFFF]">{champDriver.driverName}</p>
                  <p className="text-xs text-[#FFFFFF] tabular-nums">{champDriver.points} pts · {champDriver.teamName}</p>
                </div>
              </div>
            )}
            {champConstructor && (
              <div className="flex items-center gap-4 rounded-xl bg-[#1E2431] border border-[#E8C547]/40 px-5 py-4">
                <Trophy size={28} className="text-[#E8C547] shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{season.year} Constructors&apos; Champion</p>
                  <p className="font-display text-lg tracking-wide text-[#FFFFFF]">{champConstructor.teamName}</p>
                  <p className="text-xs text-[#FFFFFF] tabular-nums">{champConstructor.points} pts</p>
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
              {TABS.map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    tab === t
                      ? 'bg-[#00D9FF] text-[#0F1419]'
                      : 'text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#2A3142]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingArchive && (
          <p className="text-[#FFFFFF] text-sm animate-pulse mb-4">Loading archived season...</p>
        )}
      </div>

      {/* Content area — fixed app layout: it scrolls, the page never does. The All-Time tab fits the
          viewport via an accordion whose open table scrolls internally. */}
      <div className={`flex-1 min-h-0 max-w-full px-4 ${tab === 'alltime' ? 'pb-4 flex flex-col' : 'pb-6 overflow-y-auto'}`}>

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

        {/* Teammate head-to-head (current season) */}
        {tab === 'h2h' && (
          <>
            {selectedArchive && (
              <p className="text-sm text-[#FFFFFF] mb-4">
                Head-to-head reflects the current season ({season.year}).
              </p>
            )}
            <TeammateH2HPanel raceResults={season.raceResults} drivers={season.drivers} teams={season.teams} />
          </>
        )}

        {/* Driver power rankings (current season) */}
        {tab === 'power' && (
          <>
            {selectedArchive && (
              <p className="text-sm text-[#FFFFFF] mb-4">
                Power rankings reflect the current season ({season.year}).
              </p>
            )}
            <PowerRankingsPanel
              drivers={season.drivers}
              teams={season.teams}
              raceResults={season.raceResults}
              constructorStandings={season.constructorStandings}
              driverStandings={season.driverStandings}
            />
          </>
        )}

        {/* All-time historical stats (archived seasons + the in-progress season, folded in). Two
            independent collapsible cards — the title IS the card header; expand either, both, or neither.
            Open cards share the viewport and scroll internally, so the page itself never scrolls. */}
        {tab === 'alltime' && (
          <div className="flex flex-col flex-1 min-h-0 gap-2">
            {([
              { label: 'Drivers', open: openDrivers, toggle: () => setOpenDrivers((v) => !v), empty: foldedDrivers.length === 0,
                table: <AllTimeStatsTable rows={foldedDrivers} columns={DRIVER_ALLTIME_COLS} kind="driver" flagOf={(id) => driverNation.get(id) ?? ''} /> },
              { label: 'Constructors', open: openTeams, toggle: () => setOpenTeams((v) => !v), empty: foldedTeams.length === 0,
                table: <AllTimeStatsTable rows={foldedTeams} columns={TEAM_ALLTIME_COLS} kind="team" flagOf={(id) => teamNation.get(id) ?? ''} /> },
            ] as const).map((s) => (
              <div
                key={s.label}
                className={`rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden flex flex-col ${s.open ? 'flex-1 min-h-0' : 'shrink-0'}`}
              >
                <button
                  onClick={s.toggle}
                  className="shrink-0 flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#0F1419]/40 transition-colors"
                >
                  <span className="font-display text-sm tracking-wide uppercase text-[#FFFFFF]">{s.label}</span>
                  <span className="text-[#00D9FF] text-xs">{s.open ? '▲' : '▼'}</span>
                </button>
                {s.open && (
                  <div className="flex-1 min-h-0 border-t border-[#2A3142]">
                    {s.empty
                      ? <p className="px-4 py-4 text-sm text-[#FFFFFF]">No archived seasons yet.</p>
                      : s.table}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
