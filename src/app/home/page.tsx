'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { isOffSeason } from '@/lib/sim/types'
import { simulateUntilRound } from '@/lib/sim/sim-ahead'
import { OffSeasonPanel } from '@/components/home/OffSeasonPanel'
import { RaceBanner } from '@/components/home/RaceBanner'
import { PunditPredictions } from '@/components/home/PunditPredictions'
import { RankingsPanel } from '@/components/home/RankingsPanel'
import { CompactStandings } from '@/components/home/CompactStandings'
import { HeadlinesPanel } from '@/components/home/HeadlinesPanel'

export default function HomePage() {
  const phase = useSeasonStore((s) => s.phase)
  const year = useSeasonStore((s) => s.year)
  const currentRound = useSeasonStore((s) => s.currentRound)
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

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-full px-4 py-6">
        {isOffSeason(phase) ? (
          <OffSeasonPanel />
        ) : (
          <div className="max-w-7xl mx-auto space-y-5">
            {/* Masthead */}
            <div className="rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 p-5">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-7 rounded-sm bg-[#DC143C]" />
                <h1 className="font-display text-3xl tracking-wider uppercase">Formula 1</h1>
              </div>
              <p className="text-sm text-[#FFFFFF] ml-3.5 mt-1">{year} Season · Round {currentRound}</p>
            </div>

            <RaceBanner simming={simming} onSimTo={handleSimTo} />

            <div className="grid gap-5 lg:grid-cols-[45fr_55fr] lg:items-start">
              <div className="space-y-5">
                <HeadlinesPanel />
                <PunditPredictions />
              </div>
              <CompactStandings />
            </div>

            <RankingsPanel />
          </div>
        )}
      </div>
    </div>
  )
}
