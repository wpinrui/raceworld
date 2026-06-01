'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Download, Plus, Trash2, ChevronRight, RotateCcw } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import type { Driver, Team } from '@/lib/sim/types'

const STAT_KEYS = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const
type StatKey = (typeof STAT_KEYS)[number]

const STAT_LABELS: Record<StatKey, string> = {
  pace: 'Pace',
  wetWeatherPace: 'Wet',
  overtaking: 'OVT',
  smoothness: 'SMO',
}

function makeDefaultDriver(teams: Team[]): Driver {
  return {
    id: `driver-${Date.now()}`,
    name: 'New Driver',
    teamId: teams[0]?.id ?? '',
    pace: 70,
    wetWeatherPace: 70,
    overtaking: 70,
    smoothness: 70,
    age: 25,
    peakPotential: 80,
    primeEnd: 32,
    narrativeModifier: 0,
    contractExpiresAfterSeason: 2026,
  }
}

function StatSlider({
  label,
  value,
  accentColor = '#00D9FF',
  onChange,
}: {
  label: string
  value: number
  accentColor?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-[#6B7280] w-7 uppercase">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 cursor-pointer"
        style={{ accentColor }}
      />
      <span className="text-[11px] font-mono text-[#E8EAED] w-6 text-right">{value}</span>
    </div>
  )
}

export default function SetupPage() {
  const router = useRouter()
  const seasonStore = useSeasonStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [localDrivers, setLocalDrivers] = useState<Driver[]>([])
  const [localTeams, setLocalTeams] = useState<Team[]>([])
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    if (seasonStore.phase !== 'idle') {
      router.replace('/race')
      return
    }
    setLocalDrivers(seasonStore.drivers.map((d) => ({ ...d })))
    setLocalTeams(seasonStore.teams.map((t) => ({ ...t })))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handlePrePopulate() {
    setLocalDrivers(drivers2026.map((d) => ({ ...d })))
    setLocalTeams(teams2026.map((t) => ({ ...t })))
    setExpandedDriver(null)
    setImportError(null)
  }

  function handleExport() {
    const data = JSON.stringify({ drivers: localDrivers, teams: localTeams }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `raceworld-grid-${seasonStore.year}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null)
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        if (!Array.isArray(parsed.drivers) || !Array.isArray(parsed.teams)) {
          throw new Error('JSON must have "drivers" and "teams" arrays')
        }
        setLocalDrivers(parsed.drivers as Driver[])
        setLocalTeams(parsed.teams as Team[])
        setExpandedDriver(null)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Invalid JSON file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function updateDriver(id: string, patch: Partial<Driver>) {
    setLocalDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function addDriver() {
    const d = makeDefaultDriver(localTeams)
    setLocalDrivers((prev) => [...prev, d])
    setExpandedDriver(d.id)
  }

  function removeDriver(id: string) {
    setLocalDrivers((prev) => {
      const filtered = prev.filter((d) => d.id !== id)
      return filtered.length > 0 ? filtered : prev
    })
    if (expandedDriver === id) setExpandedDriver(null)
  }

  function handleStartSeason() {
    seasonStore.initSeason(localDrivers, localTeams, seasonStore.year)
    router.push('/race')
  }

  const driversByTeam = localTeams.map((team) => ({
    team,
    drivers: localDrivers.filter((d) => d.teamId === team.id),
  }))

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#E8EAED]">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-1 h-6 rounded-sm bg-[#DC143C]" />
              <h1 className="font-display text-2xl tracking-wider uppercase">Setup</h1>
            </div>
            <p className="text-[#A0A9B8] text-sm ml-3.5">
              Configure the {seasonStore.year} grid before starting the season
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={handlePrePopulate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#A0A9B8] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors"
            >
              <RotateCcw size={13} />
              Pre-populate 2026
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#A0A9B8] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors"
            >
              <Upload size={13} />
              Import JSON
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#A0A9B8] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors"
            >
              <Download size={13} />
              Export JSON
            </button>
            <button
              onClick={handleStartSeason}
              disabled={localDrivers.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start Season {seasonStore.year}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {importError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-[#3A1A1A] text-[#F87171] text-sm">
            Import error: {importError}
          </div>
        )}

        {/* Teams + Drivers */}
        <div className="space-y-6">
          {driversByTeam.map(({ team, drivers: teamDrivers }) => (
            <div key={team.id} className="rounded-xl bg-[#1E2431] p-4">
              {/* Team header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1.5 h-8 rounded-sm" style={{ backgroundColor: team.color }} />
                <div>
                  <div className="font-semibold text-[#E8EAED]">{team.name}</div>
                  <div className="text-xs text-[#6B7280]">
                    Car pace:{' '}
                    <span className="font-mono text-[#A0A9B8]">{team.carPace}</span>
                  </div>
                </div>
                <span
                  className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{ backgroundColor: team.color + '22', color: team.color }}
                >
                  {team.shortName}
                </span>
              </div>

              {/* Drivers */}
              <div className="space-y-2">
                {teamDrivers.map((driver) => {
                  const expanded = expandedDriver === driver.id
                  return (
                    <div key={driver.id} className="rounded-lg bg-[#2A3142]">
                      <div
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#303848] rounded-lg transition-colors"
                        onClick={() => setExpandedDriver(expanded ? null : driver.id)}
                      >
                        <span className="text-sm font-semibold text-[#E8EAED] flex-1 truncate">{driver.name}</span>
                        <div className="flex items-center gap-3 text-xs font-mono text-[#A0A9B8]">
                          {STAT_KEYS.map((k) => (
                            <span key={k} className="hidden sm:inline">
                              <span className="text-[#6B7280] mr-0.5">{STAT_LABELS[k]} </span>
                              {driver[k]}
                            </span>
                          ))}
                          <span className="text-[#6B7280]">Age {driver.age}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeDriver(driver.id)
                          }}
                          className="p-1 rounded text-[#6B7280] hover:text-[#F87171] hover:bg-[#3A1A1A] transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {expanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-[#303848] pt-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div>
                                <label className="text-[10px] text-[#6B7280] uppercase tracking-wider">Name</label>
                                <input
                                  type="text"
                                  value={driver.name}
                                  onChange={(e) => updateDriver(driver.id, { name: e.target.value })}
                                  className="w-full mt-1 px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-[#6B7280] uppercase tracking-wider">Team</label>
                                <select
                                  value={driver.teamId}
                                  onChange={(e) => updateDriver(driver.id, { teamId: e.target.value })}
                                  className="w-full mt-1 px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                                >
                                  {localTeams.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex gap-2">
                                {(['age', 'peakPotential', 'primeEnd'] as const).map((field) => (
                                  <div key={field} className="flex-1">
                                    <label className="text-[10px] text-[#6B7280] uppercase tracking-wider">
                                      {field === 'age' ? 'Age' : field === 'peakPotential' ? 'Potential' : 'Prime End'}
                                    </label>
                                    <input
                                      type="number"
                                      min={field === 'age' || field === 'primeEnd' ? 16 : 0}
                                      max={field === 'age' || field === 'primeEnd' ? 60 : 100}
                                      value={driver[field]}
                                      onChange={(e) => updateDriver(driver.id, { [field]: Number(e.target.value) })}
                                      className="w-full mt-1 px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2.5">
                              {STAT_KEYS.map((k) => (
                                <StatSlider
                                  key={k}
                                  label={STAT_LABELS[k]}
                                  value={driver[k]}
                                  onChange={(v) => updateDriver(driver.id, { [k]: v })}
                                />
                              ))}
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-[#6B7280] w-7 uppercase">NRT</span>
                                <input
                                  type="range"
                                  min={-20}
                                  max={20}
                                  value={driver.narrativeModifier}
                                  onChange={(e) =>
                                    updateDriver(driver.id, { narrativeModifier: Number(e.target.value) })
                                  }
                                  className="flex-1 h-1 cursor-pointer"
                                  style={{ accentColor: '#A855F7' }}
                                />
                                <span
                                  className={`text-[11px] font-mono w-7 text-right ${
                                    driver.narrativeModifier > 0
                                      ? 'text-[#10B981]'
                                      : driver.narrativeModifier < 0
                                      ? 'text-[#DC143C]'
                                      : 'text-[#6B7280]'
                                  }`}
                                >
                                  {driver.narrativeModifier > 0 ? '+' : ''}
                                  {driver.narrativeModifier}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                <button
                  onClick={addDriver}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-[#303848] text-[#6B7280] hover:border-[#00D9FF] hover:text-[#00D9FF] text-xs font-semibold uppercase tracking-wide transition-colors"
                >
                  <Plus size={13} />
                  Add Driver
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleStartSeason}
            disabled={localDrivers.length === 0}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-sm uppercase tracking-wide hover:bg-[#009CB8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Season {seasonStore.year}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
