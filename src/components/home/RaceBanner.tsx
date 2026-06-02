'use client'

import Link from 'next/link'
import { Panel } from '@/components/world/ui'
import { calendar2026 } from '@/data/calendar'
import { useSeasonStore } from '@/lib/store/season-store'

// Horizontal calendar strip: up to 4 completed races (recessed, linking to their
// classification) and up to 4 upcoming races (next/current highlighted in cyan).
export function RaceBanner() {
  const currentRound = useSeasonStore((s) => s.currentRound)
  const year = useSeasonStore((s) => s.year)

  const total = calendar2026.length

  // Last 4 completed rounds: 1 .. currentRound-1, capped to calendar bounds.
  const completedEnd = Math.min(currentRound - 1, total)
  const completedStart = Math.max(1, completedEnd - 3)
  const completed: number[] = []
  for (let r = completedStart; r <= completedEnd; r++) completed.push(r)

  // Next 4 rounds including the current/next one: currentRound .. , capped.
  const upcomingStart = Math.min(Math.max(currentRound, 1), total + 1)
  const upcomingEnd = Math.min(upcomingStart + 3, total)
  const upcoming: number[] = []
  for (let r = upcomingStart; r <= upcomingEnd; r++) upcoming.push(r)

  return (
    <Panel title="Calendar" flush>
      <div className="flex gap-2 overflow-x-auto px-5 py-4">
        {completed.length === 0 && upcoming.length === 0 && (
          <p className="text-[10px] uppercase tracking-widest text-[#6B7280]">—</p>
        )}

        {completed.map((round) => {
          const c = calendar2026[round - 1]
          return (
            <Link
              key={round}
              href={`/world/season/${year}/${round}`}
              className="flex min-w-[140px] flex-col gap-1 rounded-lg border border-[#2A3142] bg-[#0F1419] px-3 py-2.5 transition-colors hover:border-[#00D9FF]"
            >
              <span className="text-[10px] font-bold tabular-nums uppercase tracking-widest text-[#FFFFFF]">
                R{round}
              </span>
              <span className="truncate text-xs font-semibold text-[#FFFFFF]">{c.name}</span>
              <span className="truncate text-[10px] uppercase tracking-wide text-[#FFFFFF]">{c.location}</span>
            </Link>
          )
        })}

        {upcoming.map((round, i) => {
          const c = calendar2026[round - 1]
          const isNext = i === 0
          return (
            <div
              key={round}
              className={`flex min-w-[140px] flex-col gap-1 rounded-lg border px-3 py-2.5 ${
                isNext
                  ? 'border-[#00D9FF] bg-[#00D9FF]/10'
                  : 'border-[#2A3142] bg-[#1E2431]'
              }`}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold tabular-nums uppercase tracking-widest text-[#FFFFFF]">
                R{round}
                {isNext && (
                  <span className="inline-flex items-center gap-1 text-[#00D9FF]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#00D9FF]" />
                    NEXT
                  </span>
                )}
              </span>
              <span className="truncate text-xs font-semibold text-[#FFFFFF]">{c.name}</span>
              <span className="truncate text-[10px] uppercase tracking-wide text-[#FFFFFF]">{c.location}</span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
