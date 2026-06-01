'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { isOffSeason } from '@/lib/sim/types'
import { OffSeasonPanel } from '@/components/home/OffSeasonPanel'

export default function HomePage() {
  const phase = useSeasonStore((s) => s.phase)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => setHydrated(true), [])
  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#E8EAED]">
      <div className="max-w-full px-4 py-6">
        {isOffSeason(phase) ? (
          <OffSeasonPanel />
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-6 rounded-sm bg-[#DC143C]" />
            <h1 className="font-display text-2xl tracking-wider uppercase">Home</h1>
          </div>
        )}
      </div>
    </div>
  )
}
