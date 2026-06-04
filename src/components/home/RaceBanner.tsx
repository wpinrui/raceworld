'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
  const currentRound = useSeasonStore((s) => s.currentRound)
  const year = useSeasonStore((s) => s.year)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const teams = useSeasonStore((s) => s.teams)
  const teamColor = (teamId: string) => teams.find((t) => t.id === teamId)?.color ?? '#6B7280'
  // Which race's action modal is open (Go To Race / Simulate). null = closed.
  const [modalRound, setModalRound] = useState<number | null>(null)

  // The calendar scrolls horizontally (mouse wheel) and keeps the current race centred
  // (so simulated results scroll into view as the round advances). Both ease to a target.
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLButtonElement>(null)
  const targetRef = useRef<number | null>(null)
  const rafRef = useRef(0)
  const easeTo = useCallback((left: number) => {
    const el = scrollRef.current
    if (!el) return
    targetRef.current = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, left))
    if (rafRef.current) return
    const tick = () => {
      const el2 = scrollRef.current
      if (!el2 || targetRef.current == null) { rafRef.current = 0; return }
      const diff = targetRef.current - el2.scrollLeft
      if (Math.abs(diff) < 0.5) { el2.scrollLeft = targetRef.current; rafRef.current = 0; return }
      el2.scrollLeft += diff * 0.18
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return // nothing to scroll — let the page move
      e.preventDefault()
      easeTo((targetRef.current ?? el.scrollLeft) + e.deltaY + e.deltaX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [easeTo])

  // On mount (i.e. each time you navigate to Home), jump the calendar so the next race —
  // the current round — is in view, instead of always starting at round 1. One-shot: it
  // won't fight manual scrolling afterwards.
  const didInitialCentre = useRef(false)
  useEffect(() => {
    if (didInitialCentre.current) return
    const el = scrollRef.current
    const cur = currentRef.current
    if (!el || !cur) return
    didInitialCentre.current = true
    const delta = cur.getBoundingClientRect().left + cur.offsetWidth / 2 - (el.getBoundingClientRect().left + el.clientWidth / 2)
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + delta))
  }, [])

  // ONLY while a sim is running, keep the current race centred so results scroll into
  // view as the round advances. Outside a sim we leave the scroll alone so manual
  // scrolling (wheel or scrollbar) isn't fought.
  useEffect(() => {
    if (!simming) return
    const el = scrollRef.current
    const cur = currentRef.current
    if (!el || !cur) return
    const delta = cur.getBoundingClientRect().left + cur.offsetWidth / 2 - (el.getBoundingClientRect().left + el.clientWidth / 2)
    easeTo(el.scrollLeft + delta)
  }, [currentRound, simming, easeTo])

  // When the sim stops, kill any in-flight auto-centre so the scrollbar is free again.
  useEffect(() => {
    if (!simming && rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
  }, [simming])

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

          // Current — open the action modal (Go To Race / Simulate Race).
          if (current) {
            return (
              <button
                key={round}
                ref={currentRef}
                onClick={() => setModalRound(round)}
                className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-[#00D9FF] bg-[#00D9FF]/10 px-3 py-2.5 text-left transition-colors hover:bg-[#00D9FF]/20"
              >
                {head}
                {title}
                <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-widest text-[#00D9FF]">
                  Race weekend <ChevronRight size={11} />
                </span>
              </button>
            )
          }

          // Upcoming — open the action modal (Simulate Until Race).
          return (
            <button
              key={round}
              onClick={() => setModalRound(round)}
              className="flex min-w-[160px] flex-col gap-1.5 rounded-lg border border-[#2A3142] bg-[#1E2431] px-3 py-2.5 text-left transition-colors hover:border-[#00D9FF]"
            >
              {head}
              {title}
            </button>
          )
        })}
      </div>

      {modalRound != null && (() => {
        const c = calendar2026[modalRound - 1]
        const isCurrent = modalRound === currentRound
        const cancel = 'px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] text-xs font-semibold uppercase tracking-wide hover:bg-[#303848] transition-colors'
        const secondary = 'px-4 py-2 rounded-lg bg-[#2A3142] text-[#FFFFFF] text-xs font-semibold uppercase tracking-wide hover:bg-[#303848] disabled:opacity-40 transition-colors'
        const primary = 'px-4 py-2 rounded-lg bg-[#00D9FF] text-[#0F1419] text-xs font-bold uppercase tracking-wide hover:bg-[#009CB8] disabled:opacity-40 transition-colors'
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setModalRound(null)}>
            <div className="bg-[#1E2431] border border-[#2A3142] rounded-xl p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-1 h-5 rounded-sm bg-[#00D9FF]" />
                <h2 className="font-display text-sm tracking-wider uppercase text-[#FFFFFF]">Round {modalRound} · {c?.name}</h2>
              </div>
              <p className="text-sm text-[#FFFFFF] mb-5 ml-3.5">{c?.location}</p>
              <div className="flex justify-end gap-3 flex-wrap">
                <button onClick={() => setModalRound(null)} className={cancel}>Cancel</button>
                {isCurrent ? (
                  <>
                    <button disabled={simming} onClick={() => { onSimTo(modalRound + 1); setModalRound(null) }} className={secondary}>Simulate Race</button>
                    <button onClick={() => router.push('/race')} className={primary}>Go To Race</button>
                  </>
                ) : (
                  <button disabled={simming} onClick={() => { onSimTo(modalRound); setModalRound(null) }} className={primary}>Simulate Until Race</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </Panel>
  )
}
