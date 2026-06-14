'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useTeamHighlight } from '@/lib/useTeamHighlight'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'

// A single tabbed standings view (Drivers / Constructors) that fills its cell and scrolls internally,
// so the home screen fits the viewport without the page scrolling.
export function CompactStandings() {
  const card = useLiveDriverCards()
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const teams = useSeasonStore((s) => s.teams)
  const highlight = useTeamHighlight()
  const [tab, setTab] = useState<'drivers' | 'constructors'>('drivers')

  const teamColor = (id: string) => teams.find((t) => t.id === id)?.color ?? '#6B7280'

  const tabButton = (key: 'drivers' | 'constructors', label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-widest transition-colors ${
        tab === key ? 'bg-[#00D9FF] text-[#0F1419]' : 'text-[#FFFFFF] hover:text-[#00D9FF]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-2.5 border-b border-[#2A3142]">
        <Link href={`/standings?tab=${tab}`} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#FFFFFF] hover:text-[#00D9FF] transition-colors">
          Standings<ChevronRight size={11} />
        </Link>
        <span className="flex gap-1">
          {tabButton('drivers', 'Drivers')}
          {tabButton('constructors', 'Constructors')}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <ol className="space-y-1">
          {tab === 'drivers'
            ? driverStandings.map((d, i) => (
                <li key={d.driverId} style={highlight(d.teamId, teamColor(d.teamId), d.driverId)} className="flex items-center justify-between text-sm rounded px-2 py-0.5 -mx-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                    <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: teamColor(d.teamId) }} />
                    <DriverHover id={d.driverId} card={card} className="truncate min-w-0"><DriverLink id={d.driverId} className="text-[#FFFFFF] truncate">{d.driverName}</DriverLink></DriverHover>
                  </span>
                  <span className="tabular-nums font-semibold text-[#FFFFFF] shrink-0">{d.points}</span>
                </li>
              ))
            : constructorStandings.map((c, i) => (
                <li key={c.teamId} style={highlight(c.teamId, teamColor(c.teamId))} className="flex items-center justify-between text-sm rounded px-2 py-0.5 -mx-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                    <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: teamColor(c.teamId) }} />
                    <TeamLink id={c.teamId} className="text-[#FFFFFF] truncate">{c.teamName}</TeamLink>
                  </span>
                  <span className="tabular-nums font-semibold text-[#FFFFFF] shrink-0">{c.points}</span>
                </li>
              ))}
        </ol>
      </div>
    </div>
  )
}
