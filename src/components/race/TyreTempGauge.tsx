'use client'

import { useId } from 'react'
import { TEMP } from '@/lib/sim/tyre-temp'

// A glanceable curved tyre-temperature gauge (Motorsport-Manager style): a blue→green→red arc with the optimal
// WINDOW [0,1] marked by two ticks, and a needle-dot for the tyre's current temp. No number — temp is a
// normalised, abstract quantity; the player reads "cold / in the window / overheating" from the marker alone.
const span = TEMP.MAX - TEMP.MIN
const CX = 26, CY = 27, R = 21
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const frac = (t: number) => clamp01((t - TEMP.MIN) / span)
const ang = (f: number) => Math.PI * (1 - f) // f=0 → left (cold), f=1 → right (hot)
const at = (f: number, r = R) => ({ x: CX + r * Math.cos(ang(f)), y: CY - r * Math.sin(ang(f)) })
const xy = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
const tick = (f: number) => `M ${xy(at(f, R - 5))} L ${xy(at(f))}`

export default function TyreTempGauge({ temp, className = '' }: { temp: number; className?: string }) {
  const gradId = useId() // unique per instance: two gauges (both TM cars) must not share an SVG gradient id
  const cold = temp < 0, hot = temp > 1
  const markerColor = cold ? '#00D9FF' : hot ? '#DC143C' : '#10B981'
  const m = at(frac(temp))
  return (
    <svg viewBox="0 0 52 32" className={className} role="img" aria-label="Tyre temperature">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#00D9FF" />
          <stop offset="28%" stopColor="#10B981" />
          <stop offset="72%" stopColor="#10B981" />
          <stop offset="86%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#DC143C" />
        </linearGradient>
      </defs>
      <path d={`M ${xy(at(0))} A ${R} ${R} 0 0 1 ${xy(at(1))}`} fill="none" stroke={`url(#${gradId})`} strokeWidth="5" strokeLinecap="round" />
      {/* window edges (temp 0 and 1), in white so they read across the blue/green/red of the arc */}
      <path d={tick(frac(0))} stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
      <path d={tick(frac(1))} stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
      {/* current temp: a white dot with a state-coloured core, readable on any band */}
      <circle cx={m.x} cy={m.y} r="3.6" fill="#FFFFFF" stroke="#0F1419" strokeWidth="1" />
      <circle cx={m.x} cy={m.y} r="2" fill={markerColor} />
    </svg>
  )
}
