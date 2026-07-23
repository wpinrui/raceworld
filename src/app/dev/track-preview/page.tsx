'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDown, Building2, Hourglass, Layers, LayoutGrid, LifeBuoy, PanelLeftClose, PanelLeftOpen, Shield, Tag,
  Timer, TreePine, Wrench, type LucideIcon,
} from 'lucide-react'
import type { DriverRaceState, SimSpeed } from '@/lib/sim/types'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { RaceTrackMap, type TrackCarMeta, type TrackSample } from '@/components/race/RaceTrackMap'
import RaceTable, { ALL_RACE_TABLE_COLUMNS, type RaceTableColumn } from '@/components/race/RaceTable'
import CommentaryFeed from '@/components/race/CommentaryFeed'
import { LiveChampionship } from '@/components/race/LiveChampionship'
import { PitWallCard } from '@/components/race/PitWallPanel'
import { CentreConsole, CHIP_BG, consoleChipClass } from '@/components/race/CentreConsole'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  MOCK_BASELINE_CONSTRUCTORS, MOCK_BASELINE_DRIVERS, MOCK_CIRCUIT, MOCK_DRIVERS, MOCK_GRID,
  MOCK_RACE_STATE, MOCK_TEAMS, MOCK_TOTAL_LAPS,
} from './mock'
import { createEngine } from './engine'

// Dev-only preview (#sim-overhaul phase 6): the Monaco track map inside the real race-screen components,
// driven by a FAKE per-lap engine (engine.ts) that mimics the real sim's tick model — laps tick at the
// game's speeds, dots interpolate smoothly between ticks, pit stops route through the procedural pit
// lane, and the board/championship/cards/commentary follow live. Open at /dev/track-preview.

// Playback multipliers: 1x is REAL TIME (a ~78s lap takes ~78s), the rest divide the lap's real duration.
const SPEED_MULTS: Record<SimSpeed, number> = { 1: 1, 2: 2, 3: 5, 4: 10, 5: 25 }
const SPEED_LABELS: Record<SimSpeed, string> = { 1: '1×', 2: '2×', 3: '5×', 4: '10×', 5: '25×' }
// The pre-race grid wait before lap 1 starts animating.
const GRID_HOLD_MS = 2000
const BACKDROP_URL = '/track-backdrops/monaco.png'

// Subpane toggles: each button shows/hides one data group on the timing board.
const COLUMN_TOGGLES: Array<{ col: RaceTableColumn; label: string; icon: LucideIcon }> = [
  { col: 'grid', label: 'Grid', icon: LayoutGrid },
  { col: 'team', label: 'Team', icon: Shield },
  { col: 'gap', label: 'Gap', icon: Hourglass },
  { col: 'interval', label: 'Interval', icon: ArrowUpDown },
  { col: 'tyre', label: 'Tyres', icon: LifeBuoy },
  { col: 'stops', label: 'Stops', icon: Wrench },
  { col: 'lastLap', label: 'Last lap', icon: Timer },
  { col: 'stints', label: 'Stints', icon: Layers },
]

const teamOf = new Map(MOCK_TEAMS.map((t) => [t.id, t]))
const driverOf = new Map(MOCK_DRIVERS.map((d) => [d.id, d]))
const PLAYER_CAR_IDS = ['car-6', 'car-7'] as const

export default function TrackPreviewPage() {
  const layout = TRACK_LAYOUTS.monaco
  const [standingsOpen, setStandingsOpen] = useState(true)
  const [columns, setColumns] = useState<Set<RaceTableColumn>>(new Set(ALL_RACE_TABLE_COLUMNS))
  const [labelsOn, setLabelsOn] = useState(false)
  // Scenery density tuning (per-track values get authored once the right feel is found here).
  const [treeDensity, setTreeDensity] = useState(1)
  const [buildingDensity, setBuildingDensity] = useState(1)
  const sceneryDensity = useMemo(
    () => ({ trees: treeDensity, buildings: buildingDensity }),
    [treeDensity, buildingDensity],
  )
  const [speed, setSpeed] = useState<SimSpeed>(2)
  const [paused, setPaused] = useState(false)

  const [engine] = useState(createEngine)
  const [states, setStates] = useState<DriverRaceState[]>(() => engine.states())
  const [lap, setLap] = useState(0)
  const [commentary, setCommentary] = useState(() => engine.commentary())
  // Camera lock: your car by default; dragging the map frees the camera, clicking a car re-locks.
  const [followId, setFollowId] = useState<string | null>('car-7')

  const tickStartRef = useRef(0)
  const intervalRef = useRef(GRID_HOLD_MS)
  const frozenFracRef = useRef(0)
  const pausedRef = useRef(false)

  // The tick loop: one engine lap per interval. The interval is the LEADER'S REAL LAP TIME divided by
  // the speed multiplier (1x = real time), remembering mid-lap progress across pause/speed changes.
  useEffect(() => {
    pausedRef.current = paused
    if (paused || engine.finished) return
    const mult = SPEED_MULTS[speed]
    const intervalNow = () => (engine.laps === 0 ? GRID_HOLD_MS : (engine.leaderLapSeconds() * 1000) / mult)
    let timer: ReturnType<typeof setTimeout>
    const loop = () => {
      engine.tick()
      const next = engine.states()
      setStates(next)
      setCommentary(engine.commentary())
      setLap(engine.laps)
      // Hand the lock to the leader if the followed car retires.
      setFollowId((prev) =>
        prev && next.find((s) => s.driverId === prev)?.retired
          ? next.find((s) => !s.retired)?.driverId ?? null
          : prev,
      )
      frozenFracRef.current = 0
      intervalRef.current = intervalNow()
      tickStartRef.current = performance.now()
      if (!engine.finished) timer = setTimeout(loop, intervalRef.current)
    }
    intervalRef.current = intervalNow()
    tickStartRef.current = performance.now() - frozenFracRef.current * intervalRef.current
    timer = setTimeout(loop, (1 - frozenFracRef.current) * intervalRef.current)
    return () => {
      clearTimeout(timer)
      frozenFracRef.current = Math.min(1, (performance.now() - tickStartRef.current) / intervalRef.current)
    }
  }, [speed, paused, engine])

  // Space = pause, 1-4 = speed. SpaceGuard (root layout) already stops Space re-activating the last
  // focused button; the console's controls also blur themselves on click.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p) }
      if (['1', '2', '3', '4'].includes(e.key)) setSpeed(Number(e.key) as SimSpeed)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const sampleRef = useRef<(id: string) => TrackSample>(() => null)
  useEffect(() => {
    sampleRef.current = (id) => {
      const frac = pausedRef.current
        ? frozenFracRef.current
        : (performance.now() - tickStartRef.current) / intervalRef.current
      return engine.sampleAt(id, Math.min(1, Math.max(0, frac)))
    }
  }, [engine])

  const cars: TrackCarMeta[] = useMemo(
    () =>
      states.map((s) => {
        const driver = driverOf.get(s.driverId)!
        const team = teamOf.get(driver.teamId)
        return {
          id: s.driverId,
          pos: s.position,
          color: team?.color ?? '#888',
          name: driver.name,
          team: team?.name,
          nationality: driver.nationality,
          isPlayer: s.driverId === 'car-7',
          retired: s.retired,
        }
      }),
    [states],
  )

  const liveRaceState = useMemo(
    () => ({ ...MOCK_RACE_STATE, currentLap: lap, drivers: states, commentary }),
    [lap, states, commentary],
  )

  const toggleColumn = (col: RaceTableColumn) =>
    setColumns((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })

  return (
    <div className="flex flex-col h-full bg-[#0F1319] text-[#FFFFFF]">
      <div className="flex flex-1 min-h-0">
        {/* Left: the race-day timing board; subpane toggles pick the data, the panel fits itself to it */}
        <div className={`shrink-0 border-r border-[#232A38] flex flex-col ${standingsOpen ? 'max-w-[55vw]' : 'w-10'}`}>
          <div className="flex items-center justify-between px-2 py-2 shrink-0 gap-3">
            {standingsOpen && <span className="text-xs font-semibold tracking-widest uppercase">Standings</span>}
            <button
              className="p-1 rounded hover:bg-[#232A38] cursor-pointer"
              onClick={() => setStandingsOpen((v) => !v)}
            >
              {standingsOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
          </div>
          {standingsOpen && (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <RaceTable
                  drivers={MOCK_DRIVERS}
                  teams={MOCK_TEAMS}
                  states={states}
                  currentLap={lap}
                  totalLaps={MOCK_TOTAL_LAPS}
                  gridPos={MOCK_GRID}
                  columns={[...columns]}
                  selectedDriverId={followId}
                  onSelectDriver={setFollowId}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 px-2 py-2 shrink-0 border-t border-[#232A38]">
                {COLUMN_TOGGLES.map(({ col, label, icon: Icon }) => {
                  const on = columns.has(col)
                  return (
                    <Tooltip key={col} content={label}>
                      <button
                        onClick={() => toggleColumn(col)}
                        className={`flex items-center justify-center w-11 h-11 rounded-lg cursor-pointer transition-colors ${
                          on
                            ? 'bg-[#232A38] text-[#FFFFFF]'
                            : 'text-[#6B7280] hover:bg-[#1E2431]'
                        }`}
                      >
                        <Icon size={21} />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Center: the track map, full bleed, with its own display toggles top-right */}
        <div className="flex-1 min-w-0 relative">
          <RaceTrackMap
            layout={layout}
            cars={cars}
            sampleRef={sampleRef}
            followId={followId}
            onFollow={setFollowId}
            showLabels={labelsOn}
            sceneryDensity={sceneryDensity}
          />
          <div className="absolute top-3 right-3 flex gap-1.5">
            <Tooltip content="Driver labels">
              <button
                onClick={() => setLabelsOn((v) => !v)}
                className={`flex items-center justify-center w-11 h-11 rounded-lg cursor-pointer transition-colors ${
                  labelsOn ? 'bg-[#232A38] text-[#FFFFFF]' : 'text-[#6B7280] hover:bg-[#1E2431]'
                }`}
              >
                <Tag size={21} />
              </button>
            </Tooltip>
          </div>
          {/* Scenery density tuning */}
          <div className="absolute bottom-3 left-3 flex flex-col gap-2 rounded-lg bg-[#0F1319]/85 border border-[#232A38] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <TreePine size={16} className="text-[#8FB35F] shrink-0" />
              <input
                type="range"
                min={0}
                max={2.5}
                step={0.1}
                value={treeDensity}
                onChange={(e) => setTreeDensity(Number(e.target.value))}
                className="w-36 accent-[#00D9FF]"
              />
              <span className="text-xs tabular-nums w-8">{treeDensity.toFixed(1)}×</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Building2 size={16} className="text-[#8A93A6] shrink-0" />
              <input
                type="range"
                min={0}
                max={2.5}
                step={0.1}
                value={buildingDensity}
                onChange={(e) => setBuildingDensity(Number(e.target.value))}
                className="w-36 accent-[#00D9FF]"
              />
              <span className="text-xs tabular-nums w-8">{buildingDensity.toFixed(1)}×</span>
            </div>
          </div>
        </div>

        {/* Right: commentary + live championship */}
        <div className="w-80 shrink-0 border-l border-[#232A38] flex flex-col p-3 gap-3">
          <div className="flex-1 min-h-0">
            <CommentaryFeed entries={commentary} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <LiveChampionship
              states={states}
              drivers={MOCK_DRIVERS}
              teams={MOCK_TEAMS}
              baselineDrivers={MOCK_BASELINE_DRIVERS}
              baselineConstructors={MOCK_BASELINE_CONSTRUCTORS}
              year={MOCK_RACE_STATE.year}
            />
          </div>
        </div>
      </div>

      {/* Bottom: fixed-width car cards flanking the centre console */}
      <div className="flex items-stretch gap-0 px-4 py-3 shrink-0 border-t border-[#232A38]">
        {PLAYER_CAR_IDS.map((id, i) => (
          <div key={id} className="shrink-0 self-center" style={{ order: i === 0 ? 0 : 2 }}>
            <PitWallCard
              driver={driverOf.get(id)!}
              team={teamOf.get(driverOf.get(id)!.teamId)}
              ds={states.find((s) => s.driverId === id)}
              raceState={liveRaceState}
              allDrivers={MOCK_DRIVERS}
              onRetire={() => {}}
              mode="tm"
            />
          </div>
        ))}
        <div style={{ order: 1 }} className="flex-1 min-w-0 self-stretch">
          <CentreConsole
            circuitName={MOCK_CIRCUIT.name}
            countryCode={MOCK_CIRCUIT.country}
            lap={lap}
            totalLaps={MOCK_TOTAL_LAPS}
            weather={MOCK_RACE_STATE.weather}
            forecast={MOCK_RACE_STATE.weatherForecast}
            speed={speed}
            paused={paused}
            onSpeed={setSpeed}
            onTogglePause={() => setPaused((v) => !v)}
            straightness={MOCK_CIRCUIT.straightness}
            backdropUrl={BACKDROP_URL}
            speedLabels={SPEED_LABELS}
            topRight={
              <button className={consoleChipClass} style={{ background: CHIP_BG }}>DATA ROOM</button>
            }
          />
        </div>
      </div>
    </div>
  )
}
