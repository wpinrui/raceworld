'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSeasonStore } from '@/lib/store/season-store'
import { OFF_SEASON_PHASES } from '@/lib/sim/types'
import { SeasonReviewPanel } from '@/components/home/SeasonReviewPanel'
import { RetirementsPanel } from '@/components/standings/RetirementsPanel'
import { MarketPanel } from '@/components/standings/MarketPanel'
import { TestingPanel } from '@/components/standings/TestingPanel'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import {
  actionArchiveSeason,
  actionInsertConstructorStandings,
  actionGetRecentConstructorHistory,
} from '@/lib/db/actions'

const PHASE_META: Record<string, { title: string; blurb: string }> = {
  'end-of-season': { title: 'End of Season', blurb: 'Your season in review.' },
  'contract-negotiations': { title: 'Contract Negotiations', blurb: 'Driver market moves for the coming season.' },
  'driver-retirements': { title: 'Driver Retirements', blurb: 'Drivers leaving the grid.' },
  'pre-season-testing': { title: 'Pre-Season Testing', blurb: 'A first, obscured look at next season’s cars.' },
}

export function OffSeasonPanel() {
  const router = useRouter()
  const season = useSeasonStore()
  const summary = season.endOfSeasonSummary

  // progressIdx = how far the off-season has actually advanced (store phase).
  // viewIdx = which completed phase the player is currently looking at. The two
  // are decoupled so already-run phases stay revisitable; only reaching the
  // frontier runs the next phase's (irreversible) sim.
  const progressIdx = OFF_SEASON_PHASES.indexOf(season.phase)
  const [viewIdx, setViewIdx] = useState(progressIdx)
  // Clamp the view to the real progress (e.g. after a remount the store may have
  // moved on, or a stale higher index could linger).
  const safeViewIdx = Math.min(Math.max(viewIdx, 0), progressIdx)
  const viewPhase = OFF_SEASON_PHASES[safeViewIdx]
  const atFrontier = safeViewIdx === progressIdx
  const isLastView = safeViewIdx === OFF_SEASON_PHASES.length - 1

  function runNextPhase() {
    if (season.phase === 'end-of-season') season.runContractNegotiations()
    else if (season.phase === 'contract-negotiations') season.runDriverRetirements()
    else if (season.phase === 'driver-retirements') season.runPreSeasonTesting()
  }

  function handleNext() {
    if (isLastView) { handleArchiveAndNewSeason(); return }
    if (atFrontier) runNextPhase()   // run the next phase's sim only at the frontier
    setViewIdx(safeViewIdx + 1)
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

  if (!summary) return null

  return (
    <div className="rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between flex-wrap gap-4 border-b border-[#2A3142]">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-1 h-6 rounded-sm bg-[#00D9FF]" />
            <h2 className="font-display text-xl tracking-wider uppercase text-[#FFFFFF]">
              Season {season.year} · {PHASE_META[viewPhase].title}
            </h2>
          </div>
          {season.driverStandings[0] && (
            <p className="text-[#FFFFFF] text-sm ml-3.5">
              World Champion:{' '}
              <DriverLink id={season.driverStandings[0].driverId} className="text-[#FFFFFF] font-semibold">{season.driverStandings[0].driverName}</DriverLink>
              {' '}·{' '}
              <span className="text-[#FFFFFF] tabular-nums">{season.driverStandings[0].points} pts</span>
            </p>
          )}
          {season.constructorStandings[0] && (
            <p className="text-[#FFFFFF] text-sm ml-3.5">
              Constructors:{' '}
              <TeamLink id={season.constructorStandings[0].teamId} className="text-[#FFFFFF] font-semibold">{season.constructorStandings[0].teamName}</TeamLink>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleNext}
            className="px-5 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] transition-colors"
          >
            {isLastView
              ? `Start ${season.year + 1} Season →`
              : `${PHASE_META[OFF_SEASON_PHASES[safeViewIdx + 1]].title} →`}
          </button>
        </div>
      </div>

      {/* Phase stepper — completed phases are clickable to revisit */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#2A3142] text-xs flex-wrap">
        {OFF_SEASON_PHASES.map((p, i) => {
          const reached = i <= progressIdx
          return (
            <span key={p} className="flex items-center gap-2">
              <button
                onClick={() => reached && setViewIdx(i)}
                disabled={!reached}
                className={
                  i === safeViewIdx
                    ? 'text-[#00D9FF] font-semibold'
                    : reached
                      ? 'text-[#FFFFFF] hover:text-[#00D9FF] cursor-pointer'
                      : 'text-[#6B7280] cursor-default'
                }
              >
                {PHASE_META[p].title}
              </button>
              {i < OFF_SEASON_PHASES.length - 1 && <span className="text-[#3A4152]">→</span>}
            </span>
          )
        })}
      </div>

      <div className="p-5">
        <p className="text-sm text-[#FFFFFF] mb-4">{PHASE_META[viewPhase].blurb}</p>
        {viewPhase === 'end-of-season' && (
          <SeasonReviewPanel
            summary={summary}
            drivers={season.drivers}
            teams={season.teams}
            driverStandings={season.driverStandings}
            constructorStandings={season.constructorStandings}
          />
        )}
        {viewPhase === 'contract-negotiations' && (
          <MarketPanel summary={summary} teams={season.teams} />
        )}
        {viewPhase === 'driver-retirements' && (
          <RetirementsPanel summary={summary} drivers={season.drivers} />
        )}
        {viewPhase === 'pre-season-testing' && (
          <TestingPanel summary={summary} teams={season.teams} constructorStandings={season.constructorStandings} />
        )}
      </div>
    </div>
  )
}
