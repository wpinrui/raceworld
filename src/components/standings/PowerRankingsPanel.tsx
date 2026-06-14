'use client'

import { useState } from 'react'
import { Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react'
import type { Driver, Team, RaceResult, ConstructorStanding, DriverStanding } from '@/lib/sim/types'
import { computeDriverMediaBreakdowns } from '@/lib/sim/media-scores'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'

interface Props {
  drivers: Driver[]
  teams: Team[]
  raceResults: RaceResult[][]
  constructorStandings: ConstructorStanding[]
  driverStandings: DriverStanding[]
}

type SortKey = 'driver' | 'team' | 'champ' | 'a' | 'b' | 'c' | 'narr' | 'pace' | 'media'
type SortDir = 'asc' | 'desc'

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  driver: 'asc', team: 'asc', champ: 'asc',
  a: 'desc', b: 'desc', c: 'desc', narr: 'desc', pace: 'desc', media: 'desc',
}

interface Row {
  driver: Driver
  teamName: string
  teamColor: string
  champ: number | null
  a: number; b: number; c: number; narr: number; pace: number; media: number
}

function Th({ k, label, right, sortKey, sortDir, onSort }: {
  k: SortKey; label: string; right?: boolean; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = sortKey === k
  return (
    <th
      onClick={() => onSort(k)}
      className={`pb-2 px-3 font-medium select-none whitespace-nowrap cursor-pointer ${right ? 'text-right' : 'text-left'} ${active ? 'text-[#00D9FF]' : 'text-[#FFFFFF] hover:text-[#00D9FF]'}`}
    >
      <span className={`inline-flex items-center gap-0.5 ${right ? 'justify-end w-full' : ''}`}>
        {label}
        {active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <span className="w-[11px]" />}
      </span>
    </th>
  )
}

export function PowerRankingsPanel({ drivers, teams, raceResults, constructorStandings, driverStandings }: Props) {
  const card = useLiveDriverCards()
  const managed = useSeasonStore((s) => s.teamManagerMode || s.driverMode)
  const talentOn = useSettingsStore((s) => s.talents['data-room'] ?? false)
  // In the managed career modes the breakdown reveal is a Data Room talent; without it, force the public view.
  const gateAllowsReveal = !managed || talentOn
  const [godModeToggle, setGodModeToggle] = useState(false)
  const godMode = godModeToggle && gateAllowsReveal
  const [sortKey, setSortKey] = useState<SortKey>('media')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const champMap = new Map(driverStandings.map((s, i) => [s.driverId, i + 1]))
  const constructorRankInfo = constructorStandings.map((cs, i) => ({
    teamId: cs.teamId, points: cs.points, finalPosition: i + 1,
  }))
  const bdMap = new Map(
    computeDriverMediaBreakdowns(drivers, teams, raceResults, constructorRankInfo, teams.length).map((b) => [b.driverId, b]),
  )

  const rows: Row[] = drivers
    // Free agents are a god-mode-only detail; the public ranking is grid drivers.
    .filter((d) => bdMap.has(d.id) && (godMode || d.teamId !== ''))
    .map((d) => {
      const bd = bdMap.get(d.id)!
      const team = teamMap.get(d.teamId)
      return {
        driver: d,
        teamName: team ? team.name : 'Free Agent',
        teamColor: team?.color ?? '#6B7280',
        champ: champMap.get(d.id) ?? null,
        a: bd.a, b: bd.b, c: bd.c, narr: bd.narrative, pace: bd.paceNarrative, media: bd.score,
      }
    })

  const val = (r: Row): number | string => {
    switch (sortKey) {
      case 'driver': return r.driver.name
      case 'team': return r.teamName
      case 'champ': return r.champ ?? Infinity
      default: return r[sortKey]
    }
  }
  rows.sort((a, b) => {
    const av = val(a), bv = val(b)
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sortDir === 'asc' ? cmp : -cmp
  })

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(DEFAULT_DIR[k]) }
  }
  const th = (k: SortKey, label: string, right = false) => (
    <Th k={k} label={label} right={right} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
  )

  const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))

  return (
    <div>
      {gateAllowsReveal && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setGodModeToggle((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] transition-colors"
          >
            {godMode ? <EyeOff size={13} /> : <Eye size={13} />}
            {godMode ? 'Hide breakdown' : 'God mode: breakdown'}
          </button>
        </div>
      )}
      <div className={`overflow-x-auto ${godMode ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
              <th className="text-left pb-2 pr-3 font-medium w-8">#</th>
              {th('driver', 'Driver')}
              {th('team', 'Team')}
              {th('champ', 'Champ', true)}
              {godMode && th('a', 'Results ·50%', true)}
              {godMode && th('b', 'H2H ·30%', true)}
              {godMode && th('c', 'Car-adj ·20%', true)}
              {godMode && th('narr', 'Narr', true)}
              {godMode && th('pace', 'Pace', true)}
              {godMode && th('media', 'Media', true)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.driver.id} className="border-b border-[#2A3142]/50">
                <td className="py-1.5 pr-3 tabular-nums text-[#FFFFFF]">{i + 1}</td>
                <td className="py-1.5 px-3">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: r.teamColor }} />
                    <DriverHover id={r.driver.id} card={card}><DriverLink id={r.driver.id} className="text-[#FFFFFF] font-medium whitespace-nowrap">{r.driver.name}</DriverLink></DriverHover>
                  </span>
                </td>
                <td className="py-1.5 px-3 text-[#FFFFFF] whitespace-nowrap">
                  <TeamLink id={r.driver.teamId} className={r.teamName === 'Free Agent' ? 'italic' : ''}>{r.teamName}</TeamLink>
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.champ != null ? `P${r.champ}` : '—'}</td>
                {godMode && <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.a.toFixed(0)}</td>}
                {godMode && <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.b.toFixed(0)}</td>}
                {godMode && <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.c.toFixed(0)}</td>}
                {godMode && <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.narr === 0 ? '—' : signed(r.narr)}</td>}
                {godMode && <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{r.pace === 0 ? '—' : signed(r.pace)}</td>}
                {godMode && <td className="py-1.5 px-3 text-right tabular-nums font-bold text-[#00D9FF]">{r.media.toFixed(1)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
