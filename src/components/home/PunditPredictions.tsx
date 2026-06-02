'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { DriverLink } from '@/components/world/EntityLink'
import { positionPalette } from '@/components/world/pills'
import type { Driver, Team, RaceResult } from '@/lib/sim/types'

const FORM_RACES = 4 // recent races that feed the form read

interface Prediction {
  driver: Driver
  team: Team
  recent: (number | null)[] // recent finishes, oldest→newest (null = DNF)
  trend: number // base predicted position − blended position; +ve = climbing on form
}

// Blend raw pace (car + driver) with recent finishing form. Early season, with no
// results, it falls back to raw pace; as races complete, a driver beating their
// machinery climbs and a slumping one drops — so the call shifts week to week.
function predict(drivers: Driver[], teams: Team[], raceResults: RaceResult[][], currentRound: number): Prediction[] {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const grid = drivers
    .filter((d) => d.teamId !== '')
    .map((d) => ({ d, team: teamById.get(d.teamId) }))
    .filter((p): p is { d: Driver; team: Team } => p.team !== undefined)
  const field = grid.length || 20

  // Raw expected position from car pace + driver pace.
  const byBase = [...grid].sort((a, b) => b.team.carPace + b.d.pace * 0.5 - (a.team.carPace + a.d.pace * 0.5))
  const basePos = new Map<string, number>()
  byBase.forEach((x, i) => basePos.set(x.d.id, i + 1))

  const recentRounds = raceResults.slice(0, Math.max(0, currentRound - 1)).slice(-FORM_RACES)

  return grid
    .map(({ d, team }) => {
      const recent: (number | null)[] = []
      for (const round of recentRounds) {
        const r = round.find((x) => x.driverId === d.id)
        if (r) recent.push(r.dnf ? null : r.finishPosition)
      }
      const base = basePos.get(d.id) ?? field
      const finishes = recent.map((p) => p ?? field) // DNF counts as back of the field
      const avgFin = finishes.length ? finishes.reduce((s, x) => s + x, 0) / finishes.length : base
      const metric = 0.55 * base + 0.45 * avgFin
      return { driver: d, team, recent, base, metric }
    })
    .sort((a, b) => a.metric - b.metric)
    .slice(0, 8)
    .map((p, i) => ({ driver: p.driver, team: p.team, recent: p.recent, trend: p.base - (i + 1) }))
}

function FormPill({ pos }: { pos: number | null }) {
  if (pos == null) {
    return <span className="inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-bold" style={{ backgroundColor: '#5C2475', color: '#E8BBFF' }}>R</span>
  }
  const { bg, fg } = positionPalette(pos)
  return <span className="inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-bold tabular-nums" style={{ backgroundColor: bg, color: fg }}>{pos}</span>
}

export function PunditPredictions() {
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const currentRound = useSeasonStore((s) => s.currentRound)
  const raceResults = useSeasonStore((s) => s.raceResults)

  const nextRace = calendar2026[currentRound - 1]
  if (!nextRace) {
    return (
      <Panel title="Pundit Predictions">
        <p className="text-sm text-[#6B7280]">—</p>
      </Panel>
    )
  }

  const predictions = predict(drivers, teams, raceResults, currentRound)

  return (
    <Panel title={`Pundit Predictions · ${nextRace.name}`} flush>
      <ul>
        {predictions.map((p, i) => (
          <li key={p.driver.id} className="flex items-center gap-3 border-b border-[#2A3142] px-5 py-2 last:border-b-0">
            <span className="w-6 text-sm font-bold tabular-nums text-[#FFFFFF]">P{i + 1}</span>
            <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: p.team.color }} />
            <DriverLink id={p.driver.id} className="min-w-0 flex-1 truncate text-sm font-semibold text-[#FFFFFF]">
              {p.driver.name}
            </DriverLink>
            {p.trend !== 0 && (
              <span className={`text-[10px] font-bold tabular-nums ${p.trend > 0 ? 'text-[#10B981]' : 'text-[#DC143C]'}`}>
                {p.trend > 0 ? `▲${p.trend}` : `▼${-p.trend}`}
              </span>
            )}
            <span className="hidden items-center gap-0.5 sm:flex">
              {p.recent.map((pos, j) => <FormPill key={j} pos={pos} />)}
            </span>
            <span className="w-9 text-right text-[10px] uppercase tracking-widest text-[#FFFFFF]">{p.team.shortName}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
