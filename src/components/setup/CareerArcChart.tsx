'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { projectOverallByAge } from '@/lib/sim/progression'
import { statColor } from './stat-utils'

// A live preview of where a driver's OVERALL goes across their career, on the deterministic median curve
// (progression.ts projectOverallByAge — no RNG, so it redraws instantly as the creation sliders move). Rises
// to the potential by the peak age, plateaus, then declines at a rate set by the longevity slider.
//
// The x-axis runs from the chosen entry age to min(AGE_CEILING, the age the median first dips below the
// retire floor): a short-lived driver's chart ends where they fade, a long one runs out to the ceiling.
// Hover anywhere to read off the numbers.

const AGE_CEILING = 40 // upper bound: nobody's projected past 40 here, even a freak who'd still be above the floor
const RETIRE_FLOOR = 50 // OVR at/below which the driver is effectively done — the chart ends just past here

export function CareerArcChart({
  driver,
}: {
  driver: { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number; consistency: number; age: number; peakPotential: number; primeEnd: number; declineRate?: number }
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const full = projectOverallByAge(driver, AGE_CEILING)
  // Trim the flat tail: keep everything up to (and including) the first point at/under the retire floor, so
  // the descent is visible but the dead years aren't. A driver who never fades by the ceiling shows in full.
  const floorIdx = full.findIndex((p) => p.overall <= RETIRE_FLOOR)
  const arc = floorIdx > 0 ? full.slice(0, floorIdx + 1) : full

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
  const lineColor = statColor(peakPt.overall)

  // Map a pointer position to the nearest projected age (the SVG scales to its container at the viewBox
  // aspect ratio, so a width-relative read is exact).
  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const vbX = ((e.clientX - rect.left) / rect.width) * W
    const frac = (vbX - padL) / Math.max(1, W - padL - padR)
    const idx = Math.round(frac * (arc.length - 1))
    setHover(Math.max(0, Math.min(arc.length - 1, idx)))
  }

  const hp = hover != null ? arc[hover] : null
  const hx = hp ? x(hp.age) : 0
  const hy = hp ? y(hp.overall) : 0
  // Tooltip box, flipped to the left of the cursor near the right edge so it never clips.
  const boxW = 78
  const boxLeft = hx > W - boxW - padR ? hx - boxW - 6 : hx + 6

  return (
    <div className="rounded-lg bg-[#0F1419] border border-[#303848] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Career projection</span>
        <span className="text-[10px] text-[#FFFFFF]">peak ~{Math.round(peakPt.overall)} OVR at {peakPt.age}</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label="Projected overall rating by age"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
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
        {/* x labels: entry + end */}
        {[minAge, maxAge].map((a) => (
          <text key={a} x={x(a)} y={H - 4} fontSize={8} fill="#FFFFFF" textAnchor={a === minAge ? 'start' : 'end'}>{a}</text>
        ))}
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={2} />

        {/* Hover readout: a crosshair on the nearest point + a labelled box with the exact age / OVR. */}
        {hp && (
          <g>
            <line x1={hx} y1={padT} x2={hx} y2={H - padB} stroke="#FFFFFF" strokeWidth={0.75} strokeDasharray="2 2" opacity={0.5} />
            <circle cx={hx} cy={hy} r={3} fill={lineColor} stroke="#0F1419" strokeWidth={1} />
            <g transform={`translate(${boxLeft.toFixed(1)}, ${padT})`}>
              <rect width={boxW} height={18} rx={3} fill="#1E2431" stroke="#303848" strokeWidth={1} />
              <text x={6} y={12} fontSize={9} fill="#FFFFFF">age {hp.age} · {Math.round(hp.overall)} OVR</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  )
}
