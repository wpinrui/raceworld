'use client'

import { useEffect, useState } from 'react'

// Shown once, pre-race, when the player team's upgrade lands for the upcoming round (Team Manager mode).
// Full-screen dim + blur over the UI styled after RaceSimModal: a cyan F1-car decal, the outcome, and a
// Dismiss button. Fades in on mount.
export function UpgradeRevealModal({
  paceDelta,
  failed,
  onDismiss,
}: {
  paceDelta: number
  failed: boolean
  onDismiss: () => void
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className={`absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex flex-col items-center gap-6 rounded-2xl border border-[#2A3142] bg-[#1E2431] px-20 py-14 shadow-2xl transition-all duration-300 ease-out ${
          shown ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="relative flex h-28 w-28 items-center justify-center">
          {/* Cyan F1-car decal (solid PNG silhouette tinted via a CSS mask). */}
          <div
            aria-hidden
            className="h-24 w-24"
            style={{
              backgroundColor: failed ? '#6B7280' : '#00D9FF',
              WebkitMaskImage: 'url(/racing-car.png)', maskImage: 'url(/racing-car.png)',
              WebkitMaskSize: 'contain', maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center', maskPosition: 'center',
            }}
          />
        </div>
        <span className="font-display text-xl uppercase tracking-[0.3em] text-[#FFFFFF]">
          {failed ? 'Upgrade Failed' : 'Upgrade Delivered'}
        </span>
        <span className="font-display text-3xl tabular-nums text-[#00D9FF]">
          {failed ? 'No gain this cycle' : `+${paceDelta.toFixed(1)} pace`}
        </span>
        <button
          onClick={onDismiss}
          className="px-6 py-2.5 rounded-lg bg-[#00D9FF] text-[#0F1419] text-sm font-semibold uppercase tracking-widest hover:bg-[#33E1FF] transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
