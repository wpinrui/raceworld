'use client'

import { useRouter } from 'next/navigation'
import { useSeasonStore } from '@/lib/store/season-store'
import { OFF_SEASON_PHASES } from '@/lib/sim/types'
import { ProgressionPanel } from '@/components/standings/ProgressionPanel'
import { RetirementsPanel } from '@/components/standings/RetirementsPanel'
import { MarketPanel } from '@/components/standings/MarketPanel'
import { TestingPanel } from '@/components/standings/TestingPanel'
import {
  actionArchiveSeason,
  actionInsertConstructorStandings,
  actionGetRecentConstructorHistory,
} from '@/lib/db/actions'

const PHASE_META: Record<string, { title: string; blurb: string }> = {
  'end-of-season': { title: 'End of Season', blurb: 'Final standings and how each driver developed.' },
  'contract-negotiations': { title: 'Contract Negotiations', blurb: 'Driver market moves for the coming season.' },
  'driver-retirements': { title: 'Driver Retirements', blurb: 'Drivers leaving the grid.' },
  'pre-season-testing': { title: 'Pre-Season Testing', blurb: 'A first, obscured look at next season’s cars.' },
}

export function OffSeasonPanel() {
  const router = useRouter()
  const season = useSeasonStore()
  const summary = season.endOfSeasonSummary

  const phaseIdx = OFF_SEASON_PHASES.indexOf(season.phase)
  const isLastPhase = phaseIdx === OFF_SEASON_PHASES.length - 1

  function advancePhase() {
    if (season.phase === 'end-of-season') season.runContractNegotiations()
    else if (season.phase === 'contract-negotiations') season.runDriverRetirements()
    else if (season.phase === 'driver-retirements') season.runPreSeasonTesting()
  }

  async function handleArchiveAndNewSeason() {
    if (season.dbSeasonId) {
      await actionArchiveSeason(season.dbSeasonId)
      const constructorFinalPositions = season.constructorStandings.map((cs, idx) => ({
        teamId: cs.teamId,
        finalPosition: idx + 1,
        points: cs.points,
      }))
      await actionInsertConstructorStandings(season.dbSeasonId, constructorFinalPositions)
    }
    const freshHistory = await actionGetRecentConstructorHistory(5)
    season.loadConstructorHistory(freshHistory)
    season.startNewSeason()
    router.push('/setup')
  }

  function handleReturnToSetup() {
    season.resetToIdle()
    router.push('/setup')
  }

  if (!summary) return null

  return (
    <div className="rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between flex-wrap gap-4 border-b border-[#2A3142]">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-1 h-6 rounded-sm bg-[#00D9FF]" />
            <h2 className="font-display text-xl tracking-wider uppercase text-[#FFFFFF]">
              Season {season.year} · {PHASE_META[season.phase].title}
            </h2>
          </div>
          {season.driverStandings[0] && (
            <p className="text-[#A0A9B8] text-sm ml-3.5">
              World Champion:{' '}
              <span className="text-[#FFFFFF] font-semibold">{season.driverStandings[0].driverName}</span>
              {' '}·{' '}
              <span className="text-[#FFFFFF] tabular-nums">{season.driverStandings[0].points} pts</span>
            </p>
          )}
          {season.constructorStandings[0] && (
            <p className="text-[#A0A9B8] text-sm ml-3.5">
              Constructors:{' '}
              <span className="text-[#FFFFFF] font-semibold">{season.constructorStandings[0].teamName}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReturnToSetup}
            className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] hover:text-[#FFFFFF] hover:bg-[#303848] text-xs font-semibold uppercase tracking-wide transition-colors"
          >
            Return to Setup
          </button>
          <button
            onClick={isLastPhase ? handleArchiveAndNewSeason : advancePhase}
            className="px-5 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors"
          >
            {isLastPhase
              ? `Start ${season.year + 1} Season →`
              : `${PHASE_META[OFF_SEASON_PHASES[phaseIdx + 1]].title} →`}
          </button>
        </div>
      </div>

      {/* Phase stepper */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#2A3142] text-xs flex-wrap">
        {OFF_SEASON_PHASES.map((p, i) => (
          <span key={p} className="flex items-center gap-2">
            <span
              className={
                i === phaseIdx
                  ? 'text-[#00D9FF] font-semibold'
                  : i < phaseIdx
                    ? 'text-[#A0A9B8]'
                    : 'text-[#6B7280]'
              }
            >
              {PHASE_META[p].title}
            </span>
            {i < OFF_SEASON_PHASES.length - 1 && <span className="text-[#3A4152]">→</span>}
          </span>
        ))}
      </div>

      <div className="p-5">
        <p className="text-sm text-[#A0A9B8] mb-4">{PHASE_META[season.phase].blurb}</p>
        {season.phase === 'end-of-season' && (
          <ProgressionPanel summary={summary} drivers={season.drivers} />
        )}
        {season.phase === 'contract-negotiations' && (
          <MarketPanel summary={summary} teams={season.teams} />
        )}
        {season.phase === 'driver-retirements' && (
          <RetirementsPanel summary={summary} drivers={season.drivers} />
        )}
        {season.phase === 'pre-season-testing' && (
          <TestingPanel summary={summary} teams={season.teams} />
        )}
      </div>
    </div>
  )
}
