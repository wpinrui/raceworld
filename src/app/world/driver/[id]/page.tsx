'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Pencil, Check } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import { useDriverCareer } from '@/lib/world/hooks'
import { useSeasonStore } from '@/lib/store/season-store'
import { OverallRing } from '@/components/setup/OverallRing'
import { StatBar } from '@/components/setup/StatBar'
import { StatSlider } from '@/components/setup/StatSlider'
import { STAT_KEYS, STAT_LABELS } from '@/components/setup/stat-utils'
import { ResultChip } from '@/components/standings/ResultCell'
import { TeamLink } from '@/components/world/EntityLink'

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3 text-center">
      <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">{label}</p>
    </div>
  )
}

export default function DriverPage() {
  const { id } = useParams<{ id: string }>()
  const { career, loading } = useDriverCareer(id)
  const updateDriver = useSeasonStore((s) => s.updateDriver)
  const liveDriver = useSeasonStore((s) => s.drivers.find((d) => d.id === id))
  const [editing, setEditing] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  const inputClass = 'w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none'

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {loading && <p className="text-sm text-[#FFFFFF] animate-pulse">Loading…</p>}
        {!loading && !career && (
          <p className="text-sm text-[#FFFFFF]">Driver not found.</p>
        )}

        {career && (() => {
          const a = career.attributes
          return (
            <>
              {/* Header */}
              <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 flex items-center gap-5 flex-wrap">
                {a && <OverallRing overall={a.overall} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    {a && <ReactCountryFlag countryCode={a.nationality || 'GB'} svg style={{ width: '1.4em', height: '1.4em', borderRadius: '2px' }} />}
                    <h1 className="font-display text-2xl tracking-wider uppercase">{career.driverName}</h1>
                  </div>
                  {a && (
                    <p className="text-sm text-[#FFFFFF] mt-1">
                      Age {a.age} ·{' '}
                      {a.isFreeAgent ? <span className="italic">Free Agent</span> : <TeamLink id={a.teamId}>{a.teamName}</TeamLink>}
                      {!a.isFreeAgent && <span> · contract until {a.contractExpiresAfterSeason}</span>}
                    </p>
                  )}
                </div>
              </div>

              {/* Attributes */}
              {a && (
                <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Attributes</p>
                    {liveDriver && (
                      <button
                        onClick={() => setEditing((v) => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
                      >
                        {editing ? <Check size={13} /> : <Pencil size={13} />}
                        {editing ? 'Done' : 'God mode: edit'}
                      </button>
                    )}
                  </div>

                  {editing && liveDriver ? (
                    <div className="space-y-4 max-w-md">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-[#FFFFFF] block mb-1">Name</label>
                          <input type="text" value={liveDriver.name} onChange={(e) => updateDriver(id, { name: e.target.value })} className={inputClass} />
                        </div>
                        <div>
                          <label className="text-xs text-[#FFFFFF] block mb-1">Nationality</label>
                          <input type="text" maxLength={2} value={liveDriver.nationality} onChange={(e) => updateDriver(id, { nationality: e.target.value.toUpperCase() })} className={`${inputClass} uppercase`} />
                        </div>
                        <div>
                          <label className="text-xs text-[#FFFFFF] block mb-1">Age</label>
                          <input type="number" min={16} max={60} value={liveDriver.age} onChange={(e) => updateDriver(id, { age: Number(e.target.value) })} className={inputClass} />
                        </div>
                      </div>
                      <div className="space-y-2.5">
                        {STAT_KEYS.map((k) => (
                          <StatSlider key={k} label={STAT_LABELS[k]} value={liveDriver[k]} onChange={(v) => updateDriver(id, { [k]: v })} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 max-w-md">
                      <StatBar label="Pace" value={a.pace} />
                      <StatBar label="Wet" value={a.wetWeatherPace} />
                      <StatBar label="Overtaking" value={a.overtaking} />
                      <StatBar label="Smoothness" value={a.smoothness} />
                    </div>
                  )}
                </div>
              )}

              {/* Honours / totals */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                <StatTile label="Titles" value={career.totals.titles} />
                <StatTile label="Wins" value={career.totals.wins} />
                <StatTile label="Podiums" value={career.totals.podiums} />
                <StatTile label="Poles" value={career.totals.poles} />
                <StatTile label="Points" value={career.totals.points} />
                <StatTile label="Seasons" value={career.totals.seasons} />
              </div>

              {/* Career history */}
              <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
                <p className="px-5 py-3 text-[10px] uppercase tracking-widest text-[#FFFFFF] border-b border-[#2A3142]">Career</p>
                {career.seasons.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-[#FFFFFF]">No completed seasons yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                          <th className="text-left py-2 px-4 font-medium">Season</th>
                          <th className="text-left py-2 px-3 font-medium">Team</th>
                          <th className="text-right py-2 px-3 font-medium">Races</th>
                          <th className="text-right py-2 px-3 font-medium">Wins</th>
                          <th className="text-right py-2 px-3 font-medium">Podiums</th>
                          <th className="text-right py-2 px-3 font-medium">Points</th>
                          <th className="text-right py-2 px-4 font-medium">Champ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {career.seasons.map((s) => (
                          <tr key={`${s.year}-${s.teamId}`} className="border-b border-[#2A3142]/50">
                            <td className="py-2 px-4 tabular-nums text-[#FFFFFF]">
                              {s.year}{s.inProgress && <span className="ml-1.5 text-[10px] text-[#00D9FF]">LIVE</span>}
                            </td>
                            <td className="py-2 px-3"><TeamLink id={s.teamId} className="text-[#FFFFFF]">{s.teamName}</TeamLink></td>
                            <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.races}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.wins}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.podiums}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{s.points}</td>
                            <td className="py-2 px-4 text-right tabular-nums text-[#FFFFFF]">{s.championshipFinish != null ? `P${s.championshipFinish}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Current-season results */}
              {career.currentResults && career.currentResults.length > 0 && (
                <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
                  <p className="px-5 py-3 text-[10px] uppercase tracking-widest text-[#FFFFFF] border-b border-[#2A3142]">This Season</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
                          <th className="text-left py-2 px-4 font-medium">Rd</th>
                          <th className="text-left py-2 px-3 font-medium">Grand Prix</th>
                          <th className="text-center py-2 px-3 font-medium">Result</th>
                          <th className="text-right py-2 px-4 font-medium">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {career.currentResults.map((r) => (
                          <tr key={r.round} className="border-b border-[#2A3142]/50">
                            <td className="py-1.5 px-4 tabular-nums text-[#FFFFFF]">{r.round}</td>
                            <td className="py-1.5 px-3 text-[#FFFFFF]">{r.circuitName}</td>
                            <td className="py-1.5 px-3"><span className="flex justify-center"><ResultChip position={r.finishPosition} /></span></td>
                            <td className="py-1.5 px-4 text-right tabular-nums text-[#FFFFFF]">{r.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
