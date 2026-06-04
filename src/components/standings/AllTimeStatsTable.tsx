'use client'

import { useMemo, useState } from 'react'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

// Generic all-time stats table: a name search box + click-to-sort on every column. The same component
// renders the drivers and constructors tables, driven by a column config. `num` columns sort
// numerically and format with thousands separators; `year` columns sort numerically but render raw.

export interface AllTimeColumn<T> {
  key: keyof T
  label: string
  type?: 'text' | 'num' | 'year' // default 'text'
}

function Arrow({ dir }: { dir: 'asc' | 'desc' }) {
  return <span className="text-[#00D9FF] ml-0.5">{dir === 'asc' ? '▲' : '▼'}</span>
}

export function AllTimeStatsTable<T extends { id: string; name: string }>({
  rows, columns, kind,
}: { rows: T[]; columns: AllTimeColumn<T>[]; kind: 'driver' | 'team' }) {
  const numericKeys = useMemo(
    () => new Set(columns.filter((c) => c.type === 'num' || c.type === 'year').map((c) => c.key)),
    [columns],
  )
  const defaultKey = (columns.find((c) => c.key === ('points' as keyof T)) ?? columns.find((c) => c.type === 'num') ?? columns[0]).key
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey)
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows
    const numeric = numericKeys.has(sortKey)
    return [...base].sort((a, b) => {
      const cmp = numeric
        ? Number(a[sortKey]) - Number(b[sortKey])
        : String(a[sortKey]).localeCompare(String(b[sortKey]))
      return dir === 'asc' ? cmp : -cmp
    })
  }, [rows, query, sortKey, dir, numericKeys])

  const onSort = (key: keyof T) => {
    if (key === sortKey) { setDir((d) => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setDir(numericKeys.has(key) ? 'desc' : 'asc') // numbers default high→low, text A→Z
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          className="w-full sm:w-72 px-3 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
        />
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="text-[#FFFFFF] text-xs uppercase tracking-wide border-b border-[#2A3142]">
              {columns.map((c, i) => (
                <th
                  key={String(c.key)}
                  onClick={() => onSort(c.key)}
                  className={`py-2 px-3 font-medium cursor-pointer select-none hover:text-[#00D9FF] ${c.type === 'num' || c.type === 'year' ? 'text-right' : 'text-left'} ${i === 0 ? 'sticky left-0 bg-[#1E2431]' : ''}`}
                >
                  {c.label}{sortKey === c.key && <Arrow dir={dir} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                {columns.map((c, i) => {
                  const v = r[c.key]
                  const isName = c.key === ('name' as keyof T)
                  return (
                    <td
                      key={String(c.key)}
                      className={`py-1.5 px-3 ${c.type === 'num' || c.type === 'year' ? 'text-right tabular-nums' : ''} ${i === 0 ? 'sticky left-0 bg-[#1E2431] font-medium' : 'text-[#FFFFFF]'}`}
                    >
                      {isName
                        ? (kind === 'driver'
                            ? <DriverLink id={r.id} className="text-[#FFFFFF]">{String(v)}</DriverLink>
                            : <TeamLink id={r.id} className="text-[#FFFFFF]">{String(v)}</TeamLink>)
                        : c.type === 'num'
                          ? Number(v).toLocaleString()
                          : String(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={columns.length} className="py-4 px-3 text-[#FFFFFF]">No results.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
