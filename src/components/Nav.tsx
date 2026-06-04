'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { EllipsisVertical, ChevronRight, Play } from 'lucide-react'
import { useSeasonStore } from '@/lib/store/season-store'
import { useRaceStore } from '@/lib/store/race-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { isOffSeason } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'
import { raceDate, toISODate, fromISODate, formatDate } from '@/lib/sim/calendar-dates'
import { generateNews, CATEGORY_LABELS, type NewsArticle, type DriverCareer, type TeamCareer } from '@/lib/news/engine'
import { buildLiveNewsContext } from '@/lib/news/live-context'
import { computeNextStop } from '@/lib/sim/continue-loop'
import { simulateUntilRound } from '@/lib/sim/sim-ahead'
import { commitCurrentRace } from '@/lib/sim/race-commit'
import { advanceOffSeason, nextOffSeasonStageLabel } from '@/lib/sim/offseason-flow'
import { actionGetDriverCareers, actionGetTeamCareers } from '@/lib/news/actions'
import { useSetupCta } from '@/lib/store/setup-cta'
import { pendingRealWorldChanges } from '@/lib/history/transitions'
import { buildNewsIndex, LinkedText, LinkedParagraphs } from '@/components/news/LinkedText'
import { RealWorldChangesModal } from '@/components/home/RealWorldChangesModal'
import WorldSearch from '@/components/WorldSearch'

const PRIMARY_CTA = 'flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#00D9FF] text-[#0F1419] font-bold text-xs uppercase tracking-wide hover:bg-[#009CB8] disabled:opacity-50 transition-colors'
const SECONDARY_CTA = 'flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#2A3142] text-[#FFFFFF] font-bold text-xs uppercase tracking-wide hover:bg-[#303848] disabled:opacity-50 transition-colors'
const MENU_ITEM = 'block w-full text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#FFFFFF] hover:bg-[#2A3142] transition-colors'

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
  const pendingNextSeasonState = useSeasonStore((s) => s.pendingNextSeasonState)

  const [hydrated, setHydrated] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [simming, setSimming] = useState(false)
  const [newsStop, setNewsStop] = useState<{ date: string; articles: NewsArticle[] } | null>(null)
  // The gate is shown whenever there are pending real-world changes, unless the player dismissed it
  // ("Review later"); pressing Continue clears the dismissal so it reappears. Resolving clears the
  // pending set entirely. Derived open state, so no auto-open effect is needed.
  const [rwDismissed, setRwDismissed] = useState(false)
  // Prior-season career totals (the current season folds in from the store), so milestone /
  // retirement interrupts see real records. Fetched once, like the newsroom.
  const [careerBase, setCareerBase] = useState<Record<string, DriverCareer>>({})
  const [teamCareerBase, setTeamCareerBase] = useState<Record<string, TeamCareer>>({})

  useEffect(() => setHydrated(true), [])
  // Pre-season (no season started yet): Setup is the only reachable page.
  useEffect(() => {
    if (hydrated && phase === 'idle' && pathname !== '/setup') router.replace('/setup')
  }, [hydrated, phase, pathname, router])
  useEffect(() => {
    actionGetDriverCareers(year - 1).then(setCareerBase).catch(() => setCareerBase({}))
    actionGetTeamCareers(year - 1).then(setTeamCareerBase).catch(() => setTeamCareerBase({}))
  }, [year])

  const seasonActive = phase !== 'idle'
  const offSeason = isOffSeason(phase)
  const total = calendar2026.length
  const completedRounds = raceResults.length
  const nextRaceRound = completedRounds + 1
  const nextRaceDate = nextRaceRound <= total ? toISODate(raceDate(year, calendar2026[nextRaceRound - 1])) : null
  const atRaceday = !!nextRaceDate && currentDate >= nextRaceDate
  const circuit = calendar2026[currentRound - 1]
  const dateLabel = currentDate ? formatDate(fromISODate(currentDate), { year: true }) : ''

  // Hyperlink matcher for the interrupt modal (live roster; circuits limited to rounds run).
  const newsIndex = useMemo(() => buildNewsIndex({
    drivers: drivers.map((d) => ({ id: d.id, name: d.name })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    circuits: calendar2026.slice(0, raceResults.length).map((c, i) => ({ name: c.name.replace(/\bGP\b/, 'Grand Prix'), round: i + 1 })),
    year,
  }), [drivers, teams, raceResults.length, year])

  // Real-world team changes that must be acted on before the off-season can advance (null = nothing
  // to gate on). Drives both the auto-opening modal and the Continue gate below.
  const pendingRW = useMemo(
    () => pendingRealWorldChanges({ realWorldMode, phase, resolved: realWorldChangesResolved, year, teams: pendingNextSeasonState?.teams }),
    [realWorldMode, phase, realWorldChangesResolved, year, pendingNextSeasonState],
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

  // Headlessly run just the next race (no match mode), then land back pre-race at the round after.
  async function handleSimNextRace() {
    if (simming) return
    setSimming(true)
    try { await simulateUntilRound(useSeasonStore.getState().currentRound + 1) } finally { setSimming(false) }
  }

  // Advance to the next stop. A news stop opens the interrupt modal; a raceday stop moves the clock
  // onto race day (CTA flips to "Go To Race"). If race day doesn't interrupt, the race auto-simulates
  // and the loop carries on to the next stop (next interrupting story, or the season's end).
  async function handleContinue() {
    if (busy) return
    setNewsStop(null)
    setBusy(true)
    try {
      if (isOffSeason(useSeasonStore.getState().phase)) {
        // Gate: don't advance the off-season while a real-world season's grid changes are unresolved.
        // Surface them instead — the player must Apply (with any overrides) before progressing.
        const st = useSeasonStore.getState()
        if (pendingRealWorldChanges({ realWorldMode: st.realWorldMode, phase: st.phase, resolved: st.realWorldChangesResolved, year: st.year, teams: st.pendingNextSeasonState?.teams })) {
          setRwDismissed(false) // un-dismiss so the gate reappears
          return
        }
        await advanceOffSeason()
      } else {
        const settings = useSettingsStore.getState()
        while (true) {
          const s = useSeasonStore.getState()
          const articles = generateNews(buildLiveNewsContext(s, careerBase, teamCareerBase))
          const stop = computeNextStop({ currentDate: s.currentDate, completedRounds: s.raceResults.length, year: s.year, articles, settings })
          if (stop.reason === 'news') { s.setCurrentDate(stop.date); setNewsStop({ date: stop.date, articles: stop.articles }); break }
          if (stop.reason === 'race') {
            if (settings.interruptOnRaceday) { s.setCurrentDate(stop.date); break }
            const before = useSeasonStore.getState().raceResults.length
            await simulateUntilRound(stop.round + 1)
            // If the headless sim didn't actually record a round, bail rather than spin forever.
            if (useSeasonStore.getState().raceResults.length === before) break
            if (isOffSeason(useSeasonStore.getState().phase)) break
            continue
          }
          break // season-end
        }
      }
      // The off-season recap modals live on Home; jump there so they're visible after Continue.
      if (isOffSeason(useSeasonStore.getState().phase)) router.push('/home')
    } finally {
      setBusy(false)
    }
  }

  async function handleEndRace() {
    if (busy) return
    setBusy(true)
    try { await commitCurrentRace() } finally { setBusy(false) }
    router.push('/home')
  }

  function handleRestart() {
    const s = useSeasonStore.getState()
    const c = calendar2026[s.currentRound - 1]
    if (c) useRaceStore.getState().resetSession(s.drivers.filter((d) => d.teamId !== ''), s.teams, c.id)
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
    if (offSeason) {
      return <button onClick={handleContinue} disabled={busy} className={PRIMARY_CTA} title={`Next: ${nextOffSeasonStageLabel(phase)}`}>{busy ? 'Working…' : 'Continue'}<Play size={12} /></button>
    }
    if (atRaceday && interruptOnRaceday) {
      return (
        <div className="flex items-center gap-2">
          <button onClick={handleSimNextRace} disabled={simming} className={SECONDARY_CTA}>{simming ? 'Simulating…' : 'Simulate Next Race'}</button>
          <Link href="/race" className={PRIMARY_CTA}>Go To Race<ChevronRight size={14} /></Link>
        </div>
      )
    }
    return <button onClick={handleContinue} disabled={busy} className={PRIMARY_CTA}>{busy ? 'Working…' : 'Continue'}<Play size={12} /></button>
  })()

  // Before a season exists, Setup is the only page; once running, the full nav appears.
  const links = seasonActive
    ? [
        { href: '/home', label: 'HOME' },
        { href: '/setup', label: 'MARKET' },
        { href: '/standings', label: 'STANDINGS' },
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
      <RealWorldChangesModal key={pendingRW?.toYear ?? 'none'} open={!!pendingRW && !rwDismissed} transition={pendingRW} onClose={() => setRwDismissed(true)} />

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
                  <h2 className="font-display text-lg tracking-wide text-[#FFFFFF]"><LinkedText text={a.headline} index={newsIndex} /></h2>
                  <p className="text-sm italic text-[#FFFFFF]"><LinkedText text={a.dek} index={newsIndex} /></p>
                  <LinkedParagraphs text={a.body} index={newsIndex} />
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
