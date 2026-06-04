'use client'

import { useSeasonStore } from '@/lib/store/season-store'
import { computeDriverMediaScores } from '@/lib/sim/market'
import { Panel } from '@/components/world/ui'
import { DriverLink } from '@/components/world/EntityLink'
import { CarDevelopmentChart } from '@/components/home/CarDevelopmentChart'

export function RankingsPanel() {
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const carPaceHistory = useSeasonStore((s) => s.carPaceHistory)

  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const teamById = new Map(teams.map((t) => [t.id, t]))

  const constructorRankInfo = constructorStandings.map((cs, i) => ({
    teamId: cs.teamId,
    points: cs.points,
    finalPosition: i + 1,
  }))

  const mediaRows = computeDriverMediaScores(
    drivers,
    teams,
    raceResults,
    constructorRankInfo,
    teams.length,
  )
    .filter((m) => {
      const d = driverById.get(m.driverId)
      return d != null && d.teamId !== ''
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_2fr] lg:items-stretch">
      <Panel title="Media Driver Rankings">
        <ol className="space-y-1.5">
          {mediaRows.map((m, i) => {
            const d = driverById.get(m.driverId)!
            const team = teamById.get(d.teamId)
            return (
              <li key={m.driverId} className="flex items-center gap-2.5 text-sm">
                <span className="w-5 text-right tabular-nums text-[#FFFFFF]">{i + 1}</span>
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{ backgroundColor: team?.color ?? '#6B7280' }}
                />
                <DriverLink id={d.id} className="flex-1 text-[#FFFFFF] font-medium whitespace-nowrap">
                  {d.name}
                </DriverLink>
                <span className="tabular-nums font-bold text-[#00D9FF]">{Math.round(m.score)}</span>
              </li>
            )
          })}
        </ol>
      </Panel>

      <Panel title="Car Development" flush>
        <CarDevelopmentChart teams={teams} history={carPaceHistory} />
      </Panel>
    </div>
  )
}
