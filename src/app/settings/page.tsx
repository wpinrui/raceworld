'use client'

import { useEffect, useMemo, useState } from 'react'
import { Star, Flag } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore, DEFAULT_INTERRUPT_CATEGORIES } from '@/lib/store/settings-store'
import { NEWS_FILTERS } from '@/lib/news/engine'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// Player settings for the "Continue" loop: which news interrupts the sim, plus the drivers/teams
// you follow (any story mentioning them interrupts too). Reached from the top-right overflow menu.
export default function SettingsPage() {
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const {
    interruptCategories, followedDriverIds, followedTeamIds, interruptOnFollowed,
    setCategoryInterrupt, toggleFollowDriver, toggleFollowTeam, setInterruptOnFollowed, resetInterruptsToDefault,
  } = useSettingsStore()

  const [hydrated, setHydrated] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => setHydrated(true), [])

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
            {/* Raceday is always an interrupt and not toggleable. */}
            <label className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0F1419]/60">
              <Flag size={15} className="text-[#00D9FF] shrink-0" />
              <span className="flex-1 text-sm text-[#FFFFFF]">Race day</span>
              <span className="text-[10px] uppercase tracking-widest text-[#00D9FF]">Always</span>
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
      </div>
    </div>
  )
}
