'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { Driver } from '@/lib/sim/types'
import type { DriverCareer } from '@/lib/news/engine'
import { overall } from '@/lib/sim/progression'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// An expanded hover card for a driver: rating (overall + potential), career totals, age, nationality,
// and this year's championship position (if they raced). Wrap any trigger element with it.

const ordinal = (n: number): string => {
  const r = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return `${n}${s[(r - 20) % 10] || s[r] || s[0]}`
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wide text-[#FFFFFF]">{label}</span>
      <span className="text-xs font-semibold text-[#FFFFFF] tabular-nums">{value}</span>
    </span>
  )
}

export function DriverTooltip({
  driver,
  year,
  wdcPosition,
  wdcPoints,
  career,
  children,
  side = 'left',
}: {
  driver: Driver
  year: number
  wdcPosition?: number | null
  wdcPoints?: number
  career?: DriverCareer
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const ov = Math.round(overall(driver))
  const pot = Math.round(driver.peakPotential)
  return (
    <RadixTooltip.Provider delayDuration={150}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={8}
            collisionPadding={8}
            className="z-50 w-60 rounded-lg bg-[#1E2431] border border-[#303848] p-3 shadow-lg shadow-black/40 select-none"
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#FFFFFF]">
              <NationalityFlag code={driver.nationality} size="1em" />
              <span className="truncate">{driver.name}</span>
            </p>
            <p className="text-[11px] text-[#FFFFFF]">Age {driver.age}</p>
            <p className="mt-0.5 text-[11px] text-[#FFFFFF]">
              {wdcPosition != null
                ? <>{ordinal(wdcPosition)} in the {year} championship{wdcPoints != null ? ` · ${wdcPoints} pts` : ''}</>
                : <>Did not race in {year}</>}
            </p>

            <div className="mt-2 grid grid-cols-2 gap-x-4 border-t border-[#303848] pt-2">
              <Stat label="Overall" value={ov} />
              <Stat label="Potential" value={pot} />
            </div>

            <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-[#303848] pt-2">
              <Stat label="Seasons" value={career?.seasons ?? 0} />
              <Stat label="Races" value={career?.starts ?? 0} />
              <Stat label="Points" value={career?.points ?? 0} />
              <Stat label="Wins" value={career?.wins ?? 0} />
              <Stat label="Poles" value={career?.poles ?? 0} />
              <Stat label="Podiums" value={career?.podiums ?? 0} />
            </div>
            <RadixTooltip.Arrow className="fill-[#1E2431]" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
