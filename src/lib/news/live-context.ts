import { calendar2026 } from '@/data/calendar'
import { foldLiveSeason, foldLiveSeasonTeams, type NewsContext, type DriverCareer, type TeamCareer } from './engine'
import type { Driver, Team, RaceResult, SeasonPhase, DevUpgradeEvent, ConstructorSeasonRecord, EndOfSeasonSummary } from '@/lib/sim/types'

// Assemble the live (current-season) NewsContext from the store, folding the archive's prior-season
// career totals on top of the in-progress season. Shared by the newsroom and the Continue loop so
// both see exactly the same generated feed (and the same interrupt decisions).
export interface LiveSeasonSlice {
  year: number
  phase: SeasonPhase
  raceResults: RaceResult[][]
  drivers: Driver[]
  teams: Team[]
  allUpgradeEvents: DevUpgradeEvent[]
  constructorHistory: ConstructorSeasonRecord[]
  endOfSeasonSummary: EndOfSeasonSummary | null
}

export function buildLiveNewsContext(
  s: LiveSeasonSlice,
  careerBase: Record<string, DriverCareer>,
  teamCareerBase: Record<string, TeamCareer>,
): NewsContext {
  return {
    year: s.year,
    phase: s.phase,
    completedRounds: s.raceResults.length,
    drivers: s.drivers,
    teams: s.teams,
    raceResults: s.raceResults,
    upgradeEvents: s.allUpgradeEvents,
    constructorHistory: s.constructorHistory,
    endOfSeason: s.endOfSeasonSummary,
    calendar: calendar2026,
    live: true,
    careers: foldLiveSeason(careerBase, s.year, s.raceResults, s.endOfSeasonSummary?.driverChampion),
    teamCareers: foldLiveSeasonTeams(teamCareerBase, s.raceResults),
  }
}
