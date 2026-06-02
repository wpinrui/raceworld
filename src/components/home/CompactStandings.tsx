'use client'

import Link from 'next/link'
import { useSeasonStore } from '@/lib/store/season-store'
import { Panel } from '@/components/world/ui'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

export function CompactStandings() {
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const teams = useSeasonStore((s) => s.teams)

  const teamColor = (id: string) => teams.find((t) => t.id === id)?.color ?? '#6B7280'

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Panel title="Drivers">
        <ol className="space-y-1">
          {driverStandings.slice(0, 5).map((d, i) => (
            <li key={d.driverId} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-4 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: teamColor(d.teamId) }} />
                <DriverLink id={d.driverId} className="text-[#FFFFFF] truncate">{d.driverName}</DriverLink>
              </span>
              <span className="tabular-nums font-semibold text-[#FFFFFF] shrink-0">{d.points}</span>
            </li>
          ))}
        </ol>
        <Link href="/standings" className="mt-2 inline-block text-xs text-[#FFFFFF] hover:text-[#00D9FF]">full standings →</Link>
      </Panel>

      <Panel title="Constructors">
        <ol className="space-y-1">
          {constructorStandings.slice(0, 5).map((c, i) => (
            <li key={c.teamId} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-4 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: teamColor(c.teamId) }} />
                <TeamLink id={c.teamId} className="text-[#FFFFFF] truncate">{c.teamName}</TeamLink>
              </span>
              <span className="tabular-nums font-semibold text-[#FFFFFF] shrink-0">{c.points}</span>
            </li>
          ))}
        </ol>
        <Link href="/standings" className="mt-2 inline-block text-xs text-[#FFFFFF] hover:text-[#00D9FF]">full standings →</Link>
      </Panel>
    </div>
  )
}
