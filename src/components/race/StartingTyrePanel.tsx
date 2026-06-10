'use client'

import type { TyreCompound } from '@/lib/sim/types'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import TyreIndicator from './TyreIndicator'

const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']

// Team Manager pre-race control: choose the grid (starting) tyre for your cars. The "Both cars" row sets
// both at once; the per-driver rows allow a split-strategy start. Only shown in pre-race, where the race
// state exists but no lap has run, so the choice is a clean override of the weather-default compound.
function CompoundButton({ compound, selected, onClick }: { compound: TyreCompound; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full p-0.5 transition-all ${selected ? 'ring-2 ring-[#00D9FF]' : 'opacity-50 hover:opacity-100'}`}
    >
      <TyreIndicator compound={compound} size="md" />
    </button>
  )
}

export function StartingTyrePanel() {
  const raceState = useRaceStore((s) => s.raceState)
  const drivers = useRaceStore((s) => s.drivers)
  const setStartingTyre = useRaceStore((s) => s.setStartingTyre)
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)

  const myDrivers = drivers.filter((d) => d.teamId === playerTeamId)
  const compoundOf = (driverId: string) => raceState?.drivers.find((ds) => ds.driverId === driverId)?.currentTyre.compound

  if (myDrivers.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No cars on the grid.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
        <h2 className="font-semibold text-sm tracking-widest uppercase text-[#FFFFFF]">Starting Tyre</h2>
      </div>

      {/* Set both cars at once. */}
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-[#FFFFFF] w-24 shrink-0">Both cars</span>
        <div className="flex gap-1.5">
          {COMPOUNDS.map((c) => (
            <CompoundButton key={c} compound={c} selected={false} onClick={() => myDrivers.forEach((d) => setStartingTyre(d.id, c))} />
          ))}
        </div>
      </div>

      <div className="h-px bg-[#2A3142]" />

      {/* Per-driver — overrides one car (split strategy). */}
      {myDrivers.map((d) => {
        const cur = compoundOf(d.id)
        return (
          <div key={d.id} className="flex items-center gap-3">
            <span className="text-sm text-[#FFFFFF] w-24 shrink-0 truncate">{d.name}</span>
            <div className="flex gap-1.5">
              {COMPOUNDS.map((c) => (
                <CompoundButton key={c} compound={c} selected={cur === c} onClick={() => setStartingTyre(d.id, c)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
