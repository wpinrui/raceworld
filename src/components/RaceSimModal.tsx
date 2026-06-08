'use client'

import { useEffect, useState } from 'react'

// Shown while a single race is simulated headlessly ("Simulate Next Race" / "Simulate Race"). Full-screen
// dim + blur over the whole UI, a cyan F1-car decal inside a spinning progress ring, and the status text.
// Fades in on mount and out when `open` flips false (the parent keeps it mounted briefly for the fade).
export function RaceSimModal({ open }: { open: boolean }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10)
    return () => clearTimeout(t)
  }, [])
  const visible = open && shown

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className={`absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex flex-col items-center gap-7 rounded-2xl border border-[#2A3142] bg-[#1E2431] px-20 py-14 shadow-2xl transition-all duration-300 ease-out ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="relative flex h-36 w-36 items-center justify-center">
          {/* Progress ring. */}
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-[#2A3142] border-t-[#00D9FF]" />
          {/* Cyan F1-car decal (solid PNG silhouette tinted via a CSS mask). */}
          <div
            aria-hidden
            className="h-24 w-24"
            style={{
              backgroundColor: '#00D9FF',
              WebkitMaskImage: 'url(/racing-car.png)', maskImage: 'url(/racing-car.png)',
              WebkitMaskSize: 'contain', maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center', maskPosition: 'center',
            }}
          />
        </div>
        <span className="font-display text-xl uppercase tracking-[0.3em] text-[#FFFFFF]">Simulating Race</span>
      </div>
    </div>
  )
}
