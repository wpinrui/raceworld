import { useSeasonStore } from '@/lib/store/season-store'
import {
  actionArchiveSeason,
  actionInsertConstructorStandings,
  actionGetRecentConstructorHistory,
} from '@/lib/db/actions'
import { actionGetDriverCareers, actionGetTeamCareers, actionGetTeamDriverTallies, actionGetSeasonRecords, actionSaveSeasonNews } from '@/lib/news/actions'
import { buildLiveNewsContext } from '@/lib/news/live-context'
import { generateNews } from '@/lib/news/engine'
import type { OffSeasonEvent } from './continue-loop'

// Archive the finishing season + snapshot its complete feed (results + the off-season beats just run),
// then swap next season's grid live (keeping the clock). Was the final stage of the old wizard.
async function archiveAndRollover(): Promise<void> {
  const s = useSeasonStore.getState()
  if (s.dbSeasonId) {
    const [careerBase, teamCareerBase, records, teamDriverTalliesBase] = await Promise.all([
      actionGetDriverCareers(s.year - 1),
      actionGetTeamCareers(s.year - 1),
      actionGetSeasonRecords(),
      actionGetTeamDriverTallies(s.year - 1),
    ])
    const articles = generateNews(buildLiveNewsContext({
      year: s.year, saveSeed: s.saveSeed, phase: s.phase, raceResults: s.raceResults, drivers: s.drivers, teams: s.teams,
      allUpgradeEvents: s.allUpgradeEvents, devPlans: s.devPlans, constructorHistory: s.constructorHistory,
      endOfSeasonSummary: s.endOfSeasonSummary, approvedSeasonChanges: s.approvedSeasonChanges,
      seasonContractWatch: s.seasonContractWatch, seasonRenewals: s.seasonRenewals, seasonDraft: s.seasonDraft, signingDayRevealed: s.signingDayRevealed,
      priorSeasonDriverMediaScores: s.priorSeasonDriverMediaScores, carPaceHistory: s.carPaceHistory,
    }, careerBase, teamCareerBase, records, teamDriverTalliesBase))
    await actionSaveSeasonNews(s.dbSeasonId, JSON.stringify(articles))
    await actionArchiveSeason(s.dbSeasonId)
    const constructorFinalPositions = s.constructorStandings.map((cs, idx) => ({ teamId: cs.teamId, finalPosition: idx + 1, points: cs.points }))
    await actionInsertConstructorStandings(s.dbSeasonId, constructorFinalPositions)
  }
  const freshHistory = await actionGetRecentConstructorHistory(5)
  useSeasonStore.getState().loadConstructorHistory(freshHistory)
  useSeasonStore.getState().rolloverSeason()
}

// Run a dated off-season beat as the Continue loop reaches it (#126) — the computation happens
// organically on its day, not pre-baked at season end.
export async function runOffSeasonEvent(event: OffSeasonEvent): Promise<void> {
  const s = useSeasonStore.getState()
  switch (event) {
    case 'retirements': s.runDriverRetirements(); return
    case 'signing-day': s.runContractNegotiations(); return
    case 'testing': s.runPreSeasonTestOnly(); return
    case 'roster-swap': await archiveAndRollover(); return
  }
}

// One "Continue" step through the off-season. The off-season is stage-based (not date-based): each
// call runs the next stage's (irreversible) sim. From the final stage it archives the season and
// launches the next one immediately (no detour through the market — the grid is already settled).
// Returns the phase it advanced INTO ('racing' once the new season has begun).
export async function advanceOffSeason(): Promise<string> {
  const s = useSeasonStore.getState()
  switch (s.phase) {
    case 'end-of-season':
      s.runContractNegotiations()
      return useSeasonStore.getState().phase
    case 'contract-negotiations':
      s.runDriverRetirements()
      return useSeasonStore.getState().phase
    case 'driver-retirements':
      s.runPreSeasonTesting()
      return useSeasonStore.getState().phase
    case 'pre-season-testing': {
      // Archive the finished season, then start + immediately begin the next one.
      if (s.dbSeasonId) {
        // Snapshot the complete live feed before archiving: the attribute-dependent producers
        // (season narrative, driver-to-watch, market beats) can't be rebuilt from results, so we persist them now.
        // The store still holds the finished season here (next-season state is pending, not live).
        const [careerBase, teamCareerBase, records, teamDriverTalliesBase] = await Promise.all([
          actionGetDriverCareers(s.year - 1),
          actionGetTeamCareers(s.year - 1),
          actionGetSeasonRecords(),
          actionGetTeamDriverTallies(s.year - 1),
        ])
        const articles = generateNews(buildLiveNewsContext({
          year: s.year, phase: s.phase, raceResults: s.raceResults, drivers: s.drivers, teams: s.teams,
          allUpgradeEvents: s.allUpgradeEvents, constructorHistory: s.constructorHistory,
          endOfSeasonSummary: s.endOfSeasonSummary, approvedSeasonChanges: s.approvedSeasonChanges,
          seasonContractWatch: s.seasonContractWatch, seasonRenewals: s.seasonRenewals, seasonDraft: s.seasonDraft, signingDayRevealed: s.signingDayRevealed,
          priorSeasonDriverMediaScores: s.priorSeasonDriverMediaScores, carPaceHistory: s.carPaceHistory, // #88 expectation basis — must be snapshotted so archived reviews/codas don't degrade
        }, careerBase, teamCareerBase, records, teamDriverTalliesBase))
        await actionSaveSeasonNews(s.dbSeasonId, JSON.stringify(articles))

        await actionArchiveSeason(s.dbSeasonId)
        const constructorFinalPositions = s.constructorStandings.map((cs, idx) => ({
          teamId: cs.teamId, finalPosition: idx + 1, points: cs.points,
        }))
        await actionInsertConstructorStandings(s.dbSeasonId, constructorFinalPositions)
      }
      const freshHistory = await actionGetRecentConstructorHistory(5)
      s.loadConstructorHistory(freshHistory)
      s.startNewSeason()
      const n = useSeasonStore.getState()
      n.initSeason(n.drivers, n.teams, n.year)
      return useSeasonStore.getState().phase // 'pre-race' (racing again)
    }
    default:
      return s.phase
  }
}

// Human label for the off-season stage a "Continue" press will run next.
export function nextOffSeasonStageLabel(phase: string): string {
  switch (phase) {
    case 'end-of-season': return 'Contract Negotiations'
    case 'contract-negotiations': return 'Driver Retirements'
    case 'driver-retirements': return 'Pre-Season Testing'
    case 'pre-season-testing': return 'Start Next Season'
    default: return 'Continue'
  }
}
