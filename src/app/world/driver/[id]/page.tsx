'use client'

import { useEffect, useState } from 'react'
import { useRetainedState } from '@/lib/ui/retained-state'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Pencil, Check } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import { useDriverCareer, useEntityHonours, useDriverSeason } from '@/lib/world/hooks'
import { useSeasonStore } from '@/lib/store/season-store'
import { HonoursPanel } from '@/components/world/HonoursPanel'
import { StatBar } from '@/components/setup/StatBar'
import { StatSlider } from '@/components/setup/StatSlider'
import { STAT_KEYS, STAT_LABELS } from '@/components/setup/stat-utils'
import { ResultChip, ResultCell } from '@/components/standings/ResultCell'
import { calendar2026 } from '@/data/calendar'
import { TeamLink } from '@/components/world/EntityLink'
import { CountrySelect } from '@/components/CountrySelect'
import { ChampPill } from '@/components/world/pills'
import { Panel, TabBar } from '@/components/world/ui'
import { Tooltip } from '@/components/ui/Tooltip'
import { DriverAvatar } from '@/components/world/DriverAvatar'
import { RatingsProgressionChart } from '@/components/world/RatingsProgressionChart'
import { MilestonesTimeline } from '@/components/world/MilestonesTimeline'
import { TeammateH2HHistory } from '@/components/world/TeammateH2HHistory'
import { CareerStatsTable } from '@/components/world/CareerStatsTable'
import { RecentFormCard } from '@/components/world/RecentFormCard'
import { SeasonFormChart } from '@/components/world/SeasonFormChart'
import { buildDriverBio } from '@/lib/world/bio'
import { buildMilestones } from '@/lib/world/milestones'
import { overall } from '@/lib/sim/progression'

type Tab = 'overview' | 'development' | 'results' | 'milestones' | 'form' | 'h2h'

// Compact white stat for the header band (replaces the per-page rating ring). `tier`
// drives visual hierarchy: 1 = headline ratings, 2 = marquee achievements, 3 = volume.
function HeaderStat({ label, value, tier = 3 }: { label: string; value: number; tier?: 1 | 2 | 3 }) {
  const size = tier === 1 ? 'text-4xl' : tier === 2 ? 'text-2xl' : 'text-lg'
  return (
    <div className="text-center">
      <p className={`${size} font-bold tabular-nums leading-none text-[#FFFFFF]`}>{value.toLocaleString()}</p>
      <p className={`${tier === 3 ? 'text-[9px]' : 'text-[10px]'} uppercase tracking-widest text-[#FFFFFF] mt-1`}>{label}</p>
    </div>
  )
}

// Confidence (0-10) -> a one-word morale band for the at-a-glance label.
function moraleBand(c: number): string {
  if (c >= 8.5) return 'Soaring'
  if (c >= 6.5) return 'Assured'
  if (c >= 4.5) return 'Steady'
  if (c >= 2.5) return 'Fragile'
  return 'Shaken'
}

// Signed confidence streak -> a terse direction line. |streak| = consecutive same-direction
// races; sign = over (rising) / under (declining). 0 = no streak yet.
function confidenceTrend(streak: number): string {
  const n = Math.abs(streak)
  if (n === 0) return 'Holding steady.'
  const races = n === 1 ? 'race' : 'races'
  return streak > 0 ? `${n} ${races} on the rise.` : `${n} ${races} in decline.`
}

// Photo URL override with a live preview, so a link the browser cannot load as an image
// (hotlink-protected pages, search-result URLs, non-direct links) is obvious here rather than
// silently falling back to the generated avatar on the page.
function PhotoField({ value, onChange, inputClass }: { value: string | undefined; onChange: (v: string | undefined) => void; inputClass: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div>
      <label className="text-xs text-[#FFFFFF] block mb-1">Photo URL (override)</label>
      <input
        type="text"
        placeholder="https://… direct image link (blank = generated avatar)"
        value={value ?? ''}
        onChange={(e) => { setFailed(false); onChange(e.target.value || undefined) }}
        className={inputClass}
      />
      {value ? (
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="preview"
            width={44}
            height={44}
            onError={() => setFailed(true)}
            onLoad={() => setFailed(false)}
            className="rounded-lg object-cover bg-[#2A3142] border border-[#303848]"
            style={{ width: 44, height: 44 }}
          />
          <span className={`text-xs ${failed ? 'text-[#DC143C]' : 'text-[#10B981]'}`}>
            {failed ? 'Could not load. Use a direct image link (ending in .jpg or .png).' : 'Image loaded.'}
          </span>
        </div>
      ) : null}
    </div>
  )
}

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
  const [tab, setTab] = useRetainedState<Tab>(`driver:${id}:tab`, 'overview')
  // Results tab accordion: which sections are expanded (an open section fills + scrolls internally).
  const [openCareerStats, setOpenCareerStats] = useState(true)
  const [openResults, setOpenResults] = useState(true)
  const [editing, setEditing] = useState(false)
  // Form tab: which season's full-season form to show. Defaults to the driver's most recent season;
  // useDriverSeason transparently builds the live season from the store and fetches archived ones.
  const [formYear, setFormYear] = useRetainedState<number | null>(`driver:${id}:formYear`, null)
  const careerYears = career ? [...new Set(career.seasons.map((s) => s.year))].sort((x, y) => y - x) : []
  const effectiveFormYear = formYear ?? careerYears[0] ?? seasonYear
  const { detail: formDetail, loading: formLoading } = useDriverSeason(id, effectiveFormYear)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  const inputClass = 'w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none'

  return (
    <div className="h-full overflow-hidden bg-[#0F1419] text-[#FFFFFF] flex flex-col">
      <div className="px-4 py-4 flex flex-col flex-1 min-h-0 gap-4">
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
          // Rank the driver's team by car pace to label it front-running / midfield / backmarker.
          const teamStrength = (() => {
            if (!a || a.isFreeAgent || teams.length === 0) return null
            const ranked = [...teams].sort((x, y) => y.carPace - x.carPace)
            const rank = ranked.findIndex((t) => t.id === a.teamId)
            if (rank < 0) return null
            const third = ranked.length / 3
            return rank < third ? 'front-running' : rank < third * 2 ? 'midfield' : 'backmarker'
          })()
          // Stats where this driver ranks top 5 on the current grid — surfaced as
          // "known for his ..." in the bio.
          const knownFor = (() => {
            if (!a || a.isFreeAgent) return [] as string[]
            const grid = allDrivers.filter((d) => d.teamId !== '')
            const defs = [
              { key: 'pace' as const, label: 'pace', v: a.pace },
              { key: 'overtaking' as const, label: 'overtaking', v: a.overtaking },
              { key: 'wetWeatherPace' as const, label: 'wet-weather pace', v: a.wetWeatherPace },
              { key: 'smoothness' as const, label: 'tyre management', v: a.smoothness },
            ]
            return defs
              .filter((d) => grid.filter((g) => g[d.key] > d.v).length < 5)
              .sort((x, y) => y.v - x.v)
              .map((d) => d.label)
          })()
          // Rank on the grid by overall: top 5 are superstars, next 5 are stars.
          const overallRank = (() => {
            if (!a || a.isFreeAgent) return null
            const grid = allDrivers.filter((d) => d.teamId !== '')
            return grid.filter((g) => Math.round(overall(g)) > a.overall).length
          })()
          const bio = a ? buildDriverBio(career, a, seasonYear, teamStrength, knownFor, overallRank) : null
          const milestones = buildMilestones(career)

          return (
            <>
              {/* Header band — identity on the left, career totals + ratings filling the width */}
              <div className="shrink-0 rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center gap-6 flex-wrap">
                <DriverAvatar driver={avatarDriver} teamColor={teamColor} size={88} className="border-2" />
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <ReactCountryFlag countryCode={(a?.nationality) || 'GB'} svg style={{ width: '1.4em', height: '1.4em', borderRadius: '2px' }} />
                    <h1 className="font-display text-2xl tracking-wider uppercase">{career.driverName}</h1>
                  </div>
                  {a ? (
                    <p className="text-sm text-[#FFFFFF] mt-1">
                      Age {a.age}
                      {' · '}
                      {a.isFreeAgent ? <span className="italic">Free Agent</span> : <TeamLink id={a.teamId}>{a.teamName}</TeamLink>}
                      {!a.isFreeAgent && <span> · contract until {a.contractExpiresAfterSeason}</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-[#FFFFFF] mt-1 italic">Retired / historical driver</p>
                  )}
                </div>
                <div className="flex-1 flex items-end justify-end gap-x-7 gap-y-3 flex-wrap">
                  <HeaderStat label="Races" value={career.totals.races} tier={3} />
                  <HeaderStat label="Titles" value={career.totals.titles} tier={3} />
                  <HeaderStat label="Wins" value={career.totals.wins} tier={3} />
                  <HeaderStat label="Podiums" value={career.totals.podiums} tier={3} />
                  <HeaderStat label="Poles" value={career.totals.poles} tier={3} />
                  <HeaderStat label="Points" value={career.totals.points} tier={3} />
                  <HeaderStat label="Seasons" value={career.totals.seasons} tier={3} />
                  {a && (
                    <>
                      <span className="w-px h-10 bg-[#2A3142]" />
                      <HeaderStat label="Overall" value={a.overall} tier={1} />
                      <HeaderStat label="Potential" value={a.peakPotential} tier={1} />
                    </>
                  )}
                </div>
              </div>

              <div className="shrink-0">
                <TabBar<Tab>
                  tabs={[
                    { key: 'overview', label: 'Overview' },
                    { key: 'development', label: 'Development' },
                    { key: 'results', label: 'Results' },
                    { key: 'milestones', label: 'Milestones' },
                    { key: 'form', label: 'Form' },
                    { key: 'h2h', label: 'Head-to-Head' },
                  ]}
                  active={tab}
                  onChange={setTab}
                />
              </div>

              {tab === 'overview' && (
                <div className="grid gap-4 lg:grid-cols-12 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:grid-rows-3">
                  {/* Attributes */}
                  {a && (
                      <Panel fill className="lg:col-span-4">
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
                            <PhotoField value={liveDriver.photoUrl} onChange={(v) => updateDriver(id, { photoUrl: v })} inputClass={inputClass} />
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
                            <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#2A3142] text-xs text-[#FFFFFF]">
                              <span className="uppercase tracking-widest text-[10px]">Peak age</span>
                              <span className="font-semibold tabular-nums">{a.primeEnd}</span>
                            </div>
                          </div>
                        )}
                      </Panel>
                    )}

                  {/* Current season results */}
                  {a && (
                    <Panel title={current ? `Current season results — ${current.year}` : 'Current season results'} flush fill className="lg:col-span-4">
                      {career.currentResults && career.currentResults.length > 0 ? (
                        <>
                          <div className="flex items-center gap-6 px-4 py-2.5 border-b border-[#2A3142]">
                            <div className="text-center">
                              <p className="text-lg font-bold tabular-nums text-[#FFFFFF]">{current?.championshipFinish != null ? `P${current.championshipFinish}` : '—'}</p>
                              <p className="text-[9px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Championship</p>
                            </div>
                            <div className="text-center">
                              <p className="text-lg font-bold tabular-nums text-[#FFFFFF]">{current?.points ?? 0}</p>
                              <p className="text-[9px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Points</p>
                            </div>
                          </div>
                          <div className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {career.currentResults.map((r) => (
                                <Tooltip key={r.round} content={`${r.circuitName} · ${r.points} pts`}>
                                  <Link
                                    href={`/world/season/${current?.year}/${r.round}`}
                                    className="flex shrink-0 flex-col items-center gap-1"
                                  >
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#FFFFFF]">{calendar2026[r.round - 1]?.code ?? String(r.round).padStart(2, '0')}</span>
                                    <ResultChip position={r.finishPosition} year={current?.year ?? 2026} />
                                  </Link>
                                </Tooltip>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="px-4 py-3 text-sm text-[#FFFFFF]">{a.isFreeAgent ? 'Not racing this season.' : 'No races completed yet this season.'}</p>
                      )}
                    </Panel>
                  )}

                  {/* Confidence — morale rating biasing race form, vs the teammate each round (#58). */}
                  {a && (() => {
                    const conf = liveDriver?.confidence ?? 5
                    const streak = liveDriver?.confidenceStreak ?? 0
                    return (
                      <Panel title="Confidence" flush fill className="lg:col-span-4">
                        <div className="flex items-center gap-6 px-4 py-2.5 border-b border-[#2A3142]">
                          <div className="text-center">
                            <p className="text-lg font-bold tabular-nums text-[#FFFFFF]">{conf.toFixed(1)}</p>
                            <p className="text-[9px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Confidence</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-bold text-[#FFFFFF]">{moraleBand(conf)}</p>
                            <p className="text-[9px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">Morale</p>
                          </div>
                        </div>
                        <div className="px-4 py-3 text-sm text-[#FFFFFF]">
                          {confidenceTrend(streak)}
                        </div>
                      </Panel>
                    )
                  })()}

                  {/* Biography */}
                  <Panel title="Biography" fill className="lg:col-span-4">
                    <div className="space-y-2 text-sm leading-relaxed text-[#FFFFFF]">
                      {(bio ?? 'No biography available for this historical driver.').split('\n\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </Panel>

                  {/* Recent milestones (placeholder empty-state keeps the grid cell filled) */}
                  <Panel title="Recent milestones" flush fill className="lg:col-span-4">
                    <MilestonesTimeline events={milestones.slice(-5).reverse()} />
                  </Panel>

                  {/* Recent form — FM-style form line (pre-race form per round) */}
                  {a && (
                    <Panel title="Recent form" flush fill className="lg:col-span-4">
                      <RecentFormCard entries={career.recentForm} />
                    </Panel>
                  )}

                  {/* Career stats — per-season basics (2/3), Feats & Records beside it */}
                  <Panel title="Career stats" flush fill className="lg:col-span-8">
                    <CareerStatsTable seasons={career.seasons} driverId={id} />
                  </Panel>
                  <HonoursPanel feats={honours} loading={honoursLoading} className="lg:col-span-4" columns={1} fill />
                </div>
              )}

              {tab === 'development' && (
                <Panel title="Ratings progression" flush fill className="flex-1 min-h-0">
                  <RatingsProgressionChart history={career.ratingsHistory} />
                </Panel>
              )}

              {tab === 'milestones' && (
                <Panel title="Career milestones" flush fill className="flex-1 min-h-0 overflow-y-auto">
                  <MilestonesTimeline events={[...milestones].reverse()} />
                </Panel>
              )}

              {tab === 'form' && (
                <Panel title="Season form" flush fill className="flex-1 min-h-0 overflow-y-auto">
                  <div className="px-5 pt-3 flex items-center gap-2">
                    <label className="text-xs uppercase tracking-widest text-[#FFFFFF]">Season</label>
                    <select
                      value={effectiveFormYear}
                      onChange={(e) => setFormYear(Number(e.target.value))}
                      className="bg-[#0F1419] border border-[#2A3142] rounded px-2 py-1 text-xs font-semibold text-[#FFFFFF] focus:border-[#00D9FF] outline-none"
                    >
                      {(careerYears.length ? careerYears : [seasonYear]).map((y) => (
                        <option key={y} value={y} className="bg-[#0F1419] text-[#FFFFFF]">{y}{y === seasonYear ? ' (current)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  {formLoading ? (
                    <p className="px-5 py-4 text-sm text-[#FFFFFF] animate-pulse">Loading…</p>
                  ) : formDetail && formDetail.races.length > 0 ? (
                    <SeasonFormChart races={formDetail.races} />
                  ) : (
                    <p className="px-5 py-4 text-sm text-[#FFFFFF]">No race form recorded for this season.</p>
                  )}
                </Panel>
              )}

              {tab === 'results' && (
                <div className="flex flex-col flex-1 min-h-0 gap-2">
                  {([
                    {
                      label: 'Career stats', open: openCareerStats, toggle: () => setOpenCareerStats((v) => !v),
                      content: <CareerStatsTable seasons={career.seasons} driverId={id} />,
                    },
                    {
                      label: 'Complete results', open: openResults, toggle: () => setOpenResults((v) => !v),
                      content: career.seasons.length === 0 ? (
                        <p className="px-5 py-4 text-sm text-[#FFFFFF]">No seasons yet.</p>
                      ) : (
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
                                  <ResultCell key={i} position={i < s.results.length ? s.results[i] : undefined} year={s.year} />
                                ))}
                                <td className="py-2 px-3"><span className="flex justify-center"><ChampPill position={s.championshipFinish} /></span></td>
                                <td className="py-2 px-4 text-right tabular-nums font-semibold text-[#FFFFFF]">{s.points}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ),
                    },
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
                      {s.open && <div className="flex-1 min-h-0 border-t border-[#2A3142] overflow-auto">{s.content}</div>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'h2h' && (
                <Panel title="Teammate head-to-head" flush fill className="flex-1 min-h-0">
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
