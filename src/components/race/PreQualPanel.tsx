'use client'

import ReactCountryFlag from 'react-country-flag'
import type { Driver, Team, Circuit } from '@/lib/sim/types'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { useRatingsHidden } from '@/lib/useRatingsHidden'
import { useSeasonStore } from '@/lib/store/season-store'
import { useTeamHighlight } from '@/lib/useTeamHighlight'

interface Props {
  drivers: Driver[]
  teams: Team[]
  forms: Record<string, number>
  currentCircuit: Circuit | undefined
  onFormChange: (id: string, v: number) => void
}

// The grid is always laid out in constructors'-championship order (regardless of Team Manager / Scout). The
// ratings block (Car/Pace/Wet/Ovt/Smt) and the editable Form column are god-mode info: shown in the sandbox
// and when Scout Network reveals the grid, hidden otherwise. Your own team's rows are highlighted.
export function PreQualPanel({
  drivers, teams, forms, currentCircuit, onFormChange,
}: Props) {
  const card = useLiveDriverCards()
  const hidden = useRatingsHidden()
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode || s.driverMode)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const highlight = useTeamHighlight()

  // Constructors' order: group drivers by their team's WCC standing (stable within a team).
  const teamRank = new Map(constructorStandings.map((cs, i) => [cs.teamId, i]))
  const sorted = [...drivers].sort((a, b) => (teamRank.get(a.teamId) ?? 999) - (teamRank.get(b.teamId) ?? 999))

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
          <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">Grid</h2>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="text-xs font-bold tracking-widest uppercase border-b border-[#2A3142] text-[#FFFFFF]">
              <th className="py-1 px-2 text-left">Driver</th>
              <th className="py-1 px-2 text-left">Team</th>
              {!teamManagerMode && <th className="py-1 px-2 text-left">Form</th>}
              {!hidden && (
                <>
                  <th className="py-1 px-2 text-right">Car</th>
                  <th className="py-1 px-2 text-right">Pace</th>
                  <th className="py-1 px-2 text-right">Wet</th>
                  <th className="py-1 px-2 text-right">Ovt</th>
                  <th className="py-1 px-2 text-right">Smt</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const team = teams.find((t) => t.id === d.teamId)
              const form = forms[d.id] ?? 5
              return (
                <tr key={d.id} style={highlight(d.teamId, team?.color, d.id)} className="border-b border-[#1a2030] hover:bg-[#1E2431] transition-colors">
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
                  {/* Ratings block: shown in the sandbox and when Scout Network reveals the grid. */}
                  {!hidden && (
                    <>
                      <td className="py-1 px-2 text-right text-sm font-semibold text-[#FFFFFF]">{team?.carPace ?? '—'}</td>
                      {(['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const).map((stat) => (
                        <td key={stat} className="py-1 px-2 text-right text-sm font-semibold text-[#FFFFFF]">{d[stat]}</td>
                      ))}
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
