'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import type { WeatherPoint } from '@/lib/sim/types'
import { getMoistureAtLap, forecastMoistureAtLap } from '@/lib/sim/weather'

interface Props {
  weather: WeatherPoint[] // the true curve
  forecast: WeatherPoint[] // the fallible prediction
  currentLap: number
  totalLaps: number
}

// SVG canvas units (rendered responsively via viewBox).
const W = 200
const H = 38
const TOP = 3 // headroom so a 100% peak isn't clipped

const x = (lap: number, totalLaps: number) => (totalLaps <= 1 ? 0 : ((lap - 1) / (totalLaps - 1)) * W)
const y = (m: number) => H - TOP - Math.max(0, Math.min(1, m)) * (H - TOP)

// A polyline string sampling `value(lap)` at the start of every integer lap from `from` to `to`.
function path(from: number, to: number, totalLaps: number, value: (lap: number) => number): string {
  const pts: string[] = []
  for (let lap = from; lap <= to; lap++) pts.push(`${x(lap, totalLaps).toFixed(1)},${y(value(lap)).toFixed(1)}`)
  return pts.join(' ')
}

// Live weather readout for the raceday header: a wetness%-vs-lap graph. The solid line is the actual
// weather, revealed lap by lap; the dashed line ahead is the (imperfect) forecast, which homes onto
// reality as each lap nears. The eye toggle is a god-mode cheat that reveals the true future.
export function WeatherGraph({ weather, forecast, currentLap, totalLaps }: Props) {
  const [reveal, setReveal] = useState(false)

  const now = Math.max(1, Math.min(currentLap, totalLaps))
  const nowMoisture = getMoistureAtLap(weather, now)

  // Is there anything wet to show — actual or forecast, anywhere in the race?
  const anyWeather =
    weather.some((p) => p.moisture >= 0.05) ||
    forecast.some((p) => p.moisture >= 0.05) ||
    (reveal && weather.some((p) => p.moisture >= 0.05))

  const actualPast = path(1, now, totalLaps, (lap) => getMoistureAtLap(weather, lap))
  const forecastAhead = path(now, totalLaps, totalLaps, (lap) => forecastMoistureAtLap(weather, forecast, lap, now))
  const truthAhead = path(now, totalLaps, totalLaps, (lap) => getMoistureAtLap(weather, lap))
  const markerX = x(now, totalLaps)

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end leading-none">
        <span className="text-[9px] tracking-widest uppercase text-[#A0A9B8]">Weather</span>
        <span className="font-mono text-xs text-[#FFFFFF] tabular-nums">
          {anyWeather ? `${Math.round(nowMoisture * 100)}%` : 'Dry'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-9 w-[180px] rounded bg-[#0F1419] border border-[#2A3142]"
      >
        {/* baseline (dry) */}
        <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="#2A3142" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {/* actual, revealed up to the current lap */}
        <polyline
          points={actualPast}
          fill="none"
          stroke="#00D9FF"
          strokeWidth={1.75}
          vectorEffect="non-scaling-stroke"
        />

        {reveal ? (
          /* god-mode reveal: the true future, same solid cyan as the actual line (one colour = reality) */
          <polyline
            points={truthAhead}
            fill="none"
            stroke="#00D9FF"
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          /* forecast ahead, dashed and muted so it reads as a prediction, not fact */
          <polyline
            points={forecastAhead}
            fill="none"
            stroke="#6FA8C7"
            strokeWidth={1.5}
            strokeDasharray="3 2.5"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* current-lap marker */}
        <line
          x1={markerX} y1={0} x2={markerX} y2={H}
          stroke="rgba(255,255,255,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke"
        />
      </svg>

      <Tooltip content={reveal ? 'Showing the true weather ahead (god mode)' : 'Future is the forecast. Reveal the true weather ahead (god mode)'}>
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wide transition-colors ${
            reveal ? 'text-[#00D9FF] bg-[#00D9FF]/10' : 'text-[#6B7280] hover:text-[#A0A9B8]'
          }`}
        >
          {reveal ? <Eye size={12} /> : <EyeOff size={12} />}
          <span>{reveal ? 'Actual' : 'Forecast'}</span>
        </button>
      </Tooltip>
    </div>
  )
}
