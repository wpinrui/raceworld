'use client'

import { useState } from 'react'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { useRetainedState } from '@/lib/ui/retained-state'
import { useScrollRestore } from '@/lib/ui/use-scroll-restore'
import { useParams } from 'next/navigation'
import { Pencil, Check } from 'lucide-react'
import { useTeamCareer, useEntityHonours } from '@/lib/world/hooks'
import { useSeasonStore } from '@/lib/store/season-store'
import { isOffSeason } from '@/lib/sim/types'
import { HonoursPanel } from '@/components/world/HonoursPanel'
import { calendarForYear } from '@/data/calendars'
import { OverallRing } from '@/components/setup/OverallRing'
import { DriverLink } from '@/components/world/EntityLink'
import { CountrySelect } from '@/components/CountrySelect'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { ChampRank } from '@/components/world/pills'
import { ResultCell } from '@/components/standings/ResultCell'
import { Panel, StatTile, TabBar } from '@/components/world/ui'
import { UpgradeOverride } from '@/components/world/UpgradeOverride'
import { DevCyclePicker } from '@/components/world/DevCyclePicker'
import { resolveTeamNationality } from '@/lib/world/historical-team'
import { useRatingsHidden } from '@/lib/useRatingsHidden'

type Tab = 'overview' | 'seasons'

export default function TeamPage() {
  const { id } = useParams<{ id: string }>()
  const { career, loading } = useTeamCareer(id)
  const { feats: honours, loading: honoursLoading } = useEntityHonours('team', id)
  const devPlan = useSeasonStore((s) => s.devPlans.find((p) => p.teamId === id))
  const currentRound = useSeasonStore((s) => s.currentRound)
  // The live season's round count drives the in-season upgrade timeline.
  const totalRounds = useSeasonStore((s) => calendarForYear(s.year).length)
  const liveTeam = useSeasonStore((s) => s.teams.find((t) => t.id === id))
  const seasonTeams = useSeasonStore((s) => s.teams)
  const ratingsHidden = useRatingsHidden()
  const updateTeam = useSeasonStore((s) => s.updateTeam)
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode)
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const onGrid = !!liveTeam
  // Team Manager: the player picks the upgrade cadence for their own team only.
  const isPlayerTeam = teamManagerMode && id === playerTeamId
  // God-mode team edits: always available in sandbox; in Team Manager mode only for the player's own team.
  const canEditTeam = !!liveTeam && (!teamManagerMode || id === playerTeamId)
  // Only editable while the season is running: upgrades are delivered during races, and
  // startNewSeason re-rolls every dev plan from scratch, so off-season edits wouldn't survive.
  const upgradeEditable = useSeasonStore((s) => !isOffSeason(s.phase))
  const [tab, setTab] = useRetainedState<Tab>(`team:${id}:tab`, 'overview')
  const [editing, setEditing] = useState(false)
  const hydrated = useHydrated()
  const scrollRef = useScrollRestore<HTMLDivElement>(`team:${id}:scroll`)
  if (!hydrated) return null

  const inputClass = 'w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none'

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !career && <p className="text-sm text-[#FFFFFF]">Team not found.</p>}

        {career && (() => {
          const current = career.seasons.find((s) => s.inProgress)
          return (
            <>
              {/* Header band */}
              <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center gap-4 flex-wrap">
                <div className="w-1.5 h-10 rounded-sm" style={{ backgroundColor: liveTeam?.color ?? career.teamColor ?? '#6B7280' }} />
                {editing && canEditTeam && liveTeam ? (
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-[#FFFFFF] block mb-1">Name</label>
                      <input type="text" value={liveTeam.name} onChange={(e) => updateTeam(id, { name: e.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className="text-xs text-[#FFFFFF] block mb-1">Colour</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={liveTeam.color} onChange={(e) => updateTeam(id, { color: e.target.value })} className="h-9 w-10 shrink-0 rounded bg-[#0F1419] border border-[#303848] cursor-pointer p-0.5" />
                        <input type="text" value={liveTeam.color} onChange={(e) => updateTeam(id, { color: e.target.value })} className={inputClass} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[#FFFFFF] block mb-1">Nationality</label>
                      <CountrySelect value={liveTeam.nationality} onChange={(code) => updateTeam(id, { nationality: code })} />
                    </div>
                    {/* Car pace is direct-editable only in sandbox; in Team Manager it changes solely via the upgrade cycle. */}
                    {!teamManagerMode && (
                      <div>
                        <label className="text-xs text-[#FFFFFF] block mb-1">Car pace</label>
                        <input
                          type="number" min={0} max={100} step={1} value={liveTeam.carPace}
                          onChange={(e) => { if (e.target.value !== '') updateTeam(id, { carPace: Number(e.target.value) }) }}
                          className={inputClass}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <NationalityFlag code={resolveTeamNationality(id, seasonTeams)} size="1.4em" />
                      <h1 className="font-display text-2xl tracking-wider uppercase">{career.teamName}</h1>
                    </div>
                    <p className="text-sm text-[#FFFFFF] mt-0.5">
                      {career.currentPosition != null
                        ? <>Currently P{career.currentPosition}{ratingsHidden ? '' : ` · car pace ${career.carPace}`}</>
                        : <span className="italic">Not on the current grid</span>}
                    </p>
                  </div>
                )}
                {canEditTeam && (
                  <button
                    onClick={() => setEditing((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
                  >
                    {editing ? <Check size={13} /> : <Pencil size={13} />}
                    {editing ? 'Done' : 'God mode'}
                  </button>
                )}
              </div>

              <TabBar<Tab>
                tabs={[{ key: 'overview', label: 'Overview' }, { key: 'seasons', label: 'Seasons & Races' }]}
                active={tab}
                onChange={setTab}
              />

              {tab === 'overview' && (
                <div className="space-y-5">
                  {isPlayerTeam && (
                    <DevCyclePicker className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5" />
                  )}

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
                        </div>
                      </Panel>
                    )}
                  </div>

                  <HonoursPanel feats={honours} loading={honoursLoading} />

                  {/* God-mode: inspect and edit the next car upgrade before it lands. Sandbox only — in Team
                      Manager the upgrade magnitude is rolled and revealed (pre-race modal), never editable. */}
                  {!teamManagerMode && onGrid && devPlan && upgradeEditable && (
                    <UpgradeOverride teamId={id} devPlan={devPlan} currentRound={currentRound} totalRounds={totalRounds} />
                  )}
                </div>
              )}

              {tab === 'seasons' && (() => {
                const maxRounds = Math.max(1, ...career.seasons.flatMap((s) => s.drivers.map((d) => d.results.length)))
                return (
                  <Panel title="History" flush>
                    {career.seasons.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-[#FFFFFF]">No seasons yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                              <th className="text-left py-2 px-4 font-medium sticky left-0 bg-[#1E2431]">Year</th>
                              <th className="text-left py-2 px-3 font-medium">Driver</th>
                              {Array.from({ length: maxRounds }, (_, i) => (
                                <th key={i} className="text-center py-2 px-0.5 w-9 text-[10px] tabular-nums font-medium">{i + 1}</th>
                              ))}
                              <th className="text-right py-2 px-4 font-medium">Points</th>
                              <th className="text-center py-2 px-3 font-medium">Pos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...career.seasons].sort((a, b) => a.year - b.year).map((s) =>
                              s.drivers.map((d, di) => (
                                <tr key={`${s.year}-${d.driverId}`} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                                  {di === 0 && (
                                    <td rowSpan={s.drivers.length} className="py-2 px-4 tabular-nums font-medium align-middle sticky left-0 bg-[#1E2431]">{s.year}</td>
                                  )}
                                  <td className="py-2 px-3 whitespace-nowrap"><DriverLink id={d.driverId} className="text-[#FFFFFF]">{d.driverName}</DriverLink></td>
                                  {Array.from({ length: maxRounds }, (_, i) => (
                                    <ResultCell key={i} position={i < d.results.length ? d.results[i] : undefined} year={s.year} code={calendarForYear(s.year)[i]?.code} />
                                  ))}
                                  {di === 0 && (
                                    <td rowSpan={s.drivers.length} className="py-2 px-4 text-right tabular-nums font-semibold text-[#FFFFFF] align-middle">{s.points}</td>
                                  )}
                                  {di === 0 && (
                                    <td rowSpan={s.drivers.length} className="py-2 px-3 text-center align-middle"><ChampRank position={s.inProgress ? career.currentPosition : s.finalPosition} /></td>
                                  )}
                                </tr>
                              )),
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                )
              })()}
            </>
          )
        })()}
      </div>
    </div>
  )
}
