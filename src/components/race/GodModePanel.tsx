'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { Driver, Team, DriverRaceState, GodModeAction, TyreCompound, RaceState } from '@/lib/sim/types'
import { planStrategy, truthBelief, type StrategyStint } from '@/lib/sim/pit-ai'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { degradeTyre } from '@/lib/sim/tyres'
import { useSeasonStore } from '@/lib/store/season-store'
import TyreIndicator from './TyreIndicator'

interface GodModePanelProps {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  raceState: RaceState
  selectedDriverId: string
  onAction: (actions: GodModeAction[]) => void
}

const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']

function formatLapTime(lapTimes: number[]): string {
  if (!lapTimes.length) return '--'
  const t = lapTimes[lapTimes.length - 1]
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`
}

export default function GodModePanel({ drivers, teams, states, raceState, selectedDriverId, onAction }: GodModePanelProps) {
  const ds = states.find(s => s.driverId === selectedDriverId)
  const driver = drivers.find(d => d.id === selectedDriverId)
  const team = teams.find(t => t.id === driver?.teamId)
  // Team Manager gating: race control acts on YOUR drivers only; tyre-condition and form sliders are gone
  // (Peak Form maxes form automatically), and the perfect-strategy reveal (true-data) is hidden. Sandbox is
  // unchanged.
  const teamManagerMode = useSeasonStore((s) => s.teamManagerMode)
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const isMine = !teamManagerMode || driver?.teamId === playerTeamId
  // In Team Manager it's the pit wall (own-driver strategy control), not the sandbox's god mode.
  const title = teamManagerMode ? 'Pit Wall' : 'God Mode'

  const nextLapCond = ds ? degradeTyre(ds.currentTyre) : 100
  const [nextCond, setNextCond] = useState(nextLapCond)
  const [nextForm, setNextForm] = useState(ds?.form ?? 5)
  const [pitOverride, setPitOverride] = useState<'auto' | 'pit' | 'no-pit'>('auto')
  const [forceCompound, setForceCompound] = useState<TyreCompound>('medium')
  const prevPitStops = useRef(ds?.pitStops ?? 0)

  // Keep the editable "next lap" values in sync with the live driver: re-read them whenever the
  // selected driver or the lap changes, and reset the pit override only on a driver switch. Adjusting
  // state during render (React's sanctioned pattern for reacting to a changed value) replaces two
  // effects whose synchronous setState tripped react-hooks/set-state-in-effect.
  const [syncedKey, setSyncedKey] = useState(`${selectedDriverId}:${raceState.currentLap}`)
  const [syncedDriver, setSyncedDriver] = useState(selectedDriverId)
  const liveKey = `${selectedDriverId}:${raceState.currentLap}`
  if (liveKey !== syncedKey) {
    setSyncedKey(liveKey)
    if (ds) { setNextCond(degradeTyre(ds.currentTyre)); setNextForm(ds.form) }
  }
  if (selectedDriverId !== syncedDriver) {
    setSyncedDriver(selectedDriverId)
    setPitOverride('auto')
  }

  // On a driver switch, reset the pit-stop baseline so the lap detector below doesn't misfire.
  useEffect(() => {
    if (ds) prevPitStops.current = ds.pitStops
  }, [selectedDriverId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each lap: once a forced pit has actually happened, flip to no-pit and cancel; keep cancelling
  // while the driver is held out. onAction talks to the race engine, so this stays an effect.
  useEffect(() => {
    if (!ds) return
    if (pitOverride === 'pit' && ds.pitStops > prevPitStops.current) {
      setPitOverride('no-pit')
      onAction([{ type: 'cancel-pit', driverId: selectedDriverId }])
    }
    if (pitOverride === 'no-pit') {
      onAction([{ type: 'cancel-pit', driverId: selectedDriverId }])
    }
    prevPitStops.current = ds.pitStops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceState.currentLap])

  const perfectPit = useMemo(() => {
    if (!ds || !driver || !team) return null
    // Perfect-information benchmark: the optimiser on the race's TRUE deltas/life and exact condition.
    return planStrategy(
      raceState.currentLap, raceState.totalLaps,
      ds.currentTyre.condition, ds.currentTyre.compound, driver.smoothness,
      truthBelief(raceState.compoundDeltas, raceState.tyreBaseLife, raceState.totalLaps),
      raceState.weather, raceState.weatherForecast,
      pitLaneLoss(raceState.year),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriverId, raceState.currentLap, ds?.currentTyre.condition, ds?.currentTyre.compound])

  const fireCondition = (val: number) => {
    setNextCond(val)
    onAction([{ type: 'set-tyre-condition', driverId: selectedDriverId, value: val }])
  }

  const fireForm = (val: number) => {
    setNextForm(val)
    onAction([{ type: 'set-form', driverId: selectedDriverId, value: val }])
  }

  const firePitMode = (mode: 'auto' | 'pit' | 'no-pit', compound?: TyreCompound) => {
    const c = compound ?? forceCompound
    setPitOverride(mode)
    if (mode === 'pit') onAction([{ type: 'force-pit', driverId: selectedDriverId, compound: c }])
    else if (mode === 'no-pit') onAction([{ type: 'cancel-pit', driverId: selectedDriverId }])
  }

  const fireForceCompound = (val: TyreCompound) => {
    setForceCompound(val)
    if (pitOverride === 'pit') onAction([{ type: 'force-pit', driverId: selectedDriverId, compound: val }])
  }

  if (!ds || !driver || !team) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
          <h2 className="font-semibold text-sm tracking-wider text-[#FFFFFF] uppercase">{title}</h2>
        </div>
      </div>
    )
  }

  const condColor = ds.currentTyre.condition < 20 ? 'text-red-400' : 'text-[#FFFFFF]'
  const formColor = ds.form > 5 ? 'text-[#10B981]' : ds.form < 5 ? 'text-red-400' : 'text-[#FFFFFF]'

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
        <h2 className="font-semibold text-sm tracking-wider text-[#FFFFFF] uppercase">{title}</h2>
        <div className="ml-2 flex items-center gap-1.5">
          <div className="w-1 h-4 rounded-full" style={{ backgroundColor: team.color }} />
          <span className="text-sm font-bold text-[#FFFFFF]">{driver.name}</span>
          <span className="text-xs text-[#FFFFFF]">{team.shortName}</span>
          <span className="text-sm font-bold text-[#00D9FF] ml-1">P{ds.position}</span>
        </div>
      </div>

      {/* Current | Next — side by side */}
      <div className="grid grid-cols-2 gap-2">

        {/* Current lap */}
        <div className="bg-[#1E2431] rounded p-2.5">
          <div className="text-xs font-bold tracking-widest text-[#FFFFFF] uppercase mb-2">Now</div>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-[#FFFFFF]">Tyre</span>
              <div className="flex items-center gap-1.5">
                <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
                <span className={`text-sm ${condColor}`}>{ds.currentTyre.condition}%</span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-[#FFFFFF]">Stint</span>
              <span className="text-[#FFFFFF]">{ds.stintLap}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#FFFFFF]">Form</span>
              <span className={formColor}>{ds.form.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#FFFFFF]">Last lap</span>
              <span className="font-mono text-[#FFFFFF]">{formatLapTime(ds.lapTimes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#FFFFFF]">Gap</span>
              <span className="font-mono text-[#FFFFFF]">{ds.gap === 0 ? 'LEAD' : `+${ds.gap.toFixed(2)}s`}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#FFFFFF]">AI pit</span>
              {ds.targetPitLap !== null ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[#FFFFFF]">L{ds.targetPitLap}</span>
                  <TyreIndicator compound={ds.targetNextCompound} size="sm" />
                </div>
              ) : (
                <span className="text-xs text-[#FFFFFF]">none</span>
              )}
            </div>
          </div>
        </div>

        {/* Next lap overrides — your drivers only in Team Manager mode */}
        {isMine && (
        <div className="bg-[#1E2431] rounded p-2.5">
          <div className="text-xs font-bold tracking-widest text-[#FFFFFF] uppercase mb-2">Next lap</div>
          <div className="flex flex-col gap-2">
            {!teamManagerMode && (
            <div>
              <div className="flex justify-between mb-0.5">
                <label className="text-xs text-[#FFFFFF]">Tyre cond.</label>
                <span className="text-xs text-[#FFFFFF]">{Math.round(nextCond)}%</span>
              </div>
              <input type="range" min={0} max={100} step={1}
                value={nextCond}
                onChange={e => fireCondition(Number(e.target.value))}
                className="w-full accent-[#00D9FF]"
              />
            </div>
            )}
            {!teamManagerMode && (
            <div>
              <div className="flex justify-between mb-0.5">
                <label className="text-xs text-[#FFFFFF]">Form</label>
                <span className={`text-xs ${nextForm > 5 ? 'text-[#10B981]' : nextForm < 5 ? 'text-red-400' : 'text-[#FFFFFF]'}`}>{Number(nextForm).toFixed(1)}</span>
              </div>
              <input type="range" min={0} max={10} step={0.5}
                value={nextForm}
                onChange={e => fireForm(Number(e.target.value))}
                className="w-full accent-[#00D9FF]"
              />
            </div>
            )}
            <div>
              <label className="text-xs text-[#FFFFFF] block mb-1">This lap</label>
              <div className="flex gap-1.5">
                {(['auto', 'pit', 'no-pit'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => firePitMode(mode)}
                    className={`flex-1 py-1.5 text-xs font-bold tracking-widest uppercase rounded transition-colors ${
                      pitOverride === mode
                        ? mode === 'pit'
                          ? 'bg-[#00D9FF] text-[#0F1419]'
                          : mode === 'no-pit'
                          ? 'bg-[#DC143C] text-white'
                          : 'bg-[#2A3142] text-[#FFFFFF] ring-1 ring-[#FFFFFF]'
                        : 'bg-[#1E2431] text-[#FFFFFF] hover:text-[#FFFFFF]'
                    }`}
                  >
                    {mode === 'no-pit' ? 'No Pit' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {pitOverride === 'pit' && (
              <select value={forceCompound} onChange={e => fireForceCompound(e.target.value as TyreCompound)}
                className="w-full bg-[#2A3142] text-[#FFFFFF] text-xs px-2 py-1 rounded border border-[#3a4255] focus:outline-none focus:border-[#00D9FF]"
              >
                {COMPOUNDS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Perfect strategy — hidden in Team Manager mode (true-data reveal). */}
      {!teamManagerMode && perfectPit && (
        <div className="bg-[#0d2230] rounded p-2.5 border border-[#00D9FF]/20">
          <div className="text-xs font-bold tracking-widest text-[#FFFFFF] uppercase mb-2">Perfect strategy</div>
          <div className="flex flex-col gap-1">
            {perfectPit.stints.map((stint: StrategyStint, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <TyreIndicator compound={stint.compound} size="sm" />
                <span className="text-[#FFFFFF]">L{stint.fromLap}–{stint.toLap}</span>
                <span className="text-[#FFFFFF] text-xs">({stint.toLap - stint.fromLap + 1} laps)</span>
                {i < perfectPit.stints.length - 1 && (
                  <span className="text-[#00D9FF] text-xs ml-auto">pit →</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retire — your drivers only in Team Manager mode */}
      {isMine && (
        <button onClick={() => onAction([{ type: 'force-retire', driverId: selectedDriverId }])}
          className="w-full py-2 bg-[#DC143C] hover:bg-[#b01030] text-white text-sm font-bold tracking-widest uppercase rounded transition-colors"
        >
          Retire Driver
        </button>
      )}
    </div>
  )
}
