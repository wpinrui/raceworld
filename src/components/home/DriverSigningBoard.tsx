'use client'

import { useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { TeamLink } from '@/components/world/EntityLink'

// Driver mode signing day: the SAME draft as everyone else, but paused the moment a seat's roll lands on
// YOU. Seats above are already filled; this team is offering you the seat; seats below are still open. You
// accept, haggle the length (10% rejection per year of difference), or decline and hold out for a later
// (usually worse) seat. Mirrors SigningDayBoard's layout so the two never drift.

const clampYears = (n: number) => Math.max(1, Math.min(5, Math.round(n)))

export function DriverSigningBoard() {
  const pdo = useSeasonStore((s) => s.pendingDriverOffer)
  const respond = useSeasonStore((s) => s.driverOfferRespond)
  const [want, setWant] = useState<number | null>(null)

  if (!pdo) return null
  const { offer, cursor, seats } = pdo
  const filled = cursor.picks // seats decided above you, in order
  const proposeYears = want ?? offer.offeredYears
  const delta = Math.abs(proposeYears - offer.offeredYears)
  const rejectPct = Math.round(Math.min(1, 0.1 * delta) * 100)

  const SEAT_ROW = 'flex items-center gap-2.5 px-3 py-2'
  const PRIMARY = 'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF] disabled:opacity-40 disabled:cursor-not-allowed'
  const GHOST = 'px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-sm text-[#FFFFFF] shrink-0">
        A seat is on the table. Accept it, haggle the length, or hold out for a later one (you keep your place in the pool).
      </p>

      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* Seats: filled above you, your offer on the clock, the rest still open. */}
        <div className="flex flex-col min-h-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5 shrink-0">Open seats</p>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#2A3142]/50 rounded-lg bg-[#0F1419]/40">
            {seats.map((seat, i) => {
              if (i < offer.seatRank) {
                const p = filled[i]
                return (
                  <div key={i} className={SEAT_ROW}>
                    <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: seat.teamColor }} />
                    <TeamLink id={seat.teamId} className="text-xs font-semibold text-[#FFFFFF] truncate w-28 shrink-0">{seat.teamName}</TeamLink>
                    <span className="text-sm font-semibold text-[#FFFFFF] truncate flex-1">{p?.driverName ?? '—'}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-xs text-[#FFFFFF]">{p?.years ?? ''}{p ? 'yr' : ''}</span>
                  </div>
                )
              }
              if (i === offer.seatRank) {
                return (
                  <div key={i} className={`${SEAT_ROW} bg-[#00D9FF]/10 ring-1 ring-inset ring-[#00D9FF]/40`}>
                    <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: seat.teamColor }} />
                    <TeamLink id={seat.teamId} className="text-xs font-semibold text-[#FFFFFF] truncate w-28 shrink-0">{seat.teamName}</TeamLink>
                    <span className="text-sm font-semibold italic text-[#00D9FF] flex-1">Offered to you</span>
                    <span className="ml-auto shrink-0 tabular-nums text-xs text-[#00D9FF]">{offer.offeredYears}yr</span>
                  </div>
                )
              }
              return (
                <div key={i} className={SEAT_ROW}>
                  <span className="h-5 w-1 shrink-0 rounded-sm" style={{ backgroundColor: seat.teamColor }} />
                  <TeamLink id={seat.teamId} className="text-xs font-semibold text-[#FFFFFF] truncate w-28 shrink-0">{seat.teamName}</TeamLink>
                  <span className="text-xs text-[#FFFFFF] flex-1">Seat open</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* The offer + your decision. */}
        <div className="flex flex-col min-h-0">
          <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF] mb-1.5 shrink-0">Your offer</p>
          <div className="rounded-lg bg-[#0F1419]/40 p-4 space-y-3">
            <div>
              <span className="h-5 w-1 inline-block align-middle mr-2 rounded-sm" style={{ backgroundColor: offer.teamColor }} />
              <TeamLink id={offer.teamId} className="text-base font-display tracking-wide text-[#FFFFFF]">{offer.teamName}</TeamLink>
              <p className="text-xs text-[#FFFFFF] mt-1">Offering a <span className="font-semibold text-[#00D9FF]">{offer.offeredYears}-year</span> deal · {offer.pickPct}% they came to you for this seat.</p>
            </div>

            {pdo.modifyRejected ? (
              <div className="space-y-2">
                <p className="text-xs text-[#F59E0B]">They turned down your counter. Take the original {offer.offeredYears}-year deal, or decline the seat.</p>
                <div className="flex gap-2">
                  <button onClick={() => respond('accept')} className={PRIMARY}>Accept {offer.offeredYears}yr</button>
                  <button onClick={() => respond('decline')} className={GHOST}>Decline seat</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-[#FFFFFF]">Length</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((y) => (
                      <button
                        key={y}
                        onClick={() => setWant(y)}
                        className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${proposeYears === y ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'}`}
                      >
                        {y}yr
                      </button>
                    ))}
                  </div>
                </div>
                {delta > 0 && (
                  <p className="text-xs text-[#FFFFFF]">Counter at {proposeYears}yr · <span className={rejectPct >= 30 ? 'text-[#DC143C]' : 'text-[#F59E0B]'}>{rejectPct}% they walk away</span> (then accept the original or decline).</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {delta === 0 ? (
                    <button onClick={() => respond('accept')} className={PRIMARY}>Accept {offer.offeredYears}yr</button>
                  ) : (
                    <button onClick={() => respond({ modifyYears: clampYears(proposeYears) })} className={PRIMARY}>Counter {proposeYears}yr</button>
                  )}
                  <button onClick={() => respond('decline')} className={GHOST}>Decline, hold out</button>
                </div>
              </>
            )}
          </div>
          <p className="text-[10px] text-[#FFFFFF] mt-2">Decline and you stay a free agent for the seats below, then into next year if none land.</p>
        </div>
      </div>
    </div>
  )
}
