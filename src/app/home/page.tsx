'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { isOffSeason } from '@/lib/sim/types'
import { simulateUntilRound } from '@/lib/sim/sim-ahead'
import { RaceBanner } from '@/components/home/RaceBanner'
import { PunditPredictions } from '@/components/home/PunditPredictions'
import { CompactStandings } from '@/components/home/CompactStandings'
import { HeadlinesPanel } from '@/components/home/HeadlinesPanel'
import { CarDevelopmentChart } from '@/components/home/CarDevelopmentChart'

// The home dashboard fits the viewport without the page scrolling: a combined title + calendar bar on
// top, then a two-column grid where each panel (headlines, standings, car development) scrolls inside
// its own region. In the off-season the left column also surfaces the stage review (Signing Day, etc.).
export default function HomePage() {
  const phase = useSeasonStore((s) => s.phase)
  const teams = useSeasonStore((s) => s.teams)
  const carPaceHistory = useSeasonStore((s) => s.carPaceHistory)
  const [hydrated, setHydrated] = useState(false)
  const [simming, setSimming] = useState(false)

  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  async function handleSimTo(round: number) {
    if (simming) return
    setSimming(true)
    try {
      await simulateUntilRound(round)
    } finally {
      setSimming(false)
    }
  }

  const offSeason = isOffSeason(phase)

  return (
    <div className="h-full overflow-hidden bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-7xl mx-auto h-full px-4 py-4 flex flex-col gap-3 min-h-0">
        {/* Combined title + calendar bar */}
        <div className="shrink-0">
          <RaceBanner simming={simming} onSimTo={handleSimTo} />
        </div>

        <div className="flex-1 min-h-0 grid gap-3 lg:grid-cols-[45fr_55fr]">
          {/* Left: off-season stage review (off-season only) sits above the headlines feed. */}
          <div className="flex flex-col gap-3 min-h-0">
            {offSeason && <div className="flex-1 min-h-0"><PunditPredictions /></div>}
            <div className="flex-1 min-h-0"><HeadlinesPanel /></div>
          </div>

          {/* Right: tabbed standings over the car-development chart, each scrolling internally. */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex-[5] min-h-0"><CompactStandings /></div>
            <div className="flex-[4] min-h-0 rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden flex flex-col">
              <p className="shrink-0 text-[10px] uppercase tracking-widest text-[#FFFFFF] px-5 py-2.5 border-b border-[#2A3142]">Car Development</p>
              <div className="flex-1 min-h-0"><CarDevelopmentChart teams={teams} history={carPaceHistory} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
