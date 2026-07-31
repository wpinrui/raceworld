'use client'

// The perf lab on its own URL: /dev/perf-lab
//
// Reaching the lab through a race meant loading a save, starting a session and measuring a renderer
// through whatever state that save happened to be in. This page owns none of that. It builds a field
// out of nothing (field.ts), mounts the map full bleed, and opens the lab.
//
// The chrome sits in a bar ABOVE the map rather than floating over it, and that is a measurement
// decision rather than a layout one: anything drawn in front of the canvas occludes it, an occluded
// canvas rasterises less, and the panel would be lowering the numbers it was there to report.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Flag, Play, Wrench } from 'lucide-react'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { RaceTrackMap, type TrackSample } from '@/components/race/RaceTrackMap'
import { Tooltip } from '@/components/ui/Tooltip'
import { LAB_CARS, LAB_TEAM_ORDER, labSample } from './field'

const CIRCUITS = Object.keys(TRACK_LAYOUTS).sort()

function Toggle({ on, label, icon: Icon, onClick }: {
  on: boolean; label: string; icon: typeof Circle; onClick: () => void
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={(e) => { e.currentTarget.blur(); onClick() }}
        className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] cursor-pointer ${
          on ? 'bg-[#232A38] text-[#FFFFFF]' : 'text-[#FFFFFF] hover:bg-[#1E2431]'
        }`}
      >
        <Icon size={16} color={on ? '#00D9FF' : '#FFFFFF'} />
        {label}
      </button>
    </Tooltip>
  )
}

export default function PerfLabPage() {
  const [circuitId, setCircuitId] = useState('monaco')
  const [rolling, setRolling] = useState(false)
  const [pitStop, setPitStop] = useState(true)
  const layout = TRACK_LAYOUTS[circuitId]

  // Read inside the map's own rAF, so the sampler is published after each commit rather than through
  // the closure a render happened to capture. The map holds the ref for the length of a race and never
  // takes it as a dependency, which is the whole reason it is a ref.
  const t0 = useRef(0)
  const sampleRef = useRef<(id: string) => TrackSample>(() => null)
  useEffect(() => {
    sampleRef.current = (id) => {
      if (!t0.current) t0.current = performance.now()
      return labSample(id, { rolling, pitStop, now: performance.now() - t0.current })
    }
  }, [rolling, pitStop])

  // A remount per circuit, so the geometry caches, the racing-line solve and the found landmarks are
  // never a lap behind the picture.
  const mapKey = useMemo(() => `${circuitId}|${LAB_CARS.length}`, [circuitId])

  return (
    <div className="flex h-full flex-col bg-[#0F1319] text-[#FFFFFF]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#232A38] px-3 py-2">
        <Flag size={16} color="#00D9FF" />
        <select
          value={circuitId}
          onChange={(e) => setCircuitId(e.target.value)}
          className="h-9 rounded-lg border border-[#2A3142] bg-[#151A22] px-2 text-[12px] text-[#FFFFFF] cursor-pointer"
        >
          {CIRCUITS.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <Toggle
          on={rolling} label="Field rolling" icon={Play} onClick={() => setRolling((v) => !v)}
        />
        <Toggle
          on={pitStop} label="Stop in progress" icon={Wrench} onClick={() => setPitStop((v) => !v)}
        />
        <span className="ml-auto flex items-center gap-1.5 text-[12px]">
          <Circle size={8} fill="#00D9FF" color="#00D9FF" />
          {LAB_CARS.length} cars
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <RaceTrackMap
          key={mapKey}
          layout={layout}
          cars={LAB_CARS}
          sampleRef={sampleRef}
          followId={null}
          onFollow={() => {}}
          teamOrder={LAB_TEAM_ORDER}
          openPerfLab
        />
      </div>
    </div>
  )
}
