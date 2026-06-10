'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import type { Driver, Team, Circuit } from '@/lib/sim/types'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { useRatingsHidden } from '@/lib/useRatingsHidden'
import { useSeasonStore } from '@/lib/store/season-store'
import { normalisedRatingFill } from '@/lib/team-manager'

// Fog-of-war bar: a driver's stat shown as a fill (no number) when ratings are hidden in Team Manager.
function FogBar({ fill }: { fill: number }) {
  return (
    <div className="inline-block w-16 h-1.5 rounded-full bg-[#2A3142] align-middle overflow-hidden">
      <div className="h-full rounded-full bg-[#00D9FF]" style={{ width: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%` }} />
    </div>
  )
}

interface Props {
  drivers: Driver[]
  teams: Team[]
  forms: Record<string, number>
  currentCircuit: Circuit | undefined
  onFormChange: (id: string, v: number) => void
}

type SortKey = 'driver' | 'team' | 'form' | 'car' | 'pace' | 'wet' | 'ovt' | 'smt'
type SortDir = 'asc' | 'desc'

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  driver: 'asc',
  team: 'asc',
  form: 'desc',
  car: 'desc',
  pace: 'desc',
  wet: 'desc',
  ovt: 'desc',
  smt: 'desc',
}

function sortDrivers(
  drivers: Driver[],
  teams: Team[],
  forms: Record<string, number>,
  key: SortKey,
  dir: SortDir,
): Driver[] {
  const cmp = (a: Driver, b: Driver): number => {
    const ta = teams.find((t) => t.id === a.teamId)
    const tb = teams.find((t) => t.id === b.teamId)
    switch (key) {
      case 'driver': return a.name.localeCompare(b.name)
      case 'team':   return (ta?.name ?? '').localeCompare(tb?.name ?? '')
      case 'form':   return (forms[a.id] ?? 5) - (forms[b.id] ?? 5)
      case 'car':    return (ta?.carPace ?? 0) - (tb?.carPace ?? 0)
      case 'pace':   return a.pace - b.pace
      case 'wet':    return a.wetWeatherPace - b.wetWeatherPace
      case 'ovt':    return a.overtaking - b.overtaking
      case 'smt':    return a.smoothness - b.smoothness
    }
  }
  const sorted = [...drivers].sort(cmp)
  return dir === 'desc' ? sorted.reverse() : sorted
}

interface ThProps {
  col: SortKey
  children: React.ReactNode
  right?: boolean
  activeSortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}

function Th({ col, children, right, activeSortKey, sortDir, onSort }: ThProps) {
  const active = col === activeSortKey
  return (
    <th
      className={`py-1 px-2 cursor-pointer select-none whitespace-nowrap transition-colors
        ${right ? 'text-right' : 'text-left'}
        ${active ? 'text-[#00D9FF]' : 'text-[#FFFFFF] hover:text-[#FFFFFF]'}`}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center gap-0.5 ${right ? 'justify-end w-full' : ''}`}>
        {children}
        {active
          ? sortDir === 'asc'
            ? <ChevronUp size={11} className="shrink-0" />
            : <ChevronDown size={11} className="shrink-0" />
          : <span className="w-[11px]" />}
      </span>
    </th>
  )
}

export function PreQualPanel({
  drivers, teams, forms, currentCircuit, onFormChange,
}: Props) {
  const card = useLiveDriverCards()
  const hidden = useRatingsHidden()
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode)
  const maxCarPace = Math.max(1, ...teams.map((t) => t.carPace))
  const [sortKey, setSortKey] = useState<SortKey>('car')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  const sorted = sortDrivers(drivers, teams, forms, sortKey, sortDir)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-end gap-4 px-6 pt-5 pb-4 border-b border-[#2A3142]">
        <div className="flex-1">
          <p className="text-xs text-[#FFFFFF] uppercase tracking-wider mb-1">Race Weekend</p>
          <h2 className="font-display text-xl tracking-wider uppercase text-[#FFFFFF]">
            {currentCircuit?.name ?? '—'}
          </h2>
          <p className="text-sm text-[#FFFFFF] mt-0.5">
            {currentCircuit?.location} · {currentCircuit?.laps} laps
          </p>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
          <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">Driver Forms</h2>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
              <Th col="driver" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Driver</Th>
              <Th col="team" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Team</Th>
              {!teamManagerMode && <Th col="form" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Form</Th>}
              <Th col="car" right activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Car</Th>
              <Th col="pace" right activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Pace</Th>
              <Th col="wet" right activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Wet</Th>
              <Th col="ovt" right activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Ovt</Th>
              <Th col="smt" right activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Smt</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const team = teams.find((t) => t.id === d.teamId)
              const form = forms[d.id] ?? 5
              return (
                <tr key={d.id} className="border-b border-[#1a2030] hover:bg-[#1E2431] transition-colors">
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: team?.color }} />
                      <ReactCountryFlag countryCode={d.nationality || 'GB'} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
                      <DriverHover id={d.id} card={card}><DriverLink id={d.id} className="text-sm font-medium text-[#FFFFFF]">{d.name}</DriverLink></DriverHover>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-sm text-[#FFFFFF]"><TeamLink id={d.teamId} className="text-[#FFFFFF]">{team?.name ?? '—'}</TeamLink></td>
                  {/* Form is god-mode only — hidden entirely in Team Manager (Peak Form talent maxes your own). */}
                  {!teamManagerMode && (
                    <td className="py-1 px-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="range" min={0} max={10} step={0.5}
                          value={form}
                          onChange={(e) => onFormChange(d.id, Number(e.target.value))}
                          className="w-20 accent-[#00D9FF]"
                        />
                        <span className={`text-xs w-6 text-right ${form > 5 ? 'text-[#10B981]' : form < 5 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}`}>
                          {form.toFixed(1)}
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="py-1 px-2 text-right text-sm font-semibold text-[#FFFFFF]">
                    {hidden ? <FogBar fill={(team?.carPace ?? 0) / maxCarPace} /> : (team?.carPace ?? '—')}
                  </td>
                  {(['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const).map((stat) => (
                    <td key={stat} className="py-1 px-2 text-right text-sm font-semibold text-[#FFFFFF]">
                      {hidden ? <FogBar fill={normalisedRatingFill(d, stat)} /> : d[stat]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
