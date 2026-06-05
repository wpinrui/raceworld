'use client'

import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { useSeasonStore } from '@/lib/store/season-store'
import { buildPerformanceData } from '@/lib/world/performance'

type Sub = 'pace' | 'delta'

// Brighten a hex colour by a percentage, so a team's drivers read as lighter shades of the team colour.
function lighten(hex: string, pct: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  const f = 1 + pct
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f))
  const b = Math.min(255, Math.round((n & 255) * f))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function Chip({ on, color, label, onClick }: { on: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${on ? 'border-[#303848] text-[#FFFFFF]' : 'border-[#2A3142] text-[#6B7280]'}`}
    >
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: on ? color : '#3A4252' }} />
      {label}
    </button>
  )
}

function Tip({ active, payload, label, nameOf, signed }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: number; nameOf: (k: string) => string; signed?: boolean }) {
  if (!active || !payload || payload.length === 0) return null
  const rows = [...payload].sort((a, b) => b.value - a.value)
  return (
    <div className="rounded-lg bg-[#2A3142] border border-[#303848] px-3 py-2 text-xs text-[#FFFFFF] shadow-lg shadow-black/40">
      <p className="font-semibold mb-1">{label === 0 ? 'Season start' : `Round ${label}`}</p>
      {rows.map((r) => (
        <p key={r.dataKey} className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
          {nameOf(r.dataKey)}<span className="ml-auto font-semibold tabular-nums">{signed && r.value > 0 ? `+${r.value}` : r.value}</span>
        </p>
      ))}
    </div>
  )
}

export function PerformanceView() {
  const raceResults = useSeasonStore((s) => s.raceResults)
  const carPaceHistory = useSeasonStore((s) => s.carPaceHistory)
  const teams = useSeasonStore((s) => s.teams)

  const [sub, setSub] = useState<Sub>('pace')
  const [hidden, setHidden] = useState<Set<string>>(new Set()) // pace view: hidden teams
  const [selected, setSelected] = useState<Set<string>>(new Set()) // delta view: chosen teams/drivers

  const { rounds, paceRows, teamFinishRows, teamDeltaRows, driverDeltaRows, drivers } = useMemo(
    () => buildPerformanceData(raceResults, carPaceHistory, teams),
    [raceResults, carPaceHistory, teams],
  )

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams])
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.driverId, d])), [drivers])
  const orderedTeams = useMemo(() => {
    const latest = [...carPaceHistory].sort((a, b) => b.round - a.round)[0]?.paces ?? {}
    return [...teams].sort((a, b) => (latest[b.id] ?? 0) - (latest[a.id] ?? 0))
  }, [teams, carPaceHistory])

  // Drivers grouped under their team, each shaded a step brighter than the team (1st +10%, 2nd +20%…),
  // so a team's line and its drivers' lines are all distinguishable.
  const driversByTeam = useMemo(() => {
    const m = new Map<string, typeof drivers>()
    for (const d of drivers) { const a = m.get(d.teamId) ?? []; a.push(d); m.set(d.teamId, a) }
    return m
  }, [drivers])
  const driverShade = useMemo(() => {
    const m = new Map<string, string>()
    for (const [teamId, ds] of driversByTeam) {
      const base = teamById.get(teamId)?.color ?? '#8892A6'
      ds.forEach((d, i) => m.set(d.driverId, lighten(base, 0.1 * (i + 1))))
    }
    return m
  }, [driversByTeam, teamById])

  const colorOf = (key: string): string => teamById.get(key)?.color ?? driverShade.get(key) ?? '#8892A6'
  const nameOf = (key: string): string => teamById.get(key)?.name ?? driverById.get(key)?.driverName ?? key

  // Merge team + driver deltas by round (their ids never collide), for the over/under chart.
  const deltaData = useMemo(() => {
    const byRound = new Map<number, Record<string, number>>()
    for (const row of teamDeltaRows) byRound.set(row.round, { ...row })
    for (const row of driverDeltaRows) byRound.set(row.round, { ...(byRound.get(row.round) ?? { round: row.round }), ...row })
    return [...byRound.values()].sort((a, b) => a.round - b.round)
  }, [teamDeltaRows, driverDeltaRows])

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setter(next)
  }

  if (rounds === 0) {
    return <p className="text-sm text-[#FFFFFF]">Run some races and this will fill in.</p>
  }

  const maxFinish = Math.max(2, ...teamFinishRows.flatMap((r) => teams.map((t) => (r[t.id] as number) ?? 0)))
  const visibleTeams = orderedTeams.filter((t) => !hidden.has(t.id))

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Sub-tabs */}
      <div className="shrink-0 flex gap-1.5">
        {([['pace', 'Pace & results'], ['delta', 'Over / under']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSub(key)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${sub === key ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'pace' ? (
        <>
          <div className="shrink-0 flex flex-wrap gap-1.5">
            {orderedTeams.map((t) => <Chip key={t.id} on={!hidden.has(t.id)} color={t.color} label={t.name} onClick={() => toggle(hidden, setHidden, t.id)} />)}
          </div>
          {/* Top: car pace over the season */}
          <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#1E2431] border border-[#2A3142] p-3">
            <p className="shrink-0 text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Car pace</p>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={paceRows} margin={{ top: 6, right: 16, bottom: 4, left: -12 }}>
                  <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="round" type="number" domain={[0, rounds]} allowDecimals={false} tickFormatter={(r: number) => (r === 0 ? 'Start' : String(r))} stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} />
                  <YAxis domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]} allowDecimals={false} stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={40} />
                  <RTooltip content={<Tip nameOf={nameOf} />} />
                  {visibleTeams.map((t) => <Line key={t.id} type="monotone" dataKey={t.id} stroke={t.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Bottom: each team's best finish over the season (P1 at top) */}
          <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#1E2431] border border-[#2A3142] p-3">
            <p className="shrink-0 text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Best finish</p>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={teamFinishRows} margin={{ top: 6, right: 16, bottom: 4, left: -12 }}>
                  <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="round" type="number" domain={[0, rounds]} allowDecimals={false} stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} />
                  <YAxis reversed domain={[1, maxFinish]} allowDecimals={false} stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={40} />
                  <RTooltip content={<Tip nameOf={nameOf} />} />
                  {visibleTeams.map((t) => <Line key={t.id} type="monotone" dataKey={t.id} stroke={t.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 max-h-40 overflow-y-auto flex flex-wrap gap-2">
            {orderedTeams.filter((t) => (driversByTeam.get(t.id)?.length ?? 0) > 0).map((t) => (
              <div key={t.id} className="rounded-lg border border-[#2A3142] bg-[#0F1419]/40 p-2 flex flex-col gap-1.5">
                <Chip on={selected.has(t.id)} color={t.color} label={t.name} onClick={() => toggle(selected, setSelected, t.id)} />
                <div className="flex flex-wrap gap-1.5">
                  {(driversByTeam.get(t.id) ?? []).map((d) => (
                    <Chip key={d.driverId} on={selected.has(d.driverId)} color={colorOf(d.driverId)} label={d.driverName} onClick={() => toggle(selected, setSelected, d.driverId)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#1E2431] border border-[#2A3142] p-3">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={deltaData} margin={{ top: 6, right: 16, bottom: 4, left: -16 }}>
                  <CartesianGrid stroke="#2A3142" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="round" type="number" domain={[1, rounds]} allowDecimals={false} stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} />
                  <YAxis stroke="#6B7280" tick={{ fill: '#FFFFFF', fontSize: 11 }} width={32} />
                  <ReferenceLine y={0} stroke="#6B7280" />
                  <RTooltip content={<Tip nameOf={nameOf} signed />} />
                  {[...selected].map((key) => <Line key={key} type="monotone" dataKey={key} stroke={colorOf(key)} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
