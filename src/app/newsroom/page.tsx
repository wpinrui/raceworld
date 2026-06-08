'use client'

import { useEffect, useMemo, useState } from 'react'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { useRetainedState } from '@/lib/ui/retained-state'
import { useScrollRestore } from '@/lib/ui/use-scroll-restore'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { calendarForYear } from '@/data/calendars'
import { Panel } from '@/components/world/ui'
import { generateNews, CATEGORY_LABELS, NEWS_FILTERS, type NewsArticle, type DriverCareer, type TeamCareer, type TeamDriverTally, type RecordsContext } from '@/lib/news/engine'
import { buildLiveNewsContext } from '@/lib/news/live-context'
import { actionGetNewsSeasonYears, actionGetSeasonNews, actionGetAllSeasonNews, actionGetDriverCareers, actionGetTeamCareers, actionGetTeamDriverTallies, actionGetSeasonRecords, type AllSeasonNews } from '@/lib/news/actions'
import { buildNewsIndex, LinkedText, LinkedParagraphs } from '@/components/news/LinkedText'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import EntityFilter, { type EntityValue } from '@/components/news/EntityFilter'
import { fromISODate, formatDate } from '@/lib/sim/calendar-dates'

type Dated = NewsArticle & { year: number }

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

export default function NewsroomPage() {
  const s = useSeasonStore()
  const followedDriverIds = useSettingsStore((st) => st.followedDriverIds)
  const followedTeamIds = useSettingsStore((st) => st.followedTeamIds)
  const hydrated = useHydrated()
  const [filter, setFilter] = useRetainedState<string | null>('newsroom:filter', null)
  const [query, setQuery] = useRetainedState('newsroom:query', '')
  const [entity, setEntity] = useRetainedState<EntityValue | null>('newsroom:entity', null)
  const [following, setFollowing] = useRetainedState('newsroom:following', false)
  const [allSeasons, setAllSeasons] = useRetainedState('newsroom:allSeasons', false)
  const [selectedId, setSelectedId] = useRetainedState<string | null>('newsroom:selectedId', null)
  const [selectedYear, setSelectedYear] = useRetainedState<number>('newsroom:selectedYear', s.year)
  const [archivedYears, setArchivedYears] = useState<number[]>([])
  const [archivedArticles, setArchivedArticles] = useState<NewsArticle[]>([])
  // Roster for the selected archived season, used to hyperlink names in the article text.
  const [archivedRoster, setArchivedRoster] = useState<{ drivers: { id: string; name: string }[]; teams: { id: string; name: string }[]; circuits: { name: string; round: number }[] }>({ drivers: [], teams: [], circuits: [] })
  // Year whose archive has finished loading; `loadingArchive` (derived below) is true until it matches
  // the selected year, so the spinner is shown without a synchronous setState inside the fetch effect.
  const [loadedArchiveYear, setLoadedArchiveYear] = useState<number | null>(null)
  // Cross-season ("all seasons") feed, loaded once on demand.
  const [allData, setAllData] = useState<AllSeasonNews | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)
  // Prior-season F1 career totals from the archive DB (the current season is folded in from the
  // store), so the live newsroom's retirement obituaries and driver-to-watch see real records.
  const [careerBase, setCareerBase] = useState<Record<string, DriverCareer>>({})
  const [teamCareerBase, setTeamCareerBase] = useState<Record<string, TeamCareer>>({})
  const [teamDriverTallies, setTeamDriverTallies] = useState<Record<string, TeamDriverTally[]>>({})
  const [records, setRecords] = useState<RecordsContext | undefined>(undefined)
  const pageScrollRef = useScrollRestore<HTMLDivElement>('newsroom:page')
  const listScrollRef = useScrollRestore<HTMLDivElement>('newsroom:list')
  const driverCard = useLiveDriverCards()
  useEffect(() => {
    // Deep link from the home headlines: /newsroom#<articleId> opens that exact story.
    if (typeof window !== 'undefined' && window.location.hash.length > 1) {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (id) { setSelectedId(id); setFilter(null); s.markNewsRead(id) }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Discover which past seasons have news to read.
  useEffect(() => {
    actionGetNewsSeasonYears().then(setArchivedYears).catch(() => setArchivedYears([]))
  }, [])

  // Archived career totals for every prior season (strictly before the live year — the current
  // season is always counted from the store, never the DB, so it stays correct whenever it lands
  // in the archive).
  useEffect(() => {
    actionGetDriverCareers(s.year - 1).then(setCareerBase).catch(() => setCareerBase({}))
    actionGetTeamCareers(s.year - 1).then(setTeamCareerBase).catch(() => setTeamCareerBase({}))
    actionGetTeamDriverTallies(s.year - 1).then(setTeamDriverTallies).catch(() => setTeamDriverTallies({}))
    actionGetSeasonRecords().then(setRecords).catch(() => setRecords(undefined))
  }, [s.year])

  const liveYear = s.year
  const isLive = selectedYear === liveYear

  // All selectable years, newest first; the live season always sits at the top.
  const years = useMemo(() => {
    const set = new Set<number>([liveYear, ...archivedYears])
    return [...set].sort((a, b) => b - a)
  }, [liveYear, archivedYears])

  // Live season: generated client-side from the store (full attributes available).
  const liveArticles = useMemo(
    // FM-style gating: only stories at or before the current clock date (no future previews / pre-race spoilers).
    () => generateNews(buildLiveNewsContext(s, careerBase, teamCareerBase, records, teamDriverTallies)).filter((a) => !a.date || a.date <= s.currentDate),
    [s.year, s.phase, s.raceResults, s.drivers, s.teams, s.allUpgradeEvents, s.constructorHistory, s.endOfSeasonSummary, s.currentDate, careerBase, teamCareerBase, records, teamDriverTallies], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Past season: fetched from the archive DB on demand.
  useEffect(() => {
    if (isLive || allSeasons) return
    let cancelled = false
    actionGetSeasonNews(selectedYear)
      .then((res) => { if (!cancelled) { setArchivedArticles(res.articles); setArchivedRoster({ drivers: res.drivers, teams: res.teams, circuits: res.circuits }); setLoadedArchiveYear(selectedYear) } })
      .catch(() => { if (!cancelled) { setArchivedArticles([]); setArchivedRoster({ drivers: [], teams: [], circuits: [] }); setLoadedArchiveYear(selectedYear) } })
    return () => { cancelled = true }
  }, [isLive, allSeasons, selectedYear])

  // All-seasons feed: every archived snapshot, loaded once and cached. `loadingAll` is set in the
  // toggle handler (synchronously, so there's no flash of the live-only list before this fires).
  useEffect(() => {
    if (!allSeasons || allData) return
    let cancelled = false
    actionGetAllSeasonNews()
      .then((d) => { if (!cancelled) setAllData(d) })
      .catch(() => { if (!cancelled) setAllData({ articles: [], drivers: [], teams: [] }) })
      .finally(() => { if (!cancelled) setLoadingAll(false) })
    return () => { cancelled = true }
  }, [allSeasons, allData])

  const liveDated = useMemo<Dated[]>(() => liveArticles.map((a) => ({ ...a, year: liveYear })), [liveArticles, liveYear])

  // The article pool for the current scope: all seasons (live + every archive), the live season, or
  // one selected archived season. Every article carries its year.
  const pool = useMemo<Dated[]>(() => {
    if (allSeasons) return [...liveDated, ...(allData?.articles ?? [])]
    if (isLive) return liveDated
    return archivedArticles.map((a) => ({ ...a, year: selectedYear }))
  }, [allSeasons, liveDated, allData, isLive, archivedArticles, selectedYear])

  // Driver/team roster for the current scope: feeds the entity picker, the per-article entity chips,
  // and the name-hyperlink index.
  const scopeDrivers = useMemo(() => {
    if (allSeasons) {
      const m = new Map<string, string>()
      for (const d of allData?.drivers ?? []) m.set(d.id, d.name)
      for (const d of s.drivers) m.set(d.id, d.name)
      return [...m].map(([id, name]) => ({ id, name }))
    }
    if (isLive) return s.drivers.map((d) => ({ id: d.id, name: d.name }))
    return archivedRoster.drivers
  }, [allSeasons, allData, s.drivers, isLive, archivedRoster])
  const scopeTeams = useMemo(() => {
    if (allSeasons) {
      const m = new Map<string, string>()
      for (const t of allData?.teams ?? []) m.set(t.id, t.name)
      for (const t of s.teams) m.set(t.id, t.name)
      return [...m].map(([id, name]) => ({ id, name }))
    }
    if (isLive) return s.teams.map((t) => ({ id: t.id, name: t.name }))
    return archivedRoster.teams
  }, [allSeasons, allData, s.teams, isLive, archivedRoster])
  const driverName = useMemo(() => new Map(scopeDrivers.map((d) => [d.id, d.name])), [scopeDrivers])
  const teamName = useMemo(() => new Map(scopeTeams.map((t) => [t.id, t.name])), [scopeTeams])

  // Which categories actually have an article in this scope (drives which chips are enabled).
  const present = useMemo(() => new Set(pool.map((a) => a.category)), [pool])
  const hasFollows = followedDriverIds.length + followedTeamIds.length > 0

  // Compose all filters (AND): category group, entity, Following, full-text search.
  const activeGroup = filter ? NEWS_FILTERS.find((f) => f.label === filter) : null
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const followed = new Set([...followedDriverIds, ...followedTeamIds])
    return pool.filter((a) => {
      if (activeGroup && !activeGroup.categories.includes(a.category)) return false
      if (entity) {
        const ids = entity.kind === 'driver' ? a.entities?.driverIds : a.entities?.teamIds
        if (!ids?.includes(entity.id)) return false
      }
      if (following) {
        const ents = a.entities ? [...a.entities.driverIds, ...a.entities.teamIds] : []
        if (!ents.some((id) => followed.has(id))) return false
      }
      if (q && !`${a.headline} ${a.dek} ${a.body}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [pool, activeGroup, entity, following, query, followedDriverIds, followedTeamIds])

  const effectiveId = selectedId && shown.some((a) => a.id === selectedId) ? selectedId : (shown[0]?.id ?? null)
  const selected: Dated | null = shown.find((a) => a.id === effectiveId) ?? null

  // Name-to-world-page matcher for hyperlinking article text.
  const liveIndex = useMemo(() => buildNewsIndex({
    drivers: s.drivers.map((d) => ({ id: d.id, name: d.name })),
    teams: s.teams.map((t) => ({ id: t.id, name: t.name })),
    circuits: calendarForYear(liveYear).slice(0, s.raceResults.length).map((c, i) => ({ name: c.name.replace(/\bGP\b/, 'Grand Prix'), round: i + 1 })),
    year: liveYear,
  }), [s.drivers, s.teams, s.raceResults.length, liveYear])
  const archivedIndex = useMemo(() => buildNewsIndex({
    drivers: archivedRoster.drivers, teams: archivedRoster.teams, circuits: archivedRoster.circuits, year: selectedYear,
  }), [archivedRoster, selectedYear])
  // Cross-season: union roster + the selected article's own year for circuit links.
  const allSeasonsIndex = useMemo(() => buildNewsIndex({
    drivers: scopeDrivers, teams: scopeTeams,
    circuits: calendarForYear(selected?.year ?? liveYear).map((c, i) => ({ name: c.name.replace(/\bGP\b/, 'Grand Prix'), round: i + 1 })),
    year: selected?.year ?? liveYear,
  }), [scopeDrivers, scopeTeams, selected?.year, liveYear])
  const index = allSeasons ? allSeasonsIndex : (isLive ? liveIndex : archivedIndex)

  const loadingArchive = loadedArchiveYear !== selectedYear
  const loading = allSeasons ? loadingAll : (!isLive && loadingArchive)

  if (!hydrated) return null

  const toggleCls = (active: boolean, enabled = true) =>
    `px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
      active
        ? 'border-[#00D9FF] text-[#00D9FF]'
        : enabled
          ? 'border-[#2A3142] text-[#FFFFFF] hover:border-[#303848]'
          : 'border-[#1B2230] text-[#6B7280] cursor-not-allowed'
    }`

  return (
    <div ref={pageScrollRef} className="h-full overflow-y-auto bg-[#0F1419] text-[#FFFFFF]">
      <div className="px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl tracking-wider uppercase">Newsroom</h1>
          <div className="flex items-center gap-3">
            {(years.length > 1 || archivedYears.length > 0) && (
              <button onClick={() => { if (!allSeasons && !allData) setLoadingAll(true); setAllSeasons((v) => !v); setSelectedId(null) }} className={toggleCls(allSeasons)}>
                All seasons
              </button>
            )}
            {years.length > 1 && !allSeasons && (
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
        </div>

        {loading ? (
          <Panel title="Newsroom">
            <p className="text-sm text-[#FFFFFF]">Loading {allSeasons ? 'all seasons' : `the ${selectedYear} archive`}…</p>
          </Panel>
        ) : pool.length === 0 ? (
          <Panel title="Newsroom">
            <p className="text-sm text-[#FFFFFF]">
              {isLive && !allSeasons
                ? 'No news yet. Start a season and run a race, and the headlines will appear here.'
                : 'No archived news yet.'}
            </p>
          </Panel>
        ) : (
          <>
            {/* Search */}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stories…"
              className="w-full bg-[#0F1419] border border-[#2A3142] rounded-md px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#6B7280] focus:border-[#00D9FF] outline-none"
            />

            {/* Category filter + Following + entity filter — full taxonomy always shown; empty categories disabled. */}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setFilter(null)} className={toggleCls(filter === null)}>All</button>
              {NEWS_FILTERS.map((f) => {
                const enabled = f.categories.some((c) => present.has(c))
                return (
                  <button key={f.label} onClick={() => enabled && setFilter(f.label)} disabled={!enabled} className={toggleCls(filter === f.label, enabled)}>
                    {f.label}
                  </button>
                )
              })}
              <span className="mx-1 h-4 w-px bg-[#2A3142]" />
              <button
                onClick={() => hasFollows && setFollowing((v) => !v)}
                disabled={!hasFollows}
                className={toggleCls(following, hasFollows)}
              >
                Following
              </button>
              <EntityFilter drivers={scopeDrivers} teams={scopeTeams} value={entity} onChange={(v) => { setEntity(v); setSelectedId(null) }} />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {/* Headlines list */}
              <Panel title={`Headlines${shown.length ? ` (${shown.length})` : ''}`} flush className="lg:col-span-1">
                {shown.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-[#FFFFFF]">No stories match your filters.</p>
                ) : (
                  <div ref={listScrollRef} className="divide-y divide-[#2A3142] max-h-[70vh] overflow-y-auto">
                    {shown.map((a) => {
                      const active = a.id === effectiveId
                      return (
                        <button
                          key={`${a.year}:${a.id}`}
                          onClick={() => { setSelectedId(a.id); s.markNewsRead(a.id) }}
                          className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-[#0F1419]' : 'hover:bg-[#0F1419]/50'}`}
                        >
                          <p className={`text-sm font-semibold ${s.readNewsIds.includes(a.id) ? 'text-[#9CA3AF]' : 'text-[#FFFFFF]'}`}>{a.headline}</p>
                          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mt-1">
                            {whenLabel(a, calendarForYear(a.year).length)} · {CATEGORY_LABELS[a.category] ?? a.category}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </Panel>

              {/* Reader */}
              <Panel title={selected ? `${whenLabel(selected, calendarForYear(selected.year).length)} · ${CATEGORY_LABELS[selected.category] ?? selected.category}` : 'Article'} className="lg:col-span-2">
                {selected ? (
                  <article className="space-y-3">
                    <h2 className="font-display text-xl tracking-wide text-[#FFFFFF]"><LinkedText text={selected.headline} index={index} driverCard={driverCard} /></h2>
                    <p className="text-sm italic text-[#FFFFFF]"><LinkedText text={selected.dek} index={index} driverCard={driverCard} /></p>
                    <LinkedParagraphs text={selected.body} index={index} driverCard={driverCard} />
                    {selected.entities && (selected.entities.driverIds.length + selected.entities.teamIds.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#2A3142]">
                        <span className="text-[10px] uppercase tracking-widest text-[#6B7280] self-center mr-1">Filter</span>
                        {selected.entities.driverIds.map((id) => {
                          const name = driverName.get(id)
                          return name ? (
                            <button key={`d:${id}`} onClick={() => { setEntity({ kind: 'driver', id, name }); setSelectedId(null) }} className="px-2 py-0.5 rounded-full text-xs border border-[#2A3142] text-[#FFFFFF] hover:border-[#00D9FF] hover:text-[#00D9FF] transition-colors">
                              {name}
                            </button>
                          ) : null
                        })}
                        {selected.entities.teamIds.map((id) => {
                          const name = teamName.get(id)
                          return name ? (
                            <button key={`t:${id}`} onClick={() => { setEntity({ kind: 'team', id, name }); setSelectedId(null) }} className="px-2 py-0.5 rounded-full text-xs border border-[#2A3142] text-[#FFFFFF] hover:border-[#00D9FF] hover:text-[#00D9FF] transition-colors">
                              {name}
                            </button>
                          ) : null
                        })}
                      </div>
                    )}
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
