'use client'

import { useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'

// Team Manager: the player's mid-season renewal call for their own expiring drivers. Shown on the home
// page only when the renewal round has surfaced expiring drivers awaiting a decision; once every driver
// is decided the store empties the list and this panel returns null.
//
// `diff` = driver media percentile − team WCC percentile. >0 means the driver is outdriving the seat (a
// flight risk who may decline an offer); <=0 means they're a safe re-sign.
function renewalHint(diff: number): string {
  if (diff > 10) return 'Could do better, may decline'
  if (diff < -10) return 'Lucky to keep the seat'
  return 'Solid fit'
}

export function RenewalDecisionPanel() {
  const pending = useSeasonStore((s) => s.pendingPlayerRenewals)
  // The contract length you're offering each driver (your call, 1-4 years), keyed by driver.
  const [terms, setTerms] = useState<Record<string, number>>({})

  if (pending.length === 0) return null

  const decide = (driverId: string, offer: boolean) =>
    useSeasonStore.getState().decidePlayerRenewal(driverId, offer, terms[driverId] ?? 1)

  return (
    <div className="rounded-xl bg-[#1E2431] border border-[#2A3142] overflow-hidden">
      <p className="px-5 py-2.5 border-b border-[#2A3142] text-[10px] uppercase tracking-widest text-[#FFFFFF]">
        Contract Renewals
      </p>
      <ul>
        {pending.map((p) => (
          <li
            key={p.driverId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 border-b border-[#2A3142] last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[#FFFFFF] truncate">{p.driverName}</span>
              <span className="block text-[11px] text-[#FFFFFF] mt-0.5">{renewalHint(p.diff)}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((y) => (
                  <button
                    key={y}
                    onClick={() => setTerms((t) => ({ ...t, [p.driverId]: y }))}
                    className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums cursor-pointer ${(terms[p.driverId] ?? 1) === y ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF] hover:bg-[#303848]'}`}
                  >
                    {y}yr
                  </button>
                ))}
              </div>
              <button
                onClick={() => decide(p.driverId, true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#00D9FF] text-[#0F1419] hover:bg-[#33E1FF] transition-colors cursor-pointer"
              >
                Offer {terms[p.driverId] ?? 1}yr
              </button>
              <button
                onClick={() => decide(p.driverId, false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-[#DC143C] text-[#FFFFFF] hover:bg-[#E63956] transition-colors cursor-pointer"
              >
                Let expire
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
