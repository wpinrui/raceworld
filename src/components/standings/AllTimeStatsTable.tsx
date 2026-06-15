'use client'

import { useMemo, useState } from 'react'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { Tooltip } from '@/components/ui/Tooltip'
import { teamHighlightStyle, teamHighlightSolid } from '@/lib/team-manager'

// Generic all-time stats table: a leftmost rank (#) column reflecting the current sort, a name search
// box, and click-to-sort on every column. Each numeric cell carries a tooltip with that entity's
// all-time rank in that category ("3rd all-time in most podiums in a career"). The same component
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

// Keep acronyms (WDC, WCC, DNFs) as-is; lowercase ordinary words for the tooltip sentence.
function prettyLabel(label: string): string {
  return /^[A-Z]{2,}s?$/.test(label) ? label : label.toLowerCase()
}

export function AllTimeStatsTable<T extends { id: string; name: string }>({
  rows, columns, kind, flagOf, highlightId, highlightColor,
}: { rows: T[]; columns: AllTimeColumn<T>[]; kind: 'driver' | 'team'; flagOf?: (id: string) => string; highlightId?: string | null; highlightColor?: string }) {
  const numericKeys = useMemo(
    () => new Set(columns.filter((c) => c.type === 'num' || c.type === 'year').map((c) => c.key)),
    [columns],
  )
  const defaultKey = (columns.find((c) => c.key === ('points' as keyof T)) ?? columns.find((c) => c.type === 'num') ?? columns[0]).key
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey)
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  // Per-numeric-column value lists (descending), so a cell's all-time rank is a cheap lookup:
  // competition rank = 1 + (count of strictly greater values).
  const rankCols = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const c of columns) {
      if (c.type === 'num') m.set(String(c.key), rows.map((r) => Number(r[c.key])).sort((a, b) => b - a))
    }
    return m
  }, [rows, columns])
  const rankIn = (key: string, value: number): number | null => {
    const arr = rankCols.get(key)
    if (!arr || arr.length === 0) return null
    const i = arr.findIndex((x) => x <= value)
    return (i < 0 ? arr.length : i) + 1
  }
  const noun = kind === 'driver' ? 'in a career' : 'by a constructor'

  // Sort the full set first (so the # column shows the true ranking position), then filter by name —
  // a search keeps each row's real rank rather than renumbering the filtered subset.
  const view = useMemo(() => {
    const numeric = numericKeys.has(sortKey)
    const sorted = [...rows].sort((a, b) => {
      const cmp = numeric
        ? Number(a[sortKey]) - Number(b[sortKey])
        : String(a[sortKey]).localeCompare(String(b[sortKey]))
      return dir === 'asc' ? cmp : -cmp
    })
    const ranked = sorted.map((row, i) => ({ row, pos: i + 1 }))
    const q = query.trim().toLowerCase()
    return q ? ranked.filter(({ row }) => row.name.toLowerCase().includes(q)) : ranked
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
              <th className="py-2 px-3 font-medium select-none text-right sticky top-0 left-0 z-30 bg-[#1E2431] w-14">#</th>
              {columns.map((c, i) => (
                <th
                  key={String(c.key)}
                  onClick={() => onSort(c.key)}
                  className={`py-2 px-3 font-medium cursor-pointer select-none hover:text-[#00D9FF] sticky top-0 bg-[#1E2431] ${c.type === 'num' || c.type === 'year' ? 'text-right' : 'text-left'} ${i === 0 ? 'left-14 z-30' : 'z-20'}`}
                >
                  {c.label}{sortKey === c.key && <Arrow dir={dir} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map(({ row, pos }) => {
              // Mark the player's own row ("this is you"): driver mode highlights your driver, Team Manager
              // your constructor — gated by the parent, which passes the matching id + your team colour. The
              // sticky #/name cells need a SOLID tint (they'd otherwise paint over the row's translucent one).
              const isHl = !!highlightColor && highlightId != null && row.id === highlightId
              const hl = isHl ? teamHighlightStyle(highlightColor) : undefined
              const solid = isHl ? teamHighlightSolid(highlightColor) : undefined
              return (
              <tr key={row.id} style={hl} className="border-b border-[#2A3142]/50 hover:bg-[#0F1419]/40">
                <td className={`py-1.5 px-3 text-right tabular-nums sticky left-0 z-10 text-[#FFFFFF] ${solid ? '' : 'bg-[#1E2431]'}`} style={solid ? { backgroundColor: solid, boxShadow: `inset 3px 0 0 ${highlightColor}` } : undefined}>{pos}</td>
                {columns.map((c, i) => {
                  const v = row[c.key]
                  const isName = c.key === ('name' as keyof T)
                  const isNum = c.type === 'num'
                  const rank = isNum ? rankIn(String(c.key), Number(v)) : null
                  return (
                    <td
                      key={String(c.key)}
                      className={`py-1.5 px-3 ${c.type === 'num' || c.type === 'year' ? 'text-right tabular-nums' : ''} ${i === 0 ? `sticky left-14 z-10 font-medium ${solid ? '' : 'bg-[#1E2431]'}` : 'text-[#FFFFFF]'}`}
                      style={i === 0 && solid ? { backgroundColor: solid } : undefined}
                    >
                      {isName ? (
                        <span className="flex items-center gap-2">
                          <NationalityFlag code={flagOf?.(row.id)} />
                          {kind === 'driver'
                            ? <DriverLink id={row.id} className="text-[#FFFFFF]">{String(v)}</DriverLink>
                            : <TeamLink id={row.id} className="text-[#FFFFFF]">{String(v)}</TeamLink>}
                        </span>
                      ) : isNum ? (
                        rank != null ? (
                          <Tooltip content={`${ordinal(rank)} all-time in most ${prettyLabel(c.label)} ${noun}`}>
                            <span className="cursor-help">{Number(v).toLocaleString()}</span>
                          </Tooltip>
                        ) : Number(v).toLocaleString()
                      ) : (
                        String(v)
                      )}
                    </td>
                  )
                })}
              </tr>
            )})}
            {view.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="py-4 px-3 text-[#FFFFFF]">No results.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
