'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactCountryFlag from 'react-country-flag'
import type { Driver, Team, RaceState, Circuit, QualifyingLap } from '@/lib/sim/types'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'

// Qualifying speed levels map to real-time multipliers (1x / 2x / 4x / 8x); cars start STAGGER seconds
// apart (between launches, not finishes), each running two laps. We pre-computed the deterministic result
// in runQualifying — this panel just animates the reveal on a sim clock.
const SPEED_MULT: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8 }
const STAGGER = 10

function formatQualTime(t: number | null): string {
  if (t === null) return '--'
  const mins = Math.floor(t / 60)
  const secs = (t % 60).toFixed(3).padStart(6, '0')
  return `${mins}:${secs}`
}

// Stable arbitrary key for round-1 ordering and intra-tier (teammate) tie-breaks.
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

type Evt = { t: number; carId: string; lapTime: number }

interface Props {
  raceState: RaceState
  drivers: Driver[]
  teams: Team[]
  currentCircuit: Circuit | undefined
}

export function QualifyingPanel({ raceState, drivers, teams, currentCircuit }: Props) {
  const finishQualifying = useRaceStore((s) => s.finishQualifying)
  const setPaused = useRaceStore((s) => s.setPaused)
  const constructorStandings = useSeasonStore((s) => s.constructorStandings)
  const currentRound = useSeasonStore((s) => s.currentRound)

  const sessions = raceState.qualifyingSessions
  const { paused, speed, circuitId } = raceState

  const [sessionIdx, setSessionIdx] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const [showElim, setShowElim] = useState(false)

  const clockRef = useRef(0)
  const processedRef = useRef(0)
  const speedRef = useRef(speed)
  useEffect(() => { speedRef.current = speed }, [speed])

  const driverMap = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers])
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams])
  const rank = useMemo(() => new Map(constructorStandings.map((c, i) => [c.teamId, i])), [constructorStandings])

  const session = sessions[sessionIdx]
  const sessionName = session?.session ?? 'Q1'
  const cutSize = session?.eliminated.length ?? 0

  // Run order: round 1 is arbitrary; from round 2, by constructors' standings — Q1/Q2 send the top
  // constructors out first (drama at the bottom), Q3 sends the slowest of the ten first (drama at the top).
  const ordered = useMemo<QualifyingLap[]>(() => {
    if (!session) return []
    const r1 = currentRound <= 1
    const meta = session.results.map((l) => {
      const teamId = driverMap.get(l.driverId)?.teamId ?? ''
      const cr = rank.has(teamId) ? rank.get(teamId)! : 999
      return { l, cr, tie: hash(l.driverId + circuitId) }
    })
    meta.sort((a, b) => {
      if (r1) return a.tie - b.tie
      if (a.cr !== b.cr) return sessionName === 'Q3' ? b.cr - a.cr : a.cr - b.cr
      return a.tie - b.tie
    })
    return meta.map((m) => m.l)
  }, [session, sessionName, driverMap, rank, currentRound, circuitId])

  // Each car: lap 1 completes at start+lap1, lap 2 at start+lap1+lap2. Flatten to a time-sorted event list.
  const events = useMemo<Evt[]>(() => {
    const evts: Evt[] = []
    ordered.forEach((l, k) => {
      const start = k * STAGGER
      const lap1 = l.lap1 ?? l.best ?? 0
      const lap2 = l.lap2 ?? l.best ?? 0
      evts.push({ t: start + lap1, carId: l.driverId, lapTime: lap1 })
      evts.push({ t: start + lap1 + lap2, carId: l.driverId, lapTime: lap2 })
    })
    return evts.sort((a, b) => a.t - b.t)
  }, [ordered])

  // Playback clock: advance by real-time × speed while running; reveal each lap as the clock passes it.
  useEffect(() => {
    if (paused || showElim || events.length === 0) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      clockRef.current += ((now - last) / 1000) * (SPEED_MULT[speedRef.current] ?? 1)
      last = now
      let p = processedRef.current
      while (p < events.length && events[p].t <= clockRef.current) p++
      if (p !== processedRef.current) { processedRef.current = p; setRevealed(p) }
      if (p >= events.length) {
        setPaused(true)
        if (sessionIdx < sessions.length - 1) setShowElim(true)
        else finishQualifying()
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [paused, showElim, events, sessionIdx, sessions.length, setPaused, finishQualifying])

  const closeElim = () => {
    setShowElim(false)
    clockRef.current = 0
    processedRef.current = 0
    setRevealed(0)
    setSessionIdx((i) => i + 1) // stays paused; the player resumes to run the next session
  }

  // Live board from revealed laps: each car's best so far, fastest on top, untimed cars last in run order.
  const best = new Map<string, number>()
  for (let i = 0; i < revealed; i++) { const e = events[i]; const c = best.get(e.carId); if (c === undefined || e.lapTime < c) best.set(e.carId, e.lapTime) }
  const rows = ordered.map((l, runIdx) => ({ driverId: l.driverId, time: best.get(l.driverId) ?? null, runIdx }))
  rows.sort((a, b) => {
    if (a.time === null && b.time === null) return a.runIdx - b.runIdx
    if (a.time === null) return 1
    if (b.time === null) return -1
    return a.time - b.time
  })
  const leaderTime = rows.find((r) => r.time !== null)?.time ?? null
  const progress = events.length ? (revealed / events.length) * 100 : 0
  const dropFrom = rows.length - cutSize

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-[#2A3142]">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg tracking-widest uppercase text-[#FFFFFF]">
            {sessionName} — {currentCircuit?.name}
          </h2>
          <span className="text-xs tracking-widest uppercase text-[#FFFFFF]">
            {cutSize > 0 ? `${cutSize} eliminated` : 'Top 10 shootout'}
          </span>
        </div>
        <div className="h-1 w-full bg-[#2A3142] rounded-full overflow-hidden">
          <div className="h-full bg-[#00D9FF] transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[#FFFFFF] text-xs font-bold tracking-widest uppercase border-b border-[#2A3142]">
              <th className="text-left py-1 px-2 w-10">Pos</th>
              <th className="text-left py-1 px-2">Driver</th>
              <th className="text-left py-1 px-2">Team</th>
              <th className="text-right py-1 px-2">{sessionName}</th>
              <th className="text-right py-1 px-2 w-24">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const driver = driverMap.get(row.driverId)
              const team = driver ? teamMap.get(driver.teamId) : undefined
              const inDrop = cutSize > 0 && idx >= dropFrom
              const gap = row.time !== null && leaderTime !== null && row.time > leaderTime ? row.time - leaderTime : null
              return (
                <tr key={row.driverId} className={`border-b border-[#1E2431] text-[#FFFFFF] ${inDrop ? 'bg-[#3D141B]' : ''}`}>
                  <td className="py-1 px-2 font-bold">{idx + 1}</td>
                  <td className="py-1 px-2">
                    <div className="flex items-center gap-2.5">
                      {team && <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />}
                      <ReactCountryFlag countryCode={driver?.nationality || 'GB'} svg style={{ width: '1.1em', height: '1.1em', borderRadius: '2px', flexShrink: 0 }} />
                      <span>{driver?.name ?? row.driverId}</span>
                    </div>
                  </td>
                  <td className="py-1 px-2 text-sm text-[#FFFFFF]">{team?.name ?? '---'}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm font-bold">{formatQualTime(row.time)}</td>
                  <td className="py-1 px-2 text-right font-mono text-sm text-[#FFFFFF]">{gap !== null ? `+${gap.toFixed(3)}` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showElim && session && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-sm tracking-widest uppercase text-[#FFFFFF] mb-3">{sessionName} — Eliminated</h3>
            <ul className="mb-6 space-y-1.5">
              {session.eliminated.map((id) => {
                const d = driverMap.get(id)
                const t = teamMap.get(d?.teamId ?? '')
                return (
                  <li key={id} className="flex items-center gap-2.5 text-[#FFFFFF] text-sm">
                    {t && <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: t.color }} />}
                    <span>{d?.name ?? id}</span>
                  </li>
                )
              })}
            </ul>
            <button
              onClick={closeElim}
              className="w-full py-3 bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419] text-sm font-black tracking-widest uppercase rounded transition-colors cursor-pointer"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
