import { useSeasonStore } from '@/lib/store/season-store'
import {
  actionArchiveSeason,
  actionInsertConstructorStandings,
  actionGetRecentConstructorHistory,
} from '@/lib/db/actions'
import { actionGetDriverCareers, actionGetTeamCareers, actionGetTeamDriverTallies, actionGetSeasonRecords, actionGetLegendData, actionSaveSeasonNews } from '@/lib/news/actions'
import { buildLiveNewsContext } from '@/lib/news/live-context'
import { generateNews } from '@/lib/news/engine'
import type { OffSeasonEvent } from './continue-loop'

// Archive the finishing season + snapshot its complete feed (results + the off-season beats just run),
// then swap next season's grid live (keeping the clock). Was the final stage of the old wizard.
async function archiveAndRollover(): Promise<void> {
  const s = useSeasonStore.getState()
  if (s.dbSeasonId) {
    const [careerBase, teamCareerBase, records, teamDriverTalliesBase, legendData] = await Promise.all([
      actionGetDriverCareers(s.year - 1),
      actionGetTeamCareers(s.year - 1),
      actionGetSeasonRecords(),
      actionGetTeamDriverTallies(s.year - 1),
      actionGetLegendData(s.year, s.saveSeed),
    ])
    const articles = generateNews(buildLiveNewsContext({
      year: s.year, saveSeed: s.saveSeed, phase: s.phase, raceResults: s.raceResults, drivers: s.drivers, teams: s.teams,
      allUpgradeEvents: s.allUpgradeEvents, devPlans: s.devPlans, preSeasonTest: s.preSeasonTest, constructorHistory: s.constructorHistory,
      endOfSeasonSummary: s.endOfSeasonSummary, approvedSeasonChanges: s.approvedSeasonChanges,
      seasonContractWatch: s.seasonContractWatch, seasonRenewals: s.seasonRenewals, seasonDraft: s.seasonDraft, signingDayRevealed: s.signingDayRevealed,
      priorSeasonDriverMediaScores: s.priorSeasonDriverMediaScores, carPaceHistory: s.carPaceHistory,
    }, careerBase, teamCareerBase, records, teamDriverTalliesBase, legendData))
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

