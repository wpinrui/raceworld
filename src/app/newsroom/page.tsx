'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, RefreshCw, Lock } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import {
  actionNewsroomAvailable, actionListRaceReviews, actionGetOrGenerateRaceReview,
  actionRegenerateRaceReview, actionSearchNewsroom,
} from '@/lib/ai/actions'
import type { RaceReview } from '@/lib/ai/types'

function circuitName(round: number): string {
  return calendar2026[round - 1]?.name ?? `Round ${round}`
}

function sortReviews(list: RaceReview[]): RaceReview[] {
  return [...list].sort((a, b) => (b.year - a.year) || (b.round - a.round))
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#FFFFFF]">
      {text.split(/\n\n+/).map((p, i) => <p key={i}>{p.trim()}</p>)}
    </div>
  )
}

export default function NewsroomPage() {
  const year = useSeasonStore((s) => s.year)
  const raceResults = useSeasonStore((s) => s.raceResults)

  const [hydrated, setHydrated] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [reviews, setReviews] = useState<RaceReview[]>([])
  const [pending, setPending] = useState<number[]>([]) // current-season rounds generating
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchAnswer, setSearchAnswer] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const ranRef = useRef(false)
  useEffect(() => setHydrated(true), [])

  // Check availability once hydrated.
  useEffect(() => {
    if (!hydrated) return
    let on = true
    actionNewsroomAvailable().then((ok) => { if (on) setAvailable(ok) })
    return () => { on = false }
  }, [hydrated])

  // Load stored reviews, then lazily generate any missing race reviews (newest first).
  useEffect(() => {
    if (!hydrated || available !== true || ranRef.current) return
    ranRef.current = true
    let cancelled = false
    const completed = raceResults.length
    ;(async () => {
      const stored = sortReviews(await actionListRaceReviews())
      if (cancelled) return
      setReviews(stored)
      const have = new Set(stored.filter((r) => r.year === year).map((r) => r.round))
      for (let round = completed; round >= 1; round--) {
        if (cancelled) return
        if (have.has(round)) continue
        setPending((p) => [...p, round])
        const res = await actionGetOrGenerateRaceReview(year, round)
        if (cancelled) return
        setPending((p) => p.filter((r) => r !== round))
        if (res.ok) {
          const data = res.data
          setReviews((prev) => sortReviews([data, ...prev.filter((r) => !(r.year === data.year && r.round === data.round))]))
        } else if (res.error === 'NO_API_KEY') {
          setAvailable(false)
          return
        } else {
          setGenError(res.message ?? 'The newsroom could not generate that report.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [hydrated, available, year, raceResults.length])

  // Default to the newest review when nothing is explicitly selected (derived, no effect).
  const effectiveKey = selectedKey ?? (reviews[0] ? `${reviews[0].year}-${reviews[0].round}` : null)
  const selected = reviews.find((r) => `${r.year}-${r.round}` === effectiveKey) ?? null

  async function handleRegenerate() {
    if (!selected || regenerating) return
    setRegenerating(true)
    setGenError(null)
    const res = await actionRegenerateRaceReview(selected.year, selected.round)
    setRegenerating(false)
    if (res.ok) {
      const data = res.data
      setReviews((prev) => sortReviews([data, ...prev.filter((r) => !(r.year === data.year && r.round === data.round))]))
    } else if (res.error === 'NO_API_KEY') {
      setAvailable(false)
    } else {
      setGenError(res.message ?? 'Could not regenerate this report.')
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (searching || !query.trim()) return
    setSearching(true)
    setSearchAnswer(null)
    setSearchError(null)
    const res = await actionSearchNewsroom(query)
    setSearching(false)
    if (res.ok) setSearchAnswer(res.data.answer)
    else if (res.error === 'NO_API_KEY') setAvailable(false)
    else setSearchError(res.message ?? 'The desk could not answer that.')
  }

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        <h1 className="font-display text-2xl tracking-wider uppercase">Newsroom</h1>

        {available === false && (
          <Panel title="Newsroom unavailable">
            <p className="flex items-center gap-2 text-sm text-[#FFFFFF]">
              <Lock size={14} className="text-[#6B7280]" />
              Set <code className="px-1 rounded bg-[#0F1419] border border-[#2A3142]">ANTHROPIC_API_KEY</code> in <code className="px-1 rounded bg-[#0F1419] border border-[#2A3142]">.env.local</code> and restart the dev server to enable AI-generated reports and search.
            </p>
          </Panel>
        )}

        {available && (
          <>
            {/* Search */}
            <Panel title="Search the newsroom">
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the newsroom"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none"
                />
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 transition-colors"
                >
                  <Search size={13} />
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>
              {searching && <p className="mt-3 text-sm text-[#FFFFFF] animate-pulse">The desk is on it…</p>}
              {searchError && <p className="mt-3 text-sm text-[#DC143C]">{searchError}</p>}
              {searchAnswer && <div className="mt-3"><Paragraphs text={searchAnswer} /></div>}
            </Panel>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* Headlines list */}
              <Panel title="Headlines" flush className="lg:col-span-1">
                <div className="divide-y divide-[#2A3142]">
                  {pending.map((round) => (
                    <div key={`pending-${round}`} className="px-4 py-3">
                      <p className="text-sm text-[#FFFFFF] animate-pulse">Generating {year} {circuitName(round)} review…</p>
                    </div>
                  ))}
                  {reviews.map((r) => {
                    const key = `${r.year}-${r.round}`
                    const active = key === effectiveKey
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedKey(key)}
                        className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-[#0F1419]' : 'hover:bg-[#0F1419]/50'}`}
                      >
                        <p className="text-sm font-semibold text-[#FFFFFF]">{r.headline}</p>
                        <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-1">{r.year} · {circuitName(r.round)}</p>
                      </button>
                    )
                  })}
                  {reviews.length === 0 && pending.length === 0 && (
                    <p className="px-4 py-4 text-sm text-[#FFFFFF]">No race reviews yet. They appear once a race has been run.</p>
                  )}
                </div>
              </Panel>

              {/* Reader */}
              <Panel title={selected ? `${selected.year} · ${circuitName(selected.round)}` : 'Article'} className="lg:col-span-2">
                {genError && <p className="mb-3 text-sm text-[#DC143C]">{genError}</p>}
                {selected ? (
                  <article className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-display text-xl tracking-wide text-[#FFFFFF]">{selected.headline}</h2>
                      <button
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        title="Regenerate this report"
                        className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#2A3142] text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 transition-colors"
                      >
                        <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
                        {regenerating ? 'Working…' : 'Regenerate'}
                      </button>
                    </div>
                    {selected.dek && <p className="text-sm italic text-[#FFFFFF]">{selected.dek}</p>}
                    <Paragraphs text={selected.body} />
                  </article>
                ) : (
                  <p className="text-sm text-[#FFFFFF]">{pending.length > 0 ? 'Generating the latest reports…' : 'Select a headline to read the report.'}</p>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
