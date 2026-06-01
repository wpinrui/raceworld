import { statColor } from './stat-utils'

export function StatSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const color = statColor(value)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#FFFFFF] w-20 shrink-0">{label}</span>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 cursor-pointer"
        style={{ accentColor: color }}
      />
      <span className="text-sm font-semibold w-8 text-right shrink-0" style={{ color }}>{value}</span>
    </div>
  )
}
