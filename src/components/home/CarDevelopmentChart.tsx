'use client'

import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import type { Team } from '@/lib/sim/types'
import type { CarPaceSnapshot } from '@/lib/store/season-helpers'

// Each car's pace across the season, read straight from the per-round snapshots the store records
// (round 0 = season start). God-mode pace edits refresh the latest snapshot, so the chart always
// matches reality without reconstructing from the upgrade log.
interface Row { round: number; [teamId: string]: number }

function CarTooltip({ active, payload, label, teams }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: number; teams: Team[] }) {
  if (!active || !payload || payload.length === 0) return null
  const rows = [...payload].sort((a, b) => b.value - a.value)
  return (
    <div className="rounded-lg bg-[#2A3142] border border-[#303848] px-3 py-2 text-xs text-[#FFFFFF] shadow-lg shadow-black/40">
      <p className="font-semibold mb-1">{label === 0 ? 'Season start' : `Round ${label}`}</p>
      {rows.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          {teams.find((t) => t.id === p.dataKey)?.name ?? p.dataKey}: <span className="font-semibold tabular-nums">{p.value.toFixed(1)}</span>
        </p>
      ))}
    </div>
  )
}

export function CarDevelopmentChart({ teams, history }: { teams: Team[]; history: CarPaceSnapshot[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // Order the legend (and so the default emphasis) by current pace, fastest first.
  const ordered = useMemo(() => [...teams].sort((a, b) => b.carPace - a.carPace), [teams])
  const data = useMemo<Row[]>(() => history.map((h) => ({ round: h.round, ...h.paces })), [history])
  // Before any race there's a single data point per car (the season-start pace); show dots so it's
  // visible, since a one-point line has no segment to draw.
  const singlePoint = data.length === 1

  const toggle = (id: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="flex flex-col h-full px-3 py-3">
      <div className="flex flex-wrap gap-1.5 px-2 pb-3 shrink-0">
        {ordered.map((t) => {
          const off = hidden.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                off ? 'border-[#2A3142] text-[#6B7280]' : 'border-[#303848] text-[#FFFFFF]'
              }`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: off ? '#3A4252' : t.color }} />
              {t.shortName}
            </button>
          )
        })}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="round" type="number" domain={[0, 'dataMax']} allowDecimals={false}
              tickFormatter={(r: number) => (r === 0 ? 'Start' : String(r))}
              stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }}
            />
            <YAxis
              domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]}
              stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={44} allowDecimals={false}
            />
            <RTooltip content={<CarTooltip teams={teams} />} />
            {ordered.filter((t) => !hidden.has(t.id)).map((t) => (
              <Line
                key={t.id} type="monotone" dataKey={t.id} stroke={t.color}
                strokeWidth={2} dot={singlePoint} isAnimationActive={false} connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
