'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { generateNews, CATEGORY_LABELS, NEWS_FILTERS, type NewsContext, type NewsArticle } from '@/lib/news/engine'
import { actionGetNewsSeasonYears, actionGetSeasonNews } from '@/lib/news/actions'

function roundLabel(round: number, calLen: number): string {
  if (round <= 0) return 'Pre-season'
  if (round > calLen) return 'Off-season'
  return `Round ${round}`
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#FFFFFF]">
      {text.split(/\n\n+/).map((p, i) => <p key={i}>{p.trim()}</p>)}
    </div>
  )
}

export default function NewsroomPage() {
  const s = useSeasonStore()
  const [hydrated, setHydrated] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState<number>(s.year)
  const [archivedYears, setArchivedYears] = useState<number[]>([])
  const [archivedArticles, setArchivedArticles] = useState<NewsArticle[]>([])
  const [loadingArchive, setLoadingArchive] = useState(false)
  useEffect(() => {
    setHydrated(true)
    // Deep link from the home headlines: /newsroom#<articleId> opens that exact story.
    if (typeof window !== 'undefined' && window.location.hash.length > 1) {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (id) { setSelectedId(id); setFilter(null) }
    }
  }, [])

  // Discover which past seasons have news to read.
  useEffect(() => {
    actionGetNewsSeasonYears().then(setArchivedYears).catch(() => setArchivedYears([]))
  }, [])

  const liveYear = s.year
  const isLive = selectedYear === liveYear

  // All selectable years, newest first; the live season always sits at the top.
  const years = useMemo(() => {
    const set = new Set<number>([liveYear, ...archivedYears])
    return [...set].sort((a, b) => b - a)
  }, [liveYear, archivedYears])

  // Live season: generated client-side from the store (full attributes available).
  const liveArticles = useMemo(() => {
    const ctx: NewsContext = {
      year: s.year,
      phase: s.phase,
      completedRounds: s.raceResults.length,
      drivers: s.drivers,
      teams: s.teams,
      raceResults: s.raceResults,
      driverStandings: s.driverStandings,
      constructorStandings: s.constructorStandings,
      upgradeEvents: s.allUpgradeEvents,
      constructorHistory: s.constructorHistory,
      endOfSeason: s.endOfSeasonSummary,
      calendar: calendar2026,
      live: true,
    }
    return generateNews(ctx)
  }, [s.year, s.phase, s.raceResults, s.drivers, s.teams, s.driverStandings, s.constructorStandings, s.allUpgradeEvents, s.constructorHistory, s.endOfSeasonSummary])

  // Past season: fetched from the archive DB on demand.
  useEffect(() => {
    if (isLive) return
    let cancelled = false
    setLoadingArchive(true)
    actionGetSeasonNews(selectedYear)
      .then((a) => { if (!cancelled) setArchivedArticles(a) })
      .catch(() => { if (!cancelled) setArchivedArticles([]) })
      .finally(() => { if (!cancelled) setLoadingArchive(false) })
    return () => { cancelled = true }
  }, [isLive, selectedYear])

  const articles = isLive ? liveArticles : archivedArticles

  // Which categories actually have an article in this season (drives which chips are enabled).
  const present = useMemo(() => new Set(articles.map((a) => a.category)), [articles])

  // `filter` holds a chip label (or null for All). Resolve it to the categories it covers.
  const activeGroup = filter ? NEWS_FILTERS.find((f) => f.label === filter) : null
  const shown = activeGroup ? articles.filter((a) => activeGroup.categories.includes(a.category)) : articles
  const effectiveId = selectedId && shown.some((a) => a.id === selectedId) ? selectedId : (shown[0]?.id ?? null)
  const selected: NewsArticle | null = shown.find((a) => a.id === effectiveId) ?? null

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl tracking-wider uppercase">Newsroom</h1>
          {years.length > 1 && (
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#FFFFFF]">
              Season
              <select
                value={selectedYear}
                onChange={(e) => { setSelectedYear(Number(e.target.value)); setFilter(null); setSelectedId(null) }}
                className="bg-[#0F1419] border border-[#2A3142] rounded px-2 py-1 text-sm font-semibold text-[#FFFFFF] focus:border-[#00D9FF] outline-none"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="bg-[#0F1419] text-[#FFFFFF]">
                    {y}{y === liveYear ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!isLive && loadingArchive ? (
          <Panel title="Newsroom">
            <p className="text-sm text-[#FFFFFF]">Loading the {selectedYear} archive…</p>
          </Panel>
        ) : articles.length === 0 ? (
          <Panel title="Newsroom">
            <p className="text-sm text-[#FFFFFF]">
              {isLive
                ? 'No news yet. Start a season and run a race, and the headlines will appear here.'
                : `No archived news for ${selectedYear}.`}
            </p>
          </Panel>
        ) : (
          <>
            {/* Category filter — full taxonomy always shown; empty categories are disabled. */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilter(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${filter === null ? 'border-[#00D9FF] text-[#00D9FF]' : 'border-[#2A3142] text-[#FFFFFF] hover:border-[#303848]'}`}
              >
                All
              </button>
              {NEWS_FILTERS.map((f) => {
                const enabled = f.categories.some((c) => present.has(c))
                const active = filter === f.label
                return (
                  <button
                    key={f.label}
                    onClick={() => enabled && setFilter(f.label)}
                    disabled={!enabled}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      active
                        ? 'border-[#00D9FF] text-[#00D9FF]'
                        : enabled
                          ? 'border-[#2A3142] text-[#FFFFFF] hover:border-[#303848]'
                          : 'border-[#1B2230] text-[#6B7280] cursor-not-allowed'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* Headlines list */}
              <Panel title="Headlines" flush className="lg:col-span-1">
                <div className="divide-y divide-[#2A3142] max-h-[70vh] overflow-y-auto">
                  {shown.map((a) => {
                    const active = a.id === effectiveId
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelectedId(a.id)}
                        className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-[#0F1419]' : 'hover:bg-[#0F1419]/50'}`}
                      >
                        <p className="text-sm font-semibold text-[#FFFFFF]">{a.headline}</p>
                        <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-1">
                          {CATEGORY_LABELS[a.category] ?? a.category} · {roundLabel(a.round, calendar2026.length)}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </Panel>

              {/* Reader */}
              <Panel title={selected ? `${CATEGORY_LABELS[selected.category] ?? selected.category} · ${roundLabel(selected.round, calendar2026.length)}` : 'Article'} className="lg:col-span-2">
                {selected ? (
                  <article className="space-y-3">
                    <h2 className="font-display text-xl tracking-wide text-[#FFFFFF]">{selected.headline}</h2>
                    <p className="text-sm italic text-[#FFFFFF]">{selected.dek}</p>
                    <Paragraphs text={selected.body} />
                  </article>
                ) : (
                  <p className="text-sm text-[#FFFFFF]">Select a headline to read it.</p>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
