'use client'

import { useEffect, useState } from 'react'
import type { Driver, Team } from '@/lib/sim/types'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// Pick the team you'll manage in Team Manager mode: an EXISTING grid team, or a NEW one that joins as an
// extra entry (car pace = lowest on the grid − 5, two drivers signed from the free-agent pool). Signing a
// free agent rolls a 50% acceptance; a driver who declines is locked out of THAT seat (retryable for the
// other). If every remaining agent has declined a seat, the rejections clear (soft-lock guard).

export type TmSelection =
  | { kind: 'existing'; teamId: string }
  | { kind: 'new'; team: Team; drivers: Driver[] }
  | null

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// The 50% acceptance roll. Module-scoped so it's plainly not a render-time call (it fires on a click).
function offerAccepted(): boolean {
  return Math.random() < 0.5
}

export function TeamManagerSetup({
  teams, freeAgents, onChange,
}: {
  teams: Team[]
  freeAgents: Driver[]
  onChange: (sel: TmSelection) => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [existingId, setExistingId] = useState(teams[0]?.id ?? '')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#00D9FF')
  const [seats, setSeats] = useState<(Driver | null)[]>([null, null])
  const [rejected, setRejected] = useState<Set<string>>(new Set()) // for the seat currently being filled
  const [lastDecline, setLastDecline] = useState<string | null>(null)

  const lowestPace = teams.length ? Math.min(...teams.map((t) => t.carPace)) : 75
  const newPace = Math.max(5, lowestPace - 5)
  const signedIds = new Set(seats.filter(Boolean).map((d) => (d as Driver).id))
  const firstEmpty = seats.findIndex((s) => s === null)
  const available = freeAgents.filter((d) => !signedIds.has(d.id) && !rejected.has(d.id))

  // Report the current selection upward whenever the inputs change (reactive, so no stale reads).
  useEffect(() => {
    if (mode === 'existing') {
      onChange(existingId ? { kind: 'existing', teamId: existingId } : null)
      return
    }
    const signed = seats.filter(Boolean) as Driver[]
    if (newName.trim() && signed.length === 2) {
      const id = `tm-${slugify(newName) || 'team'}`
      const team: Team = {
        id, name: newName.trim(), shortName: newName.trim().slice(0, 4).toUpperCase(),
        nationality: '', color: newColor, carPace: newPace,
      }
      onChange({ kind: 'new', team, drivers: signed.map((d) => ({ ...d, teamId: id })) })
    } else {
      onChange(null)
    }
  }, [mode, existingId, newName, newColor, seats, newPace, onChange])

  function attemptSign(d: Driver) {
    if (firstEmpty === -1) return
    if (offerAccepted()) {
      const next = [...seats]; next[firstEmpty] = d
      setSeats(next); setRejected(new Set()); setLastDecline(null)
    } else {
      const r = new Set(rejected); r.add(d.id)
      const stillOpen = freeAgents.filter((x) => !signedIds.has(x.id) && !r.has(x.id))
      setRejected(stillOpen.length === 0 ? new Set() : r) // soft-lock guard: wipe if all have declined
      setLastDecline(d.name)
    }
  }

  function dropSeat(i: number) {
    const next = [...seats]; next[i] = null
    setSeats(next); setRejected(new Set()); setLastDecline(null)
  }

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
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
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
            <span className="text-xs text-[#9CA3AF] pb-2">Car pace {newPace} (back of the grid)</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {seats.map((seat, i) => (
              <div key={i} className="rounded-lg bg-[#0F1419] border border-[#303848] p-2 min-h-[44px] flex items-center gap-2">
                {seat ? (
                  <>
                    <NationalityFlag code={seat.nationality} />
                    <span className="text-sm text-[#FFFFFF] truncate flex-1">{seat.name}</span>
                    <button onClick={() => dropSeat(i)} className="text-xs text-[#FFFFFF] hover:text-[#DC143C]">✕</button>
                  </>
                ) : (
                  <span className="text-xs text-[#9CA3AF]">{firstEmpty === i ? 'Signing…' : 'Empty seat'}</span>
                )}
              </div>
            ))}
          </div>

          {firstEmpty !== -1 && (
            <div>
              {lastDecline && <p className="text-xs text-[#F87171] mb-1.5">{lastDecline} turned down the drive.</p>}
              <div className="max-h-44 overflow-y-auto rounded-lg border border-[#303848] divide-y divide-[#1a2030]">
                {available.length === 0 && <p className="text-xs text-[#9CA3AF] p-2">No free agents available.</p>}
                {available.map((d) => (
                  <button key={d.id} onClick={() => attemptSign(d)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-[#1E2431]">
                    <NationalityFlag code={d.nationality} />
                    <span className="text-sm text-[#FFFFFF] truncate flex-1">{d.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[#00D9FF]">Offer (50%)</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
