'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useRaceStore } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import type { GodModeAction, RaceResult, SimSpeed } from '@/lib/sim/types'
import { isOffSeason } from '@/lib/sim/types'
import { calendarForYear } from '@/data/calendars'
import { buildRaceResults } from '@/lib/sim/race-results'
import RaceTable from '@/components/race/RaceTable'
import GodModePanel from '@/components/race/GodModePanel'
import CommentaryFeed from '@/components/race/CommentaryFeed'
import { LiveChampionship } from '@/components/race/LiveChampionship'
import { RaceHeader } from '@/components/race/RaceHeader'
import { PreQualPanel } from '@/components/race/PreQualPanel'
import { PreRacePanel } from '@/components/race/PreRacePanel'
import { PostRacePanel } from '@/components/race/PostRacePanel'
import { SpeedBar } from '@/components/race/SpeedBar'
import { ConfirmModal } from '@/components/race/ConfirmModal'

const SPEED_INTERVALS: Record<SimSpeed, number> = { 1: 5000, 2: 2000, 3: 500, 4: 0 }

export default function RacePage() {
  const router = useRouter()
  const season = useSeasonStore()
  const {
    raceState, drivers, teams, forms, godModeDriverId,
    loadFromSeason, updateDriverForm, setGodModeDriver,
    tickLap, setSpeed, setPaused,
  } = useRaceStore()

  const phase = raceState?.phase ?? 'pre-qualifying'
  const speed = raceState?.speed ?? 1
  const paused = raceState?.paused ?? false

  const [pendingGodModeActions, setPendingGodModeActions] = useState<GodModeAction[]>([])
  const [showSpeed4Modal, setShowSpeed4Modal] = useState(false)
  const [speed4Confirmed, setSpeed4Confirmed] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [lapProgress, setLapProgress] = useState(0)

  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextTickAtRef = useRef<number>(0)
  const doTickRef = useRef<() => void>(() => {})

  const currentCircuit = calendarForYear(season.year)[season.currentRound - 1]
  const gridDrivers = season.drivers.filter((d) => d.teamId !== '')

  useEffect(() => {
    setHydrated(true)
    if (season.phase === 'idle') { router.replace('/setup'); return }
    if (isOffSeason(season.phase)) { router.replace('/home'); return }
    if (!raceState && currentCircuit) loadFromSeason(gridDrivers, season.teams, currentCircuit)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === ' ' && (phase === 'racing' || phase === 'finished')) { e.preventDefault(); setPaused(!paused) }
      if (phase === 'racing') {
        if (e.key === '1') handleSpeedClick(1)
        if (e.key === '2') handleSpeedClick(2)
        if (e.key === '3') handleSpeedClick(3)
        if (e.key === '4') handleSpeedClick(4)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused])

  const doTick = useCallback(() => {
    const actions = pendingGodModeActions.length > 0 ? [...pendingGodModeActions] : undefined
    if (actions) setPendingGodModeActions([])
    tickLap(actions)
  }, [pendingGodModeActions, tickLap])

  useEffect(() => { doTickRef.current = doTick }, [doTick])

  useEffect(() => {
    if (phase !== 'racing' || paused || speed !== 4 || !speed4Confirmed) return
    if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
    let cancelled = false
    const run = async () => {
      while (!cancelled) {
        const current = useRaceStore.getState().raceState
        if (!current || current.phase !== 'racing') break
        useRaceStore.getState().tickLap()
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    run()
    return () => { cancelled = true }
  }, [phase, paused, speed, speed4Confirmed])

  useEffect(() => {
    if (phase !== 'racing' || speed === 4) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }
    if (paused) {
      if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null }
      return
    }
    const ms = SPEED_INTERVALS[speed]
    const remaining = nextTickAtRef.current > Date.now() ? Math.min(nextTickAtRef.current - Date.now(), ms) : ms
    const schedule = (delay: number) => {
      nextTickAtRef.current = Date.now() + delay
      tickTimerRef.current = setTimeout(() => {
        doTickRef.current()
        const s = useRaceStore.getState().raceState
        if (s?.phase === 'racing' && !s.paused && s.speed !== 4) schedule(SPEED_INTERVALS[s.speed as SimSpeed])
      }, delay)
    }
    schedule(remaining)
    return () => { if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null } }
  }, [phase, paused, speed]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'racing' || paused || speed === 4) {
      setLapProgress(paused ? Math.max(0, Math.min(100, (1 - (nextTickAtRef.current - Date.now()) / SPEED_INTERVALS[speed]) * 100)) : 0)
      return
    }
    const timer = setInterval(() => {
      setLapProgress(Math.max(0, Math.min(100, (1 - (nextTickAtRef.current - Date.now()) / SPEED_INTERVALS[speed]) * 100)))
    }, 50)
    return () => clearInterval(timer)
  }, [phase, paused, speed])

  const handleSpeedClick = (s: SimSpeed) => {
    if (s === 4) { setShowSpeed4Modal(true); return }
    setSpeed4Confirmed(false); setSpeed(s)
  }

  const confirmSpeed4 = () => { setShowSpeed4Modal(false); setSpeed4Confirmed(true); setSpeed(4) }

  function computeResults(): RaceResult[] {
    if (!raceState) return []
    return buildRaceResults(raceState, drivers, teams, season.year)
  }

  if (!hydrated) return null

  const resultsForDisplay = phase === 'finished' ? computeResults() : []
  const selectedDriverId = godModeDriverId

  return (
    <div className="h-full bg-[#0F1419] text-[#FFFFFF] flex flex-col overflow-hidden">
      <RaceHeader
        phase={phase} raceState={raceState} lapProgress={lapProgress}
        currentCircuit={currentCircuit}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left 60% */}
        <div className="w-[60%] border-r border-[#2A3142] flex flex-col min-h-0 overflow-hidden">
          {phase === 'pre-qualifying' && (
            <PreQualPanel
              drivers={drivers} teams={teams} forms={forms}
              currentCircuit={currentCircuit}
              onFormChange={updateDriverForm}
            />
          )}
          {phase === 'qualifying' && (
            <div className="flex items-center justify-center h-full">
              <p className="text-[#FFFFFF] text-xl tracking-widest uppercase animate-pulse">Qualifying in progress...</p>
            </div>
          )}
          {phase === 'pre-race' && raceState && (
            <PreRacePanel
              raceState={raceState} drivers={drivers} teams={teams}
              currentCircuit={currentCircuit}
            />
          )}
          {(phase === 'racing' || phase === 'finished') && raceState && (
            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2">
              <RaceTable
                drivers={drivers} teams={teams} states={raceState.drivers}
                currentLap={raceState.currentLap} totalLaps={raceState.totalLaps}
                phase={phase} selectedDriverId={selectedDriverId}
                onSelectDriver={setGodModeDriver}
              />
            </div>
          )}
        </div>

        {/* Right 40% */}
        <div className="w-[40%] flex flex-col min-h-0 overflow-hidden">
          {phase === 'finished' ? (
            <PostRacePanel results={resultsForDisplay} teams={teams} />
          ) : (
            <>
              <div className="h-[45%] min-h-0 flex border-b border-[#2A3142] overflow-hidden">
                <div className="w-1/2 min-h-0 p-4 border-r border-[#2A3142] flex flex-col overflow-hidden">
                  <CommentaryFeed entries={raceState?.commentary ?? []} />
                </div>
                <div className="w-1/2 min-h-0 p-4 flex flex-col overflow-hidden">
                  <LiveChampionship
                    states={raceState?.drivers ?? []}
                    drivers={drivers}
                    teams={teams}
                    baselineDrivers={season.driverStandings}
                    baselineConstructors={season.constructorStandings}
                    year={season.year}
                  />
                </div>
              </div>
              <div className="h-[55%] min-h-0 p-4 overflow-y-auto">
                {raceState && phase === 'racing' ? (
                  <GodModePanel
                    drivers={drivers} teams={teams} states={raceState.drivers}
                    raceState={raceState}
                    selectedDriverId={selectedDriverId ?? drivers[0]?.id ?? ''}
                    onAction={(actions) => setPendingGodModeActions((prev) => [...prev, ...actions])}
                  />
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
                      <h2 className="font-semibold text-sm tracking-widest text-[#FFFFFF] uppercase">God Mode</h2>
                    </div>
                    <p className="text-[#FFFFFF] text-sm">Available during race.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {phase === 'racing' && raceState && (
        <SpeedBar
          speed={speed} paused={paused}
          onSpeedClick={handleSpeedClick}
          onTogglePause={() => setPaused(!paused)}
        />
      )}

      {showSpeed4Modal && (
        <ConfirmModal
          title="Simulate to End?"
          body="The race will be simulated to the end without delay."
          confirmLabel="Confirm"
          onConfirm={confirmSpeed4}
          onCancel={() => setShowSpeed4Modal(false)}
        />
      )}
    </div>
  )
}
