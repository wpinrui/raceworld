'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Download, Plus, RotateCcw, ChevronRight } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useRaceStore } from '@/lib/store/race-store'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import type { Driver, Team } from '@/lib/sim/types'
import { DriverCard, makeDefaultDriver } from '@/components/setup/DriverCard'

const DRIVERS_PER_TEAM = 2

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

  // During an active season this screen is the Driver Market: edits must persist
  // straight to the store. Before the season starts, edits stay local until
  // "Start Season" commits them via initSeason().
  const isActive = seasonStore.phase !== 'idle'

  // Drive updateGrid from committed React state rather than from inside setters,
  // so the store always receives the latest localDrivers + localTeams together.
  useEffect(() => {
    if (isActive && hydrated) seasonStore.updateGrid(localDrivers, localTeams)
  }, [localDrivers, localTeams]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const freeAgents = localDrivers.filter((d) => d.teamId === '')
  const expiringCount = localDrivers.filter(
    (d) => d.teamId !== '' && d.contractExpiresAfterSeason <= seasonStore.year,
  ).length

  const driversByTeam = localTeams.map((team) => ({
    team,
    drivers: localDrivers.filter((d) => d.teamId === team.id),
  }))

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
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
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors">
                  <RotateCcw size={13} /> Pre-populate 2026
                </button>
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors">
                  <Upload size={13} /> Import JSON
                </button>
              </>
            )}
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors">
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
                  <div className="font-semibold text-[#FFFFFF]">{team.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#FFFFFF]">Car pace</span>
                    <input
                      type="number" min={0} max={100} value={team.carPace}
                      onChange={(e) => updateTeam(team.id, { carPace: Math.min(100, Math.max(0, Number(e.target.value))) })}
                      className="w-12 px-1 py-0.5 rounded bg-[#0F1419] text-[#FFFFFF] text-xs border border-[#303848] focus:border-[#00D9FF] outline-none text-center"
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
                    className="min-h-[160px] rounded-xl border-2 border-dashed border-[#2A3142] hover:border-[#FFFFFF] text-[#FFFFFF] hover:text-[#FFFFFF] flex flex-col items-center justify-center gap-2 transition-colors">
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
                <div className="font-semibold text-[#FFFFFF]">Free Agents</div>
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
