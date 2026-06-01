'use client'

import type { RaceResult, Driver, Team } from '@/lib/sim/types'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

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

// Perceived brightness, 0..1.
function brightness(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

// Dim a bar colour (e.g. Mercedes teal) until white text on it has contrast,
// preserving its hue. Dark colours pass through untouched.
function readableBar(hex: string): string {
  const b = brightness(hex)
  return b > 0.4 ? darken(hex, 0.4 / b) : hex
}

interface Side {
  qual: number
  raceAhead: number
  points: number
  gridSum: number
  gridN: number
  finSum: number
  finN: number
}

function blank(): Side {
  return { qual: 0, raceAhead: 0, points: 0, gridSum: 0, gridN: 0, finSum: 0, finN: 0 }
}

function accumulate(side: Side, r: RaceResult) {
  side.points += r.points
  if (r.gridPosition > 0) { side.gridSum += r.gridPosition; side.gridN++ }
  if (!r.dnf && r.finishPosition != null) { side.finSum += r.finishPosition; side.finN++ }
}

function computePairH2H(d1: string, d2: string, raceResults: RaceResult[][]): [Side, Side] {
  const s1 = blank(), s2 = blank()
  for (const round of raceResults) {
    const a = round.find((r) => r.driverId === d1)
    const b = round.find((r) => r.driverId === d2)
    if (a) accumulate(s1, a)
    if (b) accumulate(s2, b)
    if (!a || !b) continue

    const aq = a.q1Time ?? a.q2Time ?? a.q3Time
    const bq = b.q1Time ?? b.q2Time ?? b.q3Time
    if (aq != null && bq != null) {
      if (aq < bq) s1.qual++
      else if (bq < aq) s2.qual++
    }
    // Only races both finished — a DNF shouldn't count either way.
    if (!a.dnf && !b.dnf && a.finishPosition != null && b.finishPosition != null) {
      if (a.finishPosition < b.finishPosition) s1.raceAhead++
      else if (b.finishPosition < a.finishPosition) s2.raceAhead++
    }
  }
  return [s1, s2]
}

const avg = (sum: number, n: number): number | null => (n > 0 ? sum / n : null)
const fmtAvg = (v: number | null): string => (v == null ? '—' : v.toFixed(1))

// Width of the left segment. Higher-is-better → bigger value wins; lower-is-better
// (grid/finish averages) → smaller value wins, so the better driver still leads.
function higherPct(a: number, b: number): number {
  return a + b > 0 ? (a / (a + b)) * 100 : 50
}
function lowerPct(a: number | null, b: number | null): number {
  if (a == null || b == null || a + b === 0) return 50
  return (b / (a + b)) * 100
}

function Bar({ label, leftText, rightText, leftPct, c1, c2 }: {
  label: string; leftText: string; rightText: string; leftPct: number; c1: string; c2: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-sm text-[#FFFFFF]">{label}</span>
      <div className="flex-1 flex h-7 rounded overflow-hidden bg-[#2A3142] text-xs font-semibold tabular-nums">
        <div className="flex items-center pl-2 min-w-0" style={{ width: `${leftPct}%`, backgroundColor: c1 }}>
          <span className="text-[#FFFFFF]">{leftText}</span>
        </div>
        <div className="flex items-center justify-end pr-2 min-w-0 flex-1" style={{ backgroundColor: c2 }}>
          <span className="text-[#FFFFFF]">{rightText}</span>
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
      let [s1, s2] = computePairH2H(a.id, b.id, raceResults)
      // Put the higher points-scorer on the left.
      if (s2.points > s1.points) { [a, b] = [b, a]; [s1, s2] = [s2, s1] }
      const base = readableBar(team.color)
      return { team, a, b, s1, s2, c1: base, c2: darken(base, 0.55) }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (cards.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No two-driver teams to compare.</p>
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {cards.map(({ team, a, b, s1, s2, c1, c2 }) => {
        const g1 = avg(s1.gridSum, s1.gridN), g2 = avg(s2.gridSum, s2.gridN)
        const f1 = avg(s1.finSum, s1.finN), f2 = avg(s2.finSum, s2.finN)
        return (
          <div key={team.id} className="rounded-xl bg-[#1E2431] border border-[#2A3142] p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-1 h-5 rounded-sm" style={{ backgroundColor: team.color }} />
              <TeamLink id={team.id} className="font-display text-base tracking-wide uppercase text-[#FFFFFF]">{team.name}</TeamLink>
            </div>
            <div className="flex items-center gap-5 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c1 }} />
                <DriverLink id={a.id} className="text-[#FFFFFF]">{a.name}</DriverLink>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c2 }} />
                <DriverLink id={b.id} className="text-[#FFFFFF]">{b.name}</DriverLink>
              </span>
            </div>
            <div className="space-y-2">
              <Bar label="Faster in qualifying" leftText={`${s1.qual}`} rightText={`${s2.qual}`} leftPct={higherPct(s1.qual, s2.qual)} c1={c1} c2={c2} />
              <Bar label="Finished ahead" leftText={`${s1.raceAhead}`} rightText={`${s2.raceAhead}`} leftPct={higherPct(s1.raceAhead, s2.raceAhead)} c1={c1} c2={c2} />
              <Bar label="Points scored" leftText={`${s1.points}`} rightText={`${s2.points}`} leftPct={higherPct(s1.points, s2.points)} c1={c1} c2={c2} />
              <Bar label="Avg grid" leftText={fmtAvg(g1)} rightText={fmtAvg(g2)} leftPct={lowerPct(g1, g2)} c1={c1} c2={c2} />
              <Bar label="Avg finish" leftText={fmtAvg(f1)} rightText={fmtAvg(f2)} leftPct={lowerPct(f1, f2)} c1={c1} c2={c2} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
