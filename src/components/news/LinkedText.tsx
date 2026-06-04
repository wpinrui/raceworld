'use client'

// Render-time hyperlinking for news prose. The news engine emits plain text; here we recognise the
// driver / team / circuit names it used (all drawn from a fixed roster) and wrap them in links to
// the matching world page. Matching is longest-first and word-boundary-safe, and any name that is
// ambiguous (e.g. a last name shared by two drivers, or a string that maps to two different
// entities) is left as plain text so we never produce a wrong link.

import React from 'react'
import { DriverLink, TeamLink, CircuitLink } from '@/components/world/EntityLink'
import { lastName } from '@/lib/news/util'
import { useFollowed } from '@/lib/store/useFollowed'

// A followed driver/team's name is accented + dotted-underlined wherever it appears in a story.
const FOLLOW_HL = 'text-[#00D9FF] underline decoration-dotted decoration-[#00D9FF]/60 underline-offset-2'

type LinkTarget =
  | { kind: 'driver'; id: string }
  | { kind: 'team'; id: string }
  | { kind: 'circuit'; round: number }

export interface NewsIndex {
  year: number
  regex: RegExp | null
  lookup: Map<string, LinkTarget>
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameTarget(a: LinkTarget, b: LinkTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'circuit' && b.kind === 'circuit') return a.round === b.round
  return (a as { id?: string }).id === (b as { id?: string }).id
}

// Build the matcher for a season. `circuits` should already be limited to rounds that have actually
// run (so a future / preview circuit does not link to a race page that has nothing to show yet).
export function buildNewsIndex(opts: {
  drivers: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  circuits: { name: string; round: number }[]
  year: number
}): NewsIndex {
  // null marks an ambiguous variant (seen pointing at two different entities) — excluded from links.
  const map = new Map<string, LinkTarget | null>()
  const add = (variant: string, target: LinkTarget) => {
    const v = variant.trim()
    if (!v) return
    if (map.has(v)) {
      const existing = map.get(v)
      if (!existing || !sameTarget(existing, target)) map.set(v, null)
    } else {
      map.set(v, target)
    }
  }

  for (const d of opts.drivers) {
    if (!d.id || !d.name) continue
    add(d.name, { kind: 'driver', id: d.id })
    add(lastName(d.name), { kind: 'driver', id: d.id })
  }
  for (const t of opts.teams) {
    if (!t.id || !t.name) continue
    add(t.name, { kind: 'team', id: t.id })
  }
  for (const c of opts.circuits) {
    if (!c.name || !c.round) continue
    // Match both the prose form ("British Grand Prix") and the raw calendar form ("British GP").
    add(c.name, { kind: 'circuit', round: c.round })
    add(c.name.replace(/\bGrand Prix\b/, 'GP'), { kind: 'circuit', round: c.round })
  }

  const lookup = new Map<string, LinkTarget>()
  for (const [k, v] of map) if (v) lookup.set(k, v)
  // Longest variants first so "George Russell" / "Racing Bulls" win over "Russell" / "Bulls".
  const variants = [...lookup.keys()].sort((a, b) => b.length - a.length)
  const regex = variants.length ? new RegExp(`\\b(${variants.map(escapeRegExp).join('|')})\\b`, 'g') : null
  return { year: opts.year, regex, lookup }
}

// Render a single run of text, linking recognised names. Falls back to plain text when no index.
export function LinkedText({ text, index }: { text: string; index: NewsIndex | null }): React.ReactElement {
  const followed = useFollowed()
  if (!index || !index.regex || !text) return <>{text}</>
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(index.regex)) {
    const start = m.index ?? 0
    const matched = m[0]
    if (start > last) out.push(text.slice(last, start))
    const t = index.lookup.get(matched)
    if (t?.kind === 'driver') out.push(<DriverLink key={start} id={t.id} className={followed.drivers.has(t.id) ? FOLLOW_HL : ''}>{matched}</DriverLink>)
    else if (t?.kind === 'team') out.push(<TeamLink key={start} id={t.id} className={followed.teams.has(t.id) ? FOLLOW_HL : ''}>{matched}</TeamLink>)
    else if (t?.kind === 'circuit') out.push(<CircuitLink key={start} year={index.year} round={t.round}>{matched}</CircuitLink>)
    else out.push(matched)
    last = start + matched.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

// A body block: blank-line-separated paragraphs, each with names linked. Mirrors the markup the
// newsroom and home modal previously used for plain bodies.
export function LinkedParagraphs({ text, index }: { text: string; index: NewsIndex | null }): React.ReactElement {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#FFFFFF]">
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i}><LinkedText text={p.trim()} index={index} /></p>
      ))}
    </div>
  )
}
