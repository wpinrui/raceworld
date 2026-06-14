'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { computePairH2H, readableBar, darken, PairH2HCard } from '@/components/standings/TeammateH2HPanel'

// Driver mode home dashboard strip (mirrors TeamManagerPanel). Left: your current-season head-to-head with
// your teammate. Right: your championship line with the previous race folded in, and a link to your driver
// page. Renders only in Driver mode.

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

export function DriverManagerPanel() {
  const driverMode = useSeasonStore((s) => s.driverMode)
  const playerDriverId = useSeasonStore((s) => s.playerDriverId)
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const raceResults = useSeasonStore((s) => s.raceResults)

  if (!driverMode || !playerDriverId) return null

  const player = drivers.find((d) => d.id === playerDriverId)
  const team = player && player.teamId ? teams.find((t) => t.id === player.teamId) : undefined
  const teammate = player && player.teamId ? drivers.find((d) => d.teamId === player.teamId && d.id !== player.id) : undefined

  // Championship line: WDC position + wins / podiums / points. Podiums counted off the per-round finishes.
  const wdcIdx = driverStandings.findIndex((s) => s.driverId === playerDriverId)
  const standing = wdcIdx >= 0 ? driverStandings[wdcIdx] : null
  const podiums = standing ? standing.results.filter((p) => p != null && p <= 3).length : 0

  // Previous race, folded into the same card (your grid, finish, points last time out).
  const lastRound = raceResults[raceResults.length - 1]
  const prev = lastRound?.find((r) => r.driverId === playerDriverId)
  const prevFinish = prev ? (prev.dnf || prev.finishPosition == null ? 'DNF' : `P${prev.finishPosition}`) : null

  const cardClass = 'rounded-xl bg-[#1E2431] border border-[#2A3142] p-5'
  const base = team ? readableBar(team.color) : '#2A3142'

  return (
    // Left: teammate head-to-head (current season). Right: your season line with the last race folded in.
    <div className="shrink-0 flex flex-wrap items-stretch gap-4">
      <div className="grow min-w-[20rem]">
        {team && teammate && raceResults.length > 0 ? (
          (() => {
            const [s1, s2] = computePairH2H(player!.id, teammate.id, raceResults)
            return <PairH2HCard team={team} a={player!} b={teammate} s1={s1} s2={s2} c1={base} c2={darken(base, 0.55)} />
          })()
        ) : (
          <div className={`${cardClass} h-full flex items-center`}>
            <p className="text-sm text-[#FFFFFF]">{!team ? 'You have no seat yet — head-to-head opens once you race for a team.' : !teammate ? 'No teammate to compare against.' : 'Head-to-head opens after round one.'}</p>
          </div>
        )}
      </div>

      <div className={`${cardClass} flex grow flex-col gap-5 min-w-[18rem]`}>
        <h2 className="font-display text-sm tracking-widest uppercase text-[#FFFFFF]">{player?.name ?? 'You'}{team ? ` · ${team.name}` : ' · Free agent'}</h2>

        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <Stat label="Championship" value={wdcIdx >= 0 ? ordinal(wdcIdx + 1) : '—'} />
          <Stat label="Wins" value={standing?.wins ?? 0} />
          <Stat label="Podiums" value={podiums} />
          <Stat label="Points" value={standing?.points ?? 0} />
        </div>

        {prev && (
          <div className="rounded-lg bg-[#0F1419]/40 px-3 py-2">
            <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Last time out</span>
            <p className="text-sm text-[#FFFFFF] mt-0.5">
              <span className="font-semibold">{prevFinish}</span> from P{prev.gridPosition}
              {prev.points > 0 ? `, ${prev.points} pt${prev.points === 1 ? '' : 's'}` : ', no points'}
              {prev.fastestLap ? ' · fastest lap' : ''}
            </p>
          </div>
        )}

        <Link
          href={`/world/driver/${playerDriverId}`}
          className="mt-auto self-start inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
        >
          Driver page<ChevronRight size={13} />
        </Link>
      </div>
    </div>
  )
}
