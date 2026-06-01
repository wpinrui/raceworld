'use client'

import { useState } from 'react'
import type { Driver, DriverRaceState, GodModeAction } from '@/lib/sim/types'

interface GodModePanelProps {
  drivers: Driver[]
  states: DriverRaceState[]
  onAction: (action: GodModeAction) => void
}

export default function GodModePanel({ drivers, states, onAction }: GodModePanelProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>(drivers[0]?.id ?? '')
  const [tyreCondition, setTyreCondition] = useState<number>(100)
  const [form, setForm] = useState<number>(5)

  const activeDrivers = drivers.filter((d) => {
    const s = states.find((s) => s.driverId === d.id)
    return s && !s.retired
  })

  const currentState = states.find((s) => s.driverId === selectedDriverId)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 bg-[#DC143C]" />
        <h2 className="text-xs font-bold tracking-widest text-[#E8EAED] uppercase">
          God Mode
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {/* Driver selector */}
        <div>
          <label className="block text-[10px] font-bold tracking-widest text-[#6B7280] uppercase mb-1">
            Driver
          </label>
          <select
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            className="w-full bg-[#2A3142] text-[#E8EAED] text-xs px-2 py-1.5 rounded border border-[#3a4255] focus:outline-none focus:border-[#00D9FF]"
          >
            {drivers.map((d) => {
              const s = states.find((s) => s.driverId === d.id)
              const retired = s?.retired
              return (
                <option key={d.id} value={d.id}>
                  {d.name}{retired ? ' (RET)' : ''}
                </option>
              )
            })}
          </select>
        </div>

        {currentState && (
          <div className="text-[10px] text-[#6B7280]">
            P{currentState.position} — Tyre: {currentState.currentTyre.condition.toFixed(0)}% —
            Form: {currentState.form.toFixed(1)}
          </div>
        )}

        {/* Tyre condition */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-bold tracking-widest text-[#6B7280] uppercase mb-1">
              Tyre Cond.
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={tyreCondition}
              onChange={(e) => setTyreCondition(Number(e.target.value))}
              className="w-full bg-[#2A3142] text-[#E8EAED] text-xs px-2 py-1.5 rounded border border-[#3a4255] focus:outline-none focus:border-[#00D9FF]"
            />
          </div>
          <button
            onClick={() =>
              onAction({
                type: 'set-tyre-condition',
                driverId: selectedDriverId,
                value: Math.min(100, Math.max(0, tyreCondition)),
              })
            }
            className="mt-4 px-3 py-1.5 bg-[#2A3142] hover:bg-[#3a4255] text-[#00D9FF] text-xs font-bold rounded border border-[#00D9FF] transition-colors"
          >
            SET
          </button>
        </div>

        {/* Form */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-bold tracking-widest text-[#6B7280] uppercase">
              Form
            </label>
            <span className="text-[#00D9FF] text-xs font-mono">{form.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={form}
              onChange={(e) => setForm(Number(e.target.value))}
              className="flex-1 accent-[#00D9FF]"
            />
            <button
              onClick={() =>
                onAction({ type: 'set-form', driverId: selectedDriverId, value: form })
              }
              className="px-3 py-1.5 bg-[#2A3142] hover:bg-[#3a4255] text-[#00D9FF] text-xs font-bold rounded border border-[#00D9FF] transition-colors"
            >
              SET
            </button>
          </div>
        </div>

        {/* Force retirement */}
        <button
          onClick={() =>
            onAction({ type: 'force-retire', driverId: selectedDriverId })
          }
          className="w-full py-2 bg-[#DC143C] hover:bg-[#b01030] text-white text-xs font-bold tracking-widest uppercase rounded transition-colors"
        >
          Retire Driver
        </button>
      </div>
    </div>
  )
}
