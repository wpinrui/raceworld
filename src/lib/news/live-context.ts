import { calendarForYear } from '@/data/calendars'
import { foldLiveSeason, foldLiveSeasonTeams, foldLiveSeasonTeamDrivers, type NewsContext, type DriverCareer, type TeamCareer, type TeamDriverTally, type RecordsContext } from './engine'
import type { Driver, Team, RaceResult, SeasonPhase, DevUpgradeEvent, TeamDevPlan, ConstructorSeasonRecord, EndOfSeasonSummary } from '@/lib/sim/types'
import type { RenewalResult, DraftPick, ContractWatch } from '@/lib/sim/driver-market'

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
  devPlans?: TeamDevPlan[]         // pending dev plans, for the forward-looking upgrade beat in the preview
  constructorHistory: ConstructorSeasonRecord[]
  endOfSeasonSummary: EndOfSeasonSummary | null
  // Real-world changes approved at this season's start (for the mid-season transition newsroom). Optional.
  approvedSeasonChanges?: {
    joins: { id: string; name: string; shortName: string; nationality: string; color: string }[]
    leaves: string[]
    rebrands: { id: string; name: string; shortName: string; color: string; nationality: string }[]
  } | null
  // Driver-market beats (named to match the store state so callers can pass it straight through).
  seasonContractWatch?: ContractWatch[]
  seasonRenewals?: RenewalResult[]
  seasonDraft?: DraftPick[]
  signingDayRevealed?: number
  // Per-round car-pace snapshots; only [0] (season start) is read, to anchor the first-season car projection (#88).
  carPaceHistory?: { round: number; paces: Record<string, number> }[]
  // Last completed season's driver media scores — the basis for this season's driver expectation (#88).
  priorSeasonDriverMediaScores?: Record<string, number>
}

export function buildLiveNewsContext(
  s: LiveSeasonSlice,
  careerBase: Record<string, DriverCareer>,
  teamCareerBase: Record<string, TeamCareer>,
  records?: RecordsContext,
  teamDriverTalliesBase: Record<string, TeamDriverTally[]> = {},
): NewsContext {
  // Map the approved real-world changes (which carry the NEW identity) to the newsroom shape, pulling each
  // team's CURRENT name from the live grid for a rebrand's "from".
  const ch = s.approvedSeasonChanges
  const nameOf = new Map(s.teams.map((t) => [t.id, t.name]))
  const nextSeasonChanges = ch
    ? {
        rebrands: ch.rebrands.map((r) => ({ teamId: r.id, fromName: nameOf.get(r.id) ?? r.id, toName: r.name })),
        additions: ch.joins.map((j) => ({ teamId: j.id, teamName: j.name })),
        removals: ch.leaves.map((id) => ({ teamId: id, teamName: nameOf.get(id) ?? id, finalPosition: null })),
      }
    : undefined
  return {
    year: s.year,
    phase: s.phase,
    completedRounds: s.raceResults.length,
    drivers: s.drivers,
    teams: s.teams,
    raceResults: s.raceResults,
    upgradeEvents: s.allUpgradeEvents,
    devPlans: s.devPlans,
    constructorHistory: s.constructorHistory,
    endOfSeason: s.endOfSeasonSummary,
    calendar: calendarForYear(s.year),
    seasonStartCarPace: s.carPaceHistory?.find((h) => h.round === 0)?.paces,
    priorDriverMediaScores: s.priorSeasonDriverMediaScores,
    live: true,
    records,
    careers: foldLiveSeason(careerBase, s.year, s.raceResults, s.endOfSeasonSummary?.driverChampion),
    teamCareers: foldLiveSeasonTeams(teamCareerBase, s.raceResults),
    teamDriverTallies: foldLiveSeasonTeamDrivers(teamDriverTalliesBase, s.year, s.raceResults),
    nextSeasonChanges,
    contractWatch: s.seasonContractWatch,
    renewals: s.seasonRenewals,
    draft: s.seasonDraft,
    signingDayRevealed: s.signingDayRevealed,
  }
}
