'use client'

import { useState } from 'react'
import type { TeammateH2H, H2HRecord } from '@/lib/world/types'
import { DriverLink } from '@/components/world/EntityLink'

const SELF = '#00D9FF'
const MATE = '#7C8698'

function pct(a: number, b: number): number {
  return a + b > 0 ? (a / (a + b)) * 100 : 50
}

function Bar({ label, self, mate }: { label: string; self: number; mate: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs text-[#FFFFFF]">{label}</span>
      <div className="flex-1 flex h-6 rounded overflow-hidden bg-[#2A3142] text-xs font-semibold tabular-nums">
        <div className="flex items-center pl-2 min-w-0" style={{ width: `${pct(self, mate)}%`, backgroundColor: SELF }}>
          <span className="text-[#0F1419]">{self}</span>
        </div>
        <div className="flex items-center justify-end pr-2 min-w-0 flex-1" style={{ backgroundColor: MATE }}>
          <span className="text-[#FFFFFF]">{mate}</span>
        </div>
      </div>
    </div>
  )
}

function Record({ rec }: { rec: H2HRecord }) {
  return (
    <div className="space-y-1.5">
      <Bar label="Out-qualified" self={rec.qualSelf} mate={rec.qualMate} />
      <Bar label="Finished ahead" self={rec.raceSelf} mate={rec.raceMate} />
      <Bar label="Points" self={rec.pointsSelf} mate={rec.pointsMate} />
    </div>
  )
}

export function TeammateH2HHistory({ records, driverName }: { records: TeammateH2H[]; driverName: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (records.length === 0) {
    return <p className="px-5 py-4 text-sm text-[#FFFFFF]">No teammate head-to-head yet — it builds once {driverName} has shared a garage for a race.</p>
  }
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: SELF }} />{driverName}</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: MATE }} />Teammate</span>
      </div>
      {records.map((t) => (
        <div key={t.teammateId} className="rounded-xl bg-[#0F1419] border border-[#2A3142] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <DriverLink id={t.teammateId} className="font-display text-base tracking-wide uppercase text-[#FFFFFF]">{t.teammateName}</DriverLink>
            <span className="text-xs text-[#FFFFFF] tabular-nums">{t.races} {t.races === 1 ? 'race' : 'races'} together</span>
          </div>
          <Record rec={t} />
          {t.seasons.length > 1 && (
            <>
              <button onClick={() => toggle(t.teammateId)} className="text-xs font-semibold text-[#00D9FF] hover:underline">
                {open.has(t.teammateId) ? 'Hide' : 'Show'} season-by-season
              </button>
              {open.has(t.teammateId) && (
                <div className="space-y-3 pt-1">
                  {t.seasons.map((s) => (
                    <div key={s.year} className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">{s.year} · {s.teamName}</p>
                      <Record rec={s} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
