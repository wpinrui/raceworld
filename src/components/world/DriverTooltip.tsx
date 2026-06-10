'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { Driver } from '@/lib/sim/types'
import type { DriverCareer } from '@/lib/news/engine'
import { shownOverall } from '@/lib/sim/progression'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { useRatingsHidden } from '@/lib/useRatingsHidden'
import { ratingGrade } from '@/lib/team-manager'

// An expanded hover card for a driver: rating (overall + potential), career totals, age, nationality,
// and this year's championship position (if they raced). Wrap any trigger element with it.

const ordinal = (n: number): string => {
  const r = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return `${n}${s[(r - 20) % 10] || s[r] || s[0]}`
}

function Stat({ label, value }: { label: string; value: number | string }) {
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
  teamName,
  teamColor,
  children,
  side = 'left',
}: {
  driver: Driver
  year: number
  wdcPosition?: number | null
  wdcPoints?: number
  career?: DriverCareer
  teamName?: string
  teamColor?: string
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const hidden = useRatingsHidden()
  const ov = Math.round(shownOverall(driver))
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
            {teamName && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#FFFFFF]">
                <span className="h-3 w-1 shrink-0 rounded-sm" style={{ backgroundColor: teamColor ?? '#6B7280' }} />
                <span className="truncate">{teamName}</span>
              </p>
            )}
            <p className="text-[11px] text-[#FFFFFF]">Age {driver.age}</p>
            <p className="mt-0.5 text-[11px] text-[#FFFFFF]">
              {wdcPosition != null
                ? <>{ordinal(wdcPosition)} in the {year} championship{wdcPoints != null ? ` · ${wdcPoints} pts` : ''}</>
                : <>Did not race in {year}</>}
            </p>

            <div className="mt-2 grid grid-cols-2 gap-x-4 border-t border-[#303848] pt-2">
              <Stat label="Overall" value={hidden ? ratingGrade(ov) : ov} />
              <Stat label="Potential" value={hidden ? ratingGrade(pot) : pot} />
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
