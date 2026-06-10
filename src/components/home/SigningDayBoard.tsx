'use client'

import { useEffect, useState } from 'react'
import type { DraftPick, DraftSeat } from '@/lib/sim/driver-market'
import type { Driver, DroppedDriver } from '@/lib/sim/types'
import { useSeasonStore, type PendingPlayerDraft } from '@/lib/store/season-store'
import { signingDayReactions } from '@/lib/news/signing-day-reactions'
import { foldLiveSeason, type DriverCareer } from '@/lib/news/engine'
import { actionGetDriverCareers } from '@/lib/news/actions'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'
import { DriverTooltip } from '@/components/world/DriverTooltip'
import { NationalityFlag } from '@/components/world/NationalityFlag'
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

// The old team (their last-season team), shown only when it adds something: a switch or a re-signing.
// Empty for rookies (the badge says so) and drivers with no last-season team (their tag covers it).
function fromLabel(p: DraftPick, former: string | undefined): string {
  if (p.flavour === 'rookie' || !former) return ''
  if (former === p.teamName) return 're-signs'
  return `from ${former}`
}

// A free agent's origin in the contenders list, always a badge: their last team, "Rookie" (never
// raced), or "Comeback" (raced before, no seat last season).
function SourceTag({ src }: { src: { team?: string; rookie?: boolean } }) {
  const base = 'text-[9px] font-bold uppercase tracking-wide rounded px-1 py-0.5 shrink-0'
  if (src.team) return <span className={`${base} bg-[#2A3142] text-[#FFFFFF]`}>{src.team}</span>
  if (src.rookie) return <span className={`${base} bg-[#10B981] text-[#0F1419]`}>Rookie</span>
  return <span className={`${base} bg-[#F59E0B] text-[#0F1419]`}>Comeback</span>
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

// Team Manager: while the off-season draft is paused for the player, their interactive pick is laid over
// the SAME signing-day board — no second screen. Synthesize the full rank-ordered picks list: rivals
// ABOVE already signed, the player's seat(s) as their confirmed pick or an empty placeholder, rivals
// BELOW as placeholders (they draft from what's left once the player confirms). The board reveals up to
// (above + filled), so the player's next open seat is the one "on the clock" and the free-agent column
// turns clickable for it.
function buildPlayerDraftPicks(pd: PendingPlayerDraft): DraftPick[] {
  const ph = (seat: DraftSeat): DraftPick => ({
    teamId: seat.teamId, teamName: seat.teamName, teamColor: seat.teamColor,
    driverId: '', driverName: '', prevTeamName: '', faRank: 0, seatRank: 0,
    pickPct: 0, realizedProb: 0, years: 0, flavour: 'chalk', odds: [],
  })
  const mine = (pp: PendingPlayerDraft['playerPicks'][number], seat: DraftSeat): DraftPick => ({
    teamId: seat.teamId, teamName: seat.teamName, teamColor: seat.teamColor,
    driverId: pp.driverId, driverName: pp.driverName, prevTeamName: '',
    faRank: pd.faRankOf[pp.driverId] ?? 0, seatRank: 0, pickPct: 50, realizedProb: 0.5,
    years: pp.years, flavour: 'chalk', odds: [],
  })
  return [
    ...pd.picksAbove,
    ...pd.playerSeats.map((seat, i) => (pd.playerPicks[i] ? mine(pd.playerPicks[i], seat) : ph(seat))),
    ...pd.belowSeats.map((seat) => ph(seat)),
  ]
}

export function SigningDayBoard({ picks: seasonPicks, year, dropped = [] }: { picks: DraftPick[]; year: number; dropped?: DroppedDriver[] }) {
  const stored = useSeasonStore((s) => s.signingDayRevealed)
  const setRevealed = useSeasonStore((s) => s.setSigningDayRevealed)
  const standings = useSeasonStore((s) => s.constructorStandings)
  const drivers = useSeasonStore((s) => s.drivers)
  const pending = useSeasonStore((s) => s.pendingNextSeasonState)
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const eos = useSeasonStore((s) => s.endOfSeasonSummary)
  // Team Manager: when the off-season draft is paused for the player to fill their own seat(s).
  const playerDraft = useSeasonStore((s) => s.pendingPlayerDraft)

  // Team Manager: the contract length you're offering the next free agent you sign (your call, 1-4 years).
  const [offerYears, setOfferYears] = useState(1)
  // Career totals (archived base + the season just run), for the free-agent hover cards.
  const [careers, setCareers] = useState<Record<string, DriverCareer>>({})
  useEffect(() => {
    actionGetDriverCareers(year - 1)
      .then((base) => setCareers(foldLiveSeason(base, year, raceResults, eos?.driverChampion)))
      .catch(() => setCareers({}))
  }, [year, raceResults, eos])

  // Team Manager: fold the player's interactive pick INTO this one board (rivals above signed, your seat
  // on the clock with a clickable pool, rivals below pending). Otherwise it's just the resolved draft.
  const draftMode = playerDraft != null
  const picks: DraftPick[] = playerDraft ? buildPlayerDraftPicks(playerDraft) : seasonPicks

  if (picks.length === 0) {
    return (
      <div className="flex h-full flex-col gap-3">
        <p className="text-sm text-[#FFFFFF]">Every seat was settled in-season. There was no free-agency activity this year.</p>
      </div>
    )
  }

  const total = picks.length
  // Draft mode: the player reveals the rivals ABOVE their seat one at a time (manual reveal, capped at the
  // above count), then it's their turn. revealed = (rivals above revealed so far) + (own seats filled).
  const aboveCount = playerDraft ? playerDraft.picksAbove.length : 0
  const revealed = playerDraft ? Math.min(stored, aboveCount) + playerDraft.playerPicks.length : Math.min(stored, total)
  const playerTurn = playerDraft != null && stored >= aboveCount // every rival above is revealed -> you pick
  const onClock = revealed < total ? picks[revealed] : null
  const complete = !draftMode && !onClock
  // The pool you're choosing from once it's your turn.
  const playerPool = playerDraft ? playerDraft.pool.filter((d) => !playerDraft.rejected.includes(d.id)) : []
  // This-season drivers win over next-season copies (correct age/form at signing time); next-season
  // entries cover any promoted rookie not on the current grid.
  const reactionDrivers = [...(pending?.drivers ?? []), ...drivers]
  const posts = draftMode ? [] : signingDayReactions(picks, reactionDrivers).filter((p) => p.pickIndex < revealed).sort((a, b) => b.pickIndex - a.pickIndex)

  // Free-agent rank is fixed for the window: the first seat's contender list is the full pool in ranked
  // order, so each driver keeps their original rank on the board even after higher names sign off the list.
  const faRankOf = new Map((picks[0]?.odds ?? []).map((o, i) => [o.driverId, i + 1]))

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
  // Where a driver comes from, from reliable sources (the just-ended classification + career totals),
  // not the draft pool's teamId (which is blank for an expiring driver). Last team / Rookie / Comeback.
  const formerTeamOf = new Map(driverStandings.map((s) => [s.driverId, s.teamName]))
  const sourceOf = (id: string): { team?: string; rookie?: boolean; comeback?: boolean } => {
    const team = formerTeamOf.get(id)
    if (team) return { team }
    return (careers[id]?.starts ?? 0) > 0 ? { comeback: true } : { rookie: true }
  }

  const wccBadge = (teamId: string): { pos: number; tip: string } => {
    const pos = finishOf.get(teamId)
    if (pos) return { pos, tip: `${ordinal(pos)} in the ${year} constructors' championship` }
    const proj = projected.get(teamId) ?? n + 1
    return { pos: proj, tip: `Projected to finish ${ordinal(proj)} in ${year + 1}` }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Controls (fixed): reveal signings one at a time, up to your seat. Hidden once it's your pick. */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {!playerTurn && (
          <>
            <button
              onClick={() => setRevealed(playerDraft ? Math.min(aboveCount, stored + 1) : Math.min(total, revealed + 1))}
              disabled={!playerDraft && complete}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Reveal next signing
            </button>
            <button
              onClick={() => setRevealed(playerDraft ? aboveCount : total)}
              disabled={!playerDraft && complete}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Reveal all
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-[#FFFFFF] tabular-nums">{revealed} / {total} seats filled</span>
      </div>

      {/* Main area (flex-1): the seats board and the free agents each scroll inside their own column. */}
      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[3fr_2fr]">
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
              const fromText = fromLabel(p, formerTeamOf.get(p.driverId))
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
                      {fromText && <span className="text-[10px] text-[#FFFFFF] truncate hidden sm:inline">{fromText}</span>}
                      <span className="ml-auto shrink-0 tabular-nums text-xs text-[#FFFFFF]">{p.years}yr</span>
                    </span>
                  ) : isOnClock ? (
                    <span className="text-xs italic text-[#00D9FF] flex-1">{playerTurn ? 'Your pick' : 'Up next…'}</span>
                  ) : (
                    <span className="text-xs text-[#FFFFFF] flex-1">Seat open</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Free agents: the contenders for the seat on the clock while signing, then whoever went
            unsigned once every seat is settled. Always visible, so it's clear who missed out. */}
        <div className="flex flex-col min-h-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5 shrink-0">
            Free agents{playerDraft && playerDraft.rejected.length > 0 ? <> · <span className="text-[#DC143C]">{playerDraft.rejected.length} turned you down</span></> : complete && dropped.length > 0 ? <> · <span className="text-[#DC143C]">{dropped.length} unsigned</span></> : ''}
          </p>
          {playerTurn && playerPool.length > 0 && (
            <div className="flex items-center gap-2 mb-1.5 shrink-0">
              <span className="text-[10px] uppercase tracking-wide text-[#FFFFFF]">Offer length</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((y) => (
                  <button
                    key={y}
                    onClick={() => setOfferYears(y)}
                    className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${offerYears === y ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'}`}
                  >
                    {y}yr
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#2A3142]/50 rounded-lg bg-[#0F1419]/40">
            {playerTurn
              ? playerPool.length > 0
                ? playerPool.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => useSeasonStore.getState().playerDraftSign(d.id, offerYears)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#00D9FF]/10"
                    >
                      <span className="w-5 text-xs font-bold tabular-nums text-[#FFFFFF] shrink-0">{playerDraft.faRankOf[d.id] ?? ''}</span>
                      <NationalityFlag code={d.nationality} />
                      <DriverTooltip driver={d} year={year} wdcPosition={wdcPosOf.get(d.id) ?? null} wdcPoints={wdcPtsOf.get(d.id)} career={careers[d.id]}>
                        <span className="text-sm text-[#FFFFFF] truncate min-w-0">{d.name}</span>
                      </DriverTooltip>
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 bg-[#00D9FF] text-[#0F1419]">Sign {offerYears}yr</span>
                    </button>
                  ))
                : <button onClick={() => useSeasonStore.getState().finishPlayerDraft()} className="m-3 self-start px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF]">No free agents left, take rookies</button>
              : onClock
              ? onClock.odds.map((o, i) => {
                  const d = driverById.get(o.driverId)
                  const row = (
                    <div className="flex items-center gap-2.5 px-3 py-1.5">
                      <span className="w-5 text-xs font-bold tabular-nums text-[#FFFFFF] shrink-0">{faRankOf.get(o.driverId) ?? i + 1}</span>
                      <DriverLink id={o.driverId} className="text-sm text-[#FFFFFF] truncate flex-1">{o.driverName}</DriverLink>
                      <SourceTag src={sourceOf(o.driverId)} />
                    </div>
                  )
                  return d
                    ? <DriverTooltip key={o.driverId} driver={d} year={year} wdcPosition={wdcPosOf.get(o.driverId) ?? null} wdcPoints={wdcPtsOf.get(o.driverId)} career={careers[o.driverId]}>{row}</DriverTooltip>
                    : <div key={o.driverId}>{row}</div>
                })
              : dropped.length > 0
                ? dropped.map((dd) => {
                    const d = driverById.get(dd.driverId)
                    const row = (
                      <div className="flex items-center gap-2.5 px-3 py-1.5">
                        <DriverLink id={dd.driverId} className="text-sm text-[#FFFFFF] truncate flex-1">{dd.driverName}</DriverLink>
                        <span className="text-[10px] text-[#FFFFFF] shrink-0">{dd.fromTeamName}</span>
                      </div>
                    )
                    return d
                      ? <DriverTooltip key={dd.driverId} driver={d} year={year} wdcPosition={wdcPosOf.get(dd.driverId) ?? null} wdcPoints={wdcPtsOf.get(dd.driverId)} career={careers[dd.driverId]}>{row}</DriverTooltip>
                      : <div key={dd.driverId}>{row}</div>
                  })
                : <p className="px-3 py-2 text-sm text-[#FFFFFF]">Every free agent found a seat.</p>}
          </div>
        </div>
      </div>

      {/* Newsroom reaction (headline + dek) to each confirmed signing, in its own bounded scroll band. */}
      {posts.length > 0 && (
        <div className="shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Paddock reaction</p>
          <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
            {posts.map((post) => (
              <div key={post.id} className="rounded-lg bg-[#0F1419]/40 px-3 py-2">
                <p className="text-sm font-semibold text-[#FFFFFF]">{post.headline}</p>
                <p className="text-xs text-[#FFFFFF] mt-0.5">{post.dek}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
