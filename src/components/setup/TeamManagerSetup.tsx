'use client'

import { useEffect, useState } from 'react'
import type { Team } from '@/lib/sim/types'
import { CountrySelect } from '@/components/CountrySelect'
import { slugify } from '@/lib/slug'

// Pick the team you'll manage in Team Manager mode: an EXISTING grid team (you start the year you chose),
// or a NEW team that JOINS the grid at a future entry year. A new team isn't given a roster here — the
// world is simulated from the earliest year up to its entry, and its seats are filled by normal free
// agency in the off-season just before it joins (car pace enters at lowest-on-the-grid − 5).

export type TmSelection =
  | { kind: 'existing'; teamId: string }
  | { kind: 'new'; team: Team; entryYear: number }
  | null

export function TeamManagerSetup({
  teams, minEntryYear, maxEntryYear, onChange, onModeChange, onEntryYearChange,
}: {
  teams: Team[]
  minEntryYear: number
  maxEntryYear: number
  onChange: (sel: TmSelection) => void
  onModeChange?: (mode: 'existing' | 'new') => void
  onEntryYearChange?: (year: number) => void // the in-progress entry year, reported even before the form validates
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  useEffect(() => { onModeChange?.(mode) }, [mode, onModeChange])
  const [existingId, setExistingId] = useState(teams[0]?.id ?? '')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#00D9FF')
  const [newNat, setNewNat] = useState('')
  const [entryYear, setEntryYear] = useState(minEntryYear)
  useEffect(() => { onEntryYearChange?.(entryYear) }, [entryYear, onEntryYearChange])

  // Report the current selection upward whenever the inputs change.
  useEffect(() => {
    if (mode === 'existing') {
      onChange(existingId ? { kind: 'existing', teamId: existingId } : null)
      return
    }
    const y = Math.max(minEntryYear, Math.min(maxEntryYear, entryYear))
    if (newName.trim() && newNat && newColor && Number.isFinite(entryYear) && Number.isFinite(y)) {
      const id = `tm-${slugify(newName) || 'team'}`
      const team: Team = {
        id, name: newName.trim(), shortName: newName.trim().slice(0, 4).toUpperCase(),
        nationality: newNat, color: newColor, carPace: 0, // pace is set to lowest-on-grid − 5 when the team joins
      }
      onChange({ kind: 'new', team, entryYear: y })
    } else {
      onChange(null)
    }
  }, [mode, existingId, newName, newColor, newNat, entryYear, minEntryYear, maxEntryYear, onChange])

  return (
    <div className="mt-3 rounded-xl bg-[#1E2431] border border-[#2A3142] p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF]">
        <button onClick={() => setMode('existing')}
          className={`px-3 py-1.5 rounded-lg ${mode === 'existing' ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF]'}`}>
          Manage existing team
        </button>
        <button onClick={() => setMode('new')}
          className={`px-3 py-1.5 rounded-lg ${mode === 'new' ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF]'}`}>
          Create a new team
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#FFFFFF]">Your team</span>
          <select value={existingId} onChange={(e) => setExistingId(e.target.value)}
            className="px-2 py-2 rounded-lg bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-[#FFFFFF] block mb-1">Team name</label>
            <input type="text" value={newName} placeholder="e.g. Apex GP" onChange={(e) => setNewName(e.target.value)}
              className="px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none" />
          </div>
          <div>
            <label className="text-xs text-[#FFFFFF] block mb-1">Colour</label>
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)}
              className="w-10 h-9 rounded bg-[#0F1419] border border-[#303848] cursor-pointer" />
          </div>
          <div>
            <label className="text-xs text-[#FFFFFF] block mb-1">Nationality</label>
            <CountrySelect value={newNat} onChange={(code) => setNewNat(code)} />
          </div>
          <div>
            <label className="text-xs text-[#FFFFFF] block mb-1">Entry year</label>
            <input type="number" min={minEntryYear} max={maxEntryYear} value={Number.isFinite(entryYear) ? entryYear : ''}
              onChange={(e) => setEntryYear(e.target.value === '' ? NaN : Number(e.target.value))}
              className="w-24 px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none" />
          </div>
          <span className="text-xs text-[#9CA3AF] pb-2">Joins at the back of the grid; free agency fills its seats before it enters.</span>
        </div>
      )}
    </div>
  )
}
