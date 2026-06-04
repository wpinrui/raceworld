'use client'

// Searchable driver/team picker for the newsroom's "filter by entity" control. When a value is set
// it renders a removable chip; otherwise a small combobox (type a name, pick from the list). Drivers
// and teams only (no circuits). The list is the roster for the current scope (season or all-seasons).

import { useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

export interface EntityValue { kind: 'driver' | 'team'; id: string; name: string }

export default function EntityFilter({
  drivers,
  teams,
  value,
  onChange,
}: {
  drivers: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  value: EntityValue | null
  onChange: (v: EntityValue | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const options = useMemo<EntityValue[]>(() => {
    const seen = new Set<string>()
    const out: EntityValue[] = []
    for (const d of drivers) if (d.id && d.name && !seen.has(`driver:${d.id}`)) { seen.add(`driver:${d.id}`); out.push({ kind: 'driver', id: d.id, name: d.name }) }
    for (const t of teams) if (t.id && t.name && !seen.has(`team:${t.id}`)) { seen.add(`team:${t.id}`); out.push({ kind: 'team', id: t.id, name: t.name }) }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [drivers, teams])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return options.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query, options])

  if (value) {
    return (
      <button
        onClick={() => onChange(null)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-[#00D9FF] text-[#00D9FF] transition-colors hover:bg-[#00D9FF]/10"
      >
        {value.name}
        <X size={12} />
      </button>
    )
  }

  return (
    <div ref={boxRef} className="relative" onBlur={(ev) => { if (!boxRef.current?.contains(ev.relatedTarget as Node)) setOpen(false) }}>
      <div className="flex items-center gap-2 px-2.5 h-7 w-52 rounded-full bg-[#0F1419] border border-[#2A3142] focus-within:border-[#00D9FF]">
        <Search size={13} className="text-[#FFFFFF] shrink-0" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { onChange(results[0]); setQuery('') } if (e.key === 'Escape') setOpen(false) }}
          placeholder="Filter by driver/team…"
          className="flex-1 min-w-0 bg-transparent text-xs text-[#FFFFFF] placeholder:text-[#6B7280] outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 top-9 z-50 w-52 rounded-lg bg-[#1E2431] border border-[#2A3142] shadow-xl overflow-hidden py-1">
          {results.map((e) => (
            <button
              key={`${e.kind}:${e.id}`}
              onClick={() => { onChange(e); setQuery(''); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[#FFFFFF] hover:bg-[#2A3142]"
            >
              <span className="truncate">{e.name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-[#6B7280]">{e.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
