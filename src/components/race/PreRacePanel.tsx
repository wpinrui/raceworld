'use client'

import ReactCountryFlag from 'react-country-flag'
import type { Driver, Team, RaceState, Circuit } from '@/lib/sim/types'
import { useTeamHighlight } from '@/lib/useTeamHighlight'
import { formatLapTime } from '@/lib/format'

interface Props {
  raceState: RaceState
  drivers: Driver[]
  teams: Team[]
  currentCircuit: Circuit | undefined
}

export function PreRacePanel({ raceState, drivers, teams, currentCircuit }: Props) {
  const highlight = useTeamHighlight()
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#2A3142]">
        <h2 className="font-display text-lg tracking-widest uppercase text-[#FFFFFF]">
          Qualifying — {currentCircuit?.name}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
              <th className="text-left py-1 px-2 w-10">Pos</th>
              <th className="text-left py-1 px-2">Driver</th>
              <th className="text-left py-1 px-2">Team</th>
              <th className="text-right py-1 px-2">Q1</th>
              <th className="text-right py-1 px-2">Q2</th>
              <th className="text-right py-1 px-2">Q3</th>
            </tr>
          </thead>
          <tbody>
            {raceState.qualifyingResults.map((qr) => {
              const driver = drivers.find((d) => d.id === qr.driverId)
              const team = driver ? teams.find((t) => t.id === driver.teamId) : undefined
              return (
                <tr key={qr.driverId} style={highlight(driver?.teamId, team?.color, qr.driverId)} className="border-b border-[#1E2431] text-[#FFFFFF] hover:bg-[#2A3142] transition-colors">
                  <td className="py-1 px-2 font-bold">{qr.gridPosition}</td>
                  <td className="py-1 px-2">
                    <div className="flex items-center gap-2.5">
                      {team && <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                      <ReactCountryFlag countryCode={driver?.nationality || 'GB'} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
                      <span>{driver?.name ?? qr.driverId}</span>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-sm text-[#FFFFFF]">{team?.name ?? '---'}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{formatLapTime(qr.q1Time)}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{formatLapTime(qr.q2Time)}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm font-bold">{formatLapTime(qr.q3Time)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
