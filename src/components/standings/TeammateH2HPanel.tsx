'use client'

import type { RaceResult, Driver, Team } from '@/lib/sim/types'

interface Props {
  raceResults: RaceResult[][]
  drivers: Driver[]
  teams: Team[]
}

// Darken a #rrggbb hex toward black (f = kept brightness, 0..1).
function darken(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

interface Tally { q1: number; q2: number; r1: number; r2: number; p1: number; p2: number }

function computePairH2H(d1: string, d2: string, raceResults: RaceResult[][]): Tally {
  const t: Tally = { q1: 0, q2: 0, r1: 0, r2: 0, p1: 0, p2: 0 }
  for (const round of raceResults) {
    const a = round.find((r) => r.driverId === d1)
    const b = round.find((r) => r.driverId === d2)
    if (a) t.p1 += a.points
    if (b) t.p2 += b.points
    if (!a || !b) continue

    const aq = a.q1Time ?? a.q2Time ?? a.q3Time
    const bq = b.q1Time ?? b.q2Time ?? b.q3Time
    if (aq != null && bq != null) {
      if (aq < bq) t.q1++
      else if (bq < aq) t.q2++
    }

    // Only races both finished — a DNF shouldn't count either way.
    if (!a.dnf && !b.dnf && a.finishPosition != null && b.finishPosition != null) {
      if (a.finishPosition < b.finishPosition) t.r1++
      else if (b.finishPosition < a.finishPosition) t.r2++
    }
  }
  return t
}

function Bar({ label, v1, v2, c1, c2 }: { label: string; v1: number; v2: number; c1: string; c2: string }) {
  const total = v1 + v2
  const w1 = total > 0 ? (v1 / total) * 100 : 50
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-sm text-[#FFFFFF]">{label}</span>
      <div className="flex-1 flex h-7 rounded overflow-hidden bg-[#2A3142] text-xs font-semibold tabular-nums">
        <div className="flex items-center pl-2 min-w-0" style={{ width: `${w1}%`, backgroundColor: c1 }}>
          <span className="text-[#FFFFFF]">{v1}</span>
        </div>
        <div className="flex items-center justify-end pr-2 min-w-0 flex-1" style={{ backgroundColor: c2 }}>
          <span className="text-[#FFFFFF]">{v2}</span>
        </div>
      </div>
    </div>
  )
}

export function TeammateH2HPanel({ raceResults, drivers, teams }: Props) {
  if (raceResults.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No races completed yet — head-to-head opens after round one.</p>
  }

  const cards = teams
    .map((team) => {
      const pair = drivers.filter((d) => d.teamId === team.id)
      if (pair.length < 2) return null
      let [a, b] = pair
      let t = computePairH2H(a.id, b.id, raceResults)
      // Put the higher points-scorer on the left.
      if (t.p2 > t.p1) {
        [a, b] = [b, a]
        t = { q1: t.q2, q2: t.q1, r1: t.r2, r2: t.r1, p1: t.p2, p2: t.p1 }
      }
      return { team, a, b, t, c1: team.color, c2: darken(team.color, 0.5) }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (cards.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No two-driver teams to compare.</p>
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {cards.map(({ team, a, b, t, c1, c2 }) => (
        <div key={team.id} className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-5 rounded-sm" style={{ backgroundColor: team.color }} />
            <h3 className="font-display text-base tracking-wide uppercase text-[#FFFFFF]">{team.name}</h3>
          </div>
          <div className="flex items-center gap-5 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c1 }} />
              <span className="text-[#FFFFFF]">{a.name}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c2 }} />
              <span className="text-[#FFFFFF]">{b.name}</span>
            </span>
          </div>
          <div className="space-y-2">
            <Bar label="Faster in qualifying" v1={t.q1} v2={t.q2} c1={c1} c2={c2} />
            <Bar label="Finished ahead" v1={t.r1} v2={t.r2} c1={c1} c2={c2} />
            <Bar label="Points scored" v1={t.p1} v2={t.p2} c1={c1} c2={c2} />
          </div>
        </div>
      ))}
    </div>
  )
}
