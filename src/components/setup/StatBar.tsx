import { statColor } from './stat-utils'

export function StatBar({ label, value }: { label: string; value: number }) {
  const color = statColor(value)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#FFFFFF] w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[#2A3142] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-sm font-semibold w-8 text-right shrink-0" style={{ color }}>{value}</span>
    </div>
  )
}
