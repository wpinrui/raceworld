'use client'

import type { RacePhase, RaceState } from '@/lib/sim/types'
import type { Circuit } from '@/lib/sim/types'
import { WeatherGraph } from './WeatherGraph'
import { pitLaneLoss } from '@/lib/sim/pit-loss'

interface Props {
  phase: RacePhase
  raceState: RaceState | null
  lapProgress: number
  currentCircuit: Circuit | undefined
}

export function RaceHeader({
  phase, raceState, lapProgress, currentCircuit,
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
        {raceState && (
          <span className="text-xs text-[#FFFFFF]">Pit loss ~{Math.round(pitLaneLoss(raceState.year))}s</span>
        )}
      </div>

      {raceState && (
        <WeatherGraph
          weather={raceState.weather ?? []}
          forecast={raceState.weatherForecast ?? []}
          currentLap={raceState.currentLap}
          totalLaps={raceState.totalLaps}
        />
      )}
    </div>
  )
}
