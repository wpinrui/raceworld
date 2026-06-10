'use client'

import { useHydrated } from '@/lib/ui/use-hydrated'
import Link from 'next/link'
import { useScrollRestore } from '@/lib/ui/use-scroll-restore'
import { useSeasonStore } from '@/lib/store/season-store'
import { useWorldOverview } from '@/lib/world/hooks'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import type { LeaderboardEntry } from '@/lib/world/types'

function LeaderList({ title, kind, entries, suffix }: { title: string; kind: 'driver' | 'team'; entries: LeaderboardEntry[]; suffix?: string }) {
  return (
    <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-4">
      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">{title}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-[#FFFFFF]">—</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((e, i) => (
            <li key={e.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-4 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                {kind === 'driver'
                  ? <DriverLink id={e.id} className="text-[#FFFFFF] truncate">{e.name}</DriverLink>
                  : <TeamLink id={e.id} className="text-[#FFFFFF] truncate">{e.name}</TeamLink>}
              </span>
              <span className="tabular-nums font-semibold text-[#00D9FF] shrink-0">{e.value}{suffix ?? ''}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function WorldPage() {
  const season = useSeasonStore()
  const { data, loading } = useWorldOverview()
  const hydrated = useHydrated()
  const scrollRef = useScrollRestore<HTMLDivElement>('world:scroll')
  const card = useLiveDriverCards()
  if (!hydrated) return null

  const champDriver = season.driverStandings[0]
  const champConstructor = season.constructorStandings[0]

  // Directory = archived teams ∪ current grid teams (so it isn't empty at game start).
  const dir = new Map<string, string>()
  for (const t of data?.teamsDirectory ?? []) dir.set(t.teamId, t.teamName)
  for (const t of season.teams) dir.set(t.id, t.name)
  const teams = [...dir.entries()].map(([teamId, teamName]) => ({ teamId, teamName })).sort((a, b) => a.teamName.localeCompare(b.teamName))
  const teamColor = (id: string) => season.teams.find((t) => t.id === id)?.color ?? '#6B7280'

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-6">
        {/* Masthead */}
        <div className="rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 p-5">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-1 h-7 rounded-sm bg-[#DC143C]" />
            <h1 className="font-display text-3xl tracking-wider uppercase">Formula 1</h1>
          </div>
          <p className="text-sm text-[#FFFFFF] ml-3.5">
            Season {season.year}
            {champDriver && <> · leading: <DriverHover id={champDriver.driverId} card={card}><DriverLink id={champDriver.driverId} className="text-[#00D9FF] font-semibold">{champDriver.driverName}</DriverLink></DriverHover> ({champDriver.points} pts)</>}
            {champConstructor && <> · <TeamLink id={champConstructor.teamId} className="font-semibold">{champConstructor.teamName}</TeamLink></>}
          </p>
        </div>

        {/* Current season snapshot */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Drivers — Top 5</p>
              <Link href="/standings" className="text-xs text-[#FFFFFF] hover:text-[#00D9FF]">full standings →</Link>
            </div>
            <ol className="space-y-1">
              {season.driverStandings.slice(0, 5).map((d, i) => (
                <li key={d.driverId} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-4 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                    <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: teamColor(d.teamId) }} />
                    <DriverHover id={d.driverId} card={card} className="truncate min-w-0"><DriverLink id={d.driverId} className="text-[#FFFFFF] truncate">{d.driverName}</DriverLink></DriverHover>
                  </span>
                  <span className="tabular-nums font-semibold text-[#FFFFFF] shrink-0">{d.points}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-4">
            <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">Constructors — Top 5</p>
            <ol className="space-y-1">
              {season.constructorStandings.slice(0, 5).map((c, i) => (
                <li key={c.teamId} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-4 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                    <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: teamColor(c.teamId) }} />
                    <TeamLink id={c.teamId} className="text-[#FFFFFF] truncate">{c.teamName}</TeamLink>
                  </span>
                  <span className="tabular-nums font-semibold text-[#FFFFFF] shrink-0">{c.points}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Champions roll */}
        <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
          <p className="px-5 py-3 text-[10px] uppercase tracking-widest text-[#FFFFFF] border-b border-[#2A3142]">Champions</p>
          {loading ? (
            <p className="px-5 py-4 text-sm text-[#FFFFFF] animate-pulse">Loading…</p>
          ) : !data || data.championsRoll.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[#FFFFFF]">No completed seasons yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                    <th className="text-left py-2 px-5 font-medium">Season</th>
                    <th className="text-left py-2 px-3 font-medium">World Champion</th>
                    <th className="text-left py-2 px-5 font-medium">Constructors&apos;</th>
                  </tr>
                </thead>
                <tbody>
                  {data.championsRoll.map((c) => (
                    <tr key={c.year} className="border-b border-[#2A3142]/50">
                      <td className="py-2 px-5 tabular-nums text-[#FFFFFF]">{c.year}</td>
                      <td className="py-2 px-3 text-[#FFFFFF]">
                        {c.driverChampionId
                          ? <><DriverHover id={c.driverChampionId} card={card}><DriverLink id={c.driverChampionId} className="font-semibold text-[#FFFFFF]">{c.driverChampionName}</DriverLink></DriverHover>
                              {c.driverChampionTeamId && <span className="text-[#FFFFFF]"> · <TeamLink id={c.driverChampionTeamId} className="text-[#FFFFFF]">{dir.get(c.driverChampionTeamId) ?? c.driverChampionTeamId}</TeamLink></span>}</>
                          : '—'}
                      </td>
                      <td className="py-2 px-5 text-[#FFFFFF]">
                        {c.constructorChampionId
                          ? <TeamLink id={c.constructorChampionId} className="font-semibold text-[#FFFFFF]">{c.constructorChampionName}</TeamLink>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* All-time records */}
        {data && (data.leaders.driverWins.length > 0 || data.leaders.driverTitles.length > 0) && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">All-Time Records</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <LeaderList title="Driver Titles" kind="driver" entries={data.leaders.driverTitles} />
              <LeaderList title="Driver Wins" kind="driver" entries={data.leaders.driverWins} />
              <LeaderList title="Driver Podiums" kind="driver" entries={data.leaders.driverPodiums} />
              <LeaderList title="Driver Points" kind="driver" entries={data.leaders.driverPoints} />
              <LeaderList title="Team Titles" kind="team" entries={data.leaders.teamTitles} />
              <LeaderList title="Team Wins" kind="team" entries={data.leaders.teamWins} />
              <LeaderList title="Team Podiums" kind="team" entries={data.leaders.teamPodiums} />
              <LeaderList title="Team Points" kind="team" entries={data.leaders.teamPoints} />
            </div>
          </div>
        )}

        {/* Teams directory */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-2">Teams</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t) => (
              <TeamLink key={t.teamId} id={t.teamId} className="!text-[#FFFFFF]">
                <span className="flex items-center gap-3 rounded-xl bg-[#1E2431] border border-[#2A3142] px-4 py-3 hover:border-[#00D9FF]/40">
                  <span className="w-1.5 h-6 rounded-sm shrink-0" style={{ backgroundColor: teamColor(t.teamId) }} />
                  <span className="font-medium">{t.teamName}</span>
                </span>
              </TeamLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
