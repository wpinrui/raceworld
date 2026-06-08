'use client'

import { useEffect, useMemo, useState } from 'react'
import ReactCountryFlag from 'react-country-flag'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate, fromISODate, addDays, formatDate } from '@/lib/sim/calendar-dates'

const PAST_DAYS = 2
const FUTURE_DAYS = 7

// FM-style calendar that fades in while the Continue loop advances the clock one day at a time. It shows
// the dates rolling past and the important events on them (race weekends). Pointer-transparent so it never
// blocks the page behind it; only mounted while advancing.
// Mounted by the parent only while advancing, so each Continue gets a fresh fade-in.
export function SimCalendar() {
  const year = useSeasonStore((s) => s.year)
  const currentDate = useSeasonStore((s) => s.currentDate)
  const [shown, setShown] = useState(false)

  // Fade/slide in one tick after mount.
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10)
    return () => clearTimeout(t)
  }, [])

  // Scheduled race weekends keyed by ISO race date (known in advance, so future days can show them).
  const raceByDate = useMemo(() => {
    const m = new Map<string, { name: string; country: string }>()
    for (const c of calendarForYear(year)) m.set(toISODate(raceDate(year, c)), { name: c.name, country: c.country })
    return m
  }, [year])

  if (!currentDate) return null
  const base = fromISODate(currentDate)
  const days = Array.from({ length: PAST_DAYS + 1 + FUTURE_DAYS }, (_, i) => {
    const d = addDays(base, i - PAST_DAYS)
    const iso = toISODate(d)
    return { iso, d, today: iso === currentDate, past: iso < currentDate, race: raceByDate.get(iso) }
  })

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-20 pointer-events-none">
      <div
        className={`w-full max-w-5xl rounded-xl border border-[#2A3142] bg-[#0F1419]/95 p-3 shadow-2xl backdrop-blur-sm transition-all duration-300 ease-out ${
          shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="h-3 w-1 rounded-sm bg-[#DC143C]" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#FFFFFF]">{year} Season</span>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest tabular-nums text-[#00D9FF]">{formatDate(base, { weekday: true, year: true })}</span>
        </div>
        <div className="flex gap-1.5">
          {days.map((day) => (
            <div
              key={day.iso}
              className={`flex-1 min-w-0 rounded-lg border px-2 py-2 transition-colors duration-200 ${
                day.today ? 'border-[#00D9FF] bg-[#00D9FF]/10' : day.past ? 'border-[#2A3142] bg-[#1E2431] opacity-40' : 'border-[#2A3142] bg-[#1E2431]'
              }`}
            >
              <div className={`text-[10px] font-bold uppercase tracking-wider tabular-nums ${day.today ? 'text-[#00D9FF]' : 'text-[#FFFFFF]'}`}>
                {formatDate(day.d, { weekday: true })}
              </div>
              {day.race ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <ReactCountryFlag countryCode={day.race.country} svg style={{ width: '0.9em', height: '0.9em', borderRadius: '2px', flexShrink: 0 }} />
                  <span className="truncate text-[10px] font-semibold text-[#FFFFFF]">{day.race.name}</span>
                </div>
              ) : (
                <div className="mt-1.5 h-3.5" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
