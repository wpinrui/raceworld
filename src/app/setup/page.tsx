'use client'

import { useEffect, useRef, useState } from 'react'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { useRouter } from 'next/navigation'
import { Upload, Download, Plus, ChevronRight } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useRaceStore } from '@/lib/store/race-store'
import type { Driver, Team } from '@/lib/sim/types'
import { isOffSeason } from '@/lib/sim/types'
import { DriverCard, makeDefaultDriver } from '@/components/setup/DriverCard'
import { TeamLink } from '@/components/world/EntityLink'
import { composeSeason, historyYears, DEFAULT_START_YEAR } from '@/lib/history/compose'
import { useSetupCta } from '@/lib/store/setup-cta'
import { calendarForYear } from '@/data/calendars'
import { simUntilYear } from '@/lib/sim/sim-until-year'
import { SimulatingWorldModal } from '@/components/SimulatingWorldModal'
import { TeamManagerSetup, type TmSelection } from '@/components/setup/TeamManagerSetup'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const DRIVERS_PER_TEAM = 2
// Earliest season with historical data; derived (not hardcoded), so it tracks any earlier years added.
const EARLIEST_YEAR = Math.min(...historyYears())

// Total championship races across [from, toExclusive) — the "sim the world" progress bar is keyed by these.
function racesBetween(from: number, toExclusive: number): number {
  let n = 0
  for (let y = from; y < toExclusive; y++) n += calendarForYear(y).length
  return n
}

export default function SetupPage() {
  const seasonStore = useSeasonStore()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Editable copies of the grid, seeded from the persisted store. zustand-persist rehydrates the
  // client store synchronously, so these lazy initialisers read the saved grid (the page is gated on
  // `hydrated` below, so the server's empty default is never rendered).
  const [localDrivers, setLocalDrivers] = useState<Driver[]>(() => seasonStore.drivers.map((d) => ({ ...d })))
  const [localTeams, setLocalTeams] = useState<Team[]>(() => seasonStore.teams.map((t) => ({ ...t })))
  const [importError, setImportError] = useState<string | null>(null)
  const hydrated = useHydrated()
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamShort, setNewTeamShort] = useState('')
  const [newTeamColor, setNewTeamColor] = useState('#888888')
  // Which season to start from, and whether real-world changes apply each season-end.
  const [startYear, setStartYear] = useState(DEFAULT_START_YEAR)
  const [realWorld, setRealWorld] = useState(false)
  // "Sim the world": fast-forward from the earliest year up to startYear before the player begins.
  const [simWorld, setSimWorld] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [racesTotal, setRacesTotal] = useState(0)
  const cancelSimRef = useRef(false)
  // Team Manager: run one team only, god-mode off (re-enableable as Settings talents).
  const [teamManager, setTeamManager] = useState(false)
  const [tmSelection, setTmSelection] = useState<TmSelection>(null)

  // Selecting a year pre-populates that season's grid immediately — every year goes through the same
  // composeSeason() path (the latest year is just the default). Real-world changes default on for any
  // past season (there's a future to track) and off for the latest (nothing ahead of it); user can toggle.
  function selectYear(year: number) {
    setStartYear(year)
    const composed = composeSeason(year)
    if (!composed) { setImportError(`No historical data for ${year}`); return }
    setLocalDrivers(composed.drivers)
    setLocalTeams(composed.teams)
    setRealWorld(year < DEFAULT_START_YEAR)
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
        // Default any missing/non-finite rating so an imported or hand-authored grid can't poison the
        // sim with NaN (every rating is required and feeds lap times / overall / the mistake roll).
        const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
        setLocalDrivers((parsed.drivers as Driver[]).map((d) => ({
          ...d,
          pace: num(d.pace, 70), wetWeatherPace: num(d.wetWeatherPace, 70),
          overtaking: num(d.overtaking, 70), smoothness: num(d.smoothness, 70), consistency: num(d.consistency, 70),
        })))
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
    // Never push the local grid while the world is being fast-forwarded — the store grid is the live sim.
    if (isActive && hydrated && !simulating) seasonStore.updateGrid(localDrivers, localTeams)
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

  // God-mode grid change: queue a brand-new team to join next season. The team enters
  // at the lowest car pace with empty seats the market then fills (GDD §Grid Changes).
  function handleAddTeam() {
    const name = newTeamName.trim()
    if (!name) return
    const existingIds = new Set([
      ...localTeams.map((t) => t.id),
      ...seasonStore.pendingGridChanges.additions.map((t) => t.id),
    ])
    let id = `${slugify(name) || 'team'}-${Math.random().toString(36).slice(2, 7)}`
    while (existingIds.has(id)) id = `${slugify(name) || 'team'}-${Math.random().toString(36).slice(2, 7)}`
    seasonStore.queueTeamAddition({
      id,
      name,
      shortName: (newTeamShort.trim() || name.slice(0, 3)).toUpperCase().slice(0, 4),
      nationality: '', // new outfits default to rest-of-world until set
      color: newTeamColor,
      carPace: 0, // placeholder; set to the lowest grid pace when the change applies
    })
    setNewTeamName('')
    setNewTeamShort('')
    setNewTeamColor('#888888')
  }

  // Sandbox "sim the world": fast-forward 1996 → startYear, then hard-reset to the real-world grid of the
  // year reached (the simulated seasons become the world's history).
  async function runSimWorld() {
    cancelSimRef.current = false
    setRacesTotal(racesBetween(EARLIEST_YEAR, startYear))
    setSimulating(true)
    const earliest = composeSeason(EARLIEST_YEAR)
    if (!earliest) { setSimulating(false); setImportError(`No historical data for ${EARLIEST_YEAR}`); return }
    useSeasonStore.getState().setRealWorldMode(true)
    useSeasonStore.getState().initSeason(earliest.drivers, earliest.teams, EARLIEST_YEAR)
    await simUntilYear(startYear, () => cancelSimRef.current)
    const landed = useSeasonStore.getState().year
    const real = composeSeason(landed)
    if (real) useSeasonStore.getState().initSeason(real.drivers, real.teams, landed)
    useSeasonStore.getState().setRealWorldMode(realWorld)
    useRaceStore.getState().resetSession()
    setSimulating(false)
    router.push('/home')
  }

  // Team Manager: history ALWAYS simulates from 1996. An existing team -> sim to your start year, reset to
  // its real-world grid, take over. A NEW team -> sim to (entry year − 1), queue the team to JOIN at the
  // entry year (free agency auto-fills its seats in that off-season), sim through to entry, take over.
  async function startTeamManager(sel: NonNullable<TmSelection>) {
    const target = sel.kind === 'new' ? sel.entryYear : startYear
    cancelSimRef.current = false
    setRacesTotal(racesBetween(EARLIEST_YEAR, target))
    setSimulating(true)
    const earliest = composeSeason(EARLIEST_YEAR)
    if (!earliest) { setSimulating(false); setImportError(`No historical data for ${EARLIEST_YEAR}`); return }
    useSeasonStore.getState().setTeamManager(false, null) // auto-resolve the market during the fast-forward
    useSeasonStore.getState().setRealWorldMode(true)
    useSeasonStore.getState().initSeason(earliest.drivers, earliest.teams, EARLIEST_YEAR)
    if (sel.kind === 'new') {
      if (sel.entryYear - 1 > EARLIEST_YEAR) await simUntilYear(sel.entryYear - 1, () => cancelSimRef.current)
      useSeasonStore.getState().queueTeamAddition(sel.team)
      await simUntilYear(sel.entryYear, () => cancelSimRef.current)
      useSeasonStore.getState().setTeamManager(true, sel.team.id)
    } else {
      await simUntilYear(startYear, () => cancelSimRef.current)
      const landed = useSeasonStore.getState().year
      const real = composeSeason(landed)
      useSeasonStore.getState().setTeamManager(true, sel.teamId)
      if (real) useSeasonStore.getState().initSeason(real.drivers, real.teams, landed)
    }
    useSeasonStore.getState().setRealWorldMode(realWorld)
    useRaceStore.getState().resetSession()
    setSimulating(false)
    router.push('/home')
  }

  async function handleStartSeason() {
    if (teamManager && tmSelection) { await startTeamManager(tmSelection); return }
    if (simWorld && startYear > EARLIEST_YEAR) { await runSimWorld(); return }
    seasonStore.setRealWorldMode(realWorld)
    seasonStore.setTeamManager(false, null)
    seasonStore.initSeason(localDrivers, localTeams, startYear)
    useRaceStore.getState().resetSession()
    router.push('/home') // land on Home; the Continue CTA drives forward to the opening race
  }

  // Surface "Start Season" up in the nav top bar (the only CTA before a season exists). The staged
  // grid lives in this page's local state, so we register the action here for the nav to invoke.
  const setSetupCta = useSetupCta((s) => s.setCta)
  useEffect(() => {
    if (isActive) { setSetupCta(null); return }
    setSetupCta({ ready: localDrivers.length > 0 && (!teamManager || tmSelection != null), year: startYear, start: handleStartSeason })
    return () => setSetupCta(null)
  }, [isActive, localDrivers, localTeams, startYear, realWorld, simWorld, teamManager, tmSelection]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated) return null

  const freeAgents = localDrivers.filter((d) => d.teamId === '')
  // Pre-populating the 2026 defaults wipes the grid — only ever offer it on a
  // brand-new game (no season completed yet), never between seasons.
  const isFreshGame = seasonStore.constructorHistory.length === 0
  const expiringCount = localDrivers.filter(
    (d) => d.teamId !== '' && d.contractExpiresAfterSeason <= seasonStore.year,
  ).length

  const driversByTeam = localTeams.map((team) => ({
    team,
    drivers: localDrivers.filter((d) => d.teamId === team.id),
  }))

  // Progress = races simmed so far (completed seasons + the in-progress one) over the total to the target.
  const racesSimmed = simulating
    ? Math.min(racesTotal, racesBetween(EARLIEST_YEAR, seasonStore.year) + seasonStore.raceResults.length)
    : 0

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      {simulating && (
        <SimulatingWorldModal
          open={simulating}
          year={seasonStore.year}
          racesSimmed={racesSimmed}
          racesTotal={racesTotal}
          onCancel={() => { cancelSimRef.current = true }}
        />
      )}
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
                {isFreshGame && (
                  <>
                    <select value={startYear} onChange={(e) => selectYear(Number(e.target.value))}
                      className="px-2 py-2 rounded-lg bg-[#0F1419] text-[#FFFFFF] text-xs border border-[#303848] focus:border-[#00D9FF] outline-none">
                      {historyYears().slice().reverse().map((y) => (
                        <option key={y} value={y}>{y}{y === DEFAULT_START_YEAR ? ' (default)' : ''}</option>
                      ))}
                    </select>
                    {startYear !== DEFAULT_START_YEAR && (
                      <label className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF]">
                        <input type="checkbox" checked={realWorld} onChange={(e) => setRealWorld(e.target.checked)} className="w-4 h-4 accent-[#00D9FF] cursor-pointer" />
                        Real-world changes
                      </label>
                    )}
                    {startYear > EARLIEST_YEAR && (
                      <label className={`flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] ${teamManager ? 'opacity-60' : ''}`}>
                        {/* Team Manager always simulates history from the earliest year, so the toggle is forced on. */}
                        <input type="checkbox" checked={teamManager || simWorld} disabled={teamManager} onChange={(e) => setSimWorld(e.target.checked)} className="w-4 h-4 accent-[#00D9FF] cursor-pointer disabled:cursor-not-allowed" />
                        Sim history from {EARLIEST_YEAR}
                      </label>
                    )}
                    <label className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF]">
                      <input type="checkbox" checked={teamManager} onChange={(e) => { setTeamManager(e.target.checked); if (!e.target.checked) setTmSelection(null) }} className="w-4 h-4 accent-[#00D9FF] cursor-pointer" />
                      Team Manager
                    </label>
                  </>
                )}
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
          </div>
        </div>

        {importError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-[#3A1A1A] text-[#F87171] text-sm">
            Import error: {importError}
          </div>
        )}

        {!isActive && teamManager && (
          <div className="mb-6">
            <TeamManagerSetup teams={localTeams} minEntryYear={EARLIEST_YEAR + 1} maxEntryYear={DEFAULT_START_YEAR} onChange={setTmSelection} />
          </div>
        )}

        <div className="space-y-6">
          {driversByTeam.map(({ team, drivers: teamDrivers }) => (
            <div key={team.id} className="rounded-xl bg-[#1E2431] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2A3142]">
                <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: team.color }} />
                <div className="flex-1">
                  <div className="font-semibold"><TeamLink id={team.id} className="text-[#FFFFFF]">{team.name}</TeamLink></div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#FFFFFF]">Car pace</span>
                    <input
                      type="number" min={0} value={team.carPace}
                      onChange={(e) => updateTeam(team.id, { carPace: Math.max(0, Number(e.target.value)) })}
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
                <div className="text-xs text-[#FFFFFF]">{freeAgents.length} available</div>
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

        {/* God-mode grid changes — deferred to next season (GDD §Grid Changes). Only
            offered while a season is actually running; the change takes effect at the
            season-end transition, so it is labelled with next year. */}
        {isActive && !isOffSeason(seasonStore.phase) && (() => {
          const pending = seasonStore.pendingGridChanges
          const removable = localTeams.filter((t) => !pending.removals.includes(t.id))
          return (
            <div className="mt-6 rounded-xl bg-[#1E2431] overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2A3142]">
                <div className="w-1.5 h-8 rounded-full bg-[#DC143C]" />
                <div className="flex-1">
                  <div className="font-semibold text-[#FFFFFF]">Grid Changes (God Mode)</div>
                  <div className="text-xs text-[#FFFFFF]">
                    Effective {seasonStore.year + 1} — the rest of {seasonStore.year} plays out on the current grid
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {(pending.additions.length > 0 || pending.removals.length > 0) && (
                  <div className="space-y-1.5">
                    {pending.additions.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-sm">
                        <span className="px-2 py-0.5 rounded bg-[#10B981]/20 text-[#10B981] text-[10px] font-bold uppercase tracking-wide">Joins</span>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                        <span className="text-[#FFFFFF] font-medium">{t.name}</span>
                        <span className="text-[#FFFFFF]">({t.shortName})</span>
                        <button onClick={() => seasonStore.cancelTeamAddition(t.id)} className="ml-auto text-xs text-[#FFFFFF] hover:text-[#DC143C] transition-colors">Cancel</button>
                      </div>
                    ))}
                    {pending.removals.map((rid) => {
                      const t = localTeams.find((x) => x.id === rid)
                      return (
                        <div key={rid} className="flex items-center gap-2 text-sm">
                          <span className="px-2 py-0.5 rounded bg-[#DC143C]/20 text-[#DC143C] text-[10px] font-bold uppercase tracking-wide">Leaves</span>
                          <span className="text-[#FFFFFF] font-medium">{t?.name ?? rid}</span>
                          <span className="text-xs text-[#FFFFFF]">drivers re-enter the market</span>
                          <button onClick={() => seasonStore.cancelTeamRemoval(rid)} className="ml-auto text-xs text-[#FFFFFF] hover:text-[#00D9FF] transition-colors">Cancel</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <label className="text-xs text-[#FFFFFF] block mb-1">New team name</label>
                    <input
                      type="text" value={newTeamName} placeholder="e.g. Audi"
                      onChange={(e) => setNewTeamName(e.target.value)}
                      className="px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#FFFFFF] block mb-1">Short</label>
                    <input
                      type="text" value={newTeamShort} maxLength={4} placeholder="AUD"
                      onChange={(e) => setNewTeamShort(e.target.value)}
                      className="w-20 px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#FFFFFF] block mb-1">Colour</label>
                    <input
                      type="color" value={newTeamColor}
                      onChange={(e) => setNewTeamColor(e.target.value)}
                      className="w-10 h-9 rounded bg-[#0F1419] border border-[#303848] cursor-pointer"
                    />
                  </div>
                  <button
                    onClick={handleAddTeam} disabled={!newTeamName.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={13} /> Add team
                  </button>
                </div>

                {removable.length > 0 && (
                  <div>
                    <label className="text-xs text-[#FFFFFF] block mb-1.5">Remove a team next season</label>
                    <div className="flex flex-wrap gap-2">
                      {removable.map((t) => (
                        <button
                          key={t.id} onClick={() => seasonStore.queueTeamRemoval(t.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:bg-[#DC143C]/30 text-xs font-semibold transition-colors"
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.shortName} ✕
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {!isActive && (
          <div className="mt-8 flex justify-end">
            <button onClick={handleStartSeason} disabled={localDrivers.length === 0 || (teamManager && !tmSelection)}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-sm uppercase tracking-wide hover:bg-[#009CB8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Start Season {seasonStore.year} <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
