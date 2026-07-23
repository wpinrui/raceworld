'use client'

import type { ReactNode } from 'react'
import { FastForward } from 'lucide-react'
import type { SimSpeed, WeatherPoint } from '@/lib/sim/types'
import { WeatherGraph } from './WeatherGraph'
import { OvertakingIndicator } from './OvertakingIndicator'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// Race-day centre console (designs/Canvas.dc.html): race identity + the live track condition over an
// optional photo backdrop that fades out on both sides, with the lap counter, speed steps, pause, and
// keycap hints. Buttons blur after click so Space stays the game's pause key and never re-activates the
// last-clicked control.

const EDGE_MASK = 'linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent)'
export const CHIP_BG = 'rgba(20,25,36,0.75)'

export const consoleChipClass =
  'h-7 flex items-center px-4 rounded border border-[#2A3142] text-[11px] font-extrabold tracking-[1.5px] text-[#8A93A6] hover:text-[#FFFFFF] hover:border-[#3A4356] cursor-pointer'

const DEFAULT_SPEED_LABELS: Record<SimSpeed, ReactNode> = {
  1: '1×', 2: '2×', 3: '3×', 4: '4×', 5: <FastForward size={15} className="fill-current" />,
}

interface Props {
  circuitName: string
  countryCode: string
  /** Completed laps; the console shows the lap in progress. */
  lap: number
  totalLaps: number
  weather: WeatherPoint[]
  forecast: WeatherPoint[]
  speed: SimSpeed
  paused: boolean
  onSpeed: (s: SimSpeed) => void
  onTogglePause: () => void
  straightness?: number
  backdropUrl?: string
  speedLabels?: Partial<Record<SimSpeed, ReactNode>>
  topRight?: ReactNode
}

export function CentreConsole({
  circuitName, countryCode, lap, totalLaps, weather, forecast, speed, paused, onSpeed, onTogglePause,
  straightness, backdropUrl, speedLabels, topRight,
}: Props) {
  const labels = { ...DEFAULT_SPEED_LABELS, ...speedLabels }

  return (
    <div className="relative w-full h-full">
      {backdropUrl && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url('${backdropUrl}')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center 30%',
            opacity: 0.55,
            WebkitMaskImage: EDGE_MASK,
            maskImage: EDGE_MASK,
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg,rgba(15,19,25,0.82),rgba(15,19,25,0.45) 45%,rgba(15,19,25,0.88))',
          WebkitMaskImage: EDGE_MASK,
          maskImage: EDGE_MASK,
        }}
      />

      <div className="relative h-full flex flex-col justify-between px-16 py-4">
        {/* Top row: race identity + lap + chips */}
        <div className="flex items-center gap-3">
          <NationalityFlag code={countryCode} />
          <span className="text-lg font-extrabold tracking-[2px]">{circuitName.toUpperCase()}</span>
          {straightness != null && <OvertakingIndicator straightness={straightness} size="chip" />}
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-extrabold tracking-[1.5px] text-[#8A93A6]">LAP</span>
            <span className="text-base font-extrabold tabular-nums leading-none">{Math.min(lap + 1, totalLaps)}</span>
            <span className="text-xs font-bold text-[#8A93A6]">/ {totalLaps}</span>
          </div>
          {topRight && <div className="ml-auto flex gap-2">{topRight}</div>}
        </div>

        {/* Middle: the track condition takes centre stage. */}
        <div className="flex justify-center">
          <div className="rounded border border-[#2A3142] px-3 py-1.5" style={{ background: CHIP_BG }}>
            <WeatherGraph
              weather={weather}
              forecast={forecast}
              currentLap={lap}
              totalLaps={totalLaps}
              graphWidth={340}
              graphHeight={52}
            />
          </div>
        </div>

        {/* Bottom: speed steps + pause + keycap hints */}
        <div className="flex items-center justify-center gap-4">
          <div className="flex gap-1.5">
            {([1, 2, 3, 4, 5] as SimSpeed[]).map((s) => (
              <button
                key={s}
                onClick={(e) => { e.currentTarget.blur(); onSpeed(s) }}
                className={`w-[42px] h-8 flex items-center justify-center rounded border text-[13px] font-extrabold cursor-pointer ${
                  speed === s
                    ? 'border-[#00D9FF] bg-[#00D9FF]/15 text-[#00D9FF]'
                    : 'border-[#2A3142] text-[#8A93A6] hover:text-[#FFFFFF]'
                }`}
                style={speed === s ? undefined : { background: CHIP_BG }}
              >
                {labels[s]}
              </button>
            ))}
          </div>
          <button
            onClick={(e) => { e.currentTarget.blur(); onTogglePause() }}
            className="h-8 flex items-center px-7 rounded bg-[#00D9FF] hover:bg-[#4DE4FF] text-[#0F1419] text-[13px] font-extrabold tracking-[1.5px] cursor-pointer"
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <div className="flex items-center gap-1.5">
            <div className="h-6 flex items-center justify-center px-2 rounded-[3px] border border-[#2A3142] border-b-2 text-[10px] font-extrabold text-[#5C6779] font-mono" style={{ background: CHIP_BG }}>SPACE</div>
            {['1', '2', '3', '4'].map((k) => (
              <div key={k} className="h-6 w-6 flex items-center justify-center rounded-[3px] border border-[#2A3142] border-b-2 text-[10px] font-extrabold text-[#5C6779] font-mono" style={{ background: CHIP_BG }}>{k}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
