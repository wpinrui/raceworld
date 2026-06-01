'use client'

import { Wrench, ChevronsUp, ChevronRight, CloudRain, CircleX, Flag, Info } from 'lucide-react'
import type { CommentaryEntry } from '@/lib/sim/types'

interface CommentaryFeedProps {
  entries: CommentaryEntry[]
}

const TYPE_CONFIG = {
  pit:        { icon: Wrench,       color: 'text-[#FFFFFF]', bg: 'bg-[#1E2431]',  border: 'border-[#2A3142]' },
  overtake:   { icon: ChevronsUp,   color: 'text-[#00D9FF]', bg: 'bg-[#0d2230]',  border: 'border-[#00D9FF]/30' },
  closing:    { icon: ChevronRight,  color: 'text-[#FCD34D]', bg: 'bg-[#1E2431]',  border: 'border-[#FCD34D]/30' },
  weather:    { icon: CloudRain,     color: 'text-[#60a5fa]', bg: 'bg-[#0d1a2e]',  border: 'border-[#60a5fa]/30' },
  retirement: { icon: CircleX,       color: 'text-[#DC143C]', bg: 'bg-[#2a0d12]',  border: 'border-[#DC143C]/40' },
  finish:     { icon: Flag,          color: 'text-[#D4AC00]', bg: 'bg-[#1e1a00]',  border: 'border-[#D4AC00]/40' },
  info:       { icon: Info,          color: 'text-[#FFFFFF]', bg: 'bg-[#1E2431]',  border: 'border-[#2A3142]' },
} as const

export default function CommentaryFeed({ entries }: CommentaryFeedProps) {
  const reversed = [...entries].reverse()

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2.5 mb-3 shrink-0">
        <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
        <h2 className="font-semibold text-base tracking-widest text-[#E8EAED] uppercase">
          Commentary
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-1">
        {reversed.length === 0 ? (
          <p className="text-[#FFFFFF] text-base italic">Awaiting race start...</p>
        ) : (
          reversed.map((entry, i) => {
            const cfg = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.info
            const Icon = cfg.icon
            return (
              <div
                key={`${entry.lap}-${entry.type}-${i}`}
                className={`flex items-start gap-3 px-3 py-2 rounded border ${cfg.bg} ${cfg.border}`}
              >
                <Icon size={15} className={`${cfg.color} mt-0.5 shrink-0`} />
                <span className="text-[#FFFFFF] text-xs text-[#FFFFFF] shrink-0 w-10 pt-px">
                  L{entry.lap}
                </span>
                <span className={`text-sm leading-snug ${cfg.color}`}>{entry.text}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
