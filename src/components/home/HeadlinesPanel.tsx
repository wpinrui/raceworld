'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { generateNews, CATEGORY_LABELS, type NewsContext, type NewsArticle } from '@/lib/news/engine'

function roundLabel(round: number, calLen: number): string {
  if (round <= 0) return 'Pre-season'
  if (round > calLen) return 'Off-season'
  return `Round ${round}`
}

// Modal reader for a single headline. Shows the full article and links through to the
// newsroom (deep-linked via the URL hash, so the news tab opens on this exact story).
function ArticleModal({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1E2431] border border-[#2A3142] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[#2A3142]">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">
            {CATEGORY_LABELS[article.category] ?? article.category} · {roundLabel(article.round, calendar2026.length)}
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[#FFFFFF] hover:text-[#00D9FF] transition-colors text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-3">
          <h2 className="font-display text-xl tracking-wide text-[#FFFFFF]">{article.headline}</h2>
          <p className="text-sm italic text-[#FFFFFF]">{article.dek}</p>
          <div className="space-y-3 text-sm leading-relaxed text-[#FFFFFF]">
            {article.body.split(/\n\n+/).map((p, i) => <p key={i}>{p.trim()}</p>)}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-6 py-3 border-t border-[#2A3142]">
          <Link
            href={`/newsroom#${encodeURIComponent(article.id)}`}
            className="text-xs font-semibold uppercase tracking-widest text-[#00D9FF] hover:text-[#009CB8] transition-colors"
          >
            Read in the newsroom →
          </Link>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#2A3142] hover:bg-[#303848] text-[#FFFFFF] text-xs font-bold tracking-widest uppercase rounded transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// The home headlines ARE the newsroom feed — same engine — so the front page and the
// newsroom never disagree. We show every story for the current round (the latest race, or
// the pre-season slate before any race) and let the panel scroll. Clicking a line opens it
// in a modal; the panel title jumps straight to the news tab.
export function HeadlinesPanel() {
  const year = useSeasonStore((s) => s.year)
  const phase = useSeasonStore((s) => s.phase)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const allUpgradeEvents = useSeasonStore((s) => s.allUpgradeEvents)
  const constructorHistory = useSeasonStore((s) => s.constructorHistory)
  const endOfSeasonSummary = useSeasonStore((s) => s.endOfSeasonSummary)
  const [openId, setOpenId] = useState<string | null>(null)

  const headlines = useMemo(() => {
    const ctx: NewsContext = {
      year, phase, completedRounds: raceResults.length, drivers, teams, raceResults,
      driverStandings, constructorStandings, upgradeEvents: allUpgradeEvents,
      constructorHistory, endOfSeason: endOfSeasonSummary, calendar: calendar2026, live: true,
    }
    // The feed is already newest-first (round desc, then priority); show the most recent 20
    // and let the panel scroll.
    return generateNews(ctx).slice(0, 20)
  }, [year, phase, raceResults, drivers, teams, driverStandings, constructorStandings, allUpgradeEvents, constructorHistory, endOfSeasonSummary])

  const open = headlines.find((h) => h.id === openId) ?? null

  const title = (
    <Link href="/newsroom" className="hover:text-[#00D9FF] transition-colors inline-flex items-center gap-1">
      Headlines <span aria-hidden>→</span>
    </Link>
  )

  return (
    <>
      <Panel title={title} flush>
        {headlines.length === 0 ? (
          <p className="px-5 py-3 text-sm text-[#FFFFFF]">No headlines yet. Run a race and the newsroom will fill up.</p>
        ) : (
          <ul className="max-h-[17.5rem] overflow-y-auto">
            {headlines.map((h) => (
              <li key={h.id} className="border-b border-[#2A3142] last:border-b-0">
                <button
                  onClick={() => setOpenId(h.id)}
                  className="w-full text-left px-5 py-2.5 hover:bg-[#0F1419]/50 transition-colors cursor-pointer"
                >
                  <span className="block text-sm leading-snug font-semibold text-[#FFFFFF]">{h.headline}</span>
                  <span className="block text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">
                    {CATEGORY_LABELS[h.category] ?? h.category} · {roundLabel(h.round, calendar2026.length)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open && <ArticleModal article={open} onClose={() => setOpenId(null)} />}
    </>
  )
}
