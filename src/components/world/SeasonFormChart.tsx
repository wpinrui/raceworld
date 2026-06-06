'use client'

import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import type { DriverSeasonRace } from '@/lib/world/types'
import { CIRCUITS } from '@/data/calendars'

// Football-Manager-style form line across a WHOLE season: the pre-race form rating (0-10) for every
// round, dots coloured by rating, with qualifying + race result in the tooltip. Sibling of
// RecentFormCard (which shows only the last six races across season boundaries).

function dotColor(form: number): string {
  if (form >= 6.5) return '#10B981' // green
  if (form >= 5) return '#E2C53D'   // amber
  return '#DC143C'                  // red
}

interface Pt {
  x: number
  form: number
  round: number
  code: string
  circuitName: string
  grid: number
  finish: number | null
  points: number
  dnf: boolean
}

function FormTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Pt }> }) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg bg-[#2A3142] border border-[#303848] px-3 py-2 text-xs text-[#FFFFFF] shadow-lg shadow-black/40">
      <p className="font-semibold mb-1">Round {p.round} · {p.circuitName}</p>
      <p>Qualifying: P{p.grid}</p>
      <p>Race: {p.dnf ? 'DNF' : `P${p.finish}`} · {p.points} pts</p>
      <p className="mt-0.5">Form: <span className="font-semibold tabular-nums">{p.form.toFixed(1)}</span></p>
    </div>
  )
}

function renderDot(props: { cx?: number; cy?: number; payload?: Pt }) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload) return <g />
  return <circle key={payload.round} cx={cx} cy={cy} r={4} fill={dotColor(payload.form)} stroke="#1E2431" strokeWidth={2} />
}

export function SeasonFormChart({ races }: { races: DriverSeasonRace[] }) {
  if (!races || races.length === 0) {
    return <p className="px-5 py-4 text-sm text-[#FFFFFF]">No race form recorded for this season.</p>
  }
  const data: Pt[] = races.map((r, i) => ({
    x: i,
    form: r.form,
    round: r.round,
    code: CIRCUITS[r.circuitId]?.code ?? String(r.round).padStart(2, '0'),
    circuitName: r.circuitName,
    grid: r.gridPosition,
    finish: r.finishPosition,
    points: r.points,
    dnf: r.dnf,
  }))
  const avg = data.reduce((s, d) => s + d.form, 0) / data.length
  const totalPoints = races.reduce((s, r) => s + r.points, 0)

  return (
    <div>
      <div className="h-64 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 16 }}>
            <XAxis dataKey="code" stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 9 }} axisLine={false} tickLine={false} interval={0} angle={-45} textAnchor="end" height={40} />
            <YAxis hide domain={[0, 10]} />
            <RTooltip content={<FormTooltip />} cursor={{ stroke: '#2A3142' }} />
            <Line type="monotone" dataKey="form" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={false} dot={renderDot} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="px-5 py-3 border-t border-[#2A3142] flex items-center justify-between text-sm text-[#FFFFFF]">
        <span className="flex items-center gap-1.5"><span className="text-[#FFD24A]">★</span> Avg form <span className="font-bold tabular-nums">{avg.toFixed(2)}</span></span>
        <span className="text-[#FFFFFF] tabular-nums">{totalPoints} pts ({data.length} races)</span>
      </div>
    </div>
  )
}
