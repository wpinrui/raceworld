'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpDown, Hourglass, Layers, LayoutGrid, LifeBuoy, PanelLeftClose, PanelLeftOpen, Shield, Tag,
  Timer, Wrench, type LucideIcon,
} from 'lucide-react'
import type { Circuit, Driver, DriverRaceState, GodModeAction, RaceResult, RaceState, SimSpeed, Team } from '@/lib/sim/types'
import type { ConstructorStanding, DriverStanding } from '@/lib/sim/types'
import type { TrackLayout } from '@/data/tracks'
import { RaceTrackMap, type TrackCarMeta, type TrackSample } from './RaceTrackMap'
import RaceTable, { ALL_RACE_TABLE_COLUMNS, type RaceTableColumn } from './RaceTable'
import CommentaryFeed from './CommentaryFeed'
import { LiveChampionship } from './LiveChampionship'
import { PitWallCard } from './PitWallPanel'
import GodModePanel from './GodModePanel'
import { PostRacePanel } from './PostRacePanel'
import { CentreConsole, CHIP_BG, consoleChipClass } from './CentreConsole'
import { Tooltip } from '@/components/ui/Tooltip'

// The 2D race-day screen (#sim-2d): collapsible timing board with subpane toggles, the live track map
// with the follow camera, commentary + live championship, and pit wall cards flanking the centre
// console. Composed here so the race page just gates on "does this circuit have a track layout yet".

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

// Pane preferences persist across race days. Safe to read lazily: the race page renders nothing until
// after hydration, so the first real render is always client-side.
const UI_KEY = 'raceday-ui'
interface StoredUi { standingsOpen: boolean; columns: RaceTableColumn[]; labelsOn: boolean }
function loadUi(): Partial<StoredUi> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_KEY) ?? '') as Partial<StoredUi>
    return {
      ...parsed,
      columns: parsed.columns?.filter((c) => ALL_RACE_TABLE_COLUMNS.includes(c)),
    }
  } catch {
    return {}
  }
}

interface Props {
  raceState: RaceState
  phase: 'racing' | 'finished'
  layout: TrackLayout
  circuit: Circuit
  drivers: Driver[]
  teams: Team[]
  speed: SimSpeed
  paused: boolean
  onSpeedClick: (s: SimSpeed) => void
  onTogglePause: () => void
  sampleRef: React.MutableRefObject<(id: string) => TrackSample>
  results: RaceResult[]
  baselineDrivers: DriverStanding[]
  baselineConstructors: ConstructorStanding[]
  year: number
  driverMode: boolean
  teamManagerMode: boolean
  playerDriverId: string | null
  playerTeamId: string | null
  godSelectedId: string | null
  onGodSelect: (id: string) => void
  onGodActions: (actions: GodModeAction[]) => void
  onRetire: (driverId: string) => void
}

export function RaceDayView({
  raceState, phase, layout, circuit, drivers, teams, speed, paused, onSpeedClick, onTogglePause,
  sampleRef, results, baselineDrivers, baselineConstructors, year, driverMode, teamManagerMode,
  playerDriverId, playerTeamId, godSelectedId, onGodSelect, onGodActions, onRetire,
}: Props) {
  const [stored] = useState(loadUi)
  const [standingsOpen, setStandingsOpen] = useState(stored.standingsOpen ?? true)
  const [columns, setColumns] = useState<Set<RaceTableColumn>>(new Set(stored.columns ?? ALL_RACE_TABLE_COLUMNS))
  const [labelsOn, setLabelsOn] = useState(stored.labelsOn ?? false)
  const [godOpen, setGodOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ standingsOpen, columns: [...columns], labelsOn }))
    } catch { /* storage unavailable: preferences just don't persist */ }
  }, [standingsOpen, columns, labelsOn])
  const [followId, setFollowId] = useState<string | null>(() =>
    driverMode ? playerDriverId : teamManagerMode ? drivers.find((d) => d.teamId === playerTeamId)?.id ?? null : null,
  )

  const driverOf = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers])
  const teamOf = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams])
  const gridPos = useMemo(
    () => Object.fromEntries(raceState.qualifyingResults.map((q) => [q.driverId, q.gridPosition])),
    [raceState.qualifyingResults],
  )

  // The follow lock quietly releases if the followed car is out (derived, not stateful).
  const followedState = raceState.drivers.find((s) => s.driverId === followId)
  const effectiveFollow = followedState && !followedState.retired ? followId : null

  const isPlayerCar = (ds: DriverRaceState) =>
    (driverMode && ds.driverId === playerDriverId) ||
    (teamManagerMode && driverOf.get(ds.driverId)?.teamId === playerTeamId)

  const cars: TrackCarMeta[] = useMemo(
    () =>
      raceState.drivers.map((s) => {
        const driver = driverOf.get(s.driverId)
        const team = driver ? teamOf.get(driver.teamId) : undefined
        return {
          id: s.driverId,
          pos: s.position,
          color: team?.color ?? '#888',
          name: driver?.name ?? s.driverId,
          team: team?.name,
          nationality: driver?.nationality,
          isPlayer: isPlayerCar(s),
          retired: s.retired,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raceState.drivers, driverOf, teamOf],
  )

  const myDrivers = driverMode
    ? drivers.filter((d) => d.id === playerDriverId)
    : teamManagerMode
      ? drivers.filter((d) => d.teamId === playerTeamId)
      : []

  const selectRow = (id: string) => {
    setFollowId(id)
    onGodSelect(id)
  }

  const toggleColumn = (col: RaceTableColumn) =>
    setColumns((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })

  const pod = (driver: Driver) => (
    <div key={driver.id} className="shrink-0 self-center">
      <PitWallCard
        driver={driver}
        team={teamOf.get(driver.teamId)}
        ds={raceState.drivers.find((s) => s.driverId === driver.id)}
        raceState={raceState}
        allDrivers={drivers}
        onRetire={onRetire}
        mode={driverMode ? 'driver' : 'tm'}
      />
    </div>
  )

  return (
    <>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: the timing board; subpane toggles pick the data, the panel fits itself to it */}
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
                  drivers={drivers}
                  teams={teams}
                  states={raceState.drivers}
                  currentLap={raceState.currentLap}
                  totalLaps={raceState.totalLaps}
                  gridPos={gridPos}
                  columns={[...columns]}
                  selectedDriverId={effectiveFollow}
                  onSelectDriver={selectRow}
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
                          on ? 'bg-[#232A38] text-[#FFFFFF]' : 'text-[#6B7280] hover:bg-[#1E2431]'
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

        {/* Center: the track map with its display toggles */}
        <div className="flex-1 min-w-0 relative">
          <RaceTrackMap
            layout={layout}
            cars={cars}
            sampleRef={sampleRef}
            followId={effectiveFollow}
            onFollow={setFollowId}
            showLabels={labelsOn}
          />
          <div className="absolute top-3 right-3 flex gap-1.5">
            <Tooltip content="Driver labels">
              <button
                onClick={(e) => { e.currentTarget.blur(); setLabelsOn((v) => !v) }}
                className={`flex items-center justify-center w-11 h-11 rounded-lg cursor-pointer transition-colors ${
                  labelsOn ? 'bg-[#232A38] text-[#FFFFFF]' : 'text-[#6B7280] hover:bg-[#1E2431]'
                }`}
              >
                <Tag size={21} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Right: post-race results, the god-mode panel, or commentary + live championship */}
        <div className="w-80 shrink-0 border-l border-[#232A38] flex flex-col min-h-0 p-3 gap-3">
          {phase === 'finished' ? (
            <PostRacePanel results={results} teams={teams} />
          ) : godOpen && !driverMode && !teamManagerMode ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <GodModePanel
                drivers={drivers}
                teams={teams}
                states={raceState.drivers}
                raceState={raceState}
                selectedDriverId={godSelectedId ?? drivers[0]?.id ?? ''}
                onAction={onGodActions}
              />
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0">
                <CommentaryFeed entries={raceState.commentary} />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <LiveChampionship
                  states={raceState.drivers}
                  drivers={drivers}
                  teams={teams}
                  baselineDrivers={baselineDrivers}
                  baselineConstructors={baselineConstructors}
                  year={year}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom: pit wall cards flanking the centre console (racing only) */}
      {phase === 'racing' && (
        <div className="flex items-stretch gap-3 px-4 pb-3 pt-0 shrink-0 border-t border-[#232A38]">
          {myDrivers[0] && pod(myDrivers[0])}
          <div className="flex-1 min-w-0 self-stretch">
            <CentreConsole
              circuitName={circuit.name}
              countryCode={circuit.country}
              lap={raceState.currentLap}
              totalLaps={raceState.totalLaps}
              weather={raceState.weather}
              forecast={raceState.weatherForecast}
              speed={speed}
              paused={paused}
              onSpeed={onSpeedClick}
              onTogglePause={onTogglePause}
              straightness={circuit.straightness}
              // Monaco stands in for every venue until per-track backdrops are sourced (see README attribution).
              backdropUrl="/track-backdrops/monaco.png"
              speedLabels={{ 1: '1×', 2: '2×', 3: '5×', 4: '10×', 5: '25×' }}
              topRight={
                !driverMode && !teamManagerMode ? (
                  <button
                    onClick={(e) => { e.currentTarget.blur(); setGodOpen((v) => !v) }}
                    className={consoleChipClass}
                    style={{ background: CHIP_BG, ...(godOpen ? { color: '#00D9FF', borderColor: '#00D9FF' } : {}) }}
                  >
                    GOD MODE
                  </button>
                ) : undefined
              }
            />
          </div>
          {myDrivers[1]
            ? pod(myDrivers[1])
            : myDrivers[0]
              // Driver mode has a single card; balance it so the console stays screen-centred.
              ? <div className="w-[480px] shrink-0" />
              : null}
        </div>
      )}
    </>
  )
}
