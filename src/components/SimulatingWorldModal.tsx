'use client'

import { useEffect, useState } from 'react'

// Shown while the world is fast-forwarded from the earliest year up to the player's chosen start year
// (game setup). Full-screen dim + blur over the whole UI — the only thing on screen during the sim. A cyan
// Earth decal (the line-art PNG tinted via a CSS mask, NOT rotated) inside a spinning progress ring, the
// year ticking up, and a races-keyed progress bar. Fades in on mount and out when `open` flips false.
export function SimulatingWorldModal({
  open, year, racesSimmed, racesTotal, onCancel,
}: {
  open: boolean
  year: number
  racesSimmed: number
  racesTotal: number
  onCancel: () => void
}) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10)
    return () => clearTimeout(t)
  }, [])
  const visible = open && shown
  const pct = racesTotal > 0 ? Math.min(100, Math.round((racesSimmed / racesTotal) * 100)) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className={`absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex flex-col items-center gap-7 rounded-2xl border border-[#2A3142] bg-[#1E2431] px-20 py-14 shadow-2xl transition-all duration-300 ease-out ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="relative flex h-36 w-36 items-center justify-center">
          {/* Progress ring (only the ring spins — the globe stays still). */}
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-[#2A3142] border-t-[#00D9FF]" />
          {/* Cyan Earth decal (line-art PNG tinted via a CSS mask). */}
          <div
            aria-hidden
            className="h-24 w-24"
            style={{
              backgroundColor: '#00D9FF',
              WebkitMaskImage: 'url(/earth.png)', maskImage: 'url(/earth.png)',
              WebkitMaskSize: 'contain', maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center', maskPosition: 'center',
            }}
          />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="font-display text-xl uppercase tracking-[0.3em] text-[#FFFFFF]">Simulating World</span>
          <span className="font-display text-3xl tabular-nums text-[#00D9FF]">{year}</span>
        </div>

        <div className="flex w-64 flex-col gap-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#2A3142]">
            <div className="h-full rounded-full bg-[#00D9FF] transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-center text-xs tabular-nums text-[#FFFFFF]">{racesSimmed} / {racesTotal} races</span>
        </div>

        <button
          onClick={onCancel}
          className="text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:text-[#DC143C] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
