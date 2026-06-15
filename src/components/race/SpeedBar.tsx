'use client'

import { FastForward } from 'lucide-react'
import type { SimSpeed } from '@/lib/sim/types'

interface Props {
  speed: SimSpeed
  paused: boolean
  onSpeedClick: (s: SimSpeed) => void
  onTogglePause: () => void
}

export function SpeedBar({ speed, paused, onSpeedClick, onTogglePause }: Props) {
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

      <div className="ml-auto text-sm text-[#FFFFFF]">Space · 1 2 3 4</div>
    </div>
  )
}
