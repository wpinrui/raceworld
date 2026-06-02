'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Pencil, Check, Lock } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import { useDriverCareer, useEntityHonours } from '@/lib/world/hooks'
import { useSeasonStore } from '@/lib/store/season-store'
import { HonoursPanel } from '@/components/world/HonoursPanel'
import { OverallRing } from '@/components/setup/OverallRing'
import { StatBar } from '@/components/setup/StatBar'
import { StatSlider } from '@/components/setup/StatSlider'
import { STAT_KEYS, STAT_LABELS } from '@/components/setup/stat-utils'
import { ResultChip, ResultCell } from '@/components/standings/ResultCell'
import { calendar2026 } from '@/data/calendar'
import { TeamLink } from '@/components/world/EntityLink'
import { CountrySelect } from '@/components/CountrySelect'
import { ChampPill } from '@/components/world/pills'
import { Panel, StatTile, TabBar } from '@/components/world/ui'
import { Tooltip } from '@/components/ui/Tooltip'
import { DriverAvatar } from '@/components/world/DriverAvatar'
import { RatingsProgressionChart } from '@/components/world/RatingsProgressionChart'
import { MilestonesTimeline } from '@/components/world/MilestonesTimeline'
import { TeammateH2HHistory } from '@/components/world/TeammateH2HHistory'
import { buildDriverBio } from '@/lib/world/bio'
import { buildMilestones } from '@/lib/world/milestones'

type Tab = 'overview' | 'development' | 'results' | 'h2h'

export default function DriverPage() {
  const { id } = useParams<{ id: string }>()
  const { career, loading } = useDriverCareer(id)
  const { feats: honours, loading: honoursLoading } = useEntityHonours('driver', id)
  const updateDriver = useSeasonStore((s) => s.updateDriver)
  const liveDriver = useSeasonStore((s) => s.drivers.find((d) => d.id === id))
  const teams = useSeasonStore((s) => s.teams)
  const allDrivers = useSeasonStore((s) => s.drivers)
  const seasonYear = useSeasonStore((s) => s.year)
  const releaseDriver = useSeasonStore((s) => s.releaseDriver)
  const extendContract = useSeasonStore((s) => s.extendContract)
  const assignDriverToTeam = useSeasonStore((s) => s.assignDriverToTeam)
  const [assignTeam, setAssignTeam] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [editing, setEditing] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  const inputClass = 'w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none'

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !career && <p className="text-sm text-[#FFFFFF]">Driver not found.</p>}

        {career && (() => {
          const a = career.attributes
          const current = career.seasons.find((s) => s.inProgress)
          const teamColor = teams.find((t) => t.id === a?.teamId)?.color ?? '#6B7280'
          const avatarDriver = {
            id: career.driverId,
            name: career.driverName,
            nationality: a?.nationality ?? 'GB',
            gender: a?.gender ?? ('male' as const),
            photoUrl: liveDriver?.photoUrl,
          }
          const bio = a ? buildDriverBio(career, a, seasonYear) : null
          const milestones = buildMilestones(career)

          return (
            <>
              {/* Header band */}
              <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center gap-5 flex-wrap">
                <DriverAvatar driver={avatarDriver} teamColor={teamColor} size={88} className="border-2" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <ReactCountryFlag countryCode={(a?.nationality) || 'GB'} svg style={{ width: '1.4em', height: '1.4em', borderRadius: '2px' }} />
                    <h1 className="font-display text-2xl tracking-wider uppercase">{career.driverName}</h1>
                  </div>
                  {a ? (
                    <p className="text-sm text-[#FFFFFF] mt-1">
                      Age {a.age} · peak until {a.primeEnd}
                      {' · '}
                      {a.isFreeAgent ? <span className="italic">Free Agent</span> : <TeamLink id={a.teamId}>{a.teamName}</TeamLink>}
                      {!a.isFreeAgent && <span> · contract until {a.contractExpiresAfterSeason}</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-[#FFFFFF] mt-1 italic">Retired / historical driver</p>
                  )}
                </div>
                {a && (
                  <div className="flex items-center gap-5">
                    <OverallRing overall={a.overall} />
                    <div className="text-center">
                      <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{a.peakPotential}</p>
                      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Potential</p>
                    </div>
                  </div>
                )}
              </div>

              <TabBar<Tab>
                tabs={[
                  { key: 'overview', label: 'Overview' },
                  { key: 'development', label: 'Development' },
                  { key: 'results', label: 'Results' },
                  { key: 'h2h', label: 'Head-to-Head' },
                ]}
                active={tab}
                onChange={setTab}
              />

              {tab === 'overview' && (
                <div className="space-y-5">
                  {/* Career totals */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                    <StatTile label="Titles" value={career.totals.titles} />
                    <StatTile label="Wins" value={career.totals.wins} />
                    <StatTile label="Podiums" value={career.totals.podiums} />
                    <StatTile label="Poles" value={career.totals.poles} />
                    <StatTile label="Points" value={career.totals.points} />
                    <StatTile label="Seasons" value={career.totals.seasons} />
                  </div>

                  <div className="grid gap-5 lg:grid-cols-3">
                    {/* Attributes */}
                    {a && (
                      <Panel className="lg:col-span-1">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Attributes</p>
                          {liveDriver && (
                            <button
                              onClick={() => setEditing((v) => !v)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
                            >
                              {editing ? <Check size={13} /> : <Pencil size={13} />}
                              {editing ? 'Done' : 'God mode'}
                            </button>
                          )}
                        </div>

                        {editing && liveDriver ? (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-[#FFFFFF] block mb-1">Name</label>
                                <input type="text" value={liveDriver.name} onChange={(e) => updateDriver(id, { name: e.target.value })} className={inputClass} />
                              </div>
                              <div>
                                <label className="text-xs text-[#FFFFFF] block mb-1">Nationality</label>
                                <CountrySelect value={liveDriver.nationality} onChange={(code) => updateDriver(id, { nationality: code })} />
                              </div>
                              <div>
                                <label className="text-xs text-[#FFFFFF] block mb-1">Age</label>
                                <input type="number" min={16} max={60} value={liveDriver.age} onChange={(e) => updateDriver(id, { age: Number(e.target.value) })} className={inputClass} />
                              </div>
                              <div>
                                <label className="text-xs text-[#FFFFFF] block mb-1">Potential</label>
                                <input type="number" min={0} max={100} value={liveDriver.peakPotential} onChange={(e) => updateDriver(id, { peakPotential: Number(e.target.value) })} className={inputClass} />
                              </div>
                              <div>
                                <label className="text-xs text-[#FFFFFF] block mb-1">Peak age</label>
                                <input type="number" min={20} max={45} value={liveDriver.primeEnd} onChange={(e) => updateDriver(id, { primeEnd: Number(e.target.value) })} className={inputClass} />
                              </div>
                              <div>
                                <label className="text-xs text-[#FFFFFF] block mb-1">Contract until</label>
                                <input type="number" value={liveDriver.contractExpiresAfterSeason} onChange={(e) => updateDriver(id, { contractExpiresAfterSeason: Number(e.target.value) })} className={inputClass} />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-[#FFFFFF] block mb-1">Photo URL (override)</label>
                              <input type="text" placeholder="https://… (blank = generated avatar)" value={liveDriver.photoUrl ?? ''} onChange={(e) => updateDriver(id, { photoUrl: e.target.value || undefined })} className={inputClass} />
                            </div>
                            <div className="space-y-2.5">
                              {STAT_KEYS.map((k) => (
                                <StatSlider key={k} label={STAT_LABELS[k]} value={liveDriver[k]} onChange={(v) => updateDriver(id, { [k]: v })} />
                              ))}
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-[#FFFFFF] w-20 shrink-0">Narrative</span>
                                <input
                                  type="range" min={-20} max={20} value={liveDriver.narrativeModifier}
                                  onChange={(e) => updateDriver(id, { narrativeModifier: Number(e.target.value) })}
                                  className="flex-1 h-1 cursor-pointer" style={{ accentColor: '#A855F7' }}
                                />
                                <span className={`text-sm font-semibold w-8 text-right shrink-0 ${liveDriver.narrativeModifier > 0 ? 'text-[#10B981]' : liveDriver.narrativeModifier < 0 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}`}>
                                  {liveDriver.narrativeModifier > 0 ? '+' : ''}{liveDriver.narrativeModifier}
                                </span>
                              </div>
                            </div>

                            {/* God-mode contract & seat overrides */}
                            <div className="pt-3 border-t border-[#2A3142] space-y-2">
                              <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Contract &amp; seat</p>
                              {liveDriver.teamId !== '' ? (
                                <div className="flex gap-2 flex-wrap">
                                  <button onClick={() => extendContract(id, 1)} className="px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold text-[#FFFFFF] hover:bg-[#303848] transition-colors">Extend +1 season</button>
                                  <button onClick={() => releaseDriver(id)} className="px-3 py-1.5 rounded-lg bg-[#DC143C]/80 text-xs font-semibold text-[#FFFFFF] hover:bg-[#DC143C] transition-colors">Release from contract</button>
                                </div>
                              ) : (
                                <div className="flex gap-2 items-center">
                                  <select value={assignTeam} onChange={(e) => setAssignTeam(e.target.value)} className={inputClass + ' flex-1'}>
                                    <option value="">Assign to a team with an open seat…</option>
                                    {teams.filter((t) => allDrivers.filter((d) => d.teamId === t.id).length < 2).map((t) => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    disabled={!assignTeam}
                                    onClick={() => { if (assignTeam) { assignDriverToTeam(id, assignTeam); setAssignTeam('') } }}
                                    className="px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 transition-colors"
                                  >Sign</button>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <StatBar label="Pace" value={a.pace} />
                            <StatBar label="Wet" value={a.wetWeatherPace} />
                            <StatBar label="Overtaking" value={a.overtaking} />
                            <StatBar label="Smoothness" value={a.smoothness} />
                          </div>
                        )}
                      </Panel>
                    )}

                    {/* Biography */}
                    <Panel title="Biography" className={a ? 'lg:col-span-2' : 'lg:col-span-3'}>
                      <p className="text-sm leading-relaxed text-[#FFFFFF]">
                        {bio ?? 'No biography available for this historical driver.'}
                      </p>
                    </Panel>
                  </div>

                  {/* Recent form + Confidence (reserved, equal footprint) */}
                  <div className="grid gap-5 lg:grid-cols-2">
                    <Panel title={current ? `This Season — ${current.year}` : 'This Season'} flush>
                      {career.currentResults && career.currentResults.length > 0 ? (
                        <>
                          <div className="flex items-center gap-8 px-5 py-3 border-b border-[#2A3142]">
                            <div className="text-center">
                              <p className="text-xl font-bold tabular-nums text-[#FFFFFF]">{current?.championshipFinish != null ? `P${current.championshipFinish}` : '—'}</p>
                              <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Championship</p>
                            </div>
                            <div className="text-center">
                              <p className="text-xl font-bold tabular-nums text-[#FFFFFF]">{current?.points ?? 0}</p>
                              <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Points</p>
                            </div>
                          </div>
                          <div className="px-5 py-4">
                            <div className="flex flex-wrap gap-1.5">
                              {career.currentResults.map((r) => (
                                <Tooltip key={r.round} content={`${r.circuitName} · ${r.points} pts`}>
                                  <Link
                                    href={`/world/season/${current?.year}/${r.round}`}
                                    className="flex shrink-0 flex-col items-center gap-1"
                                  >
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#FFFFFF]">{calendar2026[r.round - 1]?.code ?? String(r.round).padStart(2, '0')}</span>
                                    <ResultChip position={r.finishPosition} />
                                  </Link>
                                </Tooltip>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="px-5 py-4 text-sm text-[#FFFFFF]">Not racing this season.</p>
                      )}
                    </Panel>

                    {/* Confidence — planned mechanic; the slot is reserved at full size. */}
                    <Panel title="Confidence" flush>
                      <div className="flex items-center gap-8 px-5 py-3 border-b border-[#2A3142]">
                        <div className="text-center">
                          <p className="text-xl font-bold tabular-nums text-[#6B7280]">—</p>
                          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Morale</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold tabular-nums text-[#6B7280]">—</p>
                          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Form</p>
                        </div>
                      </div>
                      <div className="px-5 py-4 flex items-center gap-2 text-sm text-[#FFFFFF]">
                        <Lock size={14} className="text-[#6B7280]" />
                        Driver confidence is coming in a future update.
                      </div>
                    </Panel>
                  </div>

                  {milestones.length > 0 && (
                    <Panel title="Recent milestones" flush>
                      <MilestonesTimeline events={milestones.slice(-5).reverse()} />
                    </Panel>
                  )}

                  <HonoursPanel feats={honours} loading={honoursLoading} />
                </div>
              )}

              {tab === 'development' && (
                <div className="space-y-5">
                  <Panel title="Ratings progression" flush>
                    <RatingsProgressionChart history={career.ratingsHistory} />
                  </Panel>
                  <Panel title="Career milestones" flush>
                    <MilestonesTimeline events={[...milestones].reverse()} />
                  </Panel>
                </div>
              )}

              {tab === 'results' && (
                <div className="space-y-5">
                  {/* Career stats — basics */}
                  <Panel title="Career stats" flush>
                    {career.seasons.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-[#FFFFFF]">No seasons yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                              <th className="text-left py-2 px-4 font-medium">Year</th>
                              <th className="text-left py-2 px-3 font-medium">Team</th>
                              <th className="text-right py-2 px-3 font-medium">Races</th>
                              <th className="text-right py-2 px-3 font-medium">Wins</th>
                              <th className="text-right py-2 px-3 font-medium">Podiums</th>
                              <th className="text-right py-2 px-3 font-medium">Poles</th>
                              <th className="text-center py-2 px-3 font-medium">WDC</th>
                              <th className="text-right py-2 px-4 font-medium">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {career.seasons.map((s) => (
                              <tr key={`${s.year}-${s.teamId}`} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                                <td className="py-2 px-4 tabular-nums whitespace-nowrap">
                                  <Link href={`/world/driver/${id}/${s.year}`} className="text-[#FFFFFF] hover:text-[#00D9FF] font-medium">{s.year}</Link>
                                  {s.inProgress && <span className="ml-1.5 text-[10px] text-[#00D9FF]">LIVE</span>}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap"><TeamLink id={s.teamId} className="text-[#FFFFFF]">{s.teamName}</TeamLink></td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.races}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.wins}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.podiums}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.poles}</td>
                                <td className="py-2 px-3"><span className="flex justify-center"><ChampPill position={s.championshipFinish} /></span></td>
                                <td className="py-2 px-4 text-right tabular-nums font-semibold text-[#FFFFFF]">{s.points}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>

                  {/* Complete results — per-round matrix */}
                  <Panel title="Complete results" flush>
                    {career.seasons.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-[#FFFFFF]">No seasons yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                              <th className="text-left py-2 px-4 font-medium sticky left-0 bg-[#1E2431]">Year</th>
                              <th className="text-left py-2 px-3 font-medium">Team</th>
                              {Array.from({ length: calendar2026.length }, (_, i) => (
                                <th key={i} className="text-center py-2 px-0.5 w-9 text-[10px] tabular-nums font-medium">{calendar2026[i]?.code ?? i + 1}</th>
                              ))}
                              <th className="text-center py-2 px-3 font-medium">WDC</th>
                              <th className="text-right py-2 px-4 font-medium">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {career.seasons.map((s) => (
                              <tr key={`${s.year}-${s.teamId}`} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                                <td className="py-2 px-4 tabular-nums whitespace-nowrap sticky left-0 bg-[#1E2431]">
                                  <Link href={`/world/driver/${id}/${s.year}`} className="text-[#FFFFFF] hover:text-[#00D9FF] font-medium">{s.year}</Link>
                                  {s.inProgress && <span className="ml-1.5 text-[10px] text-[#00D9FF]">LIVE</span>}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap"><TeamLink id={s.teamId} className="text-[#FFFFFF]">{s.teamName}</TeamLink></td>
                                {Array.from({ length: calendar2026.length }, (_, i) => (
                                  <ResultCell key={i} position={i < s.results.length ? s.results[i] : undefined} />
                                ))}
                                <td className="py-2 px-3"><span className="flex justify-center"><ChampPill position={s.championshipFinish} /></span></td>
                                <td className="py-2 px-4 text-right tabular-nums font-semibold text-[#FFFFFF]">{s.points}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                </div>
              )}

              {tab === 'h2h' && (
                <Panel title="Teammate head-to-head" flush>
                  <TeammateH2HHistory records={career.teammateH2H} driverName={career.driverName} />
                </Panel>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
