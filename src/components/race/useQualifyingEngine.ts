import { useEffect, useMemo, useRef, useState } from 'react'
import type { Driver, Team, RaceState, QualifyingLap, ConstructorStanding } from '@/lib/sim/types'
import { useRaceStore } from '@/lib/store/race-store'

// Qualifying speed levels are real-time multipliers (1x / 2x / 4x / 8x). Cars launch STAGGER seconds
// apart (between launches, not finishes) and run two laps. The first car of each session blitzes its
// opening "out-lap" in OUTLAP_FAST timeline-seconds so the board does not sit empty at the start.
const SPEED_MULT: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8 }
const STAGGER = 10
// Super-speed the first car's opening out-lap so the board fills fast. Disabled by default — the track
// map should make the opening watchable; flip to true to re-enable.
const SUPERSPEED_OUTLAP = false
const OUTLAP_FAST = 6

type Sectors = [number, number, number]
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export type Seg = { timed: boolean; dur: number } // one lap of the run; timed = a flying (counting) lap
export type CarSchedule = {
  carId: string
  launch: number
  segs: Seg[]       // flying 1, in-lap, out-lap, flying 2
  end: number
}
type SectorEvt = { t: number; carId: string; sector: 1 | 2 | 3; sectorTime: number; lapTime: number | null }
export type BoardRow = { carId: string; best: number | null; sectors: (number | null)[] }

export interface QualifyingEngine {
  active: boolean
  clockRef: React.MutableRefObject<number>
  schedule: CarSchedule[]
  rows: BoardRow[]
  sessionName: string
  cutSize: number
  dropFrom: number
  progress: number
  showElim: boolean
  eliminated: string[]
  closeElim: () => void
}

export function useQualifyingEngine(
  raceState: RaceState | null,
  drivers: Driver[],
  teams: Team[],
  constructorStandings: ConstructorStanding[],
  currentRound: number,
): QualifyingEngine {
  const finishQualifying = useRaceStore((s) => s.finishQualifying)
  const setPaused = useRaceStore((s) => s.setPaused)

  const active = raceState?.phase === 'qualifying'
  const sessions = raceState?.qualifyingSessions ?? []
  const paused = raceState?.paused ?? true
  const speed = raceState?.speed ?? 1
  const circuitId = raceState?.circuitId ?? ''

  const [sessionIdx, setSessionIdx] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const [showElim, setShowElim] = useState(false)

  const clockRef = useRef(0)
  const processedRef = useRef(0)
  const speedRef = useRef(speed)
  useEffect(() => { speedRef.current = speed }, [speed])

  // Reset to Q1 whenever we (re-)enter qualifying, so each race weekend starts clean.
  const wasActive = useRef(false)
  useEffect(() => {
    if (active && !wasActive.current) {
      setSessionIdx(0); setRevealed(0); setShowElim(false)
      clockRef.current = 0; processedRef.current = 0
    }
    wasActive.current = active
  }, [active])

  const driverMap = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers])
  const rank = useMemo(() => new Map(constructorStandings.map((c, i) => [c.teamId, i])), [constructorStandings])

  const session = sessions[sessionIdx]
  const sessionName = session?.session ?? 'Q1'
  const cutSize = session?.eliminated.length ?? 0

  // Run order: round 1 arbitrary; round 2+ by constructors' standings (Q1/Q2 top-first, Q3 worst-first).
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

  // Each run: flying lap 1 (timed) → in-lap → out-lap (both untimed cruise) → flying lap 2 (timed). The
  // cruise laps make the two timed laps non-consecutive and clearly separable on the track map.
  const schedule = useMemo<CarSchedule[]>(() => ordered.map((l, k) => {
    const launch = k * STAGGER
    const lap1 = l.lap1 ?? l.best ?? 90
    const lap2 = l.lap2 ?? l.best ?? 90
    const cruise = lap2 * 0.8
    const fly1 = SUPERSPEED_OUTLAP && k === 0 ? OUTLAP_FAST : lap1
    const segs: Seg[] = [
      { timed: true, dur: fly1 },
      { timed: false, dur: cruise },
      { timed: false, dur: cruise },
      { timed: true, dur: lap2 },
    ]
    return { carId: l.driverId, launch, segs, end: launch + fly1 + 2 * cruise + lap2 }
  }), [ordered])

  // Sector-completion events: real sector times, placed on the (possibly compressed) lap timeline.
  const events = useMemo<SectorEvt[]>(() => {
    const evts: SectorEvt[] = []
    ordered.forEach((l, k) => {
      const sc = schedule[k]
      const lap1 = l.lap1 ?? 90, lap2 = l.lap2 ?? 90
      const s1: Sectors = l.lap1Sectors ?? [lap1 * 0.3, lap1 * 0.4, lap1 * 0.3]
      const s2: Sectors = l.lap2Sectors ?? [lap2 * 0.3, lap2 * 0.4, lap2 * 0.3]
      const push = (laps: Sectors, lapTotal: number, lapStart: number, lapDur: number) => {
        const scale = lapDur / lapTotal
        let cum = 0
        for (let i = 0; i < 3; i++) {
          cum += laps[i]
          evts.push({ t: lapStart + cum * scale, carId: l.driverId, sector: (i + 1) as 1 | 2 | 3, sectorTime: laps[i], lapTime: i === 2 ? lapTotal : null })
        }
      }
      const fly2Start = sc.launch + sc.segs[0].dur + sc.segs[1].dur + sc.segs[2].dur
      push(s1, lap1, sc.launch, sc.segs[0].dur)
      push(s2, lap2, fly2Start, sc.segs[3].dur)
    })
    return evts.sort((a, b) => a.t - b.t)
  }, [ordered, schedule])

  // Playback clock: advance by real-time × speed; super-speed the opening until the first lap is set.
  useEffect(() => {
    if (!active || paused || showElim || events.length === 0) return
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
  }, [active, paused, showElim, events, sessionIdx, sessions.length, setPaused, finishQualifying])

  const closeElim = () => {
    setShowElim(false)
    clockRef.current = 0
    processedRef.current = 0
    setRevealed(0)
    setSessionIdx((i) => i + 1) // stays paused; the player resumes to run the next session
  }

  // Board from revealed events: each car's latest-lap sectors + best completed lap time.
  const rows = useMemo<BoardRow[]>(() => {
    const state = new Map<string, { sectors: (number | null)[]; best: number | null }>()
    for (let i = 0; i < revealed; i++) {
      const e = events[i]
      let st = state.get(e.carId)
      if (!st) { st = { sectors: [null, null, null], best: null }; state.set(e.carId, st) }
      if (e.sector === 1) st.sectors = [e.sectorTime, null, null]
      else st.sectors[e.sector - 1] = e.sectorTime
      if (e.sector === 3 && e.lapTime !== null) st.best = st.best === null ? e.lapTime : Math.min(st.best, e.lapTime)
    }
    const list = ordered.map((l, runIdx) => {
      const st = state.get(l.driverId)
      return { carId: l.driverId, best: st?.best ?? null, sectors: st?.sectors ?? [null, null, null], runIdx }
    })
    list.sort((a, b) => {
      if (a.best === null && b.best === null) return a.runIdx - b.runIdx
      if (a.best === null) return 1
      if (b.best === null) return -1
      return a.best - b.best
    })
    return list.map(({ carId, best, sectors }) => ({ carId, best, sectors }))
  }, [revealed, events, ordered])

  const progress = events.length ? (revealed / events.length) * 100 : 0
  const dropFrom = rows.length - cutSize

  return {
    active, clockRef, schedule, rows, sessionName, cutSize, dropFrom, progress,
    showElim, eliminated: session?.eliminated ?? [], closeElim,
  }
}
