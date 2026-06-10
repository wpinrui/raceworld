'use client'

import { useEffect, useState } from 'react'

// Standard F1 start: five red lights illuminate one-per-second; after the fifth, a short random hold,
// then ALL extinguish simultaneously — lights out is the green light. We model the five red circles only.
export function LightsOverlay({ onComplete }: { onComplete: () => void }) {
  const [lit, setLit] = useState(0)      // how many lights are currently on (0..5)
  const [out, setOut] = useState(false)  // all extinguished -> go

  useEffect(() => {
    // All timers scheduled up-front so cleanup clears every pending one on unmount (no nested scheduling).
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 1; i <= 5; i++) timers.push(setTimeout(() => setLit(i), i * 1000))
    // After the fifth light (5s), hold a random 1–3s, then drop them all simultaneously and green-flag.
    const hold = 1000 + Math.random() * 2000
    timers.push(setTimeout(() => setOut(true), 5000 + hold))
    timers.push(setTimeout(onComplete, 5000 + hold + 250))
    return () => timers.forEach(clearTimeout)
    // mount-only one-shot; onComplete is captured once and always green-flags the race
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="flex items-center gap-5">
        {[0, 1, 2, 3, 4].map((i) => {
          const on = !out && i < lit
          return (
            <div
              key={i}
              className="w-16 h-16 rounded-full transition-colors duration-100"
              style={{
                backgroundColor: on ? '#FF1E1E' : '#2A0E0E',
                boxShadow: on ? '0 0 24px 6px rgba(255,30,30,0.55)' : 'none',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
