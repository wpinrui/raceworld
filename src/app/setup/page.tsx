'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Download, Plus, Trash2, ChevronRight, RotateCcw, ChevronDown } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import { useSeasonStore } from '@/lib/store/season-store'
import { useRaceStore } from '@/lib/store/race-store'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import type { Driver, Team } from '@/lib/sim/types'

const STAT_KEYS = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const
type StatKey = (typeof STAT_KEYS)[number]

const STAT_LABELS: Record<StatKey, string> = {
  pace: 'Pace',
  wetWeatherPace: 'Wet',
  overtaking: 'Overtaking',
  smoothness: 'Smoothness',
}

const DRIVERS_PER_TEAM = 2

const COLOR_LOW = 60   // ≤ this → solid red
const COLOR_HIGH = 90  // ≥ this → solid green
const HUE_RED = 0
const HUE_GREEN = 122

function statColor(value: number): string {
  const clamped = Math.max(0, Math.min(100, value))
  if (clamped <= COLOR_LOW) return `hsl(${HUE_RED}, 90%, 62%)`
  if (clamped >= COLOR_HIGH) return `hsl(${HUE_GREEN}, 72%, 52%)`
  const t = (clamped - COLOR_LOW) / (COLOR_HIGH - COLOR_LOW)
  return `hsl(${Math.round(t * HUE_GREEN)}, 85%, 58%)`
}

function computeOverall(d: Driver): number {
  return Math.round(0.6 * d.pace + 0.2 * d.smoothness + 0.1 * d.overtaking + 0.1 * d.wetWeatherPace)
}

function OverallRing({ overall }: { overall: number }) {
  const size = 44
  const cx = 22
  const cy = 22
  const r = 17
  const sw = 3
  const color = statColor(overall)
  const fraction = Math.min(overall / 100, 0.9999)
  const angle = 2 * Math.PI * fraction
  const sx = cx + r * Math.cos(-Math.PI / 2)
  const sy = cy + r * Math.sin(-Math.PI / 2)
  const ex = cx + r * Math.cos(-Math.PI / 2 + angle)
  const ey = cy + r * Math.sin(-Math.PI / 2 + angle)
  const large = fraction > 0.5 ? 1 : 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2A3142" strokeWidth={sw} />
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold" style={{ color }}>{overall}</span>
      </div>
    </div>
  )
}

function StatBar({ label, value }: { label: string; value: number }) {
  const color = statColor(value)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#FFFFFF] w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[#2A3142] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-sm font-semibold w-8 text-right shrink-0" style={{ color }}>{value}</span>
    </div>
  )
}

function StatSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const color = statColor(value)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#FFFFFF] w-20 shrink-0">{label}</span>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 cursor-pointer"
        style={{ accentColor: color }}
      />
      <span className="text-sm font-semibold w-8 text-right shrink-0" style={{ color }}>{value}</span>
    </div>
  )
}

function makeDefaultDriver(teamId: string): Driver {
  return {
    id: `driver-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'New Driver',
    teamId,
    nationality: 'GB',
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

function ContractBadge({ expiresAfter, currentYear }: { expiresAfter: number; currentYear: number }) {
  const expiring = expiresAfter === currentYear
  const expired = expiresAfter < currentYear
  if (expired) return (
    <span className="text-xs font-semibold uppercase tracking-wide bg-[#DC143C] text-white rounded px-1.5 py-0.5">
      Free Agent
    </span>
  )
  if (expiring) return (
    <span className="text-xs font-semibold uppercase tracking-wide bg-[#FCD34D] text-[#0F1419] rounded px-1.5 py-0.5">
      Expiring
    </span>
  )
  return (
    <span className="text-xs text-[#A0A9B8] tabular-nums">until {expiresAfter}</span>
  )
}

function DriverCard({ driver, teams, onUpdate, onRemove, currentYear }: {
  driver: Driver
  teams: Team[]
  onUpdate: (patch: Partial<Driver>) => void
  onRemove: () => void
  currentYear: number
}) {
  const [expanded, setExpanded] = useState(false)
  const overall = computeOverall(driver)

  return (
    <div className="rounded-xl bg-[#2A3142] overflow-hidden">
      <div className="p-4">
        {/* Header: flag + ring + name + controls */}
        <div className="flex items-center gap-3 mb-4">
          <div className="shrink-0">
            <ReactCountryFlag
              countryCode={driver.nationality || 'GB'}
              svg
              style={{ width: '1.5em', height: '1.5em', borderRadius: '2px' }}
            />
          </div>
          <OverallRing overall={overall} />
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-[#E8EAED] truncate">{driver.name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-[#A0A9B8]">Age {driver.age}</span>
              <ContractBadge expiresAfter={driver.contractExpiresAfterSeason} currentYear={currentYear} />
            </div>
          </div>
          <button
            onClick={() => setExpanded((x) => !x)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#303848] transition-colors shrink-0"
          >
            Edit
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded text-[#FFFFFF] hover:text-[#F87171] hover:bg-[#3A1A1A] transition-colors shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Stat bars */}
        <div className="space-y-2">
          {STAT_KEYS.map((k) => (
            <StatBar key={k} label={STAT_LABELS[k]} value={driver[k]} />
          ))}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#303848] p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[#FFFFFF] block mb-1">Name</label>
              <input
                type="text" value={driver.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[#FFFFFF] block mb-1">Team</label>
              <select
                value={driver.teamId}
                onChange={(e) => onUpdate({ teamId: e.target.value })}
                className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
              >
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[#FFFFFF] block mb-1">Age</label>
                <input type="number" min={16} max={60} value={driver.age}
                  onChange={(e) => onUpdate({ age: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-[#FFFFFF] block mb-1">Potential</label>
                <input type="number" min={0} max={100} value={driver.peakPotential}
                  onChange={(e) => onUpdate({ peakPotential: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded bg-[#0F1419] text-[#E8EAED] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {STAT_KEYS.map((k) => (
              <StatSlider
                key={k}
                label={STAT_LABELS[k]}
                value={driver[k]}
                onChange={(v) => onUpdate({ [k]: v })}
              />
            ))}
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#FFFFFF] w-20 shrink-0">Narrative</span>
              <input
                type="range" min={-20} max={20} value={driver.narrativeModifier}
                onChange={(e) => onUpdate({ narrativeModifier: Number(e.target.value) })}
                className="flex-1 h-1 cursor-pointer"
                style={{ accentColor: '#A855F7' }}
              />
              <span className={`text-sm font-semibold w-8 text-right shrink-0 ${driver.narrativeModifier > 0 ? 'text-[#10B981]'
                  : driver.narrativeModifier < 0 ? 'text-[#DC143C]'
                    : 'text-[#FFFFFF]'
                }`}>
                {driver.narrativeModifier > 0 ? '+' : ''}{driver.narrativeModifier}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SetupPage() {
  const router = useRouter()
  const seasonStore = useSeasonStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [localDrivers, setLocalDrivers] = useState<Driver[]>([])
  const [localTeams, setLocalTeams] = useState<Team[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    setLocalDrivers(seasonStore.drivers.map((d) => ({ ...d })))
    setLocalTeams(seasonStore.teams.map((t) => ({ ...t })))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handlePrePopulate() {
    setLocalDrivers(drivers2026.map((d) => ({ ...d })))
    setLocalTeams(teams2026.map((t) => ({ ...t })))
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
        if (!Array.isArray(parsed.drivers) || !Array.isArray(parsed.teams))
          throw new Error('JSON must have "drivers" and "teams" arrays')
        setLocalDrivers(parsed.drivers as Driver[])
        setLocalTeams(parsed.teams as Team[])
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Invalid JSON file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function updateTeam(id: string, patch: Partial<Team>) {
    setLocalTeams((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function updateDriver(id: string, patch: Partial<Driver>) {
    setLocalDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function addDriver(teamId: string) {
    if (localDrivers.filter((d) => d.teamId === teamId).length >= DRIVERS_PER_TEAM) return
    setLocalDrivers((prev) => [...prev, makeDefaultDriver(teamId)])
  }

  function removeDriver(id: string) {
    setLocalDrivers((prev) => prev.filter((d) => d.id !== id))
  }

  function handleStartSeason() {
    seasonStore.initSeason(localDrivers, localTeams, seasonStore.year)
    useRaceStore.getState().resetSession()
    router.push('/race')
  }

  if (!hydrated) return null

  const isActive = seasonStore.phase !== 'idle'
  const freeAgents = localDrivers.filter((d) => d.teamId === '')
  const expiringCount = localDrivers.filter(
    (d) => d.teamId !== '' && d.contractExpiresAfterSeason <= seasonStore.year,
  ).length

  const driversByTeam = localTeams.map((team) => ({
    team,
    drivers: localDrivers.filter((d) => d.teamId === team.id),
  }))

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#E8EAED]">
      <div className="max-w-5xl mx-auto px-6 py-8">

        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-1 h-6 rounded-sm bg-[#DC143C]" />
              <h1 className="font-display text-2xl tracking-wider uppercase">
                {isActive ? 'Driver Market' : 'Setup'}
              </h1>
            </div>
            {isActive && expiringCount > 0 && (
              <p className="text-sm ml-3.5 text-[#FCD34D]">
                {expiringCount} contract{expiringCount > 1 ? 's' : ''} expiring after {seasonStore.year}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!isActive && (
              <>
                <button onClick={handlePrePopulate}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors">
                  <RotateCcw size={13} /> Pre-populate 2026
                </button>
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors">
                  <Upload size={13} /> Import JSON
                </button>
              </>
            )}
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors">
              <Download size={13} /> Export JSON
            </button>
            {isActive ? (
              <button onClick={() => router.push('/race')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors">
                Back to Race <ChevronRight size={14} />
              </button>
            ) : (
              <button onClick={handleStartSeason} disabled={localDrivers.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Start Season {seasonStore.year} <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>

        {importError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-[#3A1A1A] text-[#F87171] text-sm">
            Import error: {importError}
          </div>
        )}

        <div className="space-y-6">
          {driversByTeam.map(({ team, drivers: teamDrivers }) => (
            <div key={team.id} className="rounded-xl bg-[#1E2431] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2A3142]">
                <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: team.color }} />
                <div className="flex-1">
                  <div className="font-semibold text-[#E8EAED]">{team.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#FFFFFF]">Car pace</span>
                    <input
                      type="number" min={0} max={100} value={team.carPace}
                      onChange={(e) => updateTeam(team.id, { carPace: Math.min(100, Math.max(0, Number(e.target.value))) })}
                      className="w-12 px-1 py-0.5 rounded bg-[#0F1419] text-[#E8EAED] text-xs border border-[#303848] focus:border-[#00D9FF] outline-none text-center"
                    />
                  </div>
                </div>

                <span className="text-xs text-[#FFFFFF]">{teamDrivers.length}/{DRIVERS_PER_TEAM}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 p-4">
                {teamDrivers.map((driver) => (
                  <DriverCard
                    key={driver.id}
                    driver={driver}

                    teams={localTeams}
                    onUpdate={(patch) => updateDriver(driver.id, patch)}
                    onRemove={() => removeDriver(driver.id)}
                    currentYear={seasonStore.year}
                  />
                ))}
                {Array.from({ length: DRIVERS_PER_TEAM - teamDrivers.length }).map((_, i) => (
                  <button key={i} onClick={() => addDriver(team.id)}
                    className="min-h-[160px] rounded-xl border-2 border-dashed border-[#2A3142] hover:border-[#FFFFFF] text-[#FFFFFF] hover:text-[#E8EAED] flex flex-col items-center justify-center gap-2 transition-colors">
                    <Plus size={20} />
                    <span className="text-sm font-semibold">Add Driver</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Free agents */}
        {freeAgents.length > 0 && (
          <div className="mt-6 rounded-xl bg-[#1E2431] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2A3142]">
              <div className="w-1.5 h-8 rounded-full bg-[#6B7280]" />
              <div className="flex-1">
                <div className="font-semibold text-[#E8EAED]">Free Agents</div>
                <div className="text-xs text-[#6B7280]">{freeAgents.length} available</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-4">
              {freeAgents.map((driver) => (
                <DriverCard
                  key={driver.id}
                  driver={driver}

                  teams={localTeams}
                  onUpdate={(patch) => updateDriver(driver.id, patch)}
                  onRemove={() => removeDriver(driver.id)}
                  currentYear={seasonStore.year}
                />
              ))}
            </div>
          </div>
        )}

        {!isActive && (
          <div className="mt-8 flex justify-end">
            <button onClick={handleStartSeason} disabled={localDrivers.length === 0}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-sm uppercase tracking-wide hover:bg-[#009CB8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Start Season {seasonStore.year} <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
