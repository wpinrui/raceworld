'use client'

import { useMemo, useRef, useState } from 'react'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { Star, SlidersHorizontal, Handshake, Flame, Telescope, BarChart3, CloudSun, type LucideIcon } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore, DEFAULT_INTERRUPT_CATEGORIES } from '@/lib/store/settings-store'
import { NEWS_FILTERS } from '@/lib/news/engine'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { actionResetDatabase } from '@/lib/db/actions'
import { simUntilYear } from '@/lib/sim/sim-until-year'
import { TALENTS } from '@/lib/team-manager'
import { Tooltip } from '@/components/ui/Tooltip'

const TALENT_ICONS: Record<string, LucideIcon> = { SlidersHorizontal, Handshake, Flame, Telescope, BarChart3, CloudSun }

// Player settings for the "Continue" loop: which news interrupts the sim, plus the drivers/teams
// you follow (any story mentioning them interrupts too). Reached from the top-right overflow menu.
export default function SettingsPage() {
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const year = useSeasonStore((s) => s.year)
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode)
  const {
    interruptOnRaceday, interruptCategories, followedDriverIds, followedTeamIds, interruptOnFollowed,
    setInterruptOnRaceday, setCategoryInterrupt, toggleFollowDriver, toggleFollowTeam, setInterruptOnFollowed, resetInterruptsToDefault,
    talents, setTalent,
  } = useSettingsStore()

  const hydrated = useHydrated()
  const [q, setQ] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [clearError, setClearError] = useState(false)
  const [simTargetStr, setSimTargetStr] = useState('')
  const [simming, setSimming] = useState(false)
  const cancelRef = useRef(false)

  // Fast-forward to the start of a future season, auto-accepting every team change on the way. Clicking
  // while it runs cancels; the game is left consistent at whatever year it reached.
  async function runSimAhead(target: number) {
    if (simming || target <= year) return
    cancelRef.current = false
    setSimming(true)
    try {
      await simUntilYear(target, () => cancelRef.current)
    } finally {
      setSimming(false)
    }
  }

  async function handleClearSave() {
    // Reset the DB FIRST. If it fails, do nothing else: clearing localStorage now would leave a fresh
    // save pointed at a stale archive (ghost data). Surface the failure and keep everything consistent.
    try {
      await actionResetDatabase()
    } catch {
      setClearError(true)
      return
    }
    localStorage.removeItem('raceworld-season')
    // Personal settings (followed drivers/teams, interrupt prefs) are their own persisted store; a
    // New Game must clear them too, or follows leak across saves.
    localStorage.removeItem('raceworld-settings')
    window.location.href = '/setup'
  }

  const gridDrivers = useMemo(
    () => drivers.filter((d) => d.teamId !== '').slice().sort((a, b) => a.name.localeCompare(b.name)),
    [drivers],
  )
  const shownDrivers = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? gridDrivers.filter((d) => d.name.toLowerCase().includes(s)) : gridDrivers
  }, [gridDrivers, q])
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id

  if (!hydrated) return null

  const catSet = new Set(interruptCategories)
  // A filter row is "on" if any of its categories interrupt; toggling sets them all together.
  const filterOn = (cats: string[]) => cats.some((c) => catSet.has(c))
  const isDefault =
    interruptCategories.length === DEFAULT_INTERRUPT_CATEGORIES.length &&
    DEFAULT_INTERRUPT_CATEGORIES.every((c) => catSet.has(c))

  const minSimYear = year + 1
  const maxSimYear = year + 200 // well within the fast-forward guard, so the target is always reachable
  const parsedTarget = parseInt(simTargetStr, 10)
  const simTargetYear = Number.isInteger(parsedTarget) ? parsedTarget : minSimYear
  const canSim = simTargetYear > year && simTargetYear <= maxSimYear

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-7 rounded-sm bg-[#DC143C]" />
          <h1 className="font-display text-2xl tracking-wider uppercase">Settings</h1>
        </div>

        {/* What interrupts the sim */}
        <section className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A3142]">
            <div>
              <h2 className="font-semibold text-sm tracking-wide uppercase text-[#FFFFFF]">News that interrupts the sim</h2>
              <p className="text-xs text-[#FFFFFF] mt-0.5">When you press Continue, these stop the clock so you can read them.</p>
            </div>
            <button
              onClick={resetInterruptsToDefault}
              disabled={isDefault}
              className="px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 transition-colors"
            >
              Reset to defaults
            </button>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {/* Race day interrupts by default, but can be turned off so races auto-simulate. */}
            <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#0F1419]/60 cursor-pointer">
              <input
                type="checkbox"
                checked={interruptOnRaceday}
                onChange={(e) => setInterruptOnRaceday(e.target.checked)}
                className="w-4 h-4 shrink-0 accent-[#00D9FF] cursor-pointer"
              />
              <span className="flex-1 text-sm text-[#FFFFFF]">Race day</span>
            </label>
            {NEWS_FILTERS.map((f) => {
              const on = filterOn(f.categories)
              return (
                <label key={f.label} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#0F1419]/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => f.categories.forEach((c) => setCategoryInterrupt(c, e.target.checked))}
                    className="w-4 h-4 shrink-0 accent-[#00D9FF] cursor-pointer"
                  />
                  <span className="flex-1 text-sm text-[#FFFFFF]">{f.label}</span>
                </label>
              )
            })}
          </div>
        </section>

        {/* Simulate ahead */}
        <section className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#2A3142]">
            <h2 className="font-semibold text-sm tracking-wide uppercase text-[#FFFFFF]">Simulate ahead</h2>
            <p className="text-xs text-[#FFFFFF] mt-0.5">Fast-forward to the start of a future season. Team changes along the way are accepted automatically.</p>
          </div>
          <div className="p-5 flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-[#FFFFFF]">
              <span>Sim to the start of</span>
              <input
                type="number"
                min={minSimYear}
                max={maxSimYear}
                value={simTargetStr}
                placeholder={String(minSimYear)}
                disabled={simming}
                onChange={(e) => setSimTargetStr(e.target.value)}
                className="w-24 px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none disabled:opacity-50"
              />
            </label>
            {simming ? (
              <>
                <span className="text-sm text-[#FFFFFF]">Simming… now {year}</span>
                <button
                  onClick={() => { cancelRef.current = true }}
                  className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] text-xs font-semibold uppercase tracking-wide hover:bg-[#303848] transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => runSimAhead(simTargetYear)}
                disabled={!canSim}
                className="px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] text-xs font-semibold uppercase tracking-wide hover:bg-[#33E5FF] disabled:opacity-40 transition-colors"
              >
                Sim to start of {simTargetYear}
              </button>
            )}
          </div>
        </section>

        {/* Follow drivers/teams */}
        <section className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
          <div className="px-5 py-3 border-b border-[#2A3142]">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={interruptOnFollowed}
                onChange={(e) => setInterruptOnFollowed(e.target.checked)}
                className="w-4 h-4 shrink-0 accent-[#00D9FF] cursor-pointer"
              />
              <div className="flex-1">
                <h2 className="font-semibold text-sm tracking-wide uppercase text-[#FFFFFF]">Interrupt for the people I follow</h2>
                <p className="text-xs text-[#FFFFFF] mt-0.5">Any story mentioning a followed driver or team stops the sim.</p>
              </div>
            </label>
          </div>

          <div className={`grid md:grid-cols-2 ${interruptOnFollowed ? '' : 'opacity-50 pointer-events-none'}`}>
            {/* Drivers */}
            <div className="p-3 border-b md:border-b-0 md:border-r border-[#2A3142]">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Drivers</span>
                <span className="text-[10px] text-[#FFFFFF]">{followedDriverIds.length} followed</span>
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search drivers…"
                className="w-full mb-2 px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
              />
              <div className="max-h-72 overflow-y-auto space-y-0.5">
                {shownDrivers.map((d) => {
                  const on = followedDriverIds.includes(d.id)
                  return (
                    <button
                      key={d.id}
                      onClick={() => toggleFollowDriver(d.id)}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[#0F1419]/60 transition-colors"
                    >
                      <Star size={14} className={`shrink-0 ${on ? 'text-[#FCD34D] fill-[#FCD34D]' : 'text-[#6B7280]'}`} />
                      <NationalityFlag code={d.nationality} />
                      <span className="flex-1 text-sm text-[#FFFFFF] truncate">{d.name}</span>
                      <span className="text-[10px] text-[#FFFFFF] truncate">{teamName(d.teamId)}</span>
                    </button>
                  )
                })}
                {shownDrivers.length === 0 && <p className="px-2 py-3 text-xs text-[#FFFFFF]">No drivers.</p>}
              </div>
            </div>

            {/* Teams */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Teams</span>
                <span className="text-[10px] text-[#FFFFFF]">{followedTeamIds.length} followed</span>
              </div>
              <div className="max-h-[19.5rem] overflow-y-auto space-y-0.5">
                {teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
                  const on = followedTeamIds.includes(t.id)
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleFollowTeam(t.id)}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[#0F1419]/60 transition-colors"
                    >
                      <Star size={14} className={`shrink-0 ${on ? 'text-[#FCD34D] fill-[#FCD34D]' : 'text-[#6B7280]'}`} />
                      <span className="w-1 h-4 rounded-sm shrink-0" style={{ backgroundColor: t.color }} />
                      <NationalityFlag code={t.nationality} />
                      <span className="flex-1 text-sm text-[#FFFFFF] truncate">{t.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Team Manager talents — re-enable god-mode powers, your team only. Only shown in Team Manager mode. */}
        {teamManagerMode && (
          <section className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#2A3142]">
              <h2 className="font-semibold text-sm tracking-wide uppercase text-[#FFFFFF]">Team Manager Talents</h2>
              <p className="text-xs text-[#9CA3AF] mt-0.5">God-mode powers, off by default. Each applies to your team only.</p>
            </div>
            <div className="p-4 space-y-1.5">
              {TALENTS.map((t) => {
                const Icon = TALENT_ICONS[t.icon]
                return (
                  <Tooltip key={t.id} content={t.tooltip}>
                    <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2A3142] cursor-pointer">
                      {Icon && <Icon size={16} className="text-[#00D9FF] shrink-0" />}
                      <span className="flex-1 text-sm font-medium text-[#FFFFFF]">{t.name}</span>
                      <input type="checkbox" checked={talents[t.id] ?? false} onChange={(e) => setTalent(t.id, e.target.checked)} className="w-4 h-4 accent-[#00D9FF] cursor-pointer" />
                    </label>
                  </Tooltip>
                )
              })}
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="rounded-xl bg-[#1E2431] border border-[#DC143C]/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-[#2A3142]">
            <h2 className="font-semibold text-sm tracking-wide uppercase text-[#DC143C]">Danger Zone</h2>
          </div>
          <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-[#FFFFFF]">Clear save</p>
              <p className="text-xs text-[#FFFFFF] mt-0.5">Wipes all local save data: season progress, driver stats, and history. Cannot be undone.</p>
            </div>
            <button
              onClick={() => { setClearError(false); setClearOpen(true) }}
              className="shrink-0 px-4 py-2 rounded-lg bg-[#DC143C] text-white text-xs font-semibold uppercase tracking-wide hover:bg-[#b01030] transition-colors"
            >
              Clear Save
            </button>
          </div>
        </section>
      </div>

      {clearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setClearOpen(false)}>
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-xl p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-1 h-5 rounded-sm bg-[#DC143C]" />
              <h2 className="font-display text-sm tracking-wider uppercase text-[#FFFFFF]">Clear Save</h2>
            </div>
            <p className="text-sm text-[#FFFFFF] mb-5">This will wipe all local save data: season progress, driver stats, and history. Cannot be undone.</p>
            {clearError && <p className="text-sm text-[#DC143C] mb-5">Reset failed. Nothing was cleared, your save is intact. Try again.</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setClearOpen(false)} className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] text-xs font-semibold uppercase tracking-wide hover:bg-[#303848] transition-colors">Cancel</button>
              <button onClick={handleClearSave} className="px-4 py-2 rounded-lg bg-[#DC143C] text-white text-xs font-semibold uppercase tracking-wide hover:bg-[#b01030] transition-colors">Clear &amp; Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
