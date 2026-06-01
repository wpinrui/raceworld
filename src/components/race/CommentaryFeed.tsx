'use client'

import type { CommentaryEntry } from '@/lib/sim/types'

interface CommentaryFeedProps {
  entries: CommentaryEntry[]
}

export default function CommentaryFeed({ entries }: CommentaryFeedProps) {
  const reversed = [...entries].reverse()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 bg-[#DC143C]" />
        <h2 className="text-xs font-bold tracking-widest text-[#E8EAED] uppercase">
          Commentary
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {reversed.length === 0 ? (
          <p className="text-[#6B7280] text-xs italic">Awaiting race start...</p>
        ) : (
          reversed.map((entry, i) => (
            <div key={i} className="flex gap-2 text-xs leading-relaxed">
              <span className="text-[#00D9FF] font-mono font-bold shrink-0 w-12">
                LAP {entry.lap}
              </span>
              <span className="text-[#A0A9B8]">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
