'use client'

import { useState } from 'react'
import type { DraftPick } from '@/lib/sim/driver-market'
import type { DroppedDriver } from '@/lib/sim/types'
import { signingDaySocialPosts } from '@/lib/news/signing-day-social'
import { DriverLink, TeamLink } from '@/components/world/EntityLink'

// Signing Day: the end-of-season draft, revealed seat by seat (most coveted car first). The left board
// is the open seats; the right is the live odds for whichever seat is on the clock; the foot is the
// analyst social reaction to whatever's been revealed. Pure presentation over the stored draft picks.

const FLAVOUR_TAG: Record<DraftPick['flavour'], { label: string; bg: string; fg: string } | null> = {
  upset: { label: 'Upset', bg: '#DC143C', fg: '#FFFFFF' },
  statement: { label: 'Statement', bg: '#00D9FF', fg: '#0F1419' },
  rookie: { label: 'Rookie', bg: '#10B981', fg: '#0F1419' },
  veteran_short: { label: '1-Year', bg: '#F59E0B', fg: '#0F1419' },
  chalk: null,
}

// Stable accent per analyst account, so each voice reads consistently down the feed.
const HANDLE_COLOR: Record<string, string> = {}
const ACCENTS = ['#00D9FF', '#10B981', '#F59E0B', '#C084FC', '#FB7185']
function accentFor(handle: string): string {
  if (!HANDLE_COLOR[handle]) {
    const idx = Object.keys(HANDLE_COLOR).length % ACCENTS.length
    HANDLE_COLOR[handle] = ACCENTS[idx]
  }
  return HANDLE_COLOR[handle]
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
  const [revealed, setRevealed] = useState(0)

  if (picks.length === 0) {
    return <p className="text-sm text-[#FFFFFF]">Every seat was settled in-season. There was no Signing Day draft this year.</p>
  }

  const total = picks.length
  const onClock = revealed < total ? picks[revealed] : null
  const complete = revealed >= total
  const posts = [...signingDaySocialPosts(picks)].filter((p) => p.pickIndex < revealed).sort((a, b) => b.pickIndex - a.pickIndex)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRevealed((r) => Math.min(total, r + 1))}
          disabled={revealed >= total}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reveal next pick
        </button>
        <button
          onClick={() => setRevealed(total)}
          disabled={revealed >= total}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reveal all
        </button>
        <span className="ml-auto text-xs text-[#FFFFFF] tabular-nums">{revealed} / {total} seats filled</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* Left: the seats board (most coveted car first) */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Open seats</p>
          <div className="divide-y divide-[#2A3142]/50 rounded-lg bg-[#0F1419]/40">
            {picks.map((p, i) => {
              const isRevealed = i < revealed
              const isOnClock = i === revealed
              return (
                <div
                  key={`${p.teamId}-${i}`}
                  className={`flex items-center gap-2.5 px-3 py-2 ${isOnClock ? 'bg-[#00D9FF]/10 ring-1 ring-inset ring-[#00D9FF]/40 rounded-lg' : ''}`}
                >
                  <span className="w-6 text-xs font-bold tabular-nums text-[#6B7280] shrink-0">#{i + 1}</span>
                  <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: p.teamColor }} />
                  <TeamLink id={p.teamId} className="text-xs font-semibold text-[#FFFFFF] truncate w-24 shrink-0">{p.teamName}</TeamLink>
                  {isRevealed ? (
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <DriverLink id={p.driverId} className="text-sm font-semibold text-[#FFFFFF] truncate">{p.driverName}</DriverLink>
                      <Tag flavour={p.flavour} />
                      <span className="ml-auto flex items-center gap-2 shrink-0 tabular-nums">
                        <span className="text-xs text-[#FFFFFF]">{p.years}yr</span>
                        <span className="text-xs text-[#00D9FF] font-semibold w-10 text-right">{p.pickPct}%</span>
                      </span>
                    </span>
                  ) : isOnClock ? (
                    <span className="text-xs italic text-[#00D9FF] flex-1">On the clock…</span>
                  ) : (
                    <span className="text-xs text-[#6B7280] flex-1">Awaiting pick</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: live odds for the seat on the clock */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">
            {onClock ? <>Odds · <span className="text-[#00D9FF]">{onClock.teamName}</span> seat</> : 'Odds'}
          </p>
          {onClock ? (
            <div className="divide-y divide-[#2A3142]/50 rounded-lg bg-[#0F1419]/40">
              {onClock.odds.map((o, i) => (
                <div key={o.driverId} className="flex items-center gap-2.5 px-3 py-1.5">
                  <span className="w-5 text-xs font-bold tabular-nums text-[#6B7280] shrink-0">{i + 1}</span>
                  <DriverLink id={o.driverId} className="text-sm text-[#FFFFFF] truncate flex-1">{o.driverName}</DriverLink>
                  <span className="text-xs text-[#00D9FF] font-semibold tabular-nums w-10 text-right shrink-0">{o.pct}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#FFFFFF] rounded-lg bg-[#0F1419]/40 px-3 py-3">Every seat is filled. Signing Day {year} is done.</p>
          )}
        </div>
      </div>

      {/* Released: pool drivers who found no seat. Held back until the board clears, so it's no spoiler. */}
      {complete && dropped.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Released <span className="text-[#DC143C]">· {dropped.length}</span></p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-[#0F1419]/40 px-3 py-2">
            {dropped.map((d) => (
              <span key={d.driverId} className="text-xs text-[#FFFFFF]">
                <DriverLink id={d.driverId} className="text-[#FFFFFF]">{d.driverName}</DriverLink>
                <span className="text-[#6B7280]"> ({d.fromTeamName})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Foot: analyst reaction to the revealed picks */}
      {posts.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5">Paddock reaction</p>
          <div className="space-y-2">
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
                    <span className="text-[#6B7280]">{post.handle}</span>
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
