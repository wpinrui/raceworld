import { TEMP } from '@/lib/sim/tyre-temp'

// A glanceable tyre-temperature gauge (Motorsport-Manager style): a blue→green→red track with the optimal
// WINDOW [0,1] as the green centre band, and a marker for the tyre's current temp. No number — temp is a
// normalised, abstract quantity; the player reads "cold / in the window / overheating" from the marker alone.
const span = TEMP.MAX - TEMP.MIN
const pos = (t: number) => Math.max(0, Math.min(100, ((t - TEMP.MIN) / span) * 100))
const LO = pos(0) // window floor, %
const HI = pos(1) // window ceiling, %

export default function TyreTempGauge({ temp, className = '' }: { temp: number; className?: string }) {
  const p = pos(temp)
  const cold = temp < 0, hot = temp > 1
  const marker = cold ? '#00D9FF' : hot ? '#DC143C' : '#10B981'
  return (
    <div
      className={`relative h-2 rounded-full ${className}`}
      style={{ background: `linear-gradient(to right, #00D9FF 0%, #10B981 ${LO}%, #10B981 ${HI}%, #F59E0B ${HI + (100 - HI) * 0.55}%, #DC143C 100%)` }}
    >
      {/* window edges */}
      <div className="absolute inset-y-0 w-px bg-black/40" style={{ left: `${LO}%` }} />
      <div className="absolute inset-y-0 w-px bg-black/40" style={{ left: `${HI}%` }} />
      {/* current-temp marker: a white bar (poking out top + bottom) with a state-coloured core, readable on any band */}
      <div
        className="absolute -top-1 -bottom-1 w-[3px] rounded-full bg-white"
        style={{ left: `calc(${p}% - 1.5px)`, boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }}
      >
        <div className="absolute inset-x-0 top-1 bottom-1 rounded-full" style={{ backgroundColor: marker }} />
      </div>
    </div>
  )
}
