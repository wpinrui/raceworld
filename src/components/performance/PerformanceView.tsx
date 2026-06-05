'use client'

import { useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, ZAxis,
  CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip,
} from 'recharts'
import { useSeasonStore } from '@/lib/store/season-store'
import type { Team } from '@/lib/sim/types'
import { buildPerformanceData, regression, type PacePoint } from '@/lib/world/performance'

function ScatterTip({ active, payload, teamName }: { active?: boolean; payload?: Array<{ payload: PacePoint }>; teamName: (id: string) => string }) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg bg-[#2A3142] border border-[#303848] px-3 py-2 text-xs text-[#FFFFFF] shadow-lg shadow-black/40">
      <p className="font-semibold">{p.driverName}</p>
      <p>{teamName(p.teamId)} · Round {p.round}</p>
      <p className="tabular-nums">Car pace {p.pace.toFixed(1)} · Finished P{p.finish}</p>
    </div>
  )
}

function DeltaTip({ active, payload, label, teams }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: number; teams: Team[] }) {
  if (!active || !payload || payload.length === 0) return null
  const rows = [...payload].sort((a, b) => b.value - a.value)
  return (
    <div className="rounded-lg bg-[#2A3142] border border-[#303848] px-3 py-2 text-xs text-[#FFFFFF] shadow-lg shadow-black/40">
      <p className="font-semibold mb-1">Round {label}</p>
      {rows.map((r) => (
        <p key={r.dataKey} className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
          {teams.find((t) => t.id === r.dataKey)?.shortName ?? r.dataKey}
          <span className="ml-auto font-semibold tabular-nums">{r.value > 0 ? `+${r.value}` : r.value}</span>
        </p>
      ))}
    </div>
  )
}

export function PerformanceView() {
  const raceResults = useSeasonStore((s) => s.raceResults)
  const carPaceHistory = useSeasonStore((s) => s.carPaceHistory)
  const teams = useSeasonStore((s) => s.teams)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const { points, deltaRows } = useMemo(() => buildPerformanceData(raceResults, carPaceHistory, teams), [raceResults, carPaceHistory, teams])

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id
  // Order the legend + series by latest car pace (fastest first).
  const orderedTeams = useMemo(() => {
    const latest = [...carPaceHistory].sort((a, b) => b.round - a.round)[0]?.paces ?? {}
    return [...teams].sort((a, b) => (latest[b.id] ?? 0) - (latest[a.id] ?? 0))
  }, [teams, carPaceHistory])

  const pointsByTeam = useMemo(() => {
    const m = new Map<string, PacePoint[]>()
    for (const p of points) (m.get(p.teamId) ?? m.set(p.teamId, []).get(p.teamId)!).push(p)
    return m
  }, [points])

  const visible = points.filter((p) => !hidden.has(p.teamId))
  const reg = regression(visible)
  const paces = visible.map((p) => p.pace)
  const xMin = paces.length ? Math.floor(Math.min(...paces) - 2) : 0
  const xMax = paces.length ? Math.ceil(Math.max(...paces) + 2) : 100
  const yMax = points.length ? Math.max(...points.map((p) => p.finish)) : 20

  const toggle = (id: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  if (points.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">Run some races and this will fill in: every finish plotted against the car that scored it.</p>
  }

  const Header = ({ title, hint }: { title: string; hint: string }) => (
    <div className="shrink-0 flex items-baseline justify-between px-1 mb-1.5">
      <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{title}</span>
      <span className="text-[10px] text-[#FFFFFF]">{hint}</span>
    </div>
  )

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Team filter (shared by both charts) */}
      <div className="shrink-0 flex flex-wrap gap-1.5">
        {orderedTeams.map((t) => {
          const off = hidden.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${off ? 'border-[#2A3142] text-[#6B7280]' : 'border-[#303848] text-[#FFFFFF]'}`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: off ? '#3A4252' : t.color }} />
              {t.shortName}
            </button>
          )
        })}
      </div>

      {/* A — scatter: car pace vs finish, with trend line */}
      <div className="flex-[3] min-h-0 flex flex-col rounded-xl bg-[#1E2431] border border-[#2A3142] p-3">
        <Header title="Pace vs result" hint={reg ? `correlation R² ${reg.r2.toFixed(2)} · each dot = a finish` : 'each dot = a finish'} />
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
              <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" />
              <XAxis
                type="number" dataKey="pace" name="Car pace" domain={[xMin, xMax]} allowDecimals={false}
                stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }}
                label={{ value: 'Car pace  (slower ← → faster)', position: 'insideBottom', offset: -12, fill: '#FFFFFF', fontSize: 11 }}
              />
              <YAxis
                type="number" dataKey="finish" name="Finish" reversed domain={[1, yMax]} allowDecimals={false}
                stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={34}
                label={{ value: 'Finish', angle: -90, position: 'insideLeft', fill: '#FFFFFF', fontSize: 11 }}
              />
              <ZAxis range={[36, 36]} />
              <RTooltip cursor={{ strokeDasharray: '3 3' }} content={<ScatterTip teamName={teamName} />} />
              {orderedTeams.filter((t) => !hidden.has(t.id)).map((t) => (
                <Scatter key={t.id} name={t.name} data={pointsByTeam.get(t.id) ?? []} fill={t.color} isAnimationActive={false} />
              ))}
              {reg && (
                <ReferenceLine
                  ifOverflow="extendDomain"
                  segment={[{ x: xMin, y: reg.intercept + reg.slope * xMin }, { x: xMax, y: reg.intercept + reg.slope * xMax }]}
                  stroke="#FFFFFF" strokeDasharray="6 4" strokeWidth={1.5}
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* C — over/under-performance delta per round */}
      <div className="flex-[2] min-h-0 flex flex-col rounded-xl bg-[#1E2431] border border-[#2A3142] p-3">
        <Header title="Over / under-performance" hint="expected finish (from pace) − actual · above 0 = beating the car" />
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={deltaRows} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
              <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="round" type="number" domain={[1, 'dataMax']} allowDecimals={false} stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} />
              <YAxis stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={32} />
              <ReferenceLine y={0} stroke="#6B7280" />
              <RTooltip content={<DeltaTip teams={teams} />} />
              {orderedTeams.filter((t) => !hidden.has(t.id)).map((t) => (
                <Line key={t.id} type="monotone" dataKey={t.id} stroke={t.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
