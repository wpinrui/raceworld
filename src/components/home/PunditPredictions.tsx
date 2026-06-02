'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { DriverLink } from '@/components/world/EntityLink'
import type { Driver, Team } from '@/lib/sim/types'

interface Prediction {
  driver: Driver
  team: Team
}

// Deterministic pundit model: car pace dominates, driver pace is a minor swing.
// No randomness, so the predicted order is stable across renders.
function predict(drivers: Driver[], teams: Team[]): Prediction[] {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  return drivers
    .filter((d) => d.teamId !== '')
    .map((d) => ({ driver: d, team: teamById.get(d.teamId) }))
    .filter((p): p is Prediction => p.team !== undefined)
    .sort(
      (a, b) =>
        b.team.carPace + b.driver.pace * 0.5 - (a.team.carPace + a.driver.pace * 0.5),
    )
    .slice(0, 8)
}

export function PunditPredictions() {
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const currentRound = useSeasonStore((s) => s.currentRound)

  const nextRace = calendar2026[currentRound - 1]

  if (!nextRace) {
    return (
      <Panel title="Pundit Predictions">
        <p className="text-sm text-[#FFFFFF]">Season complete.</p>
      </Panel>
    )
  }

  const predictions = predict(drivers, teams)

  return (
    <Panel title={`Pundit Predictions · ${nextRace.name}`} flush>
      <ul>
        {predictions.map((p, i) => (
          <li
            key={p.driver.id}
            className="flex items-center gap-3 px-5 py-2 border-b border-[#2A3142] last:border-b-0"
          >
            <span className="w-6 text-sm font-bold tabular-nums text-[#FFFFFF]">
              P{i + 1}
            </span>
            <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: p.team.color }} />
            <DriverLink id={p.driver.id} className="flex-1 truncate text-sm font-semibold text-[#FFFFFF]">
              {p.driver.name}
            </DriverLink>
            <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">
              {p.team.shortName}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
