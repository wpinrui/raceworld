'use client'

import type { Feat } from '@/lib/stats/types'
import { Panel } from '@/components/world/ui'

// Per-category accent so an all-time record reads differently from a volume club.
const CATEGORY_COLOR: Record<string, string> = {
  title: '#FCD34D',        // gold
  record: '#A855F7',       // purple — records
  season: '#00D9FF',
  streak: '#10B981',
  milestone: '#FFFFFF',
  constructor: '#00D9FF',
  race: '#FFFFFF',
  championship: '#FCD34D',
  teammate: '#10B981',
}

function FeatRow({ feat }: { feat: Feat }) {
  const accent = feat.allTime ? '#A855F7' : (CATEGORY_COLOR[feat.category] ?? '#FFFFFF')
  return (
    <div className="flex items-start gap-3 rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-2.5">
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#FFFFFF]">
          {feat.title}
          {feat.allTime && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#A855F7]">Record</span>}
        </p>
        {feat.detail && <p className="text-xs text-[#FFFFFF] mt-0.5">{feat.detail}</p>}
      </div>
    </div>
  )
}

export function HonoursPanel({ feats, loading, className = '', columns = 2, fill = false }: { feats: Feat[]; loading: boolean; className?: string; columns?: 1 | 2; fill?: boolean }) {
  if (loading) return null
  // When empty: in dashboard (fill) mode keep the grid cell filled with an empty-state;
  // elsewhere collapse to nothing as before.
  if (feats.length === 0) {
    if (!fill) return null
    return (
      <Panel title="Feats & Records" className={className} fill>
        <p className="text-sm text-[#FFFFFF]">No feats or records yet — they unlock as the career builds.</p>
      </Panel>
    )
  }
  return (
    <Panel title="Feats & Records" className={className} fill={fill}>
      <div className={`grid gap-2.5 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
        {feats.map((f) => <FeatRow key={f.id} feat={f} />)}
      </div>
    </Panel>
  )
}
