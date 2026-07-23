'use client'

import { useRef, useState } from 'react'
import {
  ArrowUpDown, Hourglass, Layers, LayoutGrid, LifeBuoy, PanelLeftClose, PanelLeftOpen, Shield, Timer, Wrench,
  type LucideIcon,
} from 'lucide-react'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { RaceTrackMap, type TrackCarMeta } from '@/components/race/RaceTrackMap'
import RaceTable, { ALL_RACE_TABLE_COLUMNS, type RaceTableColumn } from '@/components/race/RaceTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { MOCK_DRIVERS, MOCK_GRID, MOCK_LAP, MOCK_STATES, MOCK_TEAMS, MOCK_TOTAL_LAPS } from './mock'

// Dev-only preview (#sim-overhaul phase 6 spike): the Monaco track map plus a placeholder skeleton of the
// race screen (MM-inspired). No sim wiring: the left panel is the real RaceTable on fabricated data, and
// the map markers are a constant-speed parade so the map reads alive. Open at /dev/track-preview.

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
    isPlayer: s.driverId === 'car-7',
  }
})

function Placeholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-md border border-dashed border-[#3A4252] bg-[#161B26]/80 ${className}`}>
      <span className="text-xs font-semibold tracking-widest uppercase text-[#6B7280]">{label}</span>
    </div>
  )
}

export default function TrackPreviewPage() {
  const layout = TRACK_LAYOUTS.monaco
  const [standingsOpen, setStandingsOpen] = useState(true)
  const [columns, setColumns] = useState<Set<RaceTableColumn>>(new Set(ALL_RACE_TABLE_COLUMNS))

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
      {/* Top bar: weather / track state / god-mode entry placeholders */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-[#232A38]">
        <div className="font-semibold text-sm tracking-widest uppercase">Monaco</div>
        <Placeholder label="Weather" className="h-9 w-40" />
        <Placeholder label="Track state" className="h-9 w-40" />
        <div className="flex-1" />
        <Placeholder label="Data room" className="h-9 w-32" />
      </div>

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

        {/* Center: the track map, full bleed */}
        <div className="flex-1 min-w-0 relative p-6">
          <RaceTrackMap layout={layout} cars={CARS} sampleRef={sampleRef} />
        </div>

        {/* Right: commentary + live championship placeholders */}
        <div className="w-72 shrink-0 border-l border-[#232A38] flex flex-col gap-3 p-3">
          <Placeholder label="Commentary" className="flex-1" />
          <Placeholder label="Live championship" className="flex-1" />
        </div>
      </div>

      {/* Bottom: car pods flanking the lap / speed bar */}
      <div className="flex items-stretch gap-3 px-4 py-3 shrink-0 border-t border-[#232A38]">
        <Placeholder label="Car 1 pit wall" className="h-24 flex-1" />
        <div className="flex flex-col items-center justify-center gap-2 w-80 shrink-0">
          <div className="font-semibold text-sm tracking-widest uppercase">Lap {MOCK_LAP} / {MOCK_TOTAL_LAPS}</div>
          <Placeholder label="Speed controls" className="h-10 w-full" />
        </div>
        <Placeholder label="Car 2 pit wall" className="h-24 flex-1" />
      </div>
    </div>
  )
}
