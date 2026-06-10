import { ordinal } from '@/lib/news/util'

// Championship-RANK pill colours: winner / runner-up / 3rd / top-10 / outside =
// gold / grey / burnt-orange / green / blue. The green tier here is a fixed top-10 rank band
// (a championship-standing position), distinct from ResultChip's era-aware race points-finish green.
export function positionPalette(position: number): { bg: string; fg: string } {
  if (position === 1) return { bg: '#D4AC00', fg: '#0F1419' }
  if (position === 2) return { bg: '#9E9E9E', fg: '#0F1419' }
  if (position === 3) return { bg: '#C0622B', fg: '#FFFFFF' }
  if (position <= 10) return { bg: '#1A4A2E', fg: '#6EE7A0' }
  return { bg: '#1A4A66', fg: '#A8DEFF' }
}

// Championship-finish pill for the world result displays (the "Champ" column).
export function ChampPill({ position }: { position: number | null | undefined }) {
  if (position == null) {
    return <span className="text-[#6B7280]">—</span>
  }
  const { bg, fg } = positionPalette(position)
  return (
    <span
      className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-0.5 rounded text-[11px] font-bold tabular-nums"
      style={{ backgroundColor: bg, color: fg }}
    >
      P{position}
    </span>
  )
}

// Text colour for a championship rank shown as plain ordinal: podiums are tinted
// gold / silver / burnt-orange, everything else white. Tints are brightened from the
// ChampPill backgrounds so they clear AA contrast as text on the dark panel (#1E2431):
// 1st 9.5:1, 2nd ~10:1, 3rd 5.7:1.
export function champRankColor(position: number): string {
  if (position === 1) return '#F5C518'
  if (position === 2) return '#C5CAD3'
  if (position === 3) return '#E8833A'
  return '#FFFFFF'
}

// Championship finish as plain ordinal text (1st, 2nd, ... 17th), podium ranks tinted.
export function ChampRank({ position }: { position: number | null | undefined }) {
  if (position == null) {
    return <span className="text-[#6B7280]">—</span>
  }
  return (
    <span className="tabular-nums font-semibold" style={{ color: champRankColor(position) }}>
      {ordinal(position)}
    </span>
  )
}
