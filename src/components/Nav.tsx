'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useHydrated } from '@/lib/ui/use-hydrated'
import { usePathname, useRouter } from 'next/navigation'
import { EllipsisVertical, ChevronRight, Play } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { useRaceStore } from '@/lib/store/race-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { isOffSeason } from '@/lib/sim/types'
import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate, fromISODate, addDays, formatDate } from '@/lib/sim/calendar-dates'
import { generateNews, CATEGORY_LABELS, type NewsArticle, type DriverCareer, type TeamCareer, type TeamDriverTally, type RecordsContext } from '@/lib/news/engine'
import { buildLiveNewsContext } from '@/lib/news/live-context'
import { computeNextStop, type ContinueSettings } from '@/lib/sim/continue-loop'
import { simulateUntilRound } from '@/lib/sim/sim-ahead'
import { commitCurrentRace } from '@/lib/sim/race-commit'
import { runOffSeasonEvent, nextOffSeasonStageLabel } from '@/lib/sim/offseason-flow'
import { actionGetDriverCareers, actionGetTeamCareers, actionGetTeamDriverTallies, actionGetSeasonRecords } from '@/lib/news/actions'
import { useSetupCta } from '@/lib/store/setup-cta'
import { pendingRealWorldChanges } from '@/lib/history/transitions'
import { buildNewsIndex, LinkedText, LinkedParagraphs } from '@/components/news/LinkedText'
import { RealWorldChangesModal } from '@/components/home/RealWorldChangesModal'
import WorldSearch from '@/components/WorldSearch'
import { SimCalendar } from '@/components/SimCalendar'
import { RaceSimModal } from '@/components/RaceSimModal'
import { useSimControl } from '@/lib/store/sim-control'

const PRIMARY_CTA = 'flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] disabled:opacity-50 transition-colors'
const SECONDARY_CTA = 'flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#2A3142] text-[#FFFFFF] font-bold text-xs uppercase tracking-wide hover:bg-[#303848] disabled:opacity-50 transition-colors'
const STOP_CTA = 'flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#DC143C] text-[#FFFFFF] font-bold text-xs uppercase tracking-wide hover:bg-[#B01030] transition-colors'
const MENU_ITEM = 'block w-full text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#2A3142] transition-colors'

// Day-by-day Continue pacing: ms per simulated day. FM-style ~1 day/sec, easing a little faster on long
// fast-forwards so a multi-week gap to the next race doesn't drag. (n = days advanced so far this Continue.)
const dayTickMs = (n: number): number => (n < 8 ? 1080 : n < 24 ? 660 : 385)
// #127: an empty stretch (no news, no event) fast-forwards over ~this long TOTAL, not a fixed per-day
// speed — so a long dead run (the off-season's Jan/Feb weeks) reads as a real ~9s sim rather than a
// flash, while short hops stay proportionally quick. Per-day = EMPTY_RUN_MS / stretch-length, clamped.
const EMPTY_RUN_MS = 9000

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const matchMode = pathname === '/race'

  const phase = useSeasonStore((s) => s.phase)
  const year = useSeasonStore((s) => s.year)
  const currentRound = useSeasonStore((s) => s.currentRound)
  const currentDate = useSeasonStore((s) => s.currentDate)
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const racePhase = useRaceStore((s) => s.raceState?.phase)
  const interruptOnRaceday = useSettingsStore((s) => s.interruptOnRaceday)
  const setupCta = useSetupCta((s) => s.cta)
  const realWorldMode = useSeasonStore((s) => s.realWorldMode)
  const realWorldChangesResolved = useSeasonStore((s) => s.realWorldChangesResolved)

  const hydrated = useHydrated()
  const [menuOpen, setMenuOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [raceModalOpen, setRaceModalOpen] = useState(false)
  const [raceModalMounted, setRaceModalMounted] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [calMounted, setCalMounted] = useState(false) // keeps the calendar bar mounted briefly after a stop, for the fade-out linger
  const [calendarArticles, setCalendarArticles] = useState<NewsArticle[]>([])
  const stopRef = useRef(false)
  const advancingRef = useRef(false)
  const simRacePending = useSimControl((s) => s.simRacePending)
  const advancePending = useSimControl((s) => s.advancePending)
  const [newsStop, setNewsStop] = useState<{ date: string; articles: NewsArticle[] } | null>(null)
  const driverCard = useLiveDriverCards()
  // The gate is shown whenever there are pending real-world changes, unless the player dismissed it
  // ("Review later"); pressing Continue clears the dismissal so it reappears. Resolving clears the
  // pending set entirely. Derived open state, so no auto-open effect is needed.
  // Prior-season career totals (the current season folds in from the store), so milestone /
  // retirement interrupts see real records. Fetched once, like the newsroom.
  const [careerBase, setCareerBase] = useState<Record<string, DriverCareer>>({})
  const [teamCareerBase, setTeamCareerBase] = useState<Record<string, TeamCareer>>({})
  const [teamDriverTallies, setTeamDriverTallies] = useState<Record<string, TeamDriverTally[]>>({})
  const [records, setRecords] = useState<RecordsContext | undefined>(undefined)

  // Pre-season (no season started yet): Setup is the only reachable page.
  useEffect(() => {
    if (hydrated && phase === 'idle' && pathname !== '/setup') router.replace('/setup')
  }, [hydrated, phase, pathname, router])
  useEffect(() => {
    actionGetDriverCareers(year - 1).then(setCareerBase).catch(() => setCareerBase({}))
    actionGetTeamCareers(year - 1).then(setTeamCareerBase).catch(() => setTeamCareerBase({}))
    actionGetTeamDriverTallies(year - 1).then(setTeamDriverTallies).catch(() => setTeamDriverTallies({}))
    actionGetSeasonRecords().then(setRecords).catch(() => setRecords(undefined))
  }, [year])
  // Mirror `advancing` into a ref for the keyboard handler, and keep the calendar bar mounted for a short
  // linger after the advance stops so it fades out rather than vanishing.
  useEffect(() => { advancingRef.current = advancing }, [advancing])
  useEffect(() => {
    if (advancing) { const t = setTimeout(() => setCalMounted(true), 0); return () => clearTimeout(t) }
    const t = setTimeout(() => setCalMounted(false), 1100)
    return () => clearTimeout(t)
  }, [advancing])
  // Race-sim modal mount + fade-out linger.
  useEffect(() => {
    if (raceModalOpen) { const t = setTimeout(() => setRaceModalMounted(true), 0); return () => clearTimeout(t) }
    const t = setTimeout(() => setRaceModalMounted(false), 320)
    return () => clearTimeout(t)
  }, [raceModalOpen])
  // Pick up sim requests posted from the home calendar (RaceBanner) and run them here.
  useEffect(() => {
    if (!simRacePending) return
    useSimControl.getState().clearSimRace()
    runSimRace()
  }, [simRacePending]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (advancePending == null) return
    const round = advancePending
    useSimControl.getState().clearAdvance()
    runAdvanceToRace(round)
  }, [advancePending]) // eslint-disable-line react-hooks/exhaustive-deps

  const seasonActive = phase !== 'idle'
  const offSeason = isOffSeason(phase)
  const calendar = calendarForYear(year)
  const total = calendar.length
  const completedRounds = raceResults.length
  const nextRaceRound = completedRounds + 1
  // Race weekend opens on the Friday (race Sunday minus 2), so "Go to Race" appears from Friday on.
  const nextRaceDate = nextRaceRound <= total ? toISODate(addDays(raceDate(year, calendar[nextRaceRound - 1]), -2)) : null
  const atRaceday = !!nextRaceDate && currentDate >= nextRaceDate
  const circuit = calendar[currentRound - 1]
  const dateLabel = currentDate ? formatDate(fromISODate(currentDate), { year: true }) : ''

  // Hyperlink matcher for the interrupt modal (live roster; circuits limited to rounds run).
  const newsIndex = useMemo(() => buildNewsIndex({
    drivers: drivers.map((d) => ({ id: d.id, name: d.name })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    circuits: calendarForYear(year).slice(0, raceResults.length).map((c, i) => ({ name: c.name.replace(/\bGP\b/, 'Grand Prix'), round: i + 1 })),
    year,
  }), [drivers, teams, raceResults.length, year])

  // Real-world team changes that must be acted on before the off-season can advance (null = nothing
  // to gate on). Drives both the auto-opening modal and the Continue gate below.
  const pendingRW = useMemo(
    () => pendingRealWorldChanges({ realWorldMode, phase, resolved: realWorldChangesResolved, year, teams, completedRounds }),
    [realWorldMode, phase, realWorldChangesResolved, year, teams, completedRounds],
  )

  // Raceday progression — the single CTA walks pre-qualifying → pre-race → finished.
  function handleSimQualifying() { useRaceStore.getState().initSession() }
  function handleStartRace() {
    const rs = useRaceStore.getState().raceState
    if (rs) useRaceStore.setState({ raceState: { ...rs, phase: 'racing' } })
  }
  function handleQuit() {
    useRaceStore.getState().resetSession()
    setMenuOpen(false)
    router.push('/home')
  }

  // The day-by-day advance loop, shared by Continue and the fast-forward-to-a-future-race. Walks the clock
  // one day at a time (driving the calendar overlay), stopping at the next news interrupt or race weekend.
  // With a targetRound it auto-simulates intervening races and only stops at that round's weekend.
  async function runDayAdvance(opts?: { settings?: ContinueSettings; targetRound?: number }) {
    const settings = opts?.settings ?? useSettingsStore.getState()
    setAdvancing(true)
    stopRef.current = false
    let dayCount = 0
    while (true) {
      const s = useSeasonStore.getState()
      // The real-world grid-changes decision is a hard gate at a season's start. It's a blocking player
      // call, so stop the sim for it (the modal is render-driven; breaking here keeps the loop from
      // running past an unmade decision now that the off-season flows through this same loop) (#126).
      if (pendingRealWorldChanges({ realWorldMode: s.realWorldMode, phase: s.phase, resolved: s.realWorldChangesResolved, year: s.year, teams: s.teams, completedRounds: s.raceResults.length })) break
      const articles = generateNews(buildLiveNewsContext(s, careerBase, teamCareerBase, records, teamDriverTallies))
      setCalendarArticles(articles) // feed the calendar bar this season's dated news (revealed per day)
      const stop = computeNextStop({ currentDate: s.currentDate, completedRounds: s.raceResults.length, year: s.year, articles, settings, readIds: s.readNewsIds })
      if (stop.reason === 'idle') break
      // Walk the clock to the stop ONE DAY at a time, accelerating on long runs. Space/Esc set stopRef.
      let cur = s.currentDate
      // Linger on days something drops; fast-forward the empty stretches between, spread over a ~fixed
      // total so a long dead run reads as a real sim, not a flash (#127).
      const newsDays = new Set(articles.map((a) => a.date).filter((d): d is string => !!d))
      const segDays = Math.max(1, Math.round((Date.parse(stop.date) - Date.parse(cur)) / 86_400_000))
      const emptyMs = Math.min(300, Math.max(45, Math.round(EMPTY_RUN_MS / segDays)))
      while (cur < stop.date) {
        if (stopRef.current) break
        cur = toISODate(addDays(fromISODate(cur), 1))
        useSeasonStore.getState().setCurrentDate(cur)
        dayCount++
        await new Promise((r) => setTimeout(r, newsDays.has(cur) ? dayTickMs(dayCount) : emptyMs))
      }
      if (stopRef.current) break
      // Dated off-season beat (#126): run its sim/news organically now we've reached the day.
      if (stop.reason === 'offseason') {
        await runOffSeasonEvent(stop.event)
        if (stop.event === 'roster-swap') continue            // silent New-Year crossing — keep advancing
        if (opts?.targetRound != null) continue               // a fast-forward runs the beats but never stops on them
        // A no-one-retired year has nothing to show, so don't stop the sim on an empty retirements beat.
        if (stop.event === 'retirements' && (useSeasonStore.getState().endOfSeasonSummary?.retiredDriverIds?.length ?? 0) === 0) continue
        // Every other beat is a HARD STOP — the loop must never run past one. Its recap / board surfaces
        // on Home; the dated news sits in the newsroom to revisit.
        setAdvancing(false); router.push('/home'); break
      }
      if (stop.reason === 'news') { stop.articles.forEach((a) => useSeasonStore.getState().markNewsRead(a.id)); setNewsStop({ date: stop.date, articles: stop.articles }); break }
      // Race weekend (Friday): a fast-forward stops at the target weekend; a normal Continue hands the race
      // to the player; otherwise the race auto-simulates and the loop carries on.
      if (opts?.targetRound != null) { if (stop.round >= opts.targetRound) break }
      else if (useSettingsStore.getState().interruptOnRaceday) break
      const before = useSeasonStore.getState().raceResults.length
      await simulateUntilRound(stop.round + 1)
      if (useSeasonStore.getState().raceResults.length === before) break
      if (isOffSeason(useSeasonStore.getState().phase)) break
      if (stopRef.current) break
    }
  }

  // Simulate just the current race, behind the race-sim modal.
  async function runSimRace() {
    if (busy) return
    setBusy(true)
    setRaceModalOpen(true)
    useSimControl.getState().setSimBusy(true)
    // Let the modal fully fade in and cover the screen BEFORE committing the race, so the result and its
    // race-report headline never flash in the feed behind it (that spoils the "simulation is happening" illusion).
    await new Promise((r) => setTimeout(r, 380))
    try {
      await Promise.all([
        simulateUntilRound(useSeasonStore.getState().currentRound + 1),
        new Promise((r) => setTimeout(r, 900)), // hold a beat under full cover so it reads as work happening
      ])
    } finally {
      setBusy(false)
      setRaceModalOpen(false)
      useSimControl.getState().setSimBusy(false)
    }
  }
  function handleSimNextRace() { runSimRace() }

  // Fast-forward (day bar, no news/followed interrupts) up to a future race's weekend.
  async function runAdvanceToRace(targetRound: number) {
    if (busy) return
    setNewsStop(null)
    setBusy(true)
    useSimControl.getState().setSimBusy(true)
    try {
      await runDayAdvance({ settings: { interruptCategories: [], followedDriverIds: [], followedTeamIds: [], interruptOnFollowed: false }, targetRound })
    } finally {
      setBusy(false)
      setAdvancing(false)
      useSimControl.getState().setSimBusy(false)
    }
  }

  // Advance to the next stop. A news stop opens the interrupt modal; a raceday stop moves the clock
  // onto race day (CTA flips to "Go To Race"). If race day doesn't interrupt, the race auto-simulates
  // and the loop carries on to the next stop (next interrupting story, or the season's end).
  // Space (the primary-CTA key) or Escape requests a stop; the day-ticker loop checks this each tick.
  function handleStop() { stopRef.current = true }

  async function handleContinue() {
    if (busy) return
    setNewsStop(null)
    setBusy(true)
    try {
      // One unified loop (#126): in-season races + news AND the dated off-season beats all flow through
      // the day-by-day advance, which navigates to Home itself for the Signing Day / Testing hard stops.
      await runDayAdvance()
    } finally {
      setBusy(false)
      setAdvancing(false)
    }
  }

  async function handleEndRace() {
    if (busy) return
    setBusy(true)
    // Navigate FIRST, in-gesture (like Quit), so /race unmounts before commitCurrentRace advances the round
    // out from under it (which would otherwise re-render the page into round N+1's pre-qualifying). The
    // commit runs on the Zustand stores via getState(), so it completes fine after the page unmounts (#113).
    router.push('/home')
    try { await commitCurrentRace() } finally { setBusy(false) }
  }

  function handleRestart() {
    const s = useSeasonStore.getState()
    const c = calendarForYear(s.year)[s.currentRound - 1]
    if (c) useRaceStore.getState().resetSession(s.drivers.filter((d) => d.teamId !== ''), s.teams, c)
    setRestartOpen(false)
    setMenuOpen(false)
  }

  // The right-hand CTA, by context.
  const cta = (() => {
    if (!hydrated) return null
    if (matchMode) {
      if (racePhase === 'qualifying') return <button disabled className={PRIMARY_CTA}>Qualifying…</button>
      if (racePhase === 'pre-race') return <button onClick={handleStartRace} className={PRIMARY_CTA}>Start Race<ChevronRight size={14} /></button>
      if (racePhase === 'finished') return <button onClick={handleEndRace} disabled={busy} className={PRIMARY_CTA}>{busy ? 'Ending…' : 'End Race'}<ChevronRight size={14} /></button>
      if (racePhase === 'racing') return null
      return <button onClick={handleSimQualifying} className={PRIMARY_CTA}>Simulate Qualifying<ChevronRight size={14} /></button>
    }
    if (!seasonActive) {
      // Pre-season: the Setup page registers its "Start Season" action here.
      return setupCta
        ? <button onClick={setupCta.start} disabled={!setupCta.ready} className={PRIMARY_CTA}>Start Season {setupCta.year}<ChevronRight size={14} /></button>
        : null
    }
    if (advancing) return <button onClick={handleStop} className={STOP_CTA}>Stop Simulating</button>
    if (offSeason) {
      return <button onClick={handleContinue} disabled={busy} className={PRIMARY_CTA} title={`Next: ${nextOffSeasonStageLabel(phase)}`}>{busy ? 'Working…' : 'Continue'}<Play size={12} /></button>
    }
    if (atRaceday && interruptOnRaceday) {
      return (
        <div className="flex items-center gap-2">
          <button onClick={handleSimNextRace} disabled={busy} className={SECONDARY_CTA}>{busy ? 'Simulating…' : 'Simulate Next Race'}</button>
          <Link href="/race" className={PRIMARY_CTA}>Go To Race<ChevronRight size={14} /></Link>
        </div>
      )
    }
    return <button onClick={handleContinue} disabled={busy} className={PRIMARY_CTA}>{busy ? 'Working…' : 'Continue'}<Play size={12} /></button>
  })()

  // Spacebar activates the primary CTA (Football-Manager style). The current action mirrors the `cta`
  // above; resolved into a ref each render so a single listener always fires the right thing. Skips
  // when typing in a field or when a modal/menu is open (so space doesn't sim past a story to read).
  function primaryCtaAction(): (() => void) | null {
    if (!hydrated) return null
    if (matchMode) {
      if (racePhase === 'pre-race') return handleStartRace
      if (racePhase === 'finished') return busy ? null : handleEndRace
      if (racePhase === 'qualifying' || racePhase === 'racing') return null
      return handleSimQualifying
    }
    if (advancing) return handleStop
    if (!seasonActive) return setupCta && setupCta.ready ? setupCta.start : null
    if (offSeason) return busy ? null : handleContinue
    if (atRaceday && interruptOnRaceday) return () => router.push('/race')
    return busy ? null : handleContinue
  }
  const ctaBlocked = newsStop != null || restartOpen || menuOpen || !!pendingRW
  const ctaActionRef = useRef<(() => void) | null>(null)
  // Keep the ref pointed at the current action after each render (not during it).
  useEffect(() => { ctaActionRef.current = ctaBlocked ? null : primaryCtaAction() })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      // Escape bails out of an in-progress day-by-day advance.
      if (e.key === 'Escape') { if (advancingRef.current) { e.preventDefault(); stopRef.current = true } return }
      if (e.key !== ' ' && e.code !== 'Space') return
      if (e.repeat) return // one action per press; holding Space must not re-fire (e.g. double-init a season)
      const action = ctaActionRef.current
      if (!action) return
      e.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Before a season exists, Setup is the only page; once running, the full nav appears.
  const links = seasonActive
    ? [
        { href: '/home', label: 'HOME' },
        { href: '/setup', label: 'MARKET' },
        { href: '/standings', label: 'STANDINGS' },
        { href: '/performance', label: 'PERFORMANCE' },
        { href: '/world', label: 'WORLD' },
        { href: '/newsroom', label: 'NEWS' },
      ]
    : [{ href: '/setup', label: 'SETUP' }]

  return (
    <nav className="flex-none flex items-center gap-6 px-6 h-12 bg-[#1E2431] border-b border-[#2A3142]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 mr-2">
        <div className="w-1 h-5 rounded-sm bg-[#DC143C]" />
        <span className="font-display text-sm tracking-widest text-[#FFFFFF] uppercase">RaceWorld</span>
      </div>

      {matchMode ? (
        // Isolated match-mode banner: no nav links, no search — just the race identity + overflow + CTA.
        <>
          <span className="text-xs tabular-nums text-[#FFFFFF]">
            {dateLabel} · Round {String(currentRound).padStart(2, '0')}/{String(total).padStart(2, '0')}
            {circuit && <span> · {circuit.name}</span>}
          </span>
          <div className="flex-1" />
        </>
      ) : (
        <>
          {/* Nav links (RACE is reached via the Go-To-Race CTA, not a tab) */}
          <div className="flex items-center gap-1">
            {links.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 rounded text-xs font-semibold tracking-wider transition-colors ${active ? 'bg-[#00D9FF]/10 text-[#00D9FF]' : 'text-[#FFFFFF] hover:bg-[#2A3142]'}`}
                >
                  {label}
                </Link>
              )
            })}
          </div>

          {seasonActive ? <div className="flex-1 px-4"><WorldSearch /></div> : <div className="flex-1" />}

          <div className="flex items-center gap-3 text-xs tabular-nums text-[#FFFFFF]">
            {hydrated && seasonActive && (
              <span>{dateLabel} · {offSeason ? 'Off-season' : `Round ${String(currentRound).padStart(2, '0')}/${String(total).padStart(2, '0')}`}{circuit && !offSeason && <span> · {circuit.name}</span>}</span>
            )}
          </div>
        </>
      )}

      {/* Overflow menu */}
      <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenuOpen(false) }}>
        <button onClick={() => setMenuOpen((v) => !v)} className="p-1 rounded text-[#FFFFFF] hover:bg-[#2A3142] transition-colors" aria-label="Menu">
          <EllipsisVertical size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-50 w-48 rounded-lg bg-[#1E2431] border border-[#2A3142] shadow-xl py-1">
            {matchMode && (
              <>
                <button onClick={() => { setMenuOpen(false); setRestartOpen(true) }} className={`${MENU_ITEM} hover:text-[#00D9FF]`}>Restart Weekend</button>
                <button onClick={handleQuit} className={`${MENU_ITEM} hover:text-[#DC143C]`}>Quit</button>
              </>
            )}
            <Link href="/settings" onClick={() => setMenuOpen(false)} className={`${MENU_ITEM} hover:text-[#00D9FF]`}>Settings</Link>
          </div>
        )}
      </div>

      {/* The Continue / Go-To-Race / End-Race CTA sits right-most. */}
      {cta}

      {/* News interrupt modal */}
      <RealWorldChangesModal key={pendingRW?.toYear ?? 'none'} open={!!pendingRW} transition={pendingRW} />
      {calMounted && <SimCalendar open={advancing} articles={calendarArticles} />}
      {raceModalMounted && <RaceSimModal open={raceModalOpen} />}

      {newsStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNewsStop(null)}>
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A3142]">
              <span className="text-xs uppercase tracking-widest text-[#FFFFFF]">{formatDate(fromISODate(newsStop.date), { year: true })}</span>
              <span className="text-[10px] uppercase tracking-widest text-[#00D9FF]">{newsStop.articles.length} {newsStop.articles.length === 1 ? 'story' : 'stories'}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {newsStop.articles.map((a) => (
                <article key={a.id} className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-[#00D9FF]">{CATEGORY_LABELS[a.category] ?? a.category}</p>
                  <h2 className="font-display text-lg tracking-wide text-[#FFFFFF]"><LinkedText text={a.headline} index={newsIndex} driverCard={driverCard} /></h2>
                  <p className="text-sm italic text-[#FFFFFF]"><LinkedText text={a.dek} index={newsIndex} driverCard={driverCard} /></p>
                  <LinkedParagraphs text={a.body} index={newsIndex} driverCard={driverCard} />
                </article>
              ))}
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-[#2A3142]">
              <button onClick={() => setNewsStop(null)} className={PRIMARY_CTA}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Restart confirm (match mode) */}
      {restartOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setRestartOpen(false)}>
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-xl p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-1 h-5 rounded-sm bg-[#DC143C]" />
              <h2 className="font-display text-sm tracking-wider uppercase text-[#FFFFFF]">Restart Weekend</h2>
            </div>
            <p className="text-sm text-[#FFFFFF] mb-5">This discards the current session and restarts qualifying for Round {currentRound}. Results are not saved.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setRestartOpen(false)} className="px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] text-xs font-semibold uppercase tracking-wide hover:bg-[#303848] transition-colors">Cancel</button>
              <button onClick={handleRestart} className="px-4 py-2 rounded-lg bg-[#DC143C] text-white text-xs font-semibold uppercase tracking-wide hover:bg-[#b01030] transition-colors">Restart</button>
            </div>
          </div>
        </div>
      )}

    </nav>
  )
}
