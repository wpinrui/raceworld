'use client'

import { useEffect, useState } from 'react'
import type { DraftPick } from '@/lib/sim/driver-market'
import type { Driver, DroppedDriver } from '@/lib/sim/types'
import { useSeasonStore } from '@/lib/store/season-store'
import { signingDaySocialPosts } from '@/lib/news/signing-day-social'
import { foldLiveSeason, type DriverCareer } from '@/lib/news/engine'
import { actionGetDriverCareers } from '@/lib/news/actions'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverTooltip } from '@/components/world/DriverTooltip'
import { Tooltip } from '@/components/ui/Tooltip'

const ordinal = (n: number): string => {
  const v = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// Free-agent standing label: the top name is just "Best", the rest are "3rd best" etc.
const faLabel = (rank: number): string => (rank === 1 ? 'Best' : `${ordinal(rank)} best`)

// Signing Day: the off-season free-agency event, revealed one signing at a time (the most coveted seat
// first). The component fills the modal height as a fixed frame: the seats board, the running contenders,
// and the analyst reaction each scroll INSIDE their own region, so the modal itself never scrolls. The
// reveal count lives in the store, so revisiting the event shows the same progress (the illusion holds).

const FLAVOUR_TAG: Record<DraftPick['flavour'], { label: string; bg: string; fg: string } | null> = {
  upset: { label: 'Upset', bg: '#DC143C', fg: '#FFFFFF' },
  statement: { label: 'Statement', bg: '#00D9FF', fg: '#0F1419' },
  rookie: { label: 'Rookie', bg: '#10B981', fg: '#0F1419' },
  veteran_short: { label: 'Veteran', bg: '#F59E0B', fg: '#0F1419' },
  chalk: null,
}

// Stable accent per analyst account, so each voice reads consistently down the feed.
const HANDLE_COLOR: Record<string, string> = {}
const ACCENTS = ['#00D9FF', '#10B981', '#F59E0B', '#C084FC', '#FB7185']
function accentFor(handle: string): string {
  if (!HANDLE_COLOR[handle]) HANDLE_COLOR[handle] = ACCENTS[Object.keys(HANDLE_COLOR).length % ACCENTS.length]
  return HANDLE_COLOR[handle]
}

// The old team, shown only when it adds something: a switch or a re-signing. Empty for rookies (the
// badge says so) and for drivers who were already free agents (the FA ranking already says so).
function fromLabel(p: DraftPick): string {
  if (p.flavour === 'rookie' || !p.prevTeamName) return ''
  if (p.prevTeamName === p.teamName) return 're-signs'
  return `from ${p.prevTeamName}`
}

function Tag({ flavour }: { flavour: DraftPick['flavour'] }) {
  const t = FLAVOUR_TAG[flavour]
  if (!t) return null
  return (
    <span className="text-[9px] font-bold uppercase tracking-wide rounded px-1 py-0.5 shrink-0" style={{ backgroundColor: t.bg, color: t.fg }}>
      {t.label}
    </span>
  )
}

export function SigningDayBoard({ picks, year, dropped = [] }: { picks: DraftPick[]; year: number; dropped?: DroppedDriver[] }) {
  const stored = useSeasonStore((s) => s.signingDayRevealed)
  const setRevealed = useSeasonStore((s) => s.setSigningDayRevealed)
  const standings = useSeasonStore((s) => s.constructorStandings)
  const drivers = useSeasonStore((s) => s.drivers)
  const pending = useSeasonStore((s) => s.pendingNextSeasonState)
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const eos = useSeasonStore((s) => s.endOfSeasonSummary)

  // Career totals (archived base + the season just run), for the free-agent hover cards.
  const [careers, setCareers] = useState<Record<string, DriverCareer>>({})
  useEffect(() => {
    actionGetDriverCareers(year - 1)
      .then((base) => setCareers(foldLiveSeason(base, year, raceResults, eos?.driverChampion)))
      .catch(() => setCareers({}))
  }, [year, raceResults, eos])

  if (picks.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">Every seat was settled in-season. There was no free-agency activity this year.</p>
  }

  const total = picks.length
  const revealed = Math.min(stored, total)
  const onClock = revealed < total ? picks[revealed] : null
  const complete = !onClock
  const posts = signingDaySocialPosts(picks).filter((p) => p.pickIndex < revealed).sort((a, b) => b.pickIndex - a.pickIndex)

  // Each team's constructors'-championship standing for the badge. Established teams take their just-ended
  // finish; new teams (no finish) slot in below the field, projected to finish in the season ahead.
  const finishOf = new Map(standings.map((cs, i) => [cs.teamId, i + 1]))
  const n = standings.length
  const projected = new Map<string, number>()
  let newCount = 0
  for (const p of picks) {
    if (!finishOf.has(p.teamId) && !projected.has(p.teamId)) projected.set(p.teamId, n + ++newCount)
  }
  // Full driver records + this-year WDC standing, so a free agent's row can show an expanded hover card.
  const driverById = new Map<string, Driver>()
  for (const d of pending?.drivers ?? []) driverById.set(d.id, d)
  for (const d of drivers) driverById.set(d.id, d) // this-season record wins, matching the WDC year
  const wdcPosOf = new Map(driverStandings.map((s, i) => [s.driverId, i + 1]))
  const wdcPtsOf = new Map(driverStandings.map((s) => [s.driverId, s.points]))

  const wccBadge = (teamId: string): { pos: number; tip: string } => {
    const pos = finishOf.get(teamId)
    if (pos) return { pos, tip: `${ordinal(pos)} in the ${year} constructors' championship` }
    const proj = projected.get(teamId) ?? n + 1
    return { pos: proj, tip: `Projected to finish ${ordinal(proj)} in ${year + 1}` }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Controls (fixed) */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          onClick={() => setRevealed(Math.min(total, revealed + 1))}
          disabled={complete}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reveal next signing
        </button>
        <button
          onClick={() => setRevealed(total)}
          disabled={complete}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reveal all
        </button>
        <span className="ml-auto text-xs text-[#FFFFFF] tabular-nums">{revealed} / {total} seats filled</span>
      </div>

      {/* Main area (flex-1): the seats board and the contenders each scroll inside their own column. */}
      <div className={`flex-1 min-h-0 grid gap-4 ${onClock ? 'lg:grid-cols-[3fr_2fr]' : 'grid-cols-1'}`}>
        <div className="flex flex-col min-h-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5 shrink-0">Open seats</p>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#2A3142]/50 rounded-lg bg-[#0F1419]/40">
            {picks.map((p, i) => {
              const isRevealed = i < revealed
              const isOnClock = i === revealed
              const w = wccBadge(p.teamId)
              const d = driverById.get(p.driverId)
              const nameLink = <DriverLink id={p.driverId} className="text-sm font-semibold text-[#FFFFFF]">{p.driverName}</DriverLink>
              const nameEl = d
                ? <DriverTooltip driver={d} year={year} wdcPosition={wdcPosOf.get(p.driverId) ?? null} wdcPoints={wdcPtsOf.get(p.driverId)} career={careers[p.driverId]} side="right"><span className="truncate shrink-0">{nameLink}</span></DriverTooltip>
                : <span className="truncate shrink-0">{nameLink}</span>
              return (
                <div
                  key={`${p.teamId}-${i}`}
                  className={`flex items-center gap-2.5 px-3 py-2 ${isOnClock ? 'bg-[#00D9FF]/10 ring-1 ring-inset ring-[#00D9FF]/40' : ''}`}
                >
                  <Tooltip content={w.tip}>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2A3142] text-[10px] font-bold tabular-nums text-[#FFFFFF] cursor-default">{w.pos}</span>
                  </Tooltip>
                  <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: p.teamColor }} />
                  <TeamLink id={p.teamId} className="text-xs font-semibold text-[#FFFFFF] truncate w-24 shrink-0">{p.teamName}</TeamLink>
                  {isRevealed ? (
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      {nameEl}
                      <Tag flavour={p.flavour} />
                      <Tooltip content={`${faLabel(p.faRank)} free agent of ${year}`}>
                        <span className="text-[9px] font-bold uppercase tracking-wide rounded px-1 py-0.5 shrink-0 bg-[#2A3142] text-[#FFFFFF] cursor-default">{faLabel(p.faRank)}</span>
                      </Tooltip>
                      {fromLabel(p) && <span className="text-[10px] text-[#FFFFFF] truncate hidden sm:inline">{fromLabel(p)}</span>}
                      <span className="ml-auto shrink-0 tabular-nums text-xs text-[#FFFFFF]">{p.years}yr</span>
                    </span>
                  ) : isOnClock ? (
                    <span className="text-xs italic text-[#00D9FF] flex-1">Up next…</span>
                  ) : (
                    <span className="text-xs text-[#FFFFFF] flex-1">Seat open</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Contenders for the seat about to be filled (hidden once every seat is settled) */}
        {onClock && (
          <div className="flex flex-col min-h-0">
            <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5 shrink-0">Free agents</p>
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#2A3142]/50 rounded-lg bg-[#0F1419]/40">
              {onClock.odds.map((o, i) => {
                const d = driverById.get(o.driverId)
                const row = (
                  <div className="flex items-center gap-2.5 px-3 py-1.5">
                    <span className="w-5 text-xs font-bold tabular-nums text-[#FFFFFF] shrink-0">{i + 1}</span>
                    <DriverLink id={o.driverId} className="text-sm text-[#FFFFFF] truncate flex-1">{o.driverName}</DriverLink>
                    {i === 0 && <span className="text-[9px] font-bold uppercase tracking-wide text-[#00D9FF] shrink-0">Favourite</span>}
                  </div>
                )
                return d
                  ? <DriverTooltip key={o.driverId} driver={d} year={year} wdcPosition={wdcPosOf.get(o.driverId) ?? null} wdcPoints={wdcPtsOf.get(o.driverId)} career={careers[o.driverId]}>{row}</DriverTooltip>
                  : <div key={o.driverId}>{row}</div>
              })}
            </div>
          </div>
        )}
      </div>

      {/* Released: free agents who found no seat. Shown only once the board clears, so it's no spoiler. */}
      {complete && dropped.length > 0 && (
        <div className="shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Released <span className="text-[#DC143C]">· {dropped.length}</span></p>
          <div className="max-h-20 overflow-y-auto flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-[#0F1419]/40 px-3 py-2">
            {dropped.map((d) => (
              <span key={d.driverId} className="text-xs text-[#FFFFFF]">
                <DriverLink id={d.driverId} className="text-[#FFFFFF]">{d.driverName}</DriverLink>
                <span className="text-[#FFFFFF]"> ({d.fromTeamName})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Analyst reaction to the confirmed signings, in its own bounded scroll band. */}
      {posts.length > 0 && (
        <div className="shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Paddock reaction</p>
          <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
            {posts.map((post) => (
              <div key={post.id} className="flex gap-2.5 rounded-lg bg-[#0F1419]/40 px-3 py-2">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[#0F1419]"
                  style={{ backgroundColor: accentFor(post.handle) }}
                >
                  {post.name.charAt(0)}
                </span>
                <div className="min-w-0">
                  <p className="text-xs">
                    <span className="font-semibold text-[#FFFFFF]">{post.name}</span>{' '}
                    <span className="text-[#FFFFFF]">{post.handle}</span>
                  </p>
                  <p className="text-sm text-[#FFFFFF]">{post.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
