'use client'

import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import type { Team, DevUpgradeEvent } from '@/lib/sim/types'

// Each car's pace across the season, reconstructed from the current pace and the upgrade log: a car's
// pace at the end of round r is its current pace minus every (non-failed) upgrade delivered after r.
// Failed upgrades are logged with paceDelta 0, so they fall out of the sum. No stored history needed;
// mid-season the only thing that moves carPace is an upgrade event.
const round1 = (n: number) => Math.round(n * 10) / 10

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
          {teams.find((t) => t.id === p.dataKey)?.shortName ?? p.dataKey}: <span className="font-semibold tabular-nums">{p.value.toFixed(1)}</span>
        </p>
      ))}
    </div>
  )
}

function buildSeries(teams: Team[], events: DevUpgradeEvent[], completedRounds: number): Row[] {
  const rows: Row[] = []
  for (let r = 0; r <= completedRounds; r++) {
    const row: Row = { round: r }
    for (const t of teams) {
      const future = events.reduce((s, e) => (e.teamId === t.id && e.round > r ? s + e.paceDelta : s), 0)
      row[t.id] = round1(t.carPace - future)
    }
    rows.push(row)
  }
  return rows
}

export function CarDevelopmentChart({ teams, events, completedRounds }: { teams: Team[]; events: DevUpgradeEvent[]; completedRounds: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // Order the legend (and so the default emphasis) by current pace, fastest first.
  const ordered = useMemo(() => [...teams].sort((a, b) => b.carPace - a.carPace), [teams])
  const data = useMemo(() => buildSeries(ordered, events, completedRounds), [ordered, events, completedRounds])

  if (completedRounds < 1) {
    return <p className="px-4 py-8 text-sm text-[#FFFFFF] text-center">Car development charts here once the season is underway.</p>
  }

  const toggle = (id: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="px-3 py-4">
      <div className="flex flex-wrap gap-1.5 px-2 pb-3">
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
      <ResponsiveContainer width="100%" height={300}>
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
              strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
