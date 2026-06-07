'use client'

import { useHydrated } from '@/lib/ui/use-hydrated'
import { useSeasonStore } from '@/lib/store/season-store'
import { PerformanceView } from '@/components/performance/PerformanceView'

// Full-screen Performance tab: how race results line up with each car's pace.
export default function PerformancePage() {
  const year = useSeasonStore((s) => s.year)
  const hydrated = useHydrated()
  if (!hydrated) return null

  return (
    <div className="h-full overflow-hidden bg-[#0F1419] text-[#FFFFFF]">
      <div className="max-w-7xl mx-auto h-full px-4 py-4 flex flex-col gap-3 min-h-0">
        <div className="shrink-0">
          <h1 className="font-display text-lg tracking-wider uppercase">Performance · {year}</h1>
          <p className="text-xs text-[#FFFFFF]">How race results line up with each car&apos;s pace.</p>
        </div>
        <div className="flex-1 min-h-0">
          <PerformanceView />
        </div>
      </div>
    </div>
  )
}
