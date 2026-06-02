'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { generateNews, CATEGORY_LABELS, type NewsContext, type NewsArticle } from '@/lib/news/engine'

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
  useEffect(() => setHydrated(true), [])

  const articles = useMemo(() => {
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
      endOfSeason: s.endOfSeasonSummary,
      calendar: calendar2026,
    }
    return generateNews(ctx)
  }, [s.year, s.phase, s.raceResults, s.drivers, s.teams, s.driverStandings, s.constructorStandings, s.allUpgradeEvents, s.endOfSeasonSummary])

  // Distinct categories present, for the filter chips.
  const categories = useMemo(() => {
    const set = new Set(articles.map((a) => a.category))
    return [...set]
  }, [articles])

  const shown = filter ? articles.filter((a) => a.category === filter) : articles
  const effectiveId = selectedId && shown.some((a) => a.id === selectedId) ? selectedId : (shown[0]?.id ?? null)
  const selected: NewsArticle | null = shown.find((a) => a.id === effectiveId) ?? null

  if (!hydrated) return null

  return (
    <div className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        <h1 className="font-display text-2xl tracking-wider uppercase">Newsroom</h1>

        {articles.length === 0 ? (
          <Panel title="Newsroom">
            <p className="text-sm text-[#FFFFFF]">No news yet. Start a season and run a race, and the headlines will appear here.</p>
          </Panel>
        ) : (
          <>
            {/* Category filter */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilter(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${filter === null ? 'border-[#00D9FF] text-[#00D9FF]' : 'border-[#2A3142] text-[#FFFFFF] hover:border-[#303848]'}`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${filter === c ? 'border-[#00D9FF] text-[#00D9FF]' : 'border-[#2A3142] text-[#FFFFFF] hover:border-[#303848]'}`}
                >
                  {CATEGORY_LABELS[c] ?? c}
                </button>
              ))}
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
