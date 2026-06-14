'use client'

import { useEffect, useState } from 'react'
import type { Driver, Gender } from '@/lib/sim/types'
import { CountrySelect } from '@/components/CountrySelect'
import { StatSlider } from './StatSlider'
import { STAT_KEYS, STAT_LABELS } from './stat-utils'
import { CareerArcChart } from './CareerArcChart'

// Driver mode setup: create the driver you'll play as. You enter the grid as a FREE AGENT at the chosen
// entry year (sitting that season out — signing day is its post-season), and optionally reset the grid to
// the real-world roster of that year. Reports the assembled Driver + entry year upward, like TeamManagerSetup.

export type DriverSelection = { driver: Driver; entryYear: number; resetRealWorld: boolean } | null

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function DriverSetup({
  startYear, years, onStartYearChange, maxEntryYear, lastRealYear, onChange, onEntryYearChange,
}: {
  startYear: number               // the year the simulated world begins (history depth)
  years: number[]                 // selectable start years, latest first
  onStartYearChange: (year: number) => void
  maxEntryYear: number
  lastRealYear: number // last year with real-world data; the reset option only applies up to here
  onChange: (sel: DriverSelection) => void
  onEntryYearChange?: (year: number) => void
}) {
  const [name, setName] = useState('')
  const [nationality, setNationality] = useState('')
  const [gender, setGender] = useState<Gender>('male')
  const [photoUrl, setPhotoUrl] = useState('')
  const [age, setAge] = useState(20)
  const [ratings, setRatings] = useState({ pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, consistency: 70 })
  const [peakPotential, setPeakPotential] = useState(82)
  const [primeEnd, setPrimeEnd] = useState(31)
  const [declineRate, setDeclineRate] = useState(1)
  const [narrative, setNarrative] = useState(0)
  const [entryYear, setEntryYear] = useState(startYear)
  const [resetRealWorld, setResetRealWorld] = useState(false)

  // You can't join before the sim starts; if the start year is pushed past the entry year, carry it up.
  const [shownStart, setShownStart] = useState(startYear)
  if (startYear !== shownStart) {
    setShownStart(startYear)
    if (!Number.isFinite(entryYear) || entryYear < startYear) setEntryYear(startYear)
  }
  const canReset = Number.isFinite(entryYear) && entryYear <= lastRealYear

  useEffect(() => { onEntryYearChange?.(entryYear) }, [entryYear, onEntryYearChange])

  // The live preview driver (also what gets reported upward when valid).
  const draft: Driver = {
    id: `driver-player-${slugify(name) || 'you'}`,
    name: name.trim(),
    teamId: '',
    nationality: nationality || 'GB',
    gender,
    ...ratings,
    age,
    peakPotential,
    primeEnd,
    declineRate,
    narrativeModifier: narrative,
    contractExpiresAfterSeason: entryYear - 1, // already a free agent on entry
    seasonsSinceF1Seat: 0,
    ...(photoUrl.trim() ? { photoUrl: photoUrl.trim() } : {}),
  }

  useEffect(() => {
    const y = Math.max(startYear, Math.min(maxEntryYear, entryYear))
    if (name.trim() && nationality && Number.isFinite(entryYear) && Number.isFinite(y)) {
      onChange({ driver: { ...draft, contractExpiresAfterSeason: y - 1 }, entryYear: y, resetRealWorld: resetRealWorld && y <= lastRealYear })
    } else {
      onChange(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, nationality, gender, photoUrl, age, ratings, peakPotential, primeEnd, declineRate, narrative, entryYear, resetRealWorld, startYear, maxEntryYear, lastRealYear])

  const field = 'px-2 py-1.5 rounded bg-[#0F1419] text-[#FFFFFF] text-sm border border-[#303848] focus:border-[#00D9FF] outline-none'
  const lbl = 'text-xs text-[#FFFFFF] block mb-1'

  return (
    <div className="mt-3 rounded-xl bg-[#1E2431] border border-[#2A3142] p-4 grid gap-5 md:grid-cols-2">
      {/* Identity + career inputs */}
      <div className="space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[10rem]">
            <label className={lbl}>Name</label>
            <input type="text" value={name} placeholder="e.g. Alex Quinn" onChange={(e) => setName(e.target.value)} className={`${field} w-full`} />
          </div>
          <div>
            <label className={lbl}>Nationality</label>
            <CountrySelect value={nationality} onChange={setNationality} />
          </div>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={lbl}>Gender</label>
            <div className="flex gap-1.5">
              {(['male', 'female'] as Gender[]).map((g) => (
                <button key={g} onClick={() => setGender(g)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide ${gender === g ? 'bg-[#00D9FF] text-[#0F1419]' : 'bg-[#2A3142] text-[#FFFFFF]'}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className={lbl}>Photo URL (optional)</label>
            <input type="text" value={photoUrl} placeholder="https://…" onChange={(e) => setPhotoUrl(e.target.value)} className={`${field} w-full`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Age on entry</label>
            <input type="number" min={17} max={39} value={age} onChange={(e) => setAge(Math.max(17, Math.min(39, Number(e.target.value))))} className={`${field} w-full`} />
          </div>
          <div>
            <label className={lbl}>Potential</label>
            <input type="number" min={50} max={99} value={peakPotential} onChange={(e) => setPeakPotential(Math.max(50, Math.min(99, Number(e.target.value))))} className={`${field} w-full`} />
          </div>
        </div>

        <div className="space-y-2.5">
          {STAT_KEYS.map((k) => (
            <StatSlider key={k} label={STAT_LABELS[k]} value={ratings[k]} onChange={(v) => setRatings((r) => ({ ...r, [k]: v }))} />
          ))}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#FFFFFF] w-20 shrink-0">Narrative</span>
            <input type="range" min={-20} max={20} value={narrative} onChange={(e) => setNarrative(Number(e.target.value))} className="flex-1 h-1 cursor-pointer" style={{ accentColor: '#A855F7' }} />
            <span className={`text-sm font-semibold w-8 text-right shrink-0 ${narrative > 0 ? 'text-[#10B981]' : narrative < 0 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}`}>{narrative > 0 ? '+' : ''}{narrative}</span>
          </div>
        </div>
      </div>

      {/* Career arc: peak age + longevity sliders over a live projection chart */}
      <div className="space-y-3">
        <CareerArcChart driver={draft} />
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#FFFFFF] w-28 shrink-0">Peak age</span>
          <input type="range" min={25} max={38} value={primeEnd} onChange={(e) => setPrimeEnd(Number(e.target.value))} className="flex-1 h-1 cursor-pointer" style={{ accentColor: '#7C3AED' }} />
          <span className="text-sm font-semibold w-8 text-right shrink-0 text-[#FFFFFF]">{primeEnd}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#FFFFFF] w-28 shrink-0">Longevity</span>
          {/* declineRate: lower = a longer, gentler plateau past the peak. Slider runs high→low so RIGHT = more longevity. */}
          <input type="range" min={0.2} max={1.5} step={0.05} value={1.7 - declineRate} onChange={(e) => setDeclineRate(Math.round((1.7 - Number(e.target.value)) * 100) / 100)} className="flex-1 h-1 cursor-pointer" style={{ accentColor: '#7C3AED' }} />
          <span className="text-sm font-semibold w-10 text-right shrink-0 text-[#FFFFFF]">{declineRate <= 0.5 ? 'long' : declineRate >= 1.2 ? 'short' : 'med'}</span>
        </div>
        {/* Career timeline: when the world starts, when you join it, and whether to rebuild it to that
            year's real roster on entry. */}
        <div className="space-y-2.5 pt-2 border-t border-[#2A3142]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Sim starts</label>
              <select value={startYear} onChange={(e) => onStartYearChange(Number(e.target.value))} className={`${field} w-full`}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Enter grid</label>
              <input type="number" min={startYear} max={maxEntryYear} value={Number.isFinite(entryYear) ? entryYear : ''}
                onChange={(e) => setEntryYear(e.target.value === '' ? NaN : Number(e.target.value))} className={`${field} w-full`} />
            </div>
          </div>
          <label className={`flex items-center gap-2 text-xs text-[#FFFFFF] ${canReset ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
            <input type="checkbox" checked={canReset && resetRealWorld} disabled={!canReset} onChange={(e) => setResetRealWorld(e.target.checked)} className="w-4 h-4 accent-[#00D9FF] cursor-pointer disabled:cursor-not-allowed" />
            Reset to the real-world {Number.isFinite(entryYear) ? entryYear : ''} grid on entry
          </label>
        </div>
      </div>
    </div>
  )
}
