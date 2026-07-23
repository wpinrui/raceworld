'use client'

import { useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { RaceTrackMap, type TrackCarMeta } from '@/components/race/RaceTrackMap'
import RaceTable from '@/components/race/RaceTable'
import { MOCK_DRIVERS, MOCK_GRID, MOCK_LAP, MOCK_STATES, MOCK_TEAMS, MOCK_TOTAL_LAPS } from './mock'

// Dev-only preview (#sim-overhaul phase 6 spike): the Monaco track map plus a placeholder skeleton of the
// race screen (MM-inspired). No sim wiring: the left panel is the real RaceTable on fabricated data, and
// the map markers are a constant-speed parade so the map reads alive. Open at /dev/track-preview.

const PARADE_LAP_MS = 40000

const PANEL_MIN = 170
const PANEL_MAX = 900
const PANEL_DEFAULT = 700

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
  const [panelW, setPanelW] = useState<number>(PANEL_DEFAULT)
  const [standingsOpen, setStandingsOpen] = useState(true)

  const sampleRef = useRef((id: string) => {
    const i = Number(id.split('-')[1])
    const t = (performance.now() % PARADE_LAP_MS) / PARADE_LAP_MS
    return t - i * 0.03
  })

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelW
    const move = (ev: PointerEvent) =>
      setPanelW(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + ev.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

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
        {/* Left: the race-day timing board, drag-resizable and collapsible */}
        <div
          className="shrink-0 border-r border-[#232A38] flex flex-col"
          style={{ width: standingsOpen ? panelW : 40 }}
        >
          <div className="flex items-center justify-between px-2 py-2 shrink-0">
            {standingsOpen && <span className="text-xs font-semibold tracking-widest uppercase">Standings</span>}
            <button
              className="p-1 rounded hover:bg-[#232A38] cursor-pointer"
              onClick={() => setStandingsOpen((v) => !v)}
            >
              {standingsOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
          </div>
          {standingsOpen && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <RaceTable
                drivers={MOCK_DRIVERS}
                teams={MOCK_TEAMS}
                states={MOCK_STATES}
                currentLap={MOCK_LAP}
                totalLaps={MOCK_TOTAL_LAPS}
                gridPos={MOCK_GRID}
              />
            </div>
          )}
        </div>
        {standingsOpen && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize hover:bg-[#3A4252] active:bg-[#3A4252]"
            onPointerDown={startDrag}
          />
        )}

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
