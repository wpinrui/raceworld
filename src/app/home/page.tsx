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

// The normal home dashboard (masthead + calendar + headlines + standings). Reused both for a
// running season and as the "Home" view of the Home↔Season toggle during the off-season.
function NormalHome({ year, currentRound, simming, onSimTo }: {
  year: number
  currentRound: number
  simming: boolean
  onSimTo: (round: number) => void
}) {
  return (
    <div className="space-y-5">
      {/* Masthead */}
      <div className="rounded-xl bg-[#1E2431] border border-[#00D9FF]/30 p-5">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-7 rounded-sm bg-[#DC143C]" />
          <h1 className="font-display text-3xl tracking-wider uppercase">Formula 1</h1>
        </div>
        <p className="text-sm text-[#FFFFFF] ml-3.5 mt-1">{year} Season · Round {currentRound}</p>
      </div>

      <RaceBanner simming={simming} onSimTo={onSimTo} />

      <div className="grid gap-5 lg:grid-cols-[45fr_55fr]">
        <div className="space-y-5">
          <HeadlinesPanel />
          <PunditPredictions />
        </div>
        <CompactStandings />
      </div>

      <RankingsPanel />
    </div>
  )
}

export default function HomePage() {
  const phase = useSeasonStore((s) => s.phase)
  const year = useSeasonStore((s) => s.year)
  const currentRound = useSeasonStore((s) => s.currentRound)
  const [hydrated, setHydrated] = useState(false)
  const [simming, setSimming] = useState(false)
  // During the off-season, default to the season review (the actionable thing) but let the
  // player flip to their normal home at any time — it no longer disappears.
  const [offView, setOffView] = useState<'season' | 'home'>('season')

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
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-full px-4 py-6">
        {offSeason ? (
          <div className="max-w-7xl mx-auto space-y-4">
            <div className="inline-flex rounded-lg bg-[#1E2431] border border-[#2A3142] p-1 gap-1">
              {([['season', 'Season Review'], ['home', 'Home']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setOffView(v)}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors ${
                    offView === v ? 'bg-[#00D9FF] text-[#0F1419]' : 'text-[#FFFFFF] hover:bg-[#2A3142]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {offView === 'season'
              ? <OffSeasonPanel />
              : <NormalHome year={year} currentRound={currentRound} simming={simming} onSimTo={handleSimTo} />}
          </div>
        ) : (
          <div className="max-w-7xl mx-auto">
            <NormalHome year={year} currentRound={currentRound} simming={simming} onSimTo={handleSimTo} />
          </div>
        )}
      </div>
    </div>
  )
}
