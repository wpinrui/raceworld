'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendarForYear } from '@/data/calendars'
import { OFF_SEASON_PHASES, isOffSeason } from '@/lib/sim/types'
import { Panel } from '@/components/world/ui'
import { DriverLink } from '@/components/world/EntityLink'
import { DriverHover } from '@/components/world/DriverHover'
import { useLiveDriverCards } from '@/components/news/useDriverCards'
import { positionPalette } from '@/components/world/pills'
import { SeasonReviewPanel } from '@/components/home/SeasonReviewPanel'
import { RetirementsPanel } from '@/components/standings/RetirementsPanel'
import { SigningDayBoard } from '@/components/home/SigningDayBoard'
import { TestingPanel } from '@/components/standings/TestingPanel'
import type { Driver, Team, RaceResult } from '@/lib/sim/types'

const FORM_RACES = 4 // recent races that feed the form read

interface Prediction {
  driver: Driver
  team: Team
  recent: (number | null)[] // recent finishes, oldest→newest (null = DNF)
  trend: number // base predicted position − blended position; +ve = climbing on form
}

// Blend raw pace (car + driver) with recent finishing form. Early season, with no
// results, it falls back to raw pace; as races complete, a driver beating their
// machinery climbs and a slumping one drops — so the call shifts week to week.
function predict(drivers: Driver[], teams: Team[], raceResults: RaceResult[][], currentRound: number): Prediction[] {
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const grid = drivers
    .filter((d) => d.teamId !== '')
    .map((d) => ({ d, team: teamById.get(d.teamId) }))
    .filter((p): p is { d: Driver; team: Team } => p.team !== undefined)
  const field = grid.length || 20

  // Raw expected position from car pace + driver pace.
  const byBase = [...grid].sort((a, b) => b.team.carPace + b.d.pace * 0.5 - (a.team.carPace + a.d.pace * 0.5))
  const basePos = new Map<string, number>()
  byBase.forEach((x, i) => basePos.set(x.d.id, i + 1))

  const recentRounds = raceResults.slice(0, Math.max(0, currentRound - 1)).slice(-FORM_RACES)

  return grid
    .map(({ d, team }) => {
      const recent: (number | null)[] = []
      for (const round of recentRounds) {
        const r = round.find((x) => x.driverId === d.id)
        if (r) recent.push(r.dnf ? null : r.finishPosition)
      }
      const base = basePos.get(d.id) ?? field
      const finishes = recent.map((p) => p ?? field) // DNF counts as back of the field
      const avgFin = finishes.length ? finishes.reduce((s, x) => s + x, 0) / finishes.length : base
      const metric = 0.55 * base + 0.45 * avgFin
      return { driver: d, team, recent, base, metric }
    })
    .sort((a, b) => a.metric - b.metric)
    .map((p, i) => ({ driver: p.driver, team: p.team, recent: p.recent, trend: p.base - (i + 1) }))
}

function FormPill({ pos }: { pos: number | null }) {
  if (pos == null) {
    return <span className="inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-bold" style={{ backgroundColor: '#5C2475', color: '#E8BBFF' }}>R</span>
  }
  const { bg, fg } = positionPalette(pos)
  return <span className="inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-bold tabular-nums" style={{ backgroundColor: bg, color: fg }}>{pos}</span>
}

// Module-scoped so it survives unmount/remount: which off-season phase we've already auto-opened.
// This makes the recap pop exactly once when you Continue into a stage, not every time you return to
// Home (e.g. Home → Standings → Home). It only re-fires when the phase actually changes (next Continue).
let lastAutoOpenedPhase: string | null = null

const STAGE_LABEL: Record<string, string> = {
  'end-of-season': 'Season Review',
  'contract-negotiations': 'Signing Day',
  'driver-retirements': 'Retirements',
  'pre-season-testing': 'Testing',
}

// Off-season mode: Pundit Predictions becomes the season-review surface. One button per stage already
// reached; each opens a modal recapping how that stage went (Continue, top-right, runs the next one).
function OffSeasonReview() {
  const season = useSeasonStore()
  const summary = season.endOfSeasonSummary
  const [open, setOpen] = useState<string | null>(null)

  // Auto-open the recap for whatever off-season stage you've just advanced into — once per phase, so
  // returning to Home (after Standings, etc.) doesn't reopen it. The next Continue changes the phase
  // and re-arms it.
  useEffect(() => {
    if (OFF_SEASON_PHASES.includes(season.phase) && lastAutoOpenedPhase !== season.phase) {
      lastAutoOpenedPhase = season.phase
      setOpen(season.phase)
    }
  }, [season.phase])

  if (!summary) {
    return <Panel title="Off-Season"><p className="text-sm text-[#FFFFFF]">Wrapping up the season…</p></Panel>
  }

  const progressIdx = OFF_SEASON_PHASES.indexOf(season.phase)
  const reached = OFF_SEASON_PHASES.filter((_, i) => i <= progressIdx)

  return (
    <Panel title={`Season ${season.year} · Off-Season`} flush fill>
      <div className="p-4">
        <div className="flex flex-wrap gap-2">
          {reached.map((p) => (
            <button
              key={p}
              onClick={() => setOpen(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${
                p === season.phase ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'
              }`}
            >
              {STAGE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(null)}>
          <div className={`bg-[#1E2431] border border-[#2A3142] rounded-xl w-full flex flex-col shadow-xl ${open === 'contract-negotiations' ? 'max-w-5xl h-[85vh]' : 'max-w-3xl max-h-[85vh]'}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A3142]">
              <h2 className="font-display text-sm tracking-wider uppercase text-[#FFFFFF]">{STAGE_LABEL[open]}</h2>
              <button onClick={() => setOpen(null)} className="text-xs text-[#FFFFFF] hover:text-[#00D9FF] uppercase tracking-wide">Close</button>
            </div>
            <div className={`flex-1 min-h-0 p-5 ${open === 'contract-negotiations' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              {open === 'end-of-season' && (
                <SeasonReviewPanel summary={summary} drivers={season.drivers} teams={season.teams} driverStandings={season.driverStandings} constructorStandings={season.constructorStandings} />
              )}
              {open === 'contract-negotiations' && <SigningDayBoard picks={season.seasonDraft} year={season.year} dropped={summary.droppedDrivers} />}
              {open === 'driver-retirements' && <RetirementsPanel summary={summary} drivers={season.drivers} />}
              {open === 'pre-season-testing' && (
                <TestingPanel summary={summary} teams={season.pendingNextSeasonState?.teams ?? season.teams} constructorStandings={season.constructorStandings} />
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

export function PunditPredictions() {
  const card = useLiveDriverCards()
  const phase = useSeasonStore((s) => s.phase)
  const drivers = useSeasonStore((s) => s.drivers)
  const teams = useSeasonStore((s) => s.teams)
  const currentRound = useSeasonStore((s) => s.currentRound)
  const year = useSeasonStore((s) => s.year)
  const raceResults = useSeasonStore((s) => s.raceResults)

  if (isOffSeason(phase)) return <OffSeasonReview />

  const nextRace = calendarForYear(year)[currentRound - 1]
  if (!nextRace) {
    return (
      <Panel title="Pundit Predictions">
        <p className="text-sm text-[#6B7280]">—</p>
      </Panel>
    )
  }

  const predictions = predict(drivers, teams, raceResults, currentRound)

  return (
    <Panel title={`Pundit Predictions · ${nextRace.name}`} flush>
      {/* Show ~10; the rest of the grid scrolls. */}
      <ul className="max-h-[23rem] overflow-y-auto">
        {predictions.map((p, i) => (
          <li key={p.driver.id} className="flex items-center gap-3 border-b border-[#2A3142] px-5 py-2 last:border-b-0">
            <span className="w-6 text-sm font-bold tabular-nums text-[#FFFFFF]">P{i + 1}</span>
            <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: p.team.color }} />
            <DriverHover id={p.driver.id} card={card} className="min-w-0 flex-1 truncate">
              <DriverLink id={p.driver.id} className="min-w-0 flex-1 truncate text-sm font-semibold text-[#FFFFFF]">
                {p.driver.name}
              </DriverLink>
            </DriverHover>
            {p.trend !== 0 && (
              <span className={`text-[10px] font-bold tabular-nums ${p.trend > 0 ? 'text-[#10B981]' : 'text-[#DC143C]'}`}>
                {p.trend > 0 ? `▲${p.trend}` : `▼${-p.trend}`}
              </span>
            )}
            <span className="hidden items-center gap-0.5 sm:flex">
              {p.recent.map((pos, j) => <FormPill key={j} pos={pos} />)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
