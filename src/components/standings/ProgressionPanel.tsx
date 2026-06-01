'use client'

import type { EndOfSeasonSummary, Driver } from '@/lib/sim/types'

interface Props {
  summary: EndOfSeasonSummary
  drivers: Driver[]
}

const STAT_LABEL: Record<string, string> = {
  pace: 'Pace',
  wetWeatherPace: 'Wet',
  overtaking: 'OVT',
  smoothness: 'SMO',
}

export function ProgressionPanel({ summary, drivers }: Props) {
  const scoreMap = new Map(summary.driverMediaScores.map((s) => [s.driverId, s.score]))

  // Group events by driver
  const byDriver = new Map<string, typeof summary.progressionEvents>()
  for (const ev of summary.progressionEvents) {
    if (!byDriver.has(ev.driverId)) byDriver.set(ev.driverId, [])
    byDriver.get(ev.driverId)!.push(ev)
  }

  // Sort drivers by absolute total stat change
  const driverOrder = [...byDriver.entries()]
    .map(([id, evs]) => ({
      id,
      name: evs[0]?.driverName ?? id,
      totalDelta: evs.reduce((s, e) => s + Math.abs(e.after - e.before), 0),
      evs,
    }))
    .sort((a, b) => b.totalDelta - a.totalDelta)

  // Also include drivers with no events (no change)
  const seen = new Set(driverOrder.map((d) => d.id))
  for (const d of drivers) {
    if (!seen.has(d.id)) {
      driverOrder.push({ id: d.id, name: d.name, totalDelta: 0, evs: [] })
    }
  }

  if (driverOrder.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No stat changes this off-season.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
            <th className="text-left pb-2 pr-4 font-medium">Driver</th>
            <th className="text-right pb-2 px-3 font-medium">Media</th>
            <th className="text-left pb-2 px-3 font-medium">Stat</th>
            <th className="text-right pb-2 px-3 font-medium">Before</th>
            <th className="text-right pb-2 px-3 font-medium">After</th>
            <th className="text-right pb-2 font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {driverOrder.map(({ id, name, evs }) => {
            const score = scoreMap.get(id)
            if (evs.length === 0) {
              return (
                <tr key={id} className="border-b border-[#2A3142]/50">
                  <td className="py-1.5 pr-4 text-[#FFFFFF] font-medium">{name}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">
                    {score !== undefined ? score.toFixed(1) : '—'}
                  </td>
                  <td colSpan={4} className="py-1.5 px-3 text-[#FFFFFF] italic">No change</td>
                </tr>
              )
            }
            return evs.map((ev, i) => {
              const delta = ev.after - ev.before
              const color = delta > 0 ? 'text-[#10B981]' : delta < 0 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'
              const sign = delta > 0 ? '+' : ''
              return (
                <tr key={`${id}-${ev.stat}`} className="border-b border-[#2A3142]/50">
                  {i === 0 && (
                    <>
                      <td className="py-1.5 pr-4 text-[#FFFFFF] font-medium" rowSpan={evs.length}>{name}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]" rowSpan={evs.length}>
                        {score !== undefined ? score.toFixed(1) : '—'}
                      </td>
                    </>
                  )}
                  <td className="py-1.5 px-3 text-[#FFFFFF] text-xs font-mono uppercase">{STAT_LABEL[ev.stat] ?? ev.stat}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{ev.before.toFixed(1)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{ev.after.toFixed(1)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-semibold ${color}`}>
                    {sign}{delta.toFixed(1)}
                  </td>
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}
