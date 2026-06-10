'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { DevCyclePicker } from '@/components/world/DevCyclePicker'

// Team Manager home dashboard strip: the upgrade-cycle picker (so it can't be missed), your team's
// championship line, and a shortcut to its World page. Renders only in Team Manager mode.

const ordinal = (n: number): string => {
  const v = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-[#FFFFFF]">{value}</span>
    </div>
  )
}

export function TeamManagerPanel() {
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode)
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const teams = useSeasonStore((s) => s.teams)

  if (!teamManagerMode || !playerTeamId) return null

  const team = teams.find((t) => t.id === playerTeamId)
  const idx = constructorStandings.findIndex((c) => c.teamId === playerTeamId)
  const standing = idx >= 0 ? constructorStandings[idx] : null

  // Wins / podiums this season, counted from the per-driver per-round finishing positions.
  let wins = 0
  let podiums = 0
  if (standing) {
    for (const driverResults of standing.results) {
      for (const pos of driverResults) {
        if (pos === 1) wins++
        if (pos != null && pos <= 3) podiums++
      }
    }
  }

  return (
    <div className="shrink-0 rounded-xl bg-[#1E2431] border border-[#2A3142] p-4 flex flex-wrap items-center gap-x-10 gap-y-4">
      <DevCyclePicker />

      <div className="flex items-center gap-8">
        <Stat label="Position" value={idx >= 0 ? ordinal(idx + 1) : '—'} />
        <Stat label="Wins" value={wins} />
        <Stat label="Podiums" value={podiums} />
        <Stat label="Points" value={standing?.points ?? 0} />
      </div>

      <Link
        href={`/world/team/${playerTeamId}`}
        className="ml-auto inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
      >
        {team?.name ?? 'Your team'} page<ChevronRight size={13} />
      </Link>
    </div>
  )
}
