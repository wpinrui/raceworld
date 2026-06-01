'use client'

import type { Driver, Team, DriverRaceState, RacePhase } from '@/lib/sim/types'

interface RaceTableProps {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  currentLap: number
  totalLaps: number
  phase: RacePhase
}

const TYRE_COLORS: Record<string, string> = {
  soft: 'text-red-400',
  medium: 'text-yellow-400',
  hard: 'text-white',
  intermediate: 'text-green-400',
  wet: 'text-blue-400',
}

const PODIUM_BG: Record<number, string> = {
  1: 'bg-[#D4AC00]',
  2: 'bg-[#9E9E9E]',
  3: 'bg-[#C0622B]',
}

function formatGap(gap: number, retired: boolean): string {
  if (retired) return 'DNF'
  if (gap === 0) return 'LEADER'
  return `+${gap.toFixed(3)}s`
}

function formatLapTime(lapTimes: number[]): string {
  if (lapTimes.length === 0) return '--'
  const last = lapTimes[lapTimes.length - 1]
  const mins = Math.floor(last / 60)
  const secs = (last % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

export default function RaceTable({
  drivers,
  teams,
  states,
  currentLap,
  totalLaps,
  phase,
}: RaceTableProps) {
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))

  const sorted = [...states].sort((a, b) => {
    if (a.retired && !b.retired) return 1
    if (!a.retired && b.retired) return -1
    return a.position - b.position
  })

  const isFinished = phase === 'finished'

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 text-[10px] font-bold tracking-widest text-[#6B7280] uppercase">
        Lap {currentLap - 1} / {totalLaps}
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[#6B7280] text-[10px] tracking-widest uppercase border-b border-[#2A3142]">
            <th className="text-left py-1.5 px-2 w-8">Pos</th>
            <th className="text-left py-1.5 px-2">Driver</th>
            <th className="text-left py-1.5 px-2">Team</th>
            <th className="text-right py-1.5 px-2">Gap</th>
            <th className="text-center py-1.5 px-2">Tyre</th>
            <th className="text-right py-1.5 px-2">Cond</th>
            <th className="text-right py-1.5 px-2">Last Lap</th>
            <th className="text-right py-1.5 px-2">Stint</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ds) => {
            const driver = driverMap.get(ds.driverId)
            const team = driver ? teamMap.get(driver.teamId) : undefined
            const podiumBg = isFinished && !ds.retired ? PODIUM_BG[ds.position] : ''
            const rowBase = podiumBg
              ? `${podiumBg} text-black`
              : ds.retired
              ? 'text-[#6B7280]'
              : 'text-[#E8EAED]'
            const tyreColor = podiumBg
              ? 'text-black'
              : TYRE_COLORS[ds.currentTyre.compound] ?? 'text-white'
            const condColor =
              ds.currentTyre.condition < 20 && !podiumBg ? 'text-red-400' : ''

            return (
              <tr
                key={ds.driverId}
                className={`border-b border-[#1E2431] ${rowBase} hover:bg-[#2A3142] transition-colors`}
              >
                <td className="py-1.5 px-2 font-mono font-bold">{ds.position}</td>
                <td className="py-1.5 px-2">
                  <div className="flex items-center gap-2">
                    {team && (
                      <div
                        className="w-0.5 h-4 rounded-full"
                        style={{ backgroundColor: team.color }}
                      />
                    )}
                    <span className="font-medium truncate max-w-[110px]">
                      {driver?.name ?? ds.driverId}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 px-2 font-mono text-[10px]">
                  {team?.shortName ?? '---'}
                </td>
                <td
                  className={`py-1.5 px-2 text-right font-mono ${
                    ds.retired ? 'text-red-400 font-bold' : ''
                  }`}
                >
                  {formatGap(ds.gap, ds.retired)}
                </td>
                <td className={`py-1.5 px-2 text-center font-bold uppercase text-[10px] ${tyreColor}`}>
                  {ds.currentTyre.compound.slice(0, 1).toUpperCase()}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono ${condColor}`}>
                  {ds.retired ? '--' : `${ds.currentTyre.condition.toFixed(0)}%`}
                </td>
                <td className="py-1.5 px-2 text-right font-mono">
                  {formatLapTime(ds.lapTimes)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono">
                  {ds.retired ? '--' : ds.stintLap}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
