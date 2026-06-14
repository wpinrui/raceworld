'use client'

import { projectOverallByAge } from '@/lib/sim/progression'
import { statColor } from './stat-utils'

// A live preview of where a driver's OVERALL goes across their career, on the deterministic median curve
// (progression.ts projectOverallByAge — no RNG, so it redraws instantly as the creation sliders move). Rises
// to the potential by the peak age, plateaus, then declines at a rate set by the longevity slider.
export function CareerArcChart({
  driver,
}: {
  driver: { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number; consistency: number; age: number; peakPotential: number; primeEnd: number; declineRate?: number }
}) {
  const arc = projectOverallByAge(driver, 40)
  const minAge = arc[0].age
  const maxAge = arc[arc.length - 1].age
  const yMin = 40
  const yMax = 100
  const W = 320
  const H = 120
  const padL = 26
  const padB = 16
  const padT = 8
  const padR = 6

  const x = (age: number) => padL + ((age - minAge) / Math.max(1, maxAge - minAge)) * (W - padL - padR)
  const y = (ov: number) => padT + (1 - (Math.max(yMin, Math.min(yMax, ov)) - yMin) / (yMax - yMin)) * (H - padT - padB)

  const pts = arc.map((p) => `${x(p.age).toFixed(1)},${y(p.overall).toFixed(1)}`).join(' ')
  const peakX = x(Math.min(maxAge, Math.max(minAge, driver.primeEnd)))
  const peakPt = arc.reduce((best, p) => (p.overall > best.overall ? p : best), arc[0])

  return (
    <div className="rounded-lg bg-[#0F1419] border border-[#303848] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Career projection</span>
        <span className="text-[10px] text-[#FFFFFF]">peak ~{Math.round(peakPt.overall)} OVR at {peakPt.age}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected overall rating by age">
        {/* y gridlines at 50/70/90 */}
        {[50, 70, 90].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="#2A3142" strokeWidth={1} />
            <text x={2} y={y(g) + 3} fontSize={8} fill="#FFFFFF">{g}</text>
          </g>
        ))}
        {/* peak-age marker */}
        <line x1={peakX} y1={padT} x2={peakX} y2={H - padB} stroke="#7C3AED" strokeWidth={1} strokeDasharray="3 3" />
        <text x={peakX + 2} y={padT + 8} fontSize={8} fill="#A78BFA">peak age {driver.primeEnd}</text>
        {/* x labels: entry, peak age, end */}
        {[minAge, maxAge].map((a) => (
          <text key={a} x={x(a)} y={H - 4} fontSize={8} fill="#FFFFFF" textAnchor={a === minAge ? 'start' : 'end'}>{a}</text>
        ))}
        <polyline points={pts} fill="none" stroke={statColor(peakPt.overall)} strokeWidth={2} />
      </svg>
    </div>
  )
}
