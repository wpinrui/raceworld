'use client'

import type { RacePhase, RaceState } from '@/lib/sim/types'
import type { Circuit } from '@/lib/sim/types'

interface Props {
  phase: RacePhase
  raceState: RaceState | null
  lapProgress: number
  currentCircuit: Circuit | undefined
  autoSimming: boolean
  onStopAutoSim: () => void
  onRestartWeekend: () => void
}

export function RaceHeader({
  phase, raceState, lapProgress, currentCircuit,
  autoSimming, onStopAutoSim, onRestartWeekend,
}: Props) {
  return (
    <div className="shrink-0 flex items-center justify-between px-6 py-2 bg-[#1E2431] border-b border-[#2A3142]">
      <div className="flex items-center gap-3">
        {(phase === 'racing' || phase === 'finished') && raceState ? (
          <>
            <div className="relative overflow-hidden rounded px-3 py-1 bg-[#2A3142]">
              <div
                className="absolute inset-y-0 left-0 bg-[#00D9FF]/20"
                style={{ width: `${phase === 'racing' ? lapProgress : 100}%` }}
              />
              <span className="relative font-display text-sm tracking-widest uppercase text-[#FFFFFF]">
                Lap {Math.min(raceState.currentLap, raceState.totalLaps)}/{raceState.totalLaps}
              </span>
            </div>
            <span className="text-[#FFFFFF] text-sm">{currentCircuit?.name}</span>
            {phase === 'finished' && (
              <span className="font-semibold text-xs tracking-wider text-[#00D9FF] uppercase animate-pulse ml-1">
                Finished
              </span>
            )}
          </>
        ) : (
          <span className="text-[#FFFFFF] text-sm">{currentCircuit?.name ?? '—'}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {autoSimming && (
          <button
            onClick={onStopAutoSim}
            className="text-xs text-[#DC143C] hover:text-[#ff4466] tracking-wider uppercase transition-colors cursor-pointer animate-pulse"
          >
            Stop Auto-Sim
          </button>
        )}
        <button
          onClick={onRestartWeekend}
          className="text-xs text-[#FFFFFF] hover:text-[#DC143C] tracking-wider uppercase transition-colors cursor-pointer"
        >
          Restart Weekend
        </button>
      </div>
    </div>
  )
}
