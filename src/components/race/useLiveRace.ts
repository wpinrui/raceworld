'use client'

import { useEffect, useRef, useState } from 'react'
import type { CommentaryEntry, RaceState, SimSpeed } from '@/lib/sim/types'
import { LiveRace, LIVE_DT } from '@/lib/sim/live'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import { liveBridge } from '@/lib/store/live-bridge'
import { getMoistureAtLap } from '@/lib/sim/weather'
import type { TrackSample } from './RaceTrackMap'

// The live race loop (#live-engine). Owns the LiveRace instance for a played race: steps it by wall
// time × the speed multiplier each animation frame, commits a UI projection to the race store a few
// times a second (plus commentary from engine events), and serves per-frame track samples straight
// from engine positions — the sim's "now" IS the pixel's "now".

const SPEED_MULTS: Record<SimSpeed, number> = { 1: 1, 2: 2, 3: 5, 4: 10, 5: 25 }
const COMMIT_MS = 250
const MAX_STEPS_PER_FRAME = 400 // tab-sleep catch-up cap: beyond this, race time is simply dropped

function posWeight(position: number): number {
  return Math.max(0, 22 - position)
}

export function useLiveRace(): {
  sampleRef: React.MutableRefObject<(id: string) => TrackSample>
  lapProgress: number
} {
  const engineRef = useRef<LiveRace | null>(null)
  const accRef = useRef(0)
  const lastFrameRef = useRef(0)
  const lastCommitRef = useRef(0)
  const [lapProgress, setLapProgress] = useState(0)
  const sampleRef = useRef<(id: string) => TrackSample>(() => null)

  const phase = useRaceStore((s) => s.raceState?.phase)
  const paused = useRaceStore((s) => s.raceState?.paused ?? false)
  const speed = useRaceStore((s) => (s.raceState?.speed ?? 1) as SimSpeed)

  // Engine lifecycle: born when the race goes green, discarded when the session leaves racing/finished.
  useEffect(() => {
    if (phase === 'racing' && !engineRef.current) {
      const { raceState, drivers, teams, selectedCircuit, pitCommands } = useRaceStore.getState()
      if (!raceState || !selectedCircuit) return
      const { year, driverMode, playerDriverId, teamManagerMode, playerTeamId } = useSeasonStore.getState()
      const playerIds = driverMode && playerDriverId
        ? [playerDriverId]
        : teamManagerMode && playerTeamId
          ? drivers.filter((d) => d.teamId === playerTeamId).map((d) => d.id)
          : []
      const live = new LiveRace(raceState, drivers, teams, selectedCircuit, year, playerIds)
      // Standing pit-wall state carries in (driver mode starts on HOLD).
      for (const [driverId, cmd] of Object.entries(pitCommands)) {
        if (cmd === 'hold') live.setHold(driverId, true)
        else if (cmd !== 'auto') live.commandPit(driverId, cmd.pit)
      }
      engineRef.current = live
      liveBridge.current = live
      moistureStore.last = null
      sampleRef.current = (id) => live.sample(id)
    }
    if (phase !== 'racing' && phase !== 'finished' && engineRef.current) {
      engineRef.current = null
      liveBridge.current = null
      sampleRef.current = () => null
    }
  }, [phase])
  // Unmount: never leave a stale engine on the bridge.
  useEffect(() => () => { liveBridge.current = null; engineRef.current = null }, [])

  // The loop: step by wall time, commit the projection at a readable cadence.
  useEffect(() => {
    if (phase !== 'racing' || paused || !engineRef.current) return
    let raf = 0
    lastFrameRef.current = performance.now()

    const frame = (now: number) => {
      const live = engineRef.current
      if (!live) return
      const wallDt = Math.min(2000, now - lastFrameRef.current) / 1000
      lastFrameRef.current = now
      accRef.current += wallDt * SPEED_MULTS[speed]
      let steps = 0
      while (accRef.current >= LIVE_DT && steps < MAX_STEPS_PER_FRAME && live.phase === 'racing') {
        live.step(LIVE_DT)
        accRef.current -= LIVE_DT
        steps++
      }
      if (steps >= MAX_STEPS_PER_FRAME) accRef.current = 0

      if (now - lastCommitRef.current >= COMMIT_MS || live.phase === 'finished') {
        lastCommitRef.current = now
        commit(live)
        setLapProgress(live.leaderLapFrac() * 100)
      }
      if (live.phase === 'racing') raf = requestAnimationFrame(frame)
      else commit(live)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [phase, paused, speed])

  return { sampleRef, lapProgress }
}

// Project the engine into the store's RaceState: live classification + preserved UI fields +
// commentary built from engine events (same voice as the whole-lap engine's feed).
function commit(live: LiveRace): void {
  const cur = useRaceStore.getState().raceState
  if (!cur) return
  const snap = live.snapshot()
  const entries = eventsToCommentary(live, snap)
  useRaceStore.setState({
    raceState: {
      ...snap,
      speed: cur.speed,
      paused: cur.paused,
      commentary: entries.length ? [...cur.commentary, ...entries] : cur.commentary,
    },
  })
  reconcilePitWall(live, snap)
}

// A landed player stop falls back to HOLD (manual control stays manual), matching the pit wall's
// long-standing contract.
function reconcilePitWall(live: LiveRace, snap: RaceState): void {
  const { pitCommands, setPitCommand } = useRaceStore.getState()
  for (const [driverId, cmd] of Object.entries(pitCommands)) {
    if (cmd === 'auto' || cmd === 'hold') continue
    const car = live.cars.find((c) => c.ds.driverId === driverId)
    const ds = snap.drivers.find((d) => d.driverId === driverId)
    if (!ds || ds.retired) { setPitCommand(driverId, 'auto'); continue }
    if (car && !car.pit && ds.pitStops > 0) setPitCommand(driverId, 'hold')
  }
}

function eventsToCommentary(live: LiveRace, snap: RaceState): CommentaryEntry[] {
  const events = live.drainEvents()
  const nameOf = (id: string) => useRaceStore.getState().drivers.find((d) => d.id === id)?.name ?? id
  const posOf = (id: string) => snap.drivers.find((d) => d.driverId === id)?.position
  const out: Array<{ entry: CommentaryEntry; priority: number }> = []
  for (const e of events) {
    if (e.type === 'retirement') {
      out.push({
        entry: { lap: e.lap, text: `${nameOf(e.driverId)} is out! Mechanical failure on lap ${e.lap}.`, type: 'retirement' },
        priority: 1000,
      })
    } else if (e.type === 'overtake') {
      const p = posOf(e.driverId)
      out.push({
        entry: { lap: e.lap, text: `${nameOf(e.driverId)} makes the move on ${nameOf(e.otherId ?? '')}!${p ? ` Up to P${p}.` : ''}`, type: 'overtake' },
        priority: 500 + posWeight(p ?? 22) * 10,
      })
    } else if (e.type === 'pit-in') {
      out.push({
        entry: { lap: e.lap, text: `${nameOf(e.driverId)} pits! Back out on ${(e.compound ?? '').toUpperCase()} tyres.`, type: 'pit' },
        priority: 200 + posWeight(posOf(e.driverId) ?? 22) * 5,
      })
    } else if (e.type === 'finish' && posOf(e.driverId) === 1) {
      out.push({ entry: { lap: e.lap, text: `${nameOf(e.driverId)} takes the victory!`, type: 'finish' }, priority: 2000 })
    }
  }
  // Weather turns — the moisture drift accumulates until a real shift trips the line.
  const lap = snap.currentLap
  const moisture = getMoistureAtLap(snap.weather, lap)
  if (moistureStore.last == null) {
    moistureStore.last = moisture
  } else if (Math.abs(moisture - moistureStore.last) > 0.1) {
    out.push({ entry: { lap, text: moisture > moistureStore.last ? 'Rain is intensifying!' : 'The track is drying!', type: 'weather' }, priority: 900 })
    moistureStore.last = moisture
  }
  // Keep the feed readable: the most newsworthy few per commit.
  return out.sort((a, b) => b.priority - a.priority).slice(0, 4).map((o) => o.entry)
}

const moistureStore: { last: number | null } = { last: null }
