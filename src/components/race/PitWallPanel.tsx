'use client'

import { useState } from 'react'
import type { Driver, Team, DriverRaceState, RaceState, TyreCompound, SliderLevel } from '@/lib/sim/types'
import { useRaceStore, type PitCommand } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import { resolveIntensity } from '@/lib/sim/push'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { formatLiveGap } from '@/lib/format'
import TyreIndicator from './TyreIndicator'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { Tooltip } from '@/components/ui/Tooltip'

// Pit wall card, redesigned per designs/Pit Wall Card.dc.html: a fixed-width card with an always-visible
// telemetry strip (compound / tyre / stint / temp / gap / AI plan) + status block, and a STRAT | PACE
// tab rail for the controls. The pace tab uses the MODE / LEVEL hierarchy (variant 2a): a MODE row
// (Overtake / Conserve / Manual / Auto — A-Def in Driver mode) drives the LEVEL slider, which is a tinted
// readout while a mode is driving and only lights as a control in Manual; touching a level takes Manual.
// The Push preset is dropped as redundant (= Manual at Push).

const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']
const CRITICAL = 10 // tyre condition at/under which a stop is imminent

const C = {
  surface: '#1E2431', inset: '#141924', border: '#2A3142', muted: '#5C6779', secondary: '#8A93A6',
  cyan: '#00D9FF', red: '#DC143C', amber: '#FFB020', green: '#2ECC71', violet: '#8B7CF6', blue: '#3B82F6',
} as const

const LEVEL_LABELS = ['BACK', 'EASE', 'NORM', 'PUSH', 'MAX'] as const

// Where the player's car would slot back in if it pitted THIS lap: add the pit-lane loss to its race time
// and read the field by race time (the same projection the AI uses to judge clear air). Returns the net
// position and the nearest car — behind whom it rejoins, or (if it would keep the lead) ahead of whom.
function rejoinProjection(ds: DriverRaceState, raceState: RaceState, drivers: Driver[]) {
  const rejoinTime = ds.totalTime + pitLaneLoss(raceState.year)
  const others = raceState.drivers.filter((o) => o.driverId !== ds.driverId && !o.retired)
  const nameOf = (id: string) => drivers.find((d) => d.id === id)?.name ?? '—'
  const ahead = others.filter((o) => o.totalTime <= rejoinTime)
  const position = ahead.length + 1
  if (ahead.length > 0) {
    const carAhead = ahead.reduce((best, o) => (o.totalTime > best.totalTime ? o : best))
    return { position, gap: rejoinTime - carAhead.totalTime, other: nameOf(carAhead.driverId), ahead: false }
  }
  const behind = others.filter((o) => o.totalTime > rejoinTime)
  if (behind.length > 0) {
    const carBehind = behind.reduce((best, o) => (o.totalTime < best.totalTime ? o : best))
    return { position, gap: carBehind.totalTime - rejoinTime, other: nameOf(carBehind.driverId), ahead: true }
  }
  return { position, gap: 0, other: null, ahead: true }
}

// The status block line: dot + text colour + an optional right-side hint.
function statusLine(cmd: PitCommand, ds: DriverRaceState, currentLap: number): { color: string; text: string; hint?: string } {
  const cond = Math.round(ds.currentTyre.condition)
  if (cmd !== 'auto' && cmd !== 'hold') return { color: C.cyan, text: `PITTING THIS LAP → ${cmd.pit.toUpperCase()}` }
  if (cmd === 'hold') {
    return cond < CRITICAL
      ? { color: C.red, text: `STAYING OUT, TYRE CRITICAL (${cond}%)`, hint: 'AI OVERRIDDEN' }
      : { color: C.amber, text: 'STAYING OUT', hint: 'AI OVERRIDDEN' }
  }
  if (ds.targetPitLap != null && ds.targetPitLap <= currentLap)
    return { color: C.cyan, text: `PITTING THIS LAP → ${ds.targetNextCompound.toUpperCase()}` }
  if (cond < CRITICAL) return { color: C.red, text: `STOP IMMINENT (${cond}%)` }
  return { color: C.green, text: 'RUNNING', hint: `PLAN L${ds.targetPitLap ?? '—'}` }
}

// Temperature readout: the window [0,1] maps onto the green band (26%..72%) of the gradient bar.
function TempBar({ temp, critical }: { temp: number; critical: boolean }) {
  const pct = Math.min(97, Math.max(3, 26 + 46 * temp))
  return (
    <div className="flex flex-col gap-1 pt-0.5">
      <div
        className="relative w-[72px] h-[6px] rounded-[3px]"
        style={{ background: `linear-gradient(90deg,${C.blue} 0 26%,${C.green} 26% 72%,${C.red} 72% 100%)` }}
      >
        <div
          className="absolute top-1/2 w-[12px] h-[12px] rounded-full bg-[#FFFFFF] box-border"
          style={{ left: `${pct}%`, transform: 'translate(-50%,-50%)', border: `2px solid ${C.surface}` }}
        />
      </div>
      <div className="text-[9.5px] font-bold tracking-[1px]" style={{ color: critical ? C.red : C.muted }}>TEMP</div>
    </div>
  )
}

function Stat({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) {
  return (
    <div>
      <div className="text-sm font-bold tabular-nums" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="text-[9.5px] font-bold tracking-[1px]" style={{ color: C.muted }}>{label}</div>
    </div>
  )
}

function RetireButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ml-auto text-[10px] font-extrabold tracking-[1px] rounded px-2.5 py-1 cursor-pointer hover:bg-[rgba(220,20,60,0.15)]"
      style={{ color: C.red, border: '1px solid rgba(220,20,60,0.35)' }}
    >
      RETIRE
    </button>
  )
}

// ── STRAT tab: AUTO / PIT / HOLD segmented control + context line (compound picker while PIT is armed) ──
function StratTab({ driver, ds, onRetire }: { driver: Driver; ds: DriverRaceState; onRetire: (id: string) => void }) {
  const cmd: PitCommand = useRaceStore((s) => s.pitCommands[driver.id]) ?? 'auto'
  const setPitCommand = useRaceStore((s) => s.setPitCommand)
  const isPit = cmd !== 'auto' && cmd !== 'hold'
  const armedCompound: TyreCompound = isPit ? cmd.pit : ds.targetNextCompound

  const seg = (active: boolean, color: string) =>
    active
      ? { background: `${color}1F`, color, boxShadow: `inset 0 -2px 0 ${color}` }
      : undefined

  return (
    <div className="flex-1 px-3 py-2 flex flex-col gap-[7px] justify-center min-w-0">
      <div className="flex rounded-[5px] overflow-hidden h-[27px]" style={{ background: C.inset, border: `1px solid ${C.border}` }}>
        {([
          ['auto', 'AUTO', C.cyan, () => setPitCommand(driver.id, 'auto')],
          ['pit', 'PIT', C.cyan, () => setPitCommand(driver.id, { pit: armedCompound })],
          ['hold', 'HOLD', C.amber, () => setPitCommand(driver.id, 'hold')],
        ] as const).map(([key, label, color, onClick], i) => {
          const active = key === 'pit' ? isPit : cmd === key
          return (
            <button
              key={key}
              onClick={onClick}
              className={`flex-1 text-[11px] font-extrabold tracking-[1px] cursor-pointer ${active ? '' : 'text-[#8A93A6] hover:text-[#FFFFFF]'} ${i > 0 ? 'border-l border-[#2A3142]' : ''}`}
              style={seg(active, color)}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 min-h-[24px]">
        {isPit ? (
          <>
            <span className="text-[10px] font-extrabold tracking-[1px]" style={{ color: C.muted }}>BOX FOR</span>
            <div className="flex gap-1">
              {COMPOUNDS.map((c) => (
                <button
                  key={c}
                  onClick={() => setPitCommand(driver.id, { pit: c })}
                  className="rounded-full cursor-pointer"
                  style={c === armedCompound ? { boxShadow: `0 0 0 2px ${C.surface}, 0 0 0 4px ${C.cyan}` } : { opacity: 0.55 }}
                >
                  <TyreIndicator compound={c} size="sm" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="text-[10px] font-bold tracking-[0.8px]" style={{ color: C.muted }}>
            {cmd === 'hold' ? 'STAYS OUT THIS LAP' : 'STRATEGIST IN CONTROL'}
          </span>
        )}
        <RetireButton onClick={() => onRetire(driver.id)} />
      </div>
    </div>
  )
}

// ── PACE tab: the MODE / LEVEL hierarchy ──
type PaceMode = 'overtake' | 'conserve' | 'manual' | 'auto' | 'adef'

function PaceTab({ ds, mode }: { ds: DriverRaceState; mode: 'driver' | 'tm' }) {
  const setPushSlider = useRaceStore((s) => s.setPushSlider)
  const setPushPreset = useRaceStore((s) => s.setPushPreset)
  const setPushAuto = useRaceStore((s) => s.setPushAuto)
  const setAutoDefend = useRaceStore((s) => s.setAutoDefend)

  const push = ds.push ?? { kind: 'manual' as const, level: 0 as SliderLevel }
  const temp = ds.tyreTemp ?? 0.5
  const active: PaceMode = ds.pushAuto
    ? 'auto'
    : ds.autoDefend
      ? 'adef'
      : push.kind === 'preset' && push.preset === 'overtake'
        ? 'overtake'
        : push.kind === 'preset' && push.preset === 'conserve'
          ? 'conserve'
          : 'manual'
  // The level the sim is actually running: the defensive push shows at MAX even though intent stays Normal.
  const level = ds.defending ? 2 : resolveIntensity(push)

  const modeColor: Record<PaceMode, string> = {
    overtake: C.red, conserve: C.green, manual: '#FFFFFF', auto: C.cyan, adef: C.cyan,
  }
  // In Manual the slider is the control and its colour doubles as the temp warning; while a mode drives,
  // the active step is a readout tinted in that mode's colour.
  const tempColor = temp < 0 ? C.blue : temp > 1 ? C.red : C.violet
  const takeManual = () => setPushSlider(ds.driverId, Math.max(-2, Math.min(2, level)) as SliderLevel)

  const autoKey: PaceMode = mode === 'tm' ? 'auto' : 'adef'
  const modeDefs: Array<{ key: PaceMode; label: string; dot?: boolean; onClick: () => void }> = [
    { key: 'overtake', label: 'OVERTAKE', onClick: () => setPushPreset(ds.driverId, 'overtake') },
    { key: 'conserve', label: 'CONSERVE', onClick: () => setPushPreset(ds.driverId, 'conserve') },
    { key: 'manual', label: 'MANUAL', onClick: takeManual },
    mode === 'tm'
      ? { key: 'auto', label: 'AUTO', dot: true, onClick: () => setPushAuto(ds.driverId, !ds.pushAuto) }
      : { key: 'adef', label: 'A-DEF', dot: true, onClick: () => setAutoDefend(ds.driverId, !ds.autoDefend) },
  ]

  return (
    <div className="flex-1 px-3 py-2 flex flex-col gap-[7px] justify-center min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[9px] font-extrabold tracking-[1px]" style={{ color: C.muted }}>MODE</span>
        <div className="flex-1 flex gap-1">
          {modeDefs.map(({ key, label, dot, onClick }) => {
            const on = active === key
            const color = modeColor[key]
            const style = on
              ? key === 'manual'
                ? { background: C.border, border: '1px solid #3A4356', color: '#FFFFFF' }
                : key === autoKey
                  ? { background: 'rgba(0,217,255,0.12)', border: `1px solid ${C.cyan}`, color: C.cyan }
                  : { background: color, border: `1px solid ${color}`, color: '#FFFFFF' }
              : { background: C.inset, border: `1px solid ${C.border}`, color: C.secondary }
            return (
              <button
                key={key}
                onClick={onClick}
                className="flex-1 h-[25px] flex items-center justify-center gap-1 text-[10px] font-extrabold tracking-[0.5px] rounded cursor-pointer hover:text-[#FFFFFF]"
                style={style}
              >
                {dot && <span className="w-[6px] h-[6px] rounded-full" style={{ background: on ? C.cyan : C.muted }} />}
                {label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[9px] font-extrabold tracking-[1px]" style={{ color: C.muted }}>LEVEL</span>
        <div className={`flex-1 flex gap-0.5 ${active !== 'manual' ? 'opacity-85' : ''}`}>
          {LEVEL_LABELS.map((label, i) => {
            const lv = (i - 2) as SliderLevel
            const on = level === lv
            const style = !on
              ? { background: C.inset, border: `1px solid ${C.border}`, color: C.muted }
              : active === 'manual'
                ? { background: tempColor, border: `1px solid ${tempColor}`, color: '#FFFFFF' }
                : { background: `${modeColor[active] === '#FFFFFF' ? C.border : modeColor[active]}40`, border: `1px solid ${modeColor[active]}`, color: '#FFFFFF' }
            return (
              <button
                key={label}
                onClick={() => setPushSlider(ds.driverId, lv)}
                className="flex-1 h-[24px] flex items-center justify-center text-[9.5px] font-bold rounded-[3px] cursor-pointer"
                style={style}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function PitWallCard({ driver, team, ds, raceState, allDrivers, onRetire, mode, teammatePitting = false }: { driver: Driver; team: Team | undefined; ds: DriverRaceState | undefined; raceState: RaceState; allDrivers: Driver[]; onRetire: (id: string) => void; mode: 'driver' | 'tm'; teammatePitting?: boolean }) {
  const cmd: PitCommand = useRaceStore((s) => s.pitCommands[driver.id]) ?? 'auto'
  const [tab, setTab] = useState<'strat' | 'pace'>('strat')

  const header = (
    <div className="relative flex items-center gap-2 h-[40px] pl-[17px] pr-3 border-b" style={{ borderColor: C.border }}>
      <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: team?.color ?? C.muted }} />
      {/* Plain text on purpose: race day never navigates away to the driver page. */}
      <NationalityFlag code={driver.nationality} />
      <span className="text-[16px] font-semibold text-[#FFFFFF]">{driver.name}</span>
      {ds?.defending && (
        <span
          className="flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[10px] font-extrabold tracking-[1px]"
          style={{ color: C.red, background: 'rgba(220,20,60,0.15)', border: '1px solid rgba(220,20,60,0.4)' }}
        >
          <span className="w-[6px] h-[6px] rounded-full" style={{ background: C.red }} />
          DEFENDING
        </span>
      )}
      {ds && <span className="ml-auto text-[16px] font-extrabold tabular-nums" style={{ color: C.cyan }}>P{ds.position}</span>}
    </div>
  )

  if (!ds || ds.retired) {
    return (
      <div className="w-[480px] rounded-lg overflow-hidden text-[#FFFFFF]" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        {header}
        <p className="px-[17px] py-3 text-sm text-[#FFFFFF]">{ds?.retired ? `Retired, L${ds.retirementLap ?? ''}` : 'Out of the race.'}</p>
      </div>
    )
  }

  const cond = Math.round(ds.currentTyre.condition)
  const st = statusLine(cmd, ds, raceState.currentLap)
  const isPit = cmd !== 'auto' && cmd !== 'hold'
  const rejoin = rejoinProjection(ds, raceState, allDrivers)

  return (
    <div className="w-[480px] rounded-lg overflow-hidden text-[#FFFFFF]" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      {header}

      {/* Telemetry strip */}
      <div className="flex items-center gap-4 pl-[17px] pr-3 pt-[9px] pb-1.5">
        <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
        <Stat value={`${cond}%`} label="TYRE" valueColor={cond < 20 ? C.red : undefined} />
        <Stat value={`L${ds.stintLap}`} label="STINT" />
        {ds.tyreTemp != null && <TempBar temp={ds.tyreTemp} critical={ds.tyreTemp > 1} />}
        <Stat value={formatLiveGap(ds.gap)} label="GAP" />
        <Tooltip content="AI plan: pit lap and next compound">
          <div className="ml-auto flex items-center gap-[6px] rounded-[5px] px-2 py-1" style={{ background: C.inset, border: `1px solid ${C.border}` }}>
            <span className="text-[10px] font-extrabold tracking-[1px]" style={{ color: C.muted }}>AI</span>
            <span className="text-[13px] font-bold tabular-nums">L{ds.targetPitLap ?? '—'}</span>
            <span className="text-[11px]" style={{ color: C.muted }}>→</span>
            <TyreIndicator compound={ds.targetNextCompound} size="sm" />
          </div>
        </Tooltip>
      </div>

      {/* Status block */}
      <div className="flex flex-col gap-1 pl-[17px] pr-3 pb-[9px]">
        <div className="flex items-center gap-[5px]">
          <span className="w-[6px] h-[6px] rounded-full" style={{ background: st.color }} />
          <span className="text-[12px] font-bold tracking-[1px]" style={{ color: st.color === C.green ? C.secondary : st.color }}>{st.text}</span>
          {st.hint && <span className="ml-auto text-[12px] font-bold tracking-[1px]" style={{ color: C.muted }}>{st.hint}</span>}
        </div>
        <div className="text-[13px]" style={{ color: C.secondary }}>
          {isPit ? 'Rejoin' : 'Pit now'}: <span className="font-bold text-[#FFFFFF]">P{rejoin.position}</span>
          {rejoin.other && `, ${rejoin.gap.toFixed(1)}s ${rejoin.ahead ? 'ahead of' : 'behind'} ${rejoin.other}`}
        </div>
        {mode === 'driver' && teammatePitting && (
          <div className="text-[12px] font-bold tracking-[1px]" style={{ color: C.amber }}>TEAMMATE BOXING THIS LAP</div>
        )}
      </div>

      {/* Controls: tab rail + active tab */}
      <div className="flex h-[74px] border-t" style={{ borderColor: C.border }}>
        <div className="w-[70px] shrink-0 flex flex-col border-r" style={{ borderColor: C.border }}>
          {(['strat', 'pace'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center text-[11px] font-extrabold tracking-[1px] cursor-pointer ${tab === t ? 'bg-[#232B3B]' : 'hover:bg-[#232B3B]'}`}
              style={tab === t ? { color: C.cyan, boxShadow: `inset 2px 0 0 ${C.cyan}` } : { color: C.muted }}
            >
              {t === 'strat' ? 'STRAT' : 'PACE'}
            </button>
          ))}
        </div>
        {tab === 'strat'
          ? <StratTab driver={driver} ds={ds} onRetire={onRetire} />
          : <PaceTab ds={ds} mode={mode} />}
      </div>
    </div>
  )
}

// Is the player's teammate boxing this lap? Used to warn against a double-stack (the AI runs the teammate
// in Driver mode, so it's their planned stop or a stop already taken this lap).
function teammateBoxingThisLap(teammate: Driver | undefined, states: DriverRaceState[], currentLap: number): boolean {
  if (!teammate) return false
  const ds = states.find((s) => s.driverId === teammate.id)
  if (!ds || ds.retired) return false
  return (ds.targetPitLap != null && ds.targetPitLap <= currentLap) || ds.lastPitLap === currentLap
}

interface Props {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  raceState: RaceState
  onRetire: (driverId: string) => void
}

export default function PitWallPanel({ drivers, teams, states, raceState, onRetire }: Props) {
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const driverMode = useSeasonStore((s) => s.driverMode)
  const playerDriverId = useSeasonStore((s) => s.playerDriverId)

  // Driver mode controls ONLY your own car; Team Manager runs both of the team's cars.
  const player = driverMode ? drivers.find((d) => d.id === playerDriverId) : undefined
  const myDrivers = driverMode
    ? (player ? [player] : [])
    : drivers.filter((d) => d.teamId === playerTeamId)
  const teammate = driverMode && player ? drivers.find((d) => d.teamId === player.teamId && d.id !== player.id) : undefined
  const teammatePitting = driverMode ? teammateBoxingThisLap(teammate, states, raceState.currentLap) : false

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-1 h-6 bg-[#DC143C] rounded-sm" />
        <h2 className="font-semibold text-sm tracking-wider text-[#FFFFFF] uppercase">Pit Wall</h2>
      </div>
      {myDrivers.length === 0 ? (
        <p className="text-sm text-[#FFFFFF]">No cars in the race.</p>
      ) : (
        myDrivers.map((d) => (
          <PitWallCard
            key={d.id}
            driver={d}
            team={teams.find((t) => t.id === d.teamId)}
            ds={states.find((s) => s.driverId === d.id)}
            raceState={raceState}
            allDrivers={drivers}
            onRetire={onRetire}
            mode={driverMode ? 'driver' : 'tm'}
            teammatePitting={teammatePitting}
          />
        ))
      )}
    </div>
  )
}
