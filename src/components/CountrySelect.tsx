'use client'

import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import { COUNTRIES, countryName } from '@/data/countries'

export function CountrySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s
      ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(s) || c.code.toLowerCase() === s)
      : COUNTRIES
    return list.slice(0, 80)
  }, [q])

  return (
    <div ref={boxRef} className="relative" onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQ('') }}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
      >
        <ReactCountryFlag countryCode={value || 'GB'} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
        <span className="truncate flex-1 text-left">{countryName(value) || value || '—'}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg bg-[#1E2431] border border-[#2A3142] shadow-xl">
          <div className="flex items-center gap-2 px-2.5 h-8 border-b border-[#2A3142]">
            <Search size={13} className="text-[#FFFFFF] shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search country…"
              className="flex-1 min-w-0 bg-transparent text-xs text-[#FFFFFF] placeholder:text-[#6B7280] outline-none"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[#FFFFFF]">No match</p>
            ) : (
              results.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { onChange(c.code); setOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm text-[#FFFFFF] hover:bg-[#2A3142]"
                >
                  <ReactCountryFlag countryCode={c.code} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
                  <span className="truncate">{c.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
