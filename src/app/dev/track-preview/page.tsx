'use client'

import { useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { RaceTrackMap, type TrackCarMeta } from '@/components/race/RaceTrackMap'

// Dev-only preview (#sim-overhaul phase 6 spike): the Monaco track map plus a placeholder skeleton of the
// race screen (MM-inspired). No sim wiring: markers are a constant-speed parade so the map reads alive.
// Open at /dev/track-preview.

const TEAM_COLORS = ['#DC143C', '#1E6FD9', '#00A19C', '#F58020', '#9B59B6', '#2ECC71', '#E8B923', '#FF69B4', '#8B4513', '#5D6D7E']

const CARS: TrackCarMeta[] = Array.from({ length: 20 }, (_, i) => ({
  id: `car-${i}`,
  pos: i + 1,
  color: TEAM_COLORS[Math.floor(i / 2)],
  name: `Car ${i + 1}`,
  team: `Team ${Math.floor(i / 2) + 1}`,
  isPlayer: i === 7,
}))

// Parade drift: the field spread over ~60% of the lap, all moving at one slow constant speed.
const PARADE_LAP_MS = 40000

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

  const sampleRef = useRef((id: string) => {
    const i = Number(id.split('-')[1])
    const t = (performance.now() % PARADE_LAP_MS) / PARADE_LAP_MS
    return t - i * 0.03
  })

  return (
    <div className="flex flex-col h-screen bg-[#0F1319] text-[#FFFFFF]">
      {/* Top bar: weather / track state / god-mode entry placeholders */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-[#232A38]">
        <div className="font-semibold text-sm tracking-widest uppercase">Monaco</div>
        <Placeholder label="Weather" className="h-9 w-40" />
        <Placeholder label="Track state" className="h-9 w-40" />
        <div className="flex-1" />
        <Placeholder label="Data room" className="h-9 w-32" />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: standings, collapsible */}
        <div className={`shrink-0 border-r border-[#232A38] flex flex-col transition-all ${standingsOpen ? 'w-64' : 'w-10'}`}>
          <div className="flex items-center justify-between px-2 py-2">
            {standingsOpen && <span className="text-xs font-semibold tracking-widest uppercase">Standings</span>}
            <button
              className="p-1 rounded hover:bg-[#232A38] cursor-pointer"
              onClick={() => setStandingsOpen((v) => !v)}
            >
              {standingsOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
          </div>
          {standingsOpen && (
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
              {CARS.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded bg-[#161B26] px-2 py-1">
                  <span className="w-5 text-right text-xs font-bold">{c.pos}</span>
                  <span className="w-1.5 h-4 rounded-sm" style={{ backgroundColor: c.color }} />
                  <span className="text-xs font-medium flex-1">{c.name}</span>
                  <span className="text-xs tabular-nums">{c.pos === 1 ? '-' : `+${(c.pos * 0.4).toFixed(1)}`}</span>
                </div>
              ))}
            </div>
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
          <div className="font-semibold text-sm tracking-widest uppercase">Lap 1 / 78</div>
          <Placeholder label="Speed controls" className="h-10 w-full" />
        </div>
        <Placeholder label="Car 2 pit wall" className="h-24 flex-1" />
      </div>
    </div>
  )
}
