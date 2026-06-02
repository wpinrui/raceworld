'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import ReactCountryFlag from 'react-country-flag'
import { ChevronRight } from 'lucide-react'
import { Panel } from '@/components/world/ui'
import { calendar2026 } from '@/data/calendar'
import { useSeasonStore } from '@/lib/store/season-store'

const PODIUM = ['#D4AC00', '#9E9E9E', '#C0622B'] // gold / silver / bronze

function lastName(name: string): string {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

interface Props {
  simming: boolean
  onSimTo: (round: number) => void
}

// Full-season calendar strip: completed races show their podium and link to the full
// classification; the current race links into the weekend; any future race can be
// fast-simulated up to (so you land pre-race there) without leaving the home screen.
export function RaceBanner({ simming, onSimTo }: Props) {
  const currentRound = useSeasonStore((s) => s.currentRound)
  const year = useSeasonStore((s) => s.year)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const teams = useSeasonStore((s) => s.teams)
  const teamColor = (teamId: string) => teams.find((t) => t.id === teamId)?.color ?? '#6B7280'

  // Mouse wheel over the calendar scrolls it horizontally instead of the whole page,
  // easing toward the target so it glides rather than jumping.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let target = el.scrollLeft
    let raf = 0
    const tick = () => {
      const diff = target - el.scrollLeft
      if (Math.abs(diff) < 0.5) { el.scrollLeft = target; raf = 0; return }
      el.scrollLeft += diff * 0.18
      raf = requestAnimationFrame(tick)
    }
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return // nothing to scroll — let the page move
      e.preventDefault()
      const max = el.scrollWidth - el.clientWidth
      target = Math.max(0, Math.min(max, target + e.deltaY + e.deltaX))
      if (!raf) raf = requestAnimationFrame(tick)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel); if (raf) cancelAnimationFrame(raf) }
  }, [])

  return (
    <Panel title="Calendar" flush>
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto px-5 py-4">
        {calendar2026.map((c, idx) => {
          const round = idx + 1
          const completed = round < currentRound
          const current = round === currentRound
          const flag = (
            <ReactCountryFlag countryCode={c.country} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
          )
          const head = (
            <div className="flex items-center gap-1.5">
              {flag}
              <span className="text-[10px] font-bold tabular-nums uppercase tracking-widest text-[#FFFFFF]">R{round}</span>
              {current && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#00D9FF]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#00D9FF]" />NOW
                </span>
              )}
            </div>
          )
          const title = (
            <>
              <span className="truncate text-xs font-semibold text-[#FFFFFF]">{c.name}</span>
              <span className="truncate text-[10px] uppercase tracking-wide text-[#FFFFFF]">{c.location}</span>
            </>
          )

          // Completed — show podium, link to classification.
          if (completed) {
            const podium = (raceResults[round - 1] ?? [])
              .filter((r) => !r.dnf && r.finishPosition != null && r.finishPosition <= 3)
              .sort((a, b) => (a.finishPosition ?? 9) - (b.finishPosition ?? 9))
              .slice(0, 3)
            return (
              <Link
                key={round}
                href={`/world/season/${year}/${round}`}
                className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-[#2A3142] bg-[#0F1419] px-3 py-2.5 transition-colors hover:border-[#00D9FF]"
              >
                {head}
                {title}
                <div className="mt-1 flex flex-col gap-0.5">
                  {podium.length === 0 && <span className="text-[10px] text-[#6B7280]">—</span>}
                  {podium.map((r) => (
                    <span key={r.driverId} className="flex items-center gap-1.5 text-[11px] text-[#FFFFFF]">
                      <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: PODIUM[(r.finishPosition ?? 1) - 1] }} />
                      <span className="inline-block w-1 h-3 rounded-sm shrink-0" style={{ backgroundColor: teamColor(r.teamId) }} />
                      <span className="truncate">{lastName(r.driverName)}</span>
                    </span>
                  ))}
                </div>
              </Link>
            )
          }

          // Current — link into the race weekend.
          if (current) {
            return (
              <Link
                key={round}
                href="/race"
                className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-[#00D9FF] bg-[#00D9FF]/10 px-3 py-2.5 transition-colors hover:bg-[#00D9FF]/20"
              >
                {head}
                {title}
                <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-widest text-[#00D9FF]">
                  Race weekend <ChevronRight size={11} />
                </span>
              </Link>
            )
          }

          // Upcoming — fast-simulate up to this race.
          return (
            <div
              key={round}
              className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-[#2A3142] bg-[#1E2431] px-3 py-2.5"
            >
              {head}
              {title}
              <button
                disabled={simming}
                onClick={() => onSimTo(round)}
                className="mt-1 inline-flex items-center justify-center gap-1 rounded bg-[#2A3142] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#FFFFFF] transition-colors hover:bg-[#303848] disabled:opacity-40"
              >
                {simming ? 'Simulating…' : 'Sim to here'}
              </button>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
