'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { Driver, Team, DriverRaceState, GodModeAction, TyreCompound, RaceState } from '@/lib/sim/types'
import { planStrategy, sampleTeamAssumptions, type StrategyStint } from '@/lib/sim/pit-ai'
import { degradeTyre } from '@/lib/sim/tyres'
import TyreIndicator from './TyreIndicator'

interface GodModePanelProps {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  raceState: RaceState
  selectedDriverId: string
  onAction: (actions: GodModeAction[]) => void
}


const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard']

function formatLapTime(lapTimes: number[]): string {
  if (!lapTimes.length) return '--'
  const t = lapTimes[lapTimes.length - 1]
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`
}

export default function GodModePanel({ drivers, teams, states, raceState, selectedDriverId, onAction }: GodModePanelProps) {
  const ds = states.find(s => s.driverId === selectedDriverId)
  const driver = drivers.find(d => d.id === selectedDriverId)
  const team = teams.find(t => t.id === driver?.teamId)

  const nextLapCond = ds ? degradeTyre(ds.currentTyre) : 100
  const [nextCond, setNextCond] = useState(nextLapCond)
  const [nextForm, setNextForm] = useState(ds?.form ?? 5)
  const [pitOverride, setPitOverride] = useState<'auto' | 'pit' | 'no-pit'>('auto')
  const [forceCompound, setForceCompound] = useState<TyreCompound>('medium')
  const prevPitStops = useRef(ds?.pitStops ?? 0)

  // Reset when driver changes
  useEffect(() => {
    if (ds) {
      setNextCond(degradeTyre(ds.currentTyre))
      setNextForm(ds.form)
      prevPitStops.current = ds.pitStops
    }
    setPitOverride('auto')
  }, [selectedDriverId])

  // Each lap: sync sliders, handle persistent no-pit, detect completed pit
  useEffect(() => {
    if (!ds) return
    setNextCond(degradeTyre(ds.currentTyre))
    setNextForm(ds.form)

    // If we were forcing a pit and it just happened → flip to no-pit
    if (pitOverride === 'pit' && ds.pitStops > prevPitStops.current) {
      setPitOverride('no-pit')
      onAction([{ type: 'cancel-pit', driverId: selectedDriverId }])
    }

    // Persistent no-pit: re-queue cancel every lap
    if (pitOverride === 'no-pit') {
      onAction([{ type: 'cancel-pit', driverId: selectedDriverId }])
    }

    prevPitStops.current = ds.pitStops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceState.currentLap])

  const perfectPit = useMemo(() => {
    if (!ds || !driver || !team) return null
    const exactAssumptions = sampleTeamAssumptions(raceState.totalLaps, 0)
    return planStrategy(
      raceState.currentLap, raceState.totalLaps,
      ds.currentTyre.condition, ds.currentTyre.compound, ds.currentTyre.maxLifeLaps,
      exactAssumptions,
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
    // auto: no action — AI resumes control
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
          <h2 className="font-f1 text-base tracking-widest text-[#E8EAED] uppercase">God Mode</h2>
        </div>
        <p className="text-[#6B7280] text-sm italic">Select a driver from the standings.</p>
      </div>
    )
  }

  const condColor = ds.currentTyre.condition < 20 ? 'text-red-400' : 'text-[#E8EAED]'
  const formColor = ds.form > 5 ? 'text-[#10B981]' : ds.form < 5 ? 'text-red-400' : 'text-[#6B7280]'

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
        <h2 className="font-f1 text-base tracking-widest text-[#E8EAED] uppercase">God Mode</h2>
        <div className="ml-2 flex items-center gap-1.5">
          <div className="w-1 h-4 rounded-full" style={{ backgroundColor: team.color }} />
          <span className="text-sm font-bold text-[#E8EAED]">{driver.name}</span>
          <span className="text-xs text-[#6B7280]">{team.shortName}</span>
          <span className="font-mono text-sm font-bold text-[#00D9FF] ml-1">P{ds.position}</span>
        </div>
      </div>

      {/* Current | Next — side by side */}
      <div className="grid grid-cols-2 gap-2">

        {/* Current lap */}
        <div className="bg-[#1E2431] rounded p-2.5">
          <div className="text-xs font-bold tracking-widest text-[#6B7280] uppercase mb-2">Now</div>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-[#6B7280]">Tyre</span>
              <div className="flex items-center gap-1.5">
                <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
                <span className={`font-mono text-sm ${condColor}`}>{ds.currentTyre.condition}%</span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7280]">Stint</span>
              <span className="font-mono text-[#E8EAED]">{ds.stintLap}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7280]">Form</span>
              <span className={`font-mono ${formColor}`}>{ds.form.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7280]">Last lap</span>
              <span className="font-mono text-[#E8EAED]">{formatLapTime(ds.lapTimes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7280]">Gap</span>
              <span className="font-mono text-[#E8EAED]">{ds.gap === 0 ? 'LEAD' : `+${ds.gap.toFixed(2)}s`}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#6B7280]">AI pit</span>
              {ds.targetPitLap !== null ? (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[#A0A9B8] text-xs">L{ds.targetPitLap}</span>
                  <TyreIndicator compound={ds.targetNextCompound} size="sm" />
                </div>
              ) : (
                <span className="font-mono text-[#A0A9B8] text-xs">none</span>
              )}
            </div>
          </div>
        </div>

        {/* Next lap overrides */}
        <div className="bg-[#1E2431] rounded p-2.5">
          <div className="text-xs font-bold tracking-widest text-[#6B7280] uppercase mb-2">Next lap</div>
          <div className="flex flex-col gap-2">
            <div>
              <div className="flex justify-between mb-0.5">
                <label className="text-xs text-[#6B7280]">Tyre cond.</label>
                <span className="text-xs font-mono text-[#E8EAED]">{Math.round(nextCond)}%</span>
              </div>
              <input type="range" min={0} max={100} step={1}
                value={nextCond}
                onChange={e => fireCondition(Number(e.target.value))}
                className="w-full accent-[#00D9FF]"
              />
            </div>
            <div>
              <div className="flex justify-between mb-0.5">
                <label className="text-xs text-[#6B7280]">Form</label>
                <span className={`text-xs font-mono ${nextForm > 5 ? 'text-[#10B981]' : nextForm < 5 ? 'text-red-400' : 'text-[#6B7280]'}`}>{Number(nextForm).toFixed(1)}</span>
              </div>
              <input type="range" min={0} max={10} step={0.5}
                value={nextForm}
                onChange={e => fireForm(Number(e.target.value))}
                className="w-full accent-[#00D9FF]"
              />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] block mb-1">This lap</label>
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
                          : 'bg-[#2A3142] text-[#E8EAED] ring-1 ring-[#A0A9B8]'
                        : 'bg-[#1E2431] text-[#6B7280] hover:text-[#A0A9B8]'
                    }`}
                  >
                    {mode === 'no-pit' ? 'No Pit' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {pitOverride === 'pit' && (
              <select value={forceCompound} onChange={e => fireForceCompound(e.target.value as TyreCompound)}
                className="w-full bg-[#2A3142] text-[#E8EAED] text-xs px-2 py-1 rounded border border-[#3a4255] focus:outline-none focus:border-[#00D9FF]"
              >
                {COMPOUNDS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Perfect strategy — full race */}
      {perfectPit && (
        <div className="bg-[#0d2230] rounded p-2.5 border border-[#00D9FF]/20">
          <div className="text-xs font-bold tracking-widest text-[#6B7280] uppercase mb-2">Perfect strategy</div>
          <div className="flex flex-col gap-1">
            {perfectPit.stints.map((stint: StrategyStint, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm font-mono">
                <TyreIndicator compound={stint.compound} size="sm" />
                <span className="text-[#6B7280]">L{stint.fromLap}–{stint.toLap}</span>
                <span className="text-[#A0A9B8] text-xs">({stint.toLap - stint.fromLap + 1} laps)</span>
                {i < perfectPit.stints.length - 1 && (
                  <span className="text-[#00D9FF] text-xs ml-auto">pit →</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retire */}
      <button onClick={() => onAction([{ type: 'force-retire', driverId: selectedDriverId }])}
        className="w-full py-2 bg-[#DC143C] hover:bg-[#b01030] text-white text-sm font-bold tracking-widest uppercase rounded transition-colors"
      >
        Retire Driver
      </button>
    </div>
  )
}
