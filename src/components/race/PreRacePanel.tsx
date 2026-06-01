'use client'

import type { Driver, Team, RaceState, Circuit } from '@/lib/sim/types'

function formatQualTime(t: number | null): string {
  if (t === null) return '--'
  const mins = Math.floor(t / 60)
  const secs = (t % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

interface Props {
  raceState: RaceState
  drivers: Driver[]
  teams: Team[]
  currentCircuit: Circuit | undefined
  onStartRace: () => void
}

export function PreRacePanel({ raceState, drivers, teams, currentCircuit, onStartRace }: Props) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#2A3142]">
        <h2 className="font-display text-lg tracking-widest uppercase text-[#E8EAED]">
          Qualifying — {currentCircuit?.name}
        </h2>
        <button
          onClick={onStartRace}
          className="px-6 py-2.5 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors"
        >
          Start Race
        </button>
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
                <tr key={qr.driverId} className="border-b border-[#1E2431] text-[#E8EAED] hover:bg-[#2A3142] transition-colors">
                  <td className="py-1 px-2 font-bold">{qr.gridPosition}</td>
                  <td className="py-1 px-2">
                    <div className="flex items-center gap-2.5">
                      {team && <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                      <span>{driver?.name ?? qr.driverId}</span>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-sm text-[#FFFFFF]">{team?.shortName ?? '---'}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{formatQualTime(qr.q1Time)}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{formatQualTime(qr.q2Time)}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm font-bold">{formatQualTime(qr.q3Time)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
