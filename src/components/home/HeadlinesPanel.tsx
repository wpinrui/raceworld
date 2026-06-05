'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { Panel } from '@/components/world/ui'
import { generateNews, CATEGORY_LABELS, type NewsArticle, type DriverCareer, type TeamCareer, type TeamDriverTally, type RecordsContext } from '@/lib/news/engine'
import { buildLiveNewsContext } from '@/lib/news/live-context'
import { actionGetDriverCareers, actionGetTeamCareers, actionGetTeamDriverTallies, actionGetSeasonRecords } from '@/lib/news/actions'
import { buildNewsIndex, LinkedText, LinkedParagraphs, type NewsIndex, type DriverCardResolver } from '@/components/news/LinkedText'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { fromISODate, formatDate } from '@/lib/sim/calendar-dates'

function roundLabel(round: number, calLen: number): string {
  if (round <= 0) return 'Pre-season'
  if (round > calLen) return 'Off-season'
  return `Round ${round}`
}

// Article byline: drop date (no weekday) plus the round bucket, e.g. "8 Mar 2026 · Round 1".
function whenLabel(a: NewsArticle, calLen: number): string {
  const round = roundLabel(a.round, calLen)
  return a.date ? `${formatDate(fromISODate(a.date), { year: true })} · ${round}` : round
}

// Modal reader for a single headline. Shows the full article and links through to the
// newsroom (deep-linked via the URL hash, so the news tab opens on this exact story).
function ArticleModal({ article, index, driverCard, onClose }: { article: NewsArticle; index: NewsIndex | null; driverCard?: DriverCardResolver; onClose: () => void }) {
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
            {whenLabel(article, calendar2026.length)} · {CATEGORY_LABELS[article.category] ?? article.category}
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
          <h2 className="font-display text-xl tracking-wide text-[#FFFFFF]"><LinkedText text={article.headline} index={index} driverCard={driverCard} /></h2>
          <p className="text-sm italic text-[#FFFFFF]"><LinkedText text={article.dek} index={index} driverCard={driverCard} /></p>
          <LinkedParagraphs text={article.body} index={index} driverCard={driverCard} />
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
  const allUpgradeEvents = useSeasonStore((s) => s.allUpgradeEvents)
  const constructorHistory = useSeasonStore((s) => s.constructorHistory)
  const endOfSeasonSummary = useSeasonStore((s) => s.endOfSeasonSummary)
  const approvedSeasonChanges = useSeasonStore((s) => s.approvedSeasonChanges)
  const seasonContractWatch = useSeasonStore((s) => s.seasonContractWatch)
  const seasonRenewals = useSeasonStore((s) => s.seasonRenewals)
  const seasonDraft = useSeasonStore((s) => s.seasonDraft)
  const signingDayRevealed = useSeasonStore((s) => s.signingDayRevealed)
  const markNewsRead = useSeasonStore((s) => s.markNewsRead)
  const readNewsIds = useSeasonStore((s) => s.readNewsIds)
  const driverCard = useLiveDriverCards()
  const [openId, setOpenId] = useState<string | null>(null)
  // Prior-season career totals from the archive; the current season is folded in from the store.
  const [careerBase, setCareerBase] = useState<Record<string, DriverCareer>>({})
  const [teamCareerBase, setTeamCareerBase] = useState<Record<string, TeamCareer>>({})
  const [teamDriverTallies, setTeamDriverTallies] = useState<Record<string, TeamDriverTally[]>>({})
  const [records, setRecords] = useState<RecordsContext | undefined>(undefined)
  useEffect(() => {
    actionGetDriverCareers(year - 1).then(setCareerBase).catch(() => setCareerBase({}))
    actionGetTeamCareers(year - 1).then(setTeamCareerBase).catch(() => setTeamCareerBase({}))
    actionGetTeamDriverTallies(year - 1).then(setTeamDriverTallies).catch(() => setTeamDriverTallies({}))
    actionGetSeasonRecords().then(setRecords).catch(() => setRecords(undefined))
  }, [year])

  const headlines = useMemo(() => {
    // Use the SAME shared builder as the newsroom and the Continue loop, so the home feed can never
    // drift from them (it previously omitted the market beats: contract watch / renewals / draft).
    const ctx = buildLiveNewsContext(
      { year, phase, raceResults, drivers, teams, allUpgradeEvents, constructorHistory, endOfSeasonSummary, approvedSeasonChanges, seasonContractWatch, seasonRenewals, seasonDraft, signingDayRevealed },
      careerBase, teamCareerBase, records, teamDriverTallies,
    )
    // The feed is already newest-first (round desc, then priority); show the most recent 20
    // and let the panel scroll.
    return generateNews(ctx).slice(0, 20)
  }, [year, phase, raceResults, drivers, teams, allUpgradeEvents, constructorHistory, endOfSeasonSummary, approvedSeasonChanges, seasonContractWatch, seasonRenewals, seasonDraft, signingDayRevealed, careerBase, teamCareerBase, records, teamDriverTallies])

  // Name-to-world-page matcher for hyperlinking the open article (home feed is always the live season).
  const newsIndex = useMemo(() => buildNewsIndex({
    drivers: drivers.map((d) => ({ id: d.id, name: d.name })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    circuits: calendar2026.slice(0, raceResults.length).map((c, i) => ({ name: c.name.replace(/\bGP\b/, 'Grand Prix'), round: i + 1 })),
    year,
  }), [drivers, teams, raceResults.length, year])

  const open = headlines.find((h) => h.id === openId) ?? null

  const title = (
    <Link href="/newsroom" className="hover:text-[#00D9FF] transition-colors inline-flex items-center gap-1">
      Headlines <span aria-hidden>→</span>
    </Link>
  )

  return (
    <>
      <Panel title={title} flush fill>
        {headlines.length === 0 ? (
          <p className="px-5 py-3 text-sm text-[#FFFFFF]">No headlines yet. Run a race and the newsroom will fill up.</p>
        ) : (
          <ul>
            {headlines.map((h) => (
              <li key={h.id} className="border-b border-[#2A3142] last:border-b-0">
                <button
                  onClick={() => { setOpenId(h.id); markNewsRead(h.id) }}
                  className="w-full text-left px-5 py-2.5 hover:bg-[#0F1419]/50 transition-colors cursor-pointer"
                >
                  <span className={`block text-sm leading-snug font-semibold ${readNewsIds.includes(h.id) ? 'text-[#9CA3AF]' : 'text-[#FFFFFF]'}`}>{h.headline}</span>
                  <span className="block text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-0.5">
                    {whenLabel(h, calendar2026.length)} · {CATEGORY_LABELS[h.category] ?? h.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open && <ArticleModal article={open} index={newsIndex} driverCard={driverCard} onClose={() => setOpenId(null)} />}
    </>
  )
}
