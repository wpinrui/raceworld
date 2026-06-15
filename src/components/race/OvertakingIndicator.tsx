'use client'

import { ArrowLeftRight } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/settings-store'
import { overtakingRating, OVERTAKING_TIER_COLORS } from '@/lib/sim/overtaking-rating'
import { Tooltip } from '@/components/ui/Tooltip'

// How hard it is to overtake at this circuit. The tier (icon tint + label, plus a signal-bar meter in the
// full size) is always shown — it's the kind of thing a manager just knows. The precise pace-delta estimate
// is god-mode-only (Data Room talent), tucked in a hover tooltip so it never clutters the clean view.
export function OvertakingIndicator({ straightness, size = 'chip' }: { straightness: number | undefined; size?: 'chip' | 'full' }) {
  const dataRoom = useSettingsStore((s) => !!s.talents['data-room'])
  const r = overtakingRating(straightness)

  const body =
    size === 'full' ? (
      <span className="inline-flex items-center gap-2.5">
        <ArrowLeftRight size={15} style={{ color: r.color }} />
        <span className="inline-flex items-center gap-0.5">
          {OVERTAKING_TIER_COLORS.map((_, i) => (
            <span key={i} className="inline-block w-3.5 h-1.5 rounded-sm" style={{ backgroundColor: i <= r.tier ? r.color : '#3A4252' }} />
          ))}
        </span>
        <span className="text-sm font-semibold text-[#FFFFFF]">{r.label}</span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5">
        <ArrowLeftRight size={12} style={{ color: r.color }} />
        <span className="text-xs font-semibold text-[#FFFFFF]">{r.label}</span>
      </span>
    )

  if (!dataRoom) return body
  return (
    <Tooltip content={<span className="font-semibold">Estimated pace delta for overtake: {r.paceEdge.toFixed(1)}s</span>}>
      {body}
    </Tooltip>
  )
}
