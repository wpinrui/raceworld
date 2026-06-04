'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { Driver } from '@/lib/sim/types'

// An expanded hover card for a driver: their core attributes, age, nationality, and this year's
// championship position (if they raced). Wrap any trigger element with it.

function StatRow({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] text-[11px] text-[#FFFFFF]">{label}</span>
      <span className="flex-1 h-1.5 rounded-full bg-[#0F1419] overflow-hidden">
        <span className="block h-full rounded-full bg-[#00D9FF]" style={{ width: `${v}%` }} />
      </span>
      <span className="w-6 text-right text-[11px] font-semibold text-[#FFFFFF] tabular-nums">{v}</span>
    </div>
  )
}

const ordinal = (n: number): string => {
  const r = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return `${n}${s[(r - 20) % 10] || s[r] || s[0]}`
}

export function DriverTooltip({
  driver,
  year,
  wdcPosition,
  wdcPoints,
  children,
  side = 'left',
}: {
  driver: Driver
  year: number
  wdcPosition?: number | null
  wdcPoints?: number
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <RadixTooltip.Provider delayDuration={150}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={8}
            collisionPadding={8}
            className="z-50 w-56 rounded-lg bg-[#1E2431] border border-[#303848] p-3 shadow-lg shadow-black/40 select-none"
          >
            <p className="text-sm font-semibold text-[#FFFFFF] truncate">{driver.name}</p>
            <p className="text-[11px] text-[#FFFFFF]">{driver.nationality} · Age {driver.age}</p>
            <p className="mt-0.5 text-[11px] text-[#FFFFFF]">
              {wdcPosition != null
                ? <>{ordinal(wdcPosition)} in the {year} championship{wdcPoints != null ? ` · ${wdcPoints} pts` : ''}</>
                : <>Did not race in {year}</>}
            </p>
            <div className="mt-2 space-y-1">
              <StatRow label="Pace" value={driver.pace} />
              <StatRow label="Wet" value={driver.wetWeatherPace} />
              <StatRow label="Overtaking" value={driver.overtaking} />
              <StatRow label="Smoothness" value={driver.smoothness} />
            </div>
            <RadixTooltip.Arrow className="fill-[#1E2431]" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
