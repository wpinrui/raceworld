'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'
import { useSeasonStore } from '@/lib/store/season-store'
import { actionGetSearchIndex } from '@/lib/db/actions'
import type { SearchEntry } from '@/lib/world/types'

interface Entry extends SearchEntry { nationality?: string; color?: string }

export default function WorldSearch() {
  const router = useRouter()
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const [historical, setHistorical] = useState<SearchEntry[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { actionGetSearchIndex().then(setHistorical).catch(() => {}) }, [])

  // Current grid ∪ historical entities, deduped by kind+id.
  const index = useMemo<Entry[]>(() => {
    const map = new Map<string, Entry>()
    for (const e of historical) map.set(`${e.kind}:${e.id}`, { ...e })
    for (const d of drivers) map.set(`driver:${d.id}`, { id: d.id, name: d.name, kind: 'driver', nationality: d.nationality })
    for (const t of teams) map.set(`team:${t.id}`, { id: t.id, name: t.name, kind: 'team', color: t.color })
    return [...map.values()]
  }, [historical, drivers, teams])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return index.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query, index])

  function go(e: Entry) {
    setQuery('')
    setOpen(false)
    router.push(`/world/${e.kind}/${e.id}`)
  }

  return (
    <div ref={boxRef} className="relative w-full" onBlur={(ev) => { if (!boxRef.current?.contains(ev.relatedTarget as Node)) setOpen(false) }}>
      <div className="flex items-center gap-2 px-2.5 h-7 rounded-md bg-[#2A3142] border border-[#303848] focus-within:border-[#00D9FF]">
        <Search size={13} className="text-[#FFFFFF] shrink-0" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0]); if (e.key === 'Escape') setOpen(false) }}
          placeholder="Search drivers, teams…"
          className="flex-1 min-w-0 bg-transparent text-xs text-[#FFFFFF] placeholder:text-[#6B7280] outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-9 z-50 rounded-lg bg-[#1E2431] border border-[#2A3142] shadow-xl overflow-hidden py-1">
          {results.map((e) => (
            <button
              key={`${e.kind}:${e.id}`}
              onClick={() => go(e)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm text-[#FFFFFF] hover:bg-[#2A3142]"
            >
              {e.kind === 'driver'
                ? <ReactCountryFlag countryCode={e.nationality || 'GB'} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px' }} />
                : <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: e.color ?? '#6B7280' }} />}
              <span className="truncate">{e.name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-[#FFFFFF]">{e.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
