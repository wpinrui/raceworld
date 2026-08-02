'use client'

import type { Driver, DriverRaceState, Team } from '@/lib/sim/types'
import { resolveIntensity } from '@/lib/sim/push'
import { formatLapTime } from '@/lib/format'
import TyreIndicator from './TyreIndicator'

// Track-hover driver card (designs/Tooltip or driver card.dc.html): header (position, name, team),
// stat row (tyre + wear + stint, last lap, stops — the player car swaps stops for its push level),
// AHEAD strip (who's in front, gap, last-lap pace delta: green = closing), and a status footer
// (RUNNING with the gap behind, IN PIT with the box compound, the player's pit plan, or RETIRED).

const C = {
  surface: '#1E2431', inset: '#141924', border: '#2A3142', muted: '#5C6779', secondary: '#8A93A6',
  cyan: '#00D9FF', red: '#DC143C', green: '#2ECC71', violet: '#8B7CF6', blue: '#00D9FF',
} as const

interface Props {
  ds: DriverRaceState
  driver: Driver
  team?: Team
  states: DriverRaceState[]
  drivers: Driver[]
  currentLap: number
  isPlayer: boolean
}

export function DriverTrackTip({ ds, driver, team, states, drivers, currentLap, isPlayer }: Props) {
  const nameOf = (id: string) => drivers.find((d) => d.id === id)?.name ?? '—'
  const ahead = states.find((s) => !s.retired && s.position === ds.position - 1)
  const behind = states.find((s) => !s.retired && s.position === ds.position + 1)
  const myLast = ds.lapTimes[ds.lapTimes.length - 1]
  const aheadLast = ahead?.lapTimes[ahead.lapTimes.length - 1]
  const lapDelta = myLast != null && aheadLast != null ? myLast - aheadLast : null

  const pitting = !ds.retired && ds.targetPitLap != null && ds.targetPitLap <= currentLap
  const cond = Math.round(ds.currentTyre.condition)

  // Player push level: 5 cells, lit from NORMAL to the current level, coloured by tyre temperature.
  const level = ds.defending ? 2 : resolveIntensity(ds.push ?? { kind: 'manual', level: 0 })
  const temp = ds.tyreTemp ?? 0.5
  const stepColor = temp < 0 ? C.blue : temp > 1 ? C.red : C.violet
  const litFrom = Math.min(2, level + 2)
  const litTo = Math.max(2, level + 2)

  const footer = ds.retired
    ? { dot: C.red, text: 'RETIRED', color: C.red, right: <>L{ds.retirementLap ?? '—'}</>, bg: undefined as string | undefined }
    : pitting
      ? {
          dot: C.cyan, text: 'IN PIT', color: C.cyan, bg: 'rgba(0,217,255,0.08)',
          right: (
            <span className="flex items-center gap-1" style={{ color: C.cyan }}>
              BOX FOR <TyreIndicator compound={ds.targetNextCompound} size="sm" />
            </span>
          ),
        }
      : {
          dot: C.green, text: 'RUNNING', color: C.secondary, bg: undefined,
          right: isPlayer
            ? (
                <span className="flex items-center gap-1">
                  PLAN L{ds.targetPitLap ?? '—'} <TyreIndicator compound={ds.targetNextCompound} size="sm" />
                </span>
              )
            : behind
              ? <>−{behind.gap.toFixed(1)}s TO P{behind.position}</>
              : <>—</>,
        }

  return (
    <div
      className="relative w-max min-w-[300px] rounded-lg overflow-hidden text-[#FFFFFF] shadow-2xl shadow-black/50"
      style={{ background: C.surface, border: `1px solid ${C.border}` }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: team?.color ?? C.muted }} />

      {/* Header */}
      <div className="flex items-baseline gap-2.5 pl-[19px] pr-3.5 pt-2.5">
        <span className="text-[17px] font-extrabold tabular-nums" style={{ color: C.cyan }}>P{ds.position}</span>
        <span className="text-[18px] font-bold">{driver.name}</span>
        <span className="ml-auto text-[13px] font-semibold" style={{ color: C.secondary }}>
          {isPlayer ? 'You' : team?.name ?? ''}
        </span>
      </div>

      {/* Stat row */}
      <div className="flex items-center gap-4 pl-[19px] pr-3.5 pt-2.5 pb-2.5">
        <div className="flex items-center gap-2">
          <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
          <div>
            <div className="text-[14px] font-bold tabular-nums leading-tight" style={cond < 20 ? { color: C.red } : undefined}>{cond}%</div>
            <div className="text-[9px] font-bold tracking-[1px]" style={{ color: C.muted }}>L{ds.stintLap}</div>
          </div>
        </div>
        <div>
          <div className="text-[14px] font-bold tabular-nums leading-tight">{formatLapTime(myLast ?? null)}</div>
          <div className="text-[9px] font-bold tracking-[1px]" style={{ color: C.muted }}>LAST LAP</div>
        </div>
        {isPlayer ? (
          <div>
            <div className="flex items-center gap-[3px] h-[17px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-[9px] h-[6px] rounded-[1px]"
                  style={{ background: i >= litFrom && i <= litTo ? stepColor : C.border }}
                />
              ))}
            </div>
            <div className="text-[9px] font-bold tracking-[1px]" style={{ color: C.muted }}>PUSH</div>
          </div>
        ) : (
          <div>
            <div className="text-[14px] font-bold tabular-nums leading-tight">{ds.pitStops}</div>
            <div className="text-[9px] font-bold tracking-[1px]" style={{ color: C.muted }}>STOPS</div>
          </div>
        )}
      </div>

      {/* AHEAD strip */}
      <div className="flex items-baseline gap-2.5 pl-[19px] pr-3.5 pb-2.5 whitespace-nowrap">
        <span className="text-[10px] font-extrabold tracking-[1px]" style={{ color: C.muted }}>AHEAD</span>
        {ahead ? (
          <>
            <span className="text-[13px] font-bold">
              <span style={{ color: C.secondary }}>P{ahead.position}</span> {nameOf(ahead.driverId)}
            </span>
            <span className="ml-auto text-[13px] font-bold tabular-nums">
              {pitting || ds.retired ? '—' : `+${ds.gap.toFixed(1)}s`}
            </span>
            <span
              className="text-[13px] font-bold tabular-nums"
              style={{ color: lapDelta == null ? C.secondary : lapDelta <= 0 ? C.green : C.red }}
            >
              {lapDelta == null || pitting || ds.retired
                ? '— lap'
                : `${lapDelta <= 0 ? '−' : '+'}${Math.abs(lapDelta).toFixed(1)}s lap`}
            </span>
          </>
        ) : (
          <span className="text-[13px] font-bold" style={{ color: C.secondary }}>—</span>
        )}
      </div>

      {/* Status footer */}
      <div
        className="flex items-center gap-2 pl-[19px] pr-3.5 py-1.5 border-t"
        style={{ background: footer.bg ?? C.inset, borderColor: C.border }}
      >
        <span className="w-[6px] h-[6px] rounded-full" style={{ background: footer.dot }} />
        <span className="text-[11px] font-extrabold tracking-[1px]" style={{ color: footer.color }}>{footer.text}</span>
        <span className="ml-auto text-[11px] font-extrabold tracking-[1px]" style={{ color: footer.color === C.cyan ? C.cyan : C.muted }}>
          {footer.right}
        </span>
      </div>
    </div>
  )
}
