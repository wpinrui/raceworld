'use client'

import type { Driver, Team, RaceResult, ConstructorStanding } from '@/lib/sim/types'
import { computeDriverMediaBreakdowns } from '@/lib/sim/media-scores'

interface Props {
  drivers: Driver[]
  teams: Team[]
  raceResults: RaceResult[][]
  constructorStandings: ConstructorStanding[]
}

export function PowerRankingsPanel({ drivers, teams, raceResults, constructorStandings }: Props) {
  const teamMap = new Map(teams.map((t) => [t.id, t]))
  const constructorRankInfo = constructorStandings.map((cs, i) => ({
    teamId: cs.teamId,
    points: cs.points,
    finalPosition: i + 1,
  }))

  const breakdowns = computeDriverMediaBreakdowns(drivers, teams, raceResults, constructorRankInfo, teams.length)
  const bdMap = new Map(breakdowns.map((b) => [b.driverId, b]))

  const rows = drivers
    .map((d) => ({ driver: d, bd: bdMap.get(d.id)! }))
    .filter((r) => r.bd)
    .sort((a, b) => b.bd.score - a.bd.score)

  const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))

  return (
    <div>
      <p className="text-sm text-[#FFFFFF] mb-3">
        Media-perceived ability · media = 0.5·A + 0.3·B + 0.2·C + narrative + pace
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
              <th className="text-left pb-2 pr-3 font-medium w-8">#</th>
              <th className="text-left pb-2 pr-4 font-medium">Driver</th>
              <th className="text-left pb-2 px-3 font-medium">Team</th>
              <th className="text-right pb-2 px-3 font-medium">Results ·50%</th>
              <th className="text-right pb-2 px-3 font-medium">H2H ·30%</th>
              <th className="text-right pb-2 px-3 font-medium">Car-adj ·20%</th>
              <th className="text-right pb-2 px-3 font-medium">Narr</th>
              <th className="text-right pb-2 px-3 font-medium">Pace</th>
              <th className="text-right pb-2 pl-3 font-medium">Media</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ driver, bd }, i) => {
              const team = teamMap.get(driver.teamId)
              return (
                <tr key={driver.id} className="border-b border-[#2A3142]/50">
                  <td className="py-1.5 pr-3 tabular-nums text-[#FFFFFF]">{i + 1}</td>
                  <td className="py-1.5 pr-4">
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ backgroundColor: team?.color ?? '#6B7280' }} />
                      <span className="text-[#FFFFFF] font-medium">{driver.name}</span>
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-[#FFFFFF]">
                    {team ? team.name : <span className="italic">Free Agent</span>}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{bd.a.toFixed(0)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{bd.b.toFixed(0)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{bd.c.toFixed(0)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{bd.narrative === 0 ? '—' : signed(bd.narrative)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-[#FFFFFF]">{bd.paceNarrative === 0 ? '—' : signed(bd.paceNarrative)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums font-bold text-[#00D9FF]">{bd.score.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
