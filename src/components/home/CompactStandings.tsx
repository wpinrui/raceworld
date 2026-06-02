'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { Panel } from '@/components/world/ui'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

function HeaderLink({ tab, children }: { tab: 'drivers' | 'constructors'; children: React.ReactNode }) {
  return (
    <Link href={`/standings?tab=${tab}`} className="inline-flex items-center gap-1 hover:text-[#00D9FF] transition-colors">
      {children}
      <ChevronRight size={11} />
    </Link>
  )
}

export function CompactStandings() {
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const teams = useSeasonStore((s) => s.teams)

  const teamColor = (id: string) => teams.find((t) => t.id === id)?.color ?? '#6B7280'

  return (
    <div className="space-y-5">
      <Panel title={<HeaderLink tab="drivers">Drivers</HeaderLink>}>
        <ol className="space-y-1">
          {driverStandings.map((d, i) => (
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
      </Panel>

      <Panel title={<HeaderLink tab="constructors">Constructors</HeaderLink>}>
        <ol className="space-y-1">
          {constructorStandings.map((c, i) => (
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
      </Panel>
    </div>
  )
}
