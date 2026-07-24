'use client'

import { useState } from 'react'
import { Snowflake, X } from 'lucide-react'
import { liveBridge } from '@/lib/store/live-bridge'
import TyreIndicator from './TyreIndicator'
import type { TyreCompound } from '@/lib/sim/types'

// God-mode tyre editor (#live-engine): opened from a tyre cell on the standings board. The wear
// slider writes straight into the live engine; the freeze pin holds the condition until the car
// next takes a fresh set (the engine releases it at the stop).

export function TyreGodModal({
  driverId, driverName, compound, condition, onClose,
}: {
  driverId: string
  driverName: string
  compound: TyreCompound
  condition: number
  onClose: () => void
}) {
  const [value, setValue] = useState(Math.round(condition))
  const [frozen, setFrozen] = useState(() => liveBridge.current?.isWearFrozen(driverId) ?? false)

  const apply = (v: number) => {
    setValue(v)
    liveBridge.current?.applyGodActions([{ type: 'set-tyre-condition', driverId, value: v }])
  }
  const toggleFreeze = () => {
    const next = !frozen
    setFrozen(next)
    liveBridge.current?.setWearFrozen(driverId, next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[300px] rounded-lg bg-[#1E2431] border border-[#2A3142] p-4 text-[#FFFFFF] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <TyreIndicator compound={compound} size="sm" />
          <span className="text-sm font-bold">{driverName}</span>
          <button onClick={onClose} className="ml-auto cursor-pointer text-[#6B7280] hover:text-[#FFFFFF]">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => apply(Number(e.target.value))}
            className="flex-1 accent-[#00D9FF]"
          />
          <span className="w-[44px] text-right text-sm font-bold tabular-nums">{value}%</span>
        </div>

        <button
          onClick={toggleFreeze}
          className={`mt-3 flex w-full items-center gap-2 rounded px-2.5 py-1.5 cursor-pointer border text-[11px] font-extrabold tracking-[1px] ${
            frozen
              ? 'border-[#00D9FF] text-[#00D9FF] bg-[rgba(0,217,255,0.08)]'
              : 'border-[#2A3142] text-[#FFFFFF] hover:bg-[#141924]'
          }`}
        >
          <Snowflake size={13} />
          FREEZE WEAR
          <span className="ml-auto text-[10px]" style={{ color: frozen ? '#00D9FF' : '#6B7280' }}>
            {frozen ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>
    </div>
  )
}
