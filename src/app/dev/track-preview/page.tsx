'use client'

import { useRef, useState } from 'react'
import {
  ArrowUpDown, FastForward, Hourglass, Layers, LayoutGrid, LifeBuoy, PanelLeftClose, PanelLeftOpen, Shield, Tag,
  Timer, Wrench, type LucideIcon,
} from 'lucide-react'
import type { SimSpeed } from '@/lib/sim/types'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { RaceTrackMap, type TrackCarMeta } from '@/components/race/RaceTrackMap'
import RaceTable, { ALL_RACE_TABLE_COLUMNS, type RaceTableColumn } from '@/components/race/RaceTable'
import CommentaryFeed from '@/components/race/CommentaryFeed'
import { LiveChampionship } from '@/components/race/LiveChampionship'
import { PitWallCard } from '@/components/race/PitWallPanel'
import { WeatherGraph } from '@/components/race/WeatherGraph'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  MOCK_BASELINE_CONSTRUCTORS, MOCK_BASELINE_DRIVERS, MOCK_CIRCUIT, MOCK_DRIVERS, MOCK_GRID, MOCK_LAP,
  MOCK_RACE_STATE, MOCK_STATES, MOCK_TEAMS, MOCK_TOTAL_LAPS,
} from './mock'

// Dev-only preview (#sim-overhaul phase 6 spike): the Monaco track map inside the real race-screen
// components (header, timing board, commentary, live championship, pit wall, speed bar) on fabricated
// data. No sim wiring: the map markers are a constant-speed parade. Open at /dev/track-preview.

const PARADE_LAP_MS = 40000

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
const CARS: TrackCarMeta[] = MOCK_STATES.filter((s) => !s.retired).map((s) => {
  const driver = MOCK_DRIVERS.find((d) => d.id === s.driverId)!
  const team = teamOf.get(driver.teamId)
  return {
    id: s.driverId,
    pos: s.position,
    color: team?.color ?? '#888',
    name: driver.name,
    team: team?.name,
    nationality: driver.nationality,
    isPlayer: s.driverId === 'car-7',
  }
})

const PLAYER_CAR_IDS = ['car-6', 'car-7'] as const

// Centre console per designs/Canvas.dc.html: absorbs the old top bar (race title + flag, rain chip,
// Track state / Data room) above the lap counter and speed controls, over a photo backdrop that fades
// out on both sides before reaching the pit wall cards.
const EDGE_MASK = 'linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent)'
const CHIP_BG = 'rgba(20,25,36,0.75)'

function CentreConsole({ speed, paused, onSpeed, onTogglePause }: { speed: SimSpeed; paused: boolean; onSpeed: (s: SimSpeed) => void; onTogglePause: () => void }) {
  const chipBtn = 'h-7 flex items-center px-4 rounded border border-[#2A3142] text-[11px] font-extrabold tracking-[1.5px] text-[#8A93A6] hover:text-[#FFFFFF] hover:border-[#3A4356] cursor-pointer'
  const keycap = 'h-6 flex items-center justify-center px-2 rounded-[3px] border border-[#2A3142] border-b-2 text-[10px] font-extrabold text-[#5C6779] font-mono'

  return (
    <div className="relative flex-1 min-w-0 self-stretch">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/track-backdrops/monaco.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center 30%',
          opacity: 0.55,
          WebkitMaskImage: EDGE_MASK,
          maskImage: EDGE_MASK,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg,rgba(15,19,25,0.82),rgba(15,19,25,0.45) 45%,rgba(15,19,25,0.88))',
          WebkitMaskImage: EDGE_MASK,
          maskImage: EDGE_MASK,
        }}
      />

      <div className="relative h-full flex flex-col justify-between px-16 py-4">
        {/* Top row: race identity + rain + panel chips */}
        <div className="flex items-center gap-3">
          <NationalityFlag code={MOCK_CIRCUIT.country} />
          <span className="text-lg font-extrabold tracking-[2px]">{MOCK_CIRCUIT.name.toUpperCase()}</span>
          {/* Understated lap counter: plain text, no card. */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-extrabold tracking-[1.5px] text-[#8A93A6]">LAP</span>
            <span className="text-base font-extrabold tabular-nums leading-none">{MOCK_LAP}</span>
            <span className="text-xs font-bold text-[#8A93A6]">/ {MOCK_TOTAL_LAPS}</span>
          </div>
          <div className="ml-auto flex gap-2">
            <button className={chipBtn} style={{ background: CHIP_BG }}>DATA ROOM</button>
          </div>
        </div>

        {/* Middle: the track condition takes centre stage — the live WeatherGraph (actual line revealed
            lap by lap, forecast ahead, hover readout, god-mode reveal toggle), enlarged. */}
        <div className="flex justify-center">
          <div className="rounded border border-[#2A3142] px-3 py-1.5" style={{ background: CHIP_BG }}>
            <WeatherGraph
              weather={MOCK_RACE_STATE.weather}
              forecast={MOCK_RACE_STATE.weatherForecast}
              currentLap={MOCK_LAP}
              totalLaps={MOCK_TOTAL_LAPS}
              graphWidth={340}
              graphHeight={52}
            />
          </div>
        </div>

        {/* Bottom: speed steps + pause + keycap hints */}
        <div className="flex items-center justify-center gap-4">
          <div className="flex gap-1.5">
            {([1, 2, 3, 4, 5] as SimSpeed[]).map((s) => (
              <button
                key={s}
                onClick={() => onSpeed(s)}
                className={`w-[42px] h-8 flex items-center justify-center rounded border text-[13px] font-extrabold cursor-pointer ${
                  speed === s
                    ? 'border-[#00D9FF] bg-[#00D9FF]/15 text-[#00D9FF]'
                    : 'border-[#2A3142] text-[#8A93A6] hover:text-[#FFFFFF]'
                }`}
                style={speed === s ? undefined : { background: CHIP_BG }}
              >
                {s === 5 ? <FastForward size={15} className="fill-current" /> : `${s}×`}
              </button>
            ))}
          </div>
          <button
            onClick={onTogglePause}
            className="h-8 flex items-center px-7 rounded bg-[#00D9FF] hover:bg-[#4DE4FF] text-[#0F1419] text-[13px] font-extrabold tracking-[1.5px] cursor-pointer"
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <div className="flex items-center gap-1.5">
            <div className={keycap} style={{ background: CHIP_BG }}>SPACE</div>
            {['1', '2', '3', '4'].map((k) => (
              <div key={k} className={`${keycap} w-6 px-0`} style={{ background: CHIP_BG }}>{k}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TrackPreviewPage() {
  const layout = TRACK_LAYOUTS.monaco
  const [standingsOpen, setStandingsOpen] = useState(true)
  const [columns, setColumns] = useState<Set<RaceTableColumn>>(new Set(ALL_RACE_TABLE_COLUMNS))
  const [labelsOn, setLabelsOn] = useState(false)
  const [speed, setSpeed] = useState<SimSpeed>(2)
  const [paused, setPaused] = useState(false)

  const toggleColumn = (col: RaceTableColumn) =>
    setColumns((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })

  const sampleRef = useRef((id: string) => {
    const i = Number(id.split('-')[1])
    const t = (performance.now() % PARADE_LAP_MS) / PARADE_LAP_MS
    return t - i * 0.03
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
                  states={MOCK_STATES}
                  currentLap={MOCK_LAP}
                  totalLaps={MOCK_TOTAL_LAPS}
                  gridPos={MOCK_GRID}
                  columns={[...columns]}
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
        <div className="flex-1 min-w-0 relative p-6">
          <RaceTrackMap layout={layout} cars={CARS} sampleRef={sampleRef} showLabels={labelsOn} />
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
        </div>

        {/* Right: commentary + live championship */}
        <div className="w-80 shrink-0 border-l border-[#232A38] flex flex-col p-3 gap-3">
          <div className="flex-1 min-h-0">
            <CommentaryFeed entries={MOCK_RACE_STATE.commentary} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <LiveChampionship
              states={MOCK_STATES}
              drivers={MOCK_DRIVERS}
              teams={MOCK_TEAMS}
              baselineDrivers={MOCK_BASELINE_DRIVERS}
              baselineConstructors={MOCK_BASELINE_CONSTRUCTORS}
              year={MOCK_RACE_STATE.year}
            />
          </div>
        </div>
      </div>

      {/* Bottom: fixed-width car cards flanking the centre console (absorbs the old top bar) */}
      <div className="flex items-stretch gap-0 px-4 py-3 shrink-0 border-t border-[#232A38]">
        <div className="shrink-0 self-center">
          <CarPod id={PLAYER_CAR_IDS[0]} />
        </div>
        <CentreConsole
          speed={speed}
          paused={paused}
          onSpeed={setSpeed}
          onTogglePause={() => setPaused((v) => !v)}
        />
        <div className="shrink-0 self-center">
          <CarPod id={PLAYER_CAR_IDS[1]} />
        </div>
      </div>
    </div>
  )
}

function CarPod({ id }: { id: string }) {
  const driver = MOCK_DRIVERS.find((d) => d.id === id)!
  return (
    <PitWallCard
      driver={driver}
      team={teamOf.get(driver.teamId)}
      ds={MOCK_STATES.find((s) => s.driverId === id)}
      raceState={MOCK_RACE_STATE}
      allDrivers={MOCK_DRIVERS}
      onRetire={() => {}}
      mode="tm"
    />
  )
}
