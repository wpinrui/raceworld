'use client'

import { useEffect, useState } from 'react'

// Shown once, pre-race, when the player team's upgrade lands for the upcoming round (Team Manager mode).
// Full-screen dim + blur over the UI styled after RaceSimModal: an F1-car decal (cyan on success, red on a
// failure), the delivered package, the outcome, and a Dismiss button. Fades in on mount.
export function UpgradeRevealModal({
  paceDelta,
  failed,
  packageName,
  onDismiss,
}: {
  paceDelta: number
  failed: boolean
  packageName?: string
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
              backgroundColor: failed ? '#DC143C' : '#00D9FF',
              WebkitMaskImage: 'url(/racing-car.png)', maskImage: 'url(/racing-car.png)',
              WebkitMaskSize: 'contain', maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center', maskPosition: 'center',
            }}
          />
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="font-display text-xl uppercase tracking-[0.3em] text-[#FFFFFF]">
            {failed ? 'Upgrade Failed' : 'Upgrade Delivered'}
          </span>
          {packageName && (
            <span className="text-sm uppercase tracking-widest text-[#FFFFFF]">{packageName}</span>
          )}
        </div>
        <span className={`font-display text-3xl tabular-nums ${failed ? 'text-[#DC143C]' : 'text-[#00D9FF]'}`}>
          {failed ? 'No gain this cycle' : `+${paceDelta.toFixed(1)} pace`}
        </span>
        <button
          onClick={onDismiss}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-widest transition-colors ${
            failed ? 'bg-[#DC143C] text-[#FFFFFF] hover:bg-[#B01030]' : 'bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF]'
          }`}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
