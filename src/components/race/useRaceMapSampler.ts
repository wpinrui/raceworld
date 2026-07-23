'use client'

import { useEffect, useRef } from 'react'
import type { RaceState } from '@/lib/sim/types'
import type { TrackSample } from './RaceTrackMap'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { PIT_ENTRY_FRAC, PIT_EXIT_FRAC } from '@/lib/ui/track-path'

// Per-frame track positions from the REAL race sim (#sim-2d). The sim resolves one whole lap per tick;
// this interpolates between ticks exactly like the preview's fake engine did: a playback clock advances
// so the leader covers one lap per tick interval, and every car's position is derived from its own
// cumulative lap times against that clock. Pit laps route through the pit lane (entry → box hold →
// exit) using the lane's geometric fractions; the lap after a stop starts from the pit exit.

interface CarData {
  cum: number[]           // cum[k] = race time after completing lap k
  pitLaps: Set<number>    // laps that ended with a stop (from stint history)
  retired: boolean
  grid: number
  scan: number            // interpolation cache
}

export function useRaceMapSampler(
  raceState: RaceState | null,
  gridPos: Record<string, number>,
  nextTickAtRef: React.MutableRefObject<number>,
  intervalRef: React.MutableRefObject<number>,
  paused: boolean,
): React.MutableRefObject<(id: string) => TrackSample> {
  const dataRef = useRef(new Map<string, CarData>())
  const lapRef = useRef(0)
  const pitLossRef = useRef(21)
  const pausedRef = useRef(paused)
  const frozenFracRef = useRef(0)

  const liveFrac = () => {
    const ms = intervalRef.current
    if (ms <= 0) return 1
    return Math.min(1, Math.max(0, 1 - (nextTickAtRef.current - Date.now()) / ms))
  }

  // Rebuild the cumulative-time tables each tick (raceState is replaced per lap).
  useEffect(() => {
    if (!raceState) return
    pitLossRef.current = pitLaneLoss(raceState.year)
    // COMPLETED laps, derived from the data itself: the sim's currentLap is the lap IN PROGRESS
    // (it starts at 1 on the grid), so counting lapTimes is the robust source of truth.
    lapRef.current = Math.max(0, ...raceState.drivers.map((d) => d.lapTimes.length))
    const map = dataRef.current
    for (const ds of raceState.drivers) {
      const cum: number[] = [0]
      for (const t of ds.lapTimes) cum.push(cum[cum.length - 1] + t)
      const pitLaps = new Set<number>()
      let acc = 0
      for (const s of ds.stintHistory) {
        acc += s.laps
        pitLaps.add(acc)
      }
      const prev = map.get(ds.driverId)
      map.set(ds.driverId, {
        cum,
        pitLaps,
        retired: ds.retired,
        grid: gridPos[ds.driverId] ?? ds.position,
        scan: Math.min(prev?.scan ?? 0, cum.length - 1),
      })
    }
  }, [raceState, gridPos])

  useEffect(() => {
    if (paused && !pausedRef.current) frozenFracRef.current = liveFrac()
    pausedRef.current = paused
  }, [paused]) // eslint-disable-line react-hooks/exhaustive-deps

  const sampleRef = useRef<(id: string) => TrackSample>(() => null)
  useEffect(() => {
    const leaderCumAt = (lap: number): number => {
      let best = Infinity
      dataRef.current.forEach((c) => {
        if (c.cum.length - 1 < lap && c.retired) return
        const v = c.cum[Math.min(lap, c.cum.length - 1)]
        if (v < best) best = v
      })
      return best === Infinity ? 0 : best
    }

    sampleRef.current = (id) => {
      const c = dataRef.current.get(id)
      if (!c) return null
      const N = lapRef.current
      if (N === 0) return { prog: 1 - c.grid * 0.006 } // parked on the grid behind the line
      const frac = pausedRef.current ? frozenFracRef.current : liveFrac()
      const S = leaderCumAt(N - 1) + frac * (leaderCumAt(N) - leaderCumAt(N - 1))
      if (c.retired && S >= c.cum[c.cum.length - 1]) return null
      let k = Math.min(c.scan, c.cum.length - 1)
      while (k > 0 && c.cum[k] > S) k--
      while (k + 1 < c.cum.length && c.cum[k + 1] <= S) k++
      c.scan = k
      if (k + 1 >= c.cum.length) return { prog: 0 } // fully caught up (leader at a boundary)
      const lapNo = k + 1
      const lapT = c.cum[k + 1] - c.cum[k]
      const isPit = c.pitLaps.has(lapNo)
      const run = Math.max(1, lapT - (isPit ? pitLossRef.current : 0))
      const tau = S - c.cum[k]
      if (isPit) {
        const tEntry = PIT_ENTRY_FRAC * run
        if (tau < tEntry) return { prog: tau / run }
        // Pit phase: 35% of the window crawling to the box, 30% stationary, 35% crawling out.
        const w = Math.min(1, (tau - tEntry) / Math.max(0.001, lapT - tEntry))
        const prog = w < 0.35 ? (w / 0.35) * 0.5 : w < 0.65 ? 0.5 : 0.5 + ((w - 0.65) / 0.35) * 0.5
        return { prog, pit: true }
      }
      const from = c.pitLaps.has(lapNo - 1) ? PIT_EXIT_FRAC : 0
      return { prog: from + (1 - from) * Math.min(0.999, tau / run) }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return sampleRef
}
