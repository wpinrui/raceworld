import { statColor } from './stat-utils'

export function OverallRing({ overall }: { overall: number }) {
  const size = 44
  const cx = 22
  const cy = 22
  const r = 17
  const sw = 3
  const color = statColor(overall)
  const fraction = Math.min(overall / 100, 0.9999)
  const angle = 2 * Math.PI * fraction
  const sx = cx + r * Math.cos(-Math.PI / 2)
  const sy = cy + r * Math.sin(-Math.PI / 2)
  const ex = cx + r * Math.cos(-Math.PI / 2 + angle)
  const ey = cy + r * Math.sin(-Math.PI / 2 + angle)
  const large = fraction > 0.5 ? 1 : 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2A3142" strokeWidth={sw} />
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold" style={{ color }}>{overall}</span>
      </div>
    </div>
  )
}
