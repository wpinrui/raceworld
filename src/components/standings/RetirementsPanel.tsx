'use client'

import type { EndOfSeasonSummary, Driver } from '@/lib/sim/types'

interface Props {
  summary: EndOfSeasonSummary
  drivers: Driver[]
}

export function RetirementsPanel({ summary, drivers }: Props) {
  const scoreMap = new Map(summary.driverMediaScores.map((s) => [s.driverId, s.score]))

  if (summary.retiredDriverIds.length === 0) {
    return <p className="text-sm text-[#6B7280]">No retirements this off-season.</p>
  }

  const retired = summary.retiredDriverIds.map((id) => {
    const driver = drivers.find((d) => d.id === id)
    const score = scoreMap.get(id) ?? 0
    const tooOld = driver ? driver.age > driver.primeEnd + 5 : false
    return { id, name: driver?.name ?? id, age: driver?.age ?? '?', score, tooOld }
  })

  return (
    <div className="space-y-2">
      {retired.map(({ id, name, age, score, tooOld }) => (
        <div key={id} className="flex items-center justify-between rounded-lg bg-[#2A3142] px-4 py-3">
          <div>
            <span className="text-[#E8EAED] font-medium">{name}</span>
            <span className="ml-2 text-[#6B7280] text-sm">Age {age}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#A0A9B8]">
              {tooOld ? 'Age-related decline' : 'Media score too low'}
            </span>
            <span className="tabular-nums text-sm font-semibold text-[#DC143C]">
              {score.toFixed(1)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
