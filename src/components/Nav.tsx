'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'

export default function Nav() {
  const pathname = usePathname()
  const { phase, currentRound, year } = useSeasonStore()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function handleClearSave() {
    localStorage.removeItem('raceworld-season')
    window.location.href = '/setup'
  }

  const seasonActive = phase !== 'idle'
  const circuit = calendar2026[currentRound - 1]

  const links = [
    { href: '/setup', label: seasonActive ? 'MARKET' : 'SETUP' },
    { href: '/standings', label: 'STANDINGS' },
    { href: '/race', label: 'RACE' },
  ]

  return (
    <nav className="flex-none flex items-center gap-6 px-6 h-12 bg-[#1E2431] border-b border-[#2A3142]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 mr-4">
        <div className="w-1 h-5 rounded-sm bg-[#DC143C]" />
        <span className="font-display text-sm tracking-widest text-[#E8EAED] uppercase">
          RaceWorld
        </span>
      </div>

      {/* Nav links */}
      <div className="flex items-center gap-1">
        {links.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={[
                'px-3 py-1.5 rounded text-xs font-semibold tracking-wider transition-colors',
                active
                  ? 'bg-[#00D9FF]/10 text-[#00D9FF]'
                  : 'text-[#FFFFFF] hover:text-[#E8EAED] hover:bg-[#2A3142]',
              ].join(' ')}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {/* Season indicator */}
      <div className="ml-auto flex items-center gap-4 text-xs tabular-nums text-[#FFFFFF]">
        {seasonActive && circuit ? (
          <span>
            <span className="text-[#E8EAED]">
              {year} · Round {String(currentRound).padStart(2, '0')}/{String(calendar2026.length).padStart(2, '0')}
            </span>
            <span className="text-[#FFFFFF]"> · {circuit.name}</span>
          </span>
        ) : (
          <span className="text-[#FFFFFF]">No active season</span>
        )}

        <button
          onClick={() => setConfirmOpen(true)}
          className="px-2.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wide text-[#6B7280] hover:text-[#DC143C] hover:bg-[#2A3142] transition-colors"
        >
          Clear Save
        </button>
      </div>

      {/* Confirm modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="bg-[#1E2431] border border-[#2A3142] rounded-xl p-6 w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-1 h-5 rounded-sm bg-[#DC143C]" />
              <h2 className="font-display text-sm tracking-wider uppercase text-[#E8EAED]">Clear Save</h2>
            </div>
            <p className="text-sm text-[#A0A9B8] mb-5">
              This will wipe all local save data — season progress, driver stats, and history. Cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#E8EAED] text-xs font-semibold uppercase tracking-wide hover:bg-[#303848] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearSave}
                className="px-4 py-2 rounded-lg bg-[#DC143C] text-white text-xs font-semibold uppercase tracking-wide hover:bg-[#b01030] transition-colors"
              >
                Clear &amp; Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
