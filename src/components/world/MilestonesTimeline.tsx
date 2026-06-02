'use client'

import type { MilestoneEvent, MilestoneKind } from '@/lib/world/milestones'

const KIND_COLOR: Record<MilestoneKind, string> = {
  title: '#FFD24A',
  win: '#00D9FF',
  podium: '#FF8000',
  start: '#7C8698',
  points: '#27F4D2',
  season: '#A855F7',
}

export function MilestonesTimeline({ events }: { events: MilestoneEvent[] }) {
  if (events.length === 0) {
    return <p className="px-5 py-4 text-sm text-[#FFFFFF]">No milestones yet — they unlock as the career unfolds.</p>
  }
  return (
    <ol className="px-5 py-4 space-y-0">
      {events.map((e, i) => (
        <li key={`${e.id}-${i}`} className="flex gap-3 items-stretch">
          <div className="flex flex-col items-center">
            <span className="w-3 h-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: KIND_COLOR[e.kind] }} />
            {i < events.length - 1 && <span className="w-px flex-1 bg-[#2A3142] my-1" />}
          </div>
          <div className="pb-3 min-w-0">
            <p className="text-sm font-semibold text-[#FFFFFF]">{e.label}</p>
            <p className="text-xs text-[#FFFFFF] tabular-nums">
              {e.year}{e.round != null ? ` · Round ${e.round}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
