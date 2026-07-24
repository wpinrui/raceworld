import type { TyreCompound } from '@/lib/sim/types'

const LETTER: Record<TyreCompound, string> = {
  soft: 'S', medium: 'M', hard: 'H', intermediate: 'I', wet: 'W',
}

export const COMPOUND_COLORS: Record<TyreCompound, string> = {
  soft: '#FF4444', medium: '#FFD700', hard: '#FFFFFF',
  intermediate: '#39B54A', wet: '#0067FF',
}

interface TyreIndicatorProps {
  compound: TyreCompound
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: { circle: 'w-5 h-5 text-[11px]', font: 'font-black' },
  md: { circle: 'w-6 h-6 text-[13px]', font: 'font-black' },
  lg: { circle: 'w-8 h-8 text-[16px]', font: 'font-black' },
}

export default function TyreIndicator({ compound, size = 'sm' }: TyreIndicatorProps) {
  const s = SIZES[size]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-black shrink-0 ${s.circle} ${s.font}`}
      style={{ color: COMPOUND_COLORS[compound] }}
    >
      {LETTER[compound]}
    </span>
  )
}
