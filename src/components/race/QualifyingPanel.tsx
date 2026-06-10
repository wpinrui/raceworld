'use client'

import type { Driver, Team, Circuit } from '@/lib/sim/types'
import type { BoardRow } from './useQualifyingEngine'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { useTeamHighlight } from '@/lib/useTeamHighlight'

const ROW_H = 30
const COLS = '30px minmax(104px,1.3fr) minmax(52px,0.9fr) 84px 56px 56px 56px'

function formatLap(t: number | null): string {
  if (t === null) return '--'
  const mins = Math.floor(t / 60)
  const secs = (t % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}
const formatSector = (t: number | null) => (t === null ? '' : t.toFixed(3))

interface Props {
  rows: BoardRow[]
  sessionName: string
  cutSize: number
  dropFrom: number
  progress: number
  showElim: boolean
  eliminated: string[]
  closeElim: () => void
  drivers: Driver[]
  teams: Team[]
  currentCircuit: Circuit | undefined
}

export function QualifyingPanel({ rows, sessionName, cutSize, dropFrom, progress, showElim, eliminated, closeElim, drivers, teams, currentCircuit }: Props) {
  const driverMap = new Map(drivers.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const highlight = useTeamHighlight()

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-[#2A3142]">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg tracking-widest uppercase text-[#FFFFFF]">{sessionName} — {currentCircuit?.name}</h2>
          <span className="text-xs tracking-widest uppercase text-[#FFFFFF]">{cutSize > 0 ? `${cutSize} eliminated` : 'Top 10 shootout'}</span>
        </div>
        <div className="h-1 w-full bg-[#2A3142] rounded-full overflow-hidden">
          <div className="h-full bg-[#00D9FF] transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-3">
        <div className="grid text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142] pb-1 px-2" style={{ gridTemplateColumns: COLS }}>
          <div>#</div><div>Driver</div><div>Team</div>
          <div className="text-right">Time</div>
          <div className="text-right">S1</div><div className="text-right">S2</div><div className="text-right">S3</div>
        </div>
        <div className="relative" style={{ height: rows.length * ROW_H }}>
          {rows.map((row, idx) => {
            const driver = driverMap.get(row.carId)
            const team = driver ? teamMap.get(driver.teamId) : undefined
            const inDrop = cutSize > 0 && idx >= dropFrom
            const hl = highlight(driver?.teamId, team?.color)
            return (
              <div
                key={row.carId}
                className={`absolute left-0 right-0 grid items-center px-2 text-[#FFFFFF] border-b border-[#1E2431] ${inDrop ? 'bg-[#3D141B]' : ''}`}
                style={{
                  gridTemplateColumns: COLS, height: ROW_H, transform: `translateY(${idx * ROW_H}px)`, transition: 'transform 0.4s cubic-bezier(0.4,0,0.2,1)',
                  // Your-team highlight. On an elimination-zone row keep its red fill, just add the colour bar.
                  ...(hl ? (inDrop ? { boxShadow: hl.boxShadow } : hl) : {}),
                }}
              >
                <div className="font-bold text-sm">{idx + 1}</div>
                <div className="flex items-center gap-2 min-w-0">
                  {team && <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                  <NationalityFlag code={driver?.nationality} />
                  <span className="truncate text-sm">{driver?.name ?? row.carId}</span>
                </div>
                <div className="text-sm truncate">{team?.name ?? '---'}</div>
                <div className="text-right font-mono text-sm font-bold">{formatLap(row.best)}</div>
                <div className="text-right font-mono text-xs text-[#9CA3AF]">{formatSector(row.sectors[0])}</div>
                <div className="text-right font-mono text-xs text-[#9CA3AF]">{formatSector(row.sectors[1])}</div>
                <div className="text-right font-mono text-xs text-[#9CA3AF]">{formatSector(row.sectors[2])}</div>
              </div>
            )
          })}
        </div>
      </div>

      {showElim && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-sm tracking-widest uppercase text-[#FFFFFF] mb-3">{sessionName} — Eliminated</h3>
            <ul className="mb-6 space-y-1.5">
              {eliminated.map((id) => {
                const d = driverMap.get(id); const t = teamMap.get(d?.teamId ?? '')
                return (
                  <li key={id} className="flex items-center gap-2.5 text-[#FFFFFF] text-sm">
                    {t && <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: t.color }} />}
                    <span>{d?.name ?? id}</span>
                  </li>
                )
              })}
            </ul>
            <button onClick={closeElim} className="w-full py-3 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors cursor-pointer">Continue</button>
          </div>
        </div>
      )}
    </div>
  )
}
