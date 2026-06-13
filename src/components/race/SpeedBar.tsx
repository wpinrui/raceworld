'use client'

import { FastForward, Radio } from 'lucide-react'
import type { SimSpeed } from '@/lib/sim/types'

interface Props {
  speed: SimSpeed
  paused: boolean
  onSpeedClick: (s: SimSpeed) => void
  onTogglePause: () => void
  // Race Engineer auto-advance: play at the chosen speed but auto-pause at the pit window. A toggle, not a
  // speed — it runs alongside speeds 1-4. Hidden unless the talent is on.
  showAutoAdvance?: boolean
  autoAdvance?: boolean
  onToggleAutoAdvance?: () => void
  pitAlert?: string | null
}

export function SpeedBar({ speed, paused, onSpeedClick, onTogglePause, showAutoAdvance, autoAdvance, onToggleAutoAdvance, pitAlert }: Props) {
  return (
    <div className="shrink-0 bg-[#1E2431] border-t border-[#2A3142] px-6 py-3 flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        {([1, 2, 3, 4, 5] as SimSpeed[]).map((s) => (
          <button
            key={s}
            onClick={() => onSpeedClick(s)}
            className={`px-4 py-2 text-sm font-bold rounded transition-colors flex items-center ${
              speed === s ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'
            }`}
          >
            {s === 5 ? <FastForward size={16} className="fill-current" /> : `${s}x`}
          </button>
        ))}
        {showAutoAdvance && (
          <button
            onClick={onToggleAutoAdvance}
            title="Play at the chosen speed and auto-pause when a car should pit"
            className={`ml-1.5 px-3 py-2 text-sm font-bold tracking-wide uppercase rounded transition-colors flex items-center gap-1.5 ${
              autoAdvance ? 'bg-[#7C3AED] text-white' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'
            }`}
          >
            <Radio size={15} /> Auto-pit
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-[#2A3142]" />

      <button
        onClick={onTogglePause}
        className={`px-5 py-2 text-sm font-bold tracking-widest uppercase rounded transition-colors ${
          paused ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'
        }`}
      >
        {paused ? 'Resume' : 'Pause'}
      </button>

      {pitAlert && (
        <span className="px-3 py-1.5 rounded bg-[#7C3AED] text-white text-sm font-bold tracking-wide">{pitAlert}</span>
      )}

      <div className="ml-auto text-sm text-[#FFFFFF]">Space · 1 2 3 4</div>
    </div>
  )
}
