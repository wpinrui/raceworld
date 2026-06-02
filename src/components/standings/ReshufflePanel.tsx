'use client'

import type { EndOfSeasonSummary, Team } from '@/lib/sim/types'

interface Props {
  summary: EndOfSeasonSummary
  teams: Team[]
}

export function ReshufflePanel({ summary, teams }: Props) {
  const rows = teams
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      oldPace: summary.carReshuffleOldPaces[t.id] ?? t.carPace,
      newPace: summary.carReshuffleNewPaces[t.id] ?? t.carPace,
    }))
    .sort((a, b) => b.newPace - a.newPace)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
            <th className="text-left pb-2 pr-4 font-medium">Team</th>
            <th className="text-right pb-2 px-3 font-medium">Old Pace</th>
            <th className="text-right pb-2 px-3 font-medium">New Pace</th>
            <th className="text-right pb-2 font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, color, oldPace, newPace }) => {
            const delta = newPace - oldPace
            const deltaColor = delta > 0 ? 'text-[#10B981]' : delta < 0 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'
            return (
              <tr key={id} className="border-b border-[#2A3142]/50">
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-4 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-[#FFFFFF] font-medium">{name}</span>
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF]">{oldPace.toFixed(1)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-[#FFFFFF] font-semibold">{newPace.toFixed(1)}</td>
                <td className={`py-2 text-right tabular-nums font-semibold ${deltaColor}`}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
