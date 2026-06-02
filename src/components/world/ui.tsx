'use client'

// Shared chrome for the world pages.

export function Panel({
  title, children, className = '', flush = false,
}: {
  title?: string
  children: React.ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <div className={`rounded-xl bg-[#1E2431] border border-[#2A3142] ${flush ? 'overflow-hidden' : 'p-5'} ${className}`}>
      {title && (
        <p className={`text-[10px] uppercase tracking-widest text-[#FFFFFF] ${flush ? 'px-5 py-3 border-b border-[#2A3142]' : 'mb-3'}`}>
          {title}
        </p>
      )}
      {children}
    </div>
  )
}

export function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg bg-[#0F1419] border border-[#2A3142] px-4 py-3 text-center">
      <p className="text-2xl font-bold tabular-nums text-[#FFFFFF]">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-[#FFFFFF] mt-0.5">{sub}</p>}
    </div>
  )
}

// Inactive vs active is conveyed by the cyan underline + weight, never by dimming
// the text — all readable labels stay pure white.
export function TabBar<T extends string>({
  tabs, active, onChange,
}: {
  tabs: { key: T; label: string }[]
  active: T
  onChange: (k: T) => void
}) {
  return (
    <div className="flex gap-1 border-b border-[#2A3142] overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap border-b-2 -mb-px transition-colors text-[#FFFFFF] ${
            active === t.key ? 'border-[#00D9FF]' : 'border-transparent hover:border-[#2A3142]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
