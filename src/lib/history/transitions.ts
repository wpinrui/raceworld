import type { Team } from '@/lib/sim/types'
import { historicalDrivers } from '@/data/history/drivers'
import { historicalGrids } from '@/data/history/grids'
import type { HistoricalDriver, HistoricalTeam } from '@/data/history/types'

// The real-world changes for a season transition (currentYear -> currentYear+1): which constructors
// join, leave, or rebrand, and which real drivers enter the market. Pure: the consent UI presents
// these for per-change approval, then the approved subset is applied to the next-season state.

export interface TeamRebrand {
  id: string
  from: { name: string; shortName: string; color: string; nationality: string }
  to: HistoricalTeam
}

export interface RealWorldTransition {
  toYear: number
  hasData: boolean // false when the timeline has no data for toYear (fall back to the pure sim)
  teamJoins: HistoricalTeam[]
  teamLeaves: { id: string; name: string }[]
  teamRebrands: TeamRebrand[]
  rookieEntries: HistoricalDriver[]
}

export function realWorldTransition(currentYear: number, currentTeams: Team[]): RealWorldTransition {
  const toYear = currentYear + 1
  const base: RealWorldTransition = { toYear, hasData: false, teamJoins: [], teamLeaves: [], teamRebrands: [], rookieEntries: [] }
  const next = historicalGrids.find((g) => g.year === toYear)
  if (!next) return base

  // The real diff is grids[currentYear] -> grids[toYear], applied against the live grid (whose team
  // ids track grids[currentYear] since teams only change via this script or god-mode).
  const cur = historicalGrids.find((g) => g.year === currentYear)
  const curById = new Map((cur?.teams ?? []).map((t) => [t.id, t]))
  const nextById = new Map(next.teams.map((t) => [t.id, t]))
  const liveIds = new Set(currentTeams.map((t) => t.id))

  const teamJoins = next.teams.filter((t) => !curById.has(t.id) && !liveIds.has(t.id))
  const teamLeaves = currentTeams
    .filter((t) => curById.has(t.id) && !nextById.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }))
  const teamRebrands: TeamRebrand[] = currentTeams.flatMap((live) => {
    const to = nextById.get(live.id)
    // Only a NAME change is a rebrand; a livery colour/shortName tweak with the same name is not.
    if (!to || to.name === live.name) return []
    return [{ id: live.id, from: { name: live.name, shortName: live.shortName, color: live.color, nationality: live.nationality }, to }]
  })
  const rookieEntries: HistoricalDriver[] = historicalDrivers.filter((d) => d.marketEntryYear === toYear)

  return { toYear, hasData: true, teamJoins, teamLeaves, teamRebrands, rookieEntries }
}
