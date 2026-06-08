'use client'

import { useEffect, useMemo, useState } from 'react'
import ReactCountryFlag from 'react-country-flag'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate, fromISODate, addDays, formatDate } from '@/lib/sim/calendar-dates'
import type { NewsArticle } from '@/lib/news/engine'

const PAST_DAYS = 2
const FUTURE_DAYS = 4

// FM-style calendar bar. Mounted by the nav only while the Continue loop advances the clock day by day:
// it spans the full width flush under the top bar, dims and blurs the home screen behind it, and shows each
// day's race weekend plus the news headlines that have dropped by the current date (future news stays hidden
// until the clock reaches it).
export function SimCalendar({ open, articles }: { open: boolean; articles: NewsArticle[] }) {
  const year = useSeasonStore((s) => s.year)
  const currentDate = useSeasonStore((s) => s.currentDate)
  const [shown, setShown] = useState(false)

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

  // News bucketed by the ISO day it dropped.
  const newsByDate = useMemo(() => {
    const m = new Map<string, NewsArticle[]>()
    for (const a of articles) {
      if (!a.date) continue
      const list = m.get(a.date)
      if (list) list.push(a)
      else m.set(a.date, [a])
    }
    return m
  }, [articles])

  if (!currentDate) return null
  const visible = open && shown // open flips false during the linger so the bar fades out before unmounting
  const base = fromISODate(currentDate)
  const days = Array.from({ length: PAST_DAYS + 1 + FUTURE_DAYS }, (_, i) => {
    const d = addDays(base, i - PAST_DAYS)
    const iso = toISODate(d)
    const [wd, , mon] = formatDate(d, { weekday: true }).split(' ') // "Wed 22 Nov"
    return {
      iso, num: d.getUTCDate(), wd, mon,
      today: iso === currentDate,
      past: iso < currentDate,
      race: raceByDate.get(iso),
      news: iso <= currentDate ? (newsByDate.get(iso) ?? []) : [],
    }
  })

  return (
    <>
      {/* Dim + blur the home screen behind; absorbs clicks so nothing behind is interactable mid-sim. */}
      <div className={`fixed inset-x-0 top-12 bottom-0 z-30 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      {/* Full-width calendar bar, flush under the nav. */}
      <div
        className={`fixed inset-x-0 top-12 z-40 border-b border-[#2A3142] bg-[#1E2431] shadow-2xl transition-all duration-300 ease-out ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
      >
        {/* Keyed by the day so each new day re-runs the slide-in animation. */}
        <div key={currentDate} className="flex w-full divide-x divide-[#2A3142]" style={{ animation: 'simcal-day-in 280ms ease-out' }}>
          {days.map((day) => (
            <div
              key={day.iso}
              className={`flex-1 min-w-0 min-h-[280px] px-3 py-3 ${day.today ? 'bg-[#00D9FF]/10' : day.past ? 'bg-[#181D27] opacity-60' : ''}`}
            >
              <div className="flex items-baseline gap-1.5 border-b border-[#2A3142] pb-2">
                <span className={`text-lg font-bold tabular-nums ${day.today ? 'text-[#00D9FF]' : 'text-[#FFFFFF]'}`}>{day.num}</span>
                <span className={`text-[11px] font-bold uppercase tracking-widest ${day.today ? 'text-[#00D9FF]' : 'text-[#9CA3AF]'}`}>{day.wd}</span>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-widest text-[#6B7280]">{day.mon}</span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {day.race && (
                  <div className="flex items-center gap-1.5 rounded border border-[#00D9FF]/30 bg-[#00D9FF]/15 px-2 py-1.5">
                    <ReactCountryFlag countryCode={day.race.country} svg style={{ width: '1em', height: '1em', borderRadius: '2px', flexShrink: 0 }} />
                    <span className="truncate text-[11px] font-bold uppercase tracking-wide text-[#00D9FF]">{day.race.name}</span>
                  </div>
                )}
                {day.news.slice(0, 4).map((a) => (
                  <div key={a.id} className="rounded border border-[#2A3142] bg-[#0F1419] px-2 py-1.5">
                    <span className="block truncate text-xs font-semibold leading-snug text-[#FFFFFF]">{a.headline}</span>
                  </div>
                ))}
                {day.news.length > 4 && <span className="block pl-0.5 text-[10px] text-[#6B7280]">+{day.news.length - 4} more</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
