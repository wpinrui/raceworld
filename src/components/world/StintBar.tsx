import type { TyreCompound } from '@/lib/sim/types'
import { Tooltip } from '@/components/ui/Tooltip'

const COMPOUND: Record<TyreCompound, { bg: string; fg: string; letter: string }> = {
  soft: { bg: '#E1342B', fg: '#FFFFFF', letter: 'S' },
  medium: { bg: '#E2C53D', fg: '#0F1419', letter: 'M' },
  hard: { bg: '#E8E8E8', fg: '#0F1419', letter: 'H' },
  intermediate: { bg: '#43B02A', fg: '#FFFFFF', letter: 'I' },
  wet: { bg: '#1E5FBF', fg: '#FFFFFF', letter: 'W' },
}

// Tyre stints as proportional segments, each labelled with compound + lap count.
export function StintBar({ stints }: { stints: { compound: TyreCompound; laps: number }[] }) {
  if (!stints || stints.length === 0) return <span className="text-[#6B7280]">—</span>
  const total = stints.reduce((s, x) => s + x.laps, 0) || 1
  return (
    <span className="inline-flex h-5 w-full min-w-[7rem] max-w-[16rem] rounded overflow-hidden align-middle">
      {stints.map((s, i) => {
        const c = COMPOUND[s.compound] ?? { bg: '#6B7280', fg: '#FFFFFF', letter: '?' }
        return (
          <Tooltip key={i} content={`${s.compound} · ${s.laps} laps`}>
            <span
              className="flex items-center justify-center text-[10px] font-bold tabular-nums"
              style={{ backgroundColor: c.bg, color: c.fg, width: `${(s.laps / total) * 100}%` }}
            >
              {c.letter}
              <span className="ml-0.5 opacity-80">{s.laps}</span>
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}
