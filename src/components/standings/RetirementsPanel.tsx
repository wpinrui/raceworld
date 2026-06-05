'use client'

import type { EndOfSeasonSummary, Driver } from '@/lib/sim/types'
import { DriverLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'

interface Props {
  summary: EndOfSeasonSummary
  drivers: Driver[]
}

export function RetirementsPanel({ summary, drivers }: Props) {
  const card = useLiveDriverCards()
  if (summary.retiredDriverIds.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">No retirements this off-season.</p>
  }

  const retired = summary.retiredDriverIds.map((id) => {
    const driver = drivers.find((d) => d.id === id)
    return { id, name: driver?.name ?? id, age: driver?.age ?? '?' }
  })

  return (
    <div className="space-y-2">
      {retired.map(({ id, name, age }) => (
        <div key={id} className="flex items-center justify-between rounded-lg bg-[#2A3142] px-4 py-3">
          <div>
            <DriverHover id={id} card={card}><DriverLink id={id} className="text-[#FFFFFF] font-medium">{name}</DriverLink></DriverHover>
            <span className="ml-2 text-[#FFFFFF] text-sm">Age {age}</span>
          </div>
          <span className="text-sm text-[#FFFFFF]">Out of F1 for 5 seasons</span>
        </div>
      ))}
    </div>
  )
}
