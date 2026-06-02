'use client'

import { useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Tooltip as RTooltip,
} from 'recharts'
import type { RatingsPoint } from '@/lib/world/types'

type SeriesKey = 'overall' | 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness'

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'overall', label: 'Overall', color: '#00D9FF' },
  { key: 'pace', label: 'Pace', color: '#FF8000' },
  { key: 'wetWeatherPace', label: 'Wet', color: '#64C4FF' },
  { key: 'overtaking', label: 'Overtaking', color: '#FF87BC' },
  { key: 'smoothness', label: 'Smoothness', color: '#27F4D2' },
]

interface Datum extends RatingsPoint { x: number }

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Datum; dataKey: string; value: number; color: string }> }) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg bg-[#2A3142] border border-[#303848] px-3 py-2 text-xs text-[#FFFFFF] shadow-lg shadow-black/40">
      <p className="font-semibold mb-1">{d.year} · {d.round === 0 ? 'Pre-season' : `Round ${d.round}`}</p>
      {payload.map((p) => {
        const s = SERIES.find((x) => x.key === p.dataKey)
        return (
          <p key={p.dataKey} className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            {s?.label ?? p.dataKey}: <span className="font-semibold tabular-nums">{p.value}</span>
          </p>
        )
      })}
    </div>
  )
}

export function RatingsProgressionChart({ history }: { history: RatingsPoint[] }) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set())

  const data: Datum[] = useMemo(() => history.map((p, i) => ({ ...p, x: i })), [history])

  // One x-tick per season, placed at that season's first data point.
  const { ticks, yearByIndex } = useMemo(() => {
    const ticks: number[] = []
    const yearByIndex: Record<number, number> = {}
    const seen = new Set<number>()
    data.forEach((d) => {
      if (!seen.has(d.year)) { seen.add(d.year); ticks.push(d.x); yearByIndex[d.x] = d.year }
    })
    return { ticks, yearByIndex }
  }, [data])

  if (data.length < 2) {
    return (
      <p className="px-5 py-8 text-sm text-[#FFFFFF] text-center">
        Not enough history yet — race a few rounds and a development line builds here.
      </p>
    )
  }

  const toggle = (k: SeriesKey) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  return (
    <div className="px-3 py-4">
      <div className="flex flex-wrap gap-2 px-2 pb-3">
        {SERIES.map((s) => {
          const off = hidden.has(s.key)
          return (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                off ? 'border-[#2A3142] text-[#6B7280]' : 'border-[#303848] text-[#FFFFFF]'
              }`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: off ? '#3A4252' : s.color }} />
              {s.label}
            </button>
          )
        })}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
          <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x" type="number" domain={['dataMin', 'dataMax']}
            ticks={ticks} tickFormatter={(i: number) => String(yearByIndex[i] ?? '')}
            stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }}
          />
          <YAxis
            domain={[(min: number) => Math.max(0, Math.floor(min - 2)), (max: number) => Math.min(100, Math.ceil(max + 2))]}
            stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={44} allowDecimals={false}
          />
          <RTooltip content={<CustomTooltip />} />
          {ticks.slice(1).map((t) => (
            <ReferenceLine key={t} x={t} stroke="#2A3142" strokeWidth={1} />
          ))}
          {SERIES.filter((s) => !hidden.has(s.key)).map((s) => (
            <Line
              key={s.key} type="monotone" dataKey={s.key} stroke={s.color}
              strokeWidth={s.key === 'overall' ? 2.5 : 1.5} dot={false}
              isAnimationActive={false} connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
