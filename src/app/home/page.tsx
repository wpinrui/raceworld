'use client'

import Link from 'next/link'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { useSeasonStore } from '@/lib/store/season-store'
import { RaceBanner } from '@/components/home/RaceBanner'
import { PunditPredictions } from '@/components/home/PunditPredictions'
import { CompactStandings } from '@/components/home/CompactStandings'
import { HeadlinesPanel } from '@/components/home/HeadlinesPanel'
import { CarDevelopmentChart } from '@/components/home/CarDevelopmentChart'
import { RenewalDecisionPanel } from '@/components/home/RenewalDecisionPanel'
import { TeamManagerPanel } from '@/components/home/TeamManagerPanel'

// The home dashboard fits the viewport without the page scrolling: a combined title + calendar bar on
// top, then a two-column grid where each panel (headlines, standings, car development) scrolls inside
// its own region. In the off-season the left column also surfaces the stage review (Signing Day, etc.).
export default function HomePage() {
  const phase = useSeasonStore((s) => s.phase)
  const teams = useSeasonStore((s) => s.teams)
  const carPaceHistory = useSeasonStore((s) => s.carPaceHistory)
  const preSeasonTest = useSeasonStore((s) => s.preSeasonTest)
  const completedRounds = useSeasonStore((s) => s.raceResults.length)
  const hydrated = useHydrated()

  if (!hydrated) return null

  // The home's left review panel shows ONLY for the two interactive off-season boards: Signing Day
  // (contract-negotiations) and the pre-season test (after the rollover, phase 'pre-race', before round
  // 1). The season review + retirements are news, read in the feed — not revisit panels (#126).
  const showLeftPanel = phase === 'contract-negotiations' || (!!preSeasonTest && completedRounds === 0)

  return (
    <div className="h-full overflow-hidden bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-7xl mx-auto h-full px-4 py-4 flex flex-col gap-3 min-h-0">
        {/* Combined title + calendar bar */}
        <div className="shrink-0">
          <RaceBanner />
        </div>

        {/* Team Manager: your-team control strip (upgrade cycle, championship line, team-page shortcut). */}
        <TeamManagerPanel />

        <div className="flex-1 min-h-0 grid gap-3 lg:grid-cols-[45fr_55fr]">
          {/* Left: the renewal decision (when pending) sits at the top, then the off-season stage review
              (off-season only) above the headlines feed. */}
          <div className="flex flex-col gap-3 min-h-0">
            <RenewalDecisionPanel />
            {showLeftPanel && <div className="flex-1 min-h-0"><PunditPredictions /></div>}
            <div className="flex-1 min-h-0"><HeadlinesPanel /></div>
          </div>

          {/* Right: tabbed standings over the car-development chart, each scrolling internally. */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex-[5] min-h-0"><CompactStandings /></div>
            <div className="flex-[4] min-h-0 rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden flex flex-col">
              <Link href="/performance" className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#FFFFFF] hover:text-[#00D9FF] transition-colors px-5 py-2.5 border-b border-[#2A3142]">Car Development <span aria-hidden>→</span></Link>
              <div className="flex-1 min-h-0"><CarDevelopmentChart teams={teams} history={carPaceHistory} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
