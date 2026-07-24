'use client'

import { useEffect, useRef } from 'react'
import type { RaceState } from '@/lib/sim/types'
import type { TrackSample } from './RaceTrackMap'
import { useRaceStore } from '@/lib/store/race-store'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { PIT_ENTRY_FRAC, PIT_EXIT_FRAC } from '@/lib/ui/track-path'

// Per-frame track positions from the REAL race sim (#sim-2d, #sector-engine). The sim resolves one
// SECTOR (1/8 lap) per tick; this interpolates between ticks: a playback clock S advances so the
// leader covers its just-resolved slice per tick interval, and every car's position derives from its
// own cumulative times against that clock — resolved laps through the lap table, the lap in progress
// through its sector splits. Pit laps route through the pit lane (entry → box hold → exit) using the
// lane's geometric fractions; a pit lap is never "in progress" here (its splits complete in the same
// tick the stop lands), so the pit window always animates through the resolved-lap math even though
// it spans the S/F line.

interface CarData {
  cum: number[]           // cum[k] = race time after completing lap k
  splits: number[]        // the in-progress lap's sector splits (empty when between laps)
  end: number             // full resolved extent = cum[last] + Σ splits (the car's totalTime)
  pitLaps: Set<number>    // laps that ended with a stop (from stint history)
  retired: boolean
  grid: number
  scan: number            // interpolation cache
}

export function useRaceMapSampler(
  gridPos: Record<string, number>,
  nextTickAtRef: React.MutableRefObject<number>,
  intervalRef: React.MutableRefObject<number>,
  paused: boolean,
): React.MutableRefObject<(id: string) => TrackSample> {
  const dataRef = useRef(new Map<string, CarData>())
  const hasDataRef = useRef(false)
  const windowRef = useRef({ start: 0, end: 0 })
  const pitLossRef = useRef(21)
  const pausedRef = useRef(paused)
  const frozenFracRef = useRef(0)

  const liveFrac = () => {
    const ms = intervalRef.current
    if (!Number.isFinite(ms) || ms <= 0) return 1
    const f = 1 - (nextTickAtRef.current - Date.now()) / ms
    return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0
  }

  // Rebuild the cumulative-time tables SYNCHRONOUSLY with the store tick: zustand subscribers fire
  // inside tickSector, before the page's scheduler resets the animation clock. Rebuilding in a React
  // effect instead ran a frame late — the fresh clock read stale tables for one painted frame, and
  // the whole field flashed a window back then snapped forward at the start of every lap.
  useEffect(() => {
    const rebuild = (raceState: RaceState | null) => {
      if (!raceState) return
      pitLossRef.current = pitLaneLoss(raceState.year)
      const map = dataRef.current
      let any = false
      let windowEnd = Infinity
      let leaderSlice = NaN
      for (const ds of raceState.drivers) {
        // The lap in progress: splits still short of a full lap. A length-8 sectorTimes describes the
        // last COMPLETED lap (it already sums into lapTimes) and must not be double-counted.
        const splits = ds.sectorTimes && ds.sectorTimes.length < 8 ? ds.sectorTimes : []
        // Anchor at the car's OFFICIAL starting time (the sim seeds totalTime with the grid offset,
        // which lapTimes/splits don't contain) — otherwise the map orders cars by pure pace and
        // disagrees with the standings from lap 1.
        const seed = ds.totalTime - ds.lapTimes.reduce((a, b) => a + b, 0) - splits.reduce((a, b) => a + b, 0)
        const cum: number[] = [seed]
        for (const t of ds.lapTimes) cum.push(cum[cum.length - 1] + t)
        if (ds.lapTimes.length > 0 || splits.length > 0) any = true
        const pitLaps = new Set<number>()
        let acc = 0
        for (const s of ds.stintHistory) {
          acc += s.laps
          pitLaps.add(acc)
        }
        const prev = map.get(ds.driverId)
        map.set(ds.driverId, {
          cum,
          splits,
          end: ds.totalTime,
          pitLaps,
          retired: ds.retired,
          grid: gridPos[ds.driverId] ?? ds.position,
          scan: Math.min(prev?.scan ?? 0, cum.length - 1),
        })
        // The playback window ends at the front of the resolved race — the running leader's extent —
        // and starts one just-resolved slice earlier (a sector, or a whole lap on the legacy path).
        if (!ds.retired && ds.totalTime < windowEnd) {
          windowEnd = ds.totalTime
          leaderSlice = ds.sectorTimes?.[ds.sectorTimes.length - 1]
            ?? ds.lapTimes[ds.lapTimes.length - 1]
            ?? NaN
        }
      }
      hasDataRef.current = any
      if (any && Number.isFinite(windowEnd)) {
        const start = Number.isFinite(leaderSlice) ? Math.max(0, windowEnd - leaderSlice) : windowEnd
        windowRef.current = { start, end: windowEnd }
      } else {
        windowRef.current = { start: 0, end: 0 }
      }
    }
    rebuild(useRaceStore.getState().raceState)
    return useRaceStore.subscribe((state) => rebuild(state.raceState))
  }, [gridPos])

  useEffect(() => {
    if (paused && !pausedRef.current) frozenFracRef.current = liveFrac()
    pausedRef.current = paused
  }, [paused]) // eslint-disable-line react-hooks/exhaustive-deps

  const sampleRef = useRef<(id: string) => TrackSample>(() => null)
  useEffect(() => {
    sampleRef.current = (id) => {
      const c = dataRef.current.get(id)
      if (!c) return null
      if (!hasDataRef.current) return { prog: 0, gridSlot: c.grid } // formed up on the starting grid
      const frac = pausedRef.current ? frozenFracRef.current : liveFrac()
      const w = windowRef.current
      const S = w.start + frac * (w.end - w.start)
      // Covering its grid deficit: the whole field launches together at lights out; this car reaches
      // the S/F line exactly when the official clock says its race begins.
      if (S < c.cum[0]) return { prog: 0, gridSlot: c.grid, launch: c.cum[0] > 0 ? S / c.cum[0] : 1 }
      if (c.retired && S >= c.end) return null

      const last = c.cum.length - 1
      if (S >= c.cum[last] && c.splits.length > 0) {
        // The lap in progress, at sector resolution: each split is 1/8 of the lap's TIME (the map's
        // speed profile turns that time fraction into track distance). Walk to the split containing S.
        let j = 0
        let acc = c.cum[last]
        while (j < c.splits.length - 1 && acc + c.splits[j] <= S) { acc += c.splits[j]; j++ }
        const within = Math.min(1, Math.max(0, (S - acc) / Math.max(0.001, c.splits[j])))
        const from = c.pitLaps.has(last) ? PIT_EXIT_FRAC : 0
        return { prog: from + (1 - from) * Math.min(0.999, (j + within) / 8) }
      }

      let k = Math.min(c.scan, last)
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
        const w2 = Math.min(1, (tau - tEntry) / Math.max(0.001, lapT - tEntry))
        const prog = w2 < 0.35 ? (w2 / 0.35) * 0.5 : w2 < 0.65 ? 0.5 : 0.5 + ((w2 - 0.65) / 0.35) * 0.5
        return { prog, pit: true }
      }
      const from = c.pitLaps.has(lapNo - 1) ? PIT_EXIT_FRAC : 0
      return { prog: from + (1 - from) * Math.min(0.999, tau / run) }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return sampleRef
}
