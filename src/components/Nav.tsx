'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'

export default function Nav() {
  const pathname = usePathname()
  const { phase, currentRound, year } = useSeasonStore()

  const seasonActive = phase !== 'idle'
  const circuit = calendar2026[currentRound - 1]

  const links = [
    { href: '/setup', label: 'SETUP' },
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
                  : 'text-[#A0A9B8] hover:text-[#E8EAED] hover:bg-[#2A3142]',
              ].join(' ')}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {/* Season indicator */}
      <div className="ml-auto text-xs font-mono text-[#A0A9B8]">
        {seasonActive && circuit ? (
          <span>
            <span className="text-[#E8EAED]">
              {year} · Round {String(currentRound).padStart(2, '0')}/{String(calendar2026.length).padStart(2, '0')}
            </span>
            <span className="text-[#6B7280]"> · {circuit.name}</span>
          </span>
        ) : (
          <span className="text-[#6B7280]">No active season</span>
        )}
      </div>
    </nav>
  )
}
