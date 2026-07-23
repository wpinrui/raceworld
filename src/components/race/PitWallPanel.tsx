'use client'

import { useState } from 'react'
import type { Driver, Team, DriverRaceState, RaceState, TyreCompound, PushPreset, SliderLevel } from '@/lib/sim/types'
import { useRaceStore, type PitCommand } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import { SLIDER_LABELS } from '@/lib/sim/push'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { formatLiveGap } from '@/lib/format'
import { TEMP } from '@/lib/sim/tyre-temp'
import TyreIndicator from './TyreIndicator'
import TyreTempGauge from './TyreTempGauge'
import { DriverLink } from '@/components/world/EntityLink'

const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']
const CRITICAL = 10 // tyre condition at/under which a stop is imminent

interface Props {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  raceState: RaceState
  onRetire: (driverId: string) => void
}

// Where the player's car would slot back in if it pitted THIS lap: add the pit-lane loss to its race time
// and read the field by race time (the same projection the AI uses to judge clear air). Returns the net
// position and the nearest car — behind whom it rejoins, or (if it would keep the lead) ahead of whom.
function rejoinProjection(ds: DriverRaceState, raceState: RaceState, drivers: Driver[]) {
  const rejoinTime = ds.totalTime + pitLaneLoss(raceState.year)
  const others = raceState.drivers.filter((o) => o.driverId !== ds.driverId && !o.retired)
  const ahead = others.filter((o) => o.totalTime <= rejoinTime)
  const nameOf = (id: string) => drivers.find((d) => d.id === id)?.name ?? '—'
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

// The pit wall the player commands the AI strategy with each lap. `auto` = the AI decides (read-only
// status); `hold` = stay out this lap; `{ pit }` = box at the end of the lap for the chosen compound.
function status(cmd: PitCommand, ds: DriverRaceState, currentLap: number): { text: string; color: string } {
  const cond = ds.currentTyre.condition
  if (cmd !== 'auto' && cmd !== 'hold') return { text: `Pitting → ${cmd.pit}`, color: '#00D9FF' }
  if (cmd === 'hold') return cond < CRITICAL ? { text: `Staying out — tyre critical (${Math.round(cond)}%)`, color: '#DC143C' } : { text: 'Staying out', color: '#F59E0B' }
  // auto
  if (ds.targetPitLap != null && ds.targetPitLap <= currentLap) return { text: `Pitting this lap → ${ds.targetNextCompound}`, color: '#00D9FF' }
  if (cond < CRITICAL) return { text: `Stop imminent (${Math.round(cond)}%)`, color: '#DC143C' }
  return { text: `Running · planned L${ds.targetPitLap ?? '—'}`, color: '#FFFFFF' }
}

function ModeButton({ active, color, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1.5 text-xs font-bold tracking-widest uppercase rounded transition-colors ${
        active ? '' : 'bg-[#1E2431] text-[#FFFFFF] hover:bg-[#2A3142]'
      }`}
      style={active ? { backgroundColor: color, color: '#0F1419' } : undefined}
    >
      {children}
    </button>
  )
}

// Driver mode push controls (#sim-overhaul): four PRESETS that auto-revert to normal once their goal is met,
// plus a persistent 5-step SLIDER. Pushing is quicker but heats + wears the tyres; backing off cools + saves.
const PRESETS: { preset: PushPreset | 'normal'; label: string; color: string }[] = [
  { preset: 'overtake', label: 'Overtake', color: '#DC143C' },
  { preset: 'push', label: 'Push', color: '#F59E0B' },
  { preset: 'normal', label: 'Normal', color: '#2A3142' },
  { preset: 'conserve', label: 'Conserve', color: '#10B981' },
]

// A small on/off toggle (distinct from the preset buttons, which are a one-of-many choice).
function Toggle({ on, disabled, onColor, onClick, children }: { on: boolean; disabled?: boolean; onColor: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
        disabled ? 'bg-[#1E2431] text-[#6B7280] cursor-not-allowed' : on ? 'text-[#0F1419]' : 'bg-[#1E2431] text-[#FFFFFF] hover:bg-[#2A3142]'
      }`}
      style={on && !disabled ? { backgroundColor: onColor } : undefined}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${on && !disabled ? 'bg-[#0F1419]' : 'bg-[#6B7280]'}`} />
      {children}
    </button>
  )
}

// Driver/Team-Manager push controls. Presets + a 5-step slider set the car's push; the active button reflects
// `ds.push`. In Team Manager an AUTO toggle hands push to the AI (and `ds.push` then mirrors its live pick); in
// Driver mode an AUTO-DEFEND toggle (only armable from Normal) pushes to defend a car behind without disturbing
// the Normal selection. Picking any preset takes manual control and clears the relevant auto (#push-auto).
function PushControl({ ds, mode }: { ds: DriverRaceState; mode: 'driver' | 'tm' }) {
  const setPushSlider = useRaceStore((s) => s.setPushSlider)
  const setPushPreset = useRaceStore((s) => s.setPushPreset)
  const setPushAuto = useRaceStore((s) => s.setPushAuto)
  const setAutoDefend = useRaceStore((s) => s.setAutoDefend)
  const push = ds.push ?? { kind: 'manual', level: 0 as const }
  const temp = ds.tyreTemp ?? TEMP.FRESH_TEMP
  const cold = temp < 0, hot = temp > 1
  const auto = ds.pushAuto ?? false
  const autoDefend = ds.autoDefend ?? false
  const activePreset = push.kind === 'preset' ? push.preset : null
  const level = push.kind === 'manual' ? push.level : null
  const isNormal = push.kind === 'manual' && push.level === 0
  // Out of the heat window: the slider's active step glows blue (too cold) or red (too hot).
  const stepColor = cold ? '#00D9FF' : hot ? '#DC143C' : '#7C3AED'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {PRESETS.map((p) => (
          <ModeButton
            key={p.preset}
            active={p.preset === 'normal' ? level === 0 : activePreset === p.preset}
            color={p.color}
            onClick={() => (p.preset === 'normal' ? setPushSlider(ds.driverId, 0) : setPushPreset(ds.driverId, p.preset))}
          >{p.label}</ModeButton>
        ))}
      </div>
      <div className="flex gap-1">
        {SLIDER_LABELS.map((lbl, i) => {
          const lv = (i - 2) as SliderLevel
          const active = level === lv
          return (
            <button
              key={lbl}
              onClick={() => setPushSlider(ds.driverId, lv)}
              className={`flex-1 py-1 text-[10px] font-bold tracking-wide uppercase rounded transition-colors ${active ? '' : 'bg-[#1E2431] text-[#FFFFFF] hover:bg-[#2A3142]'}`}
              style={active ? { backgroundColor: stepColor, color: '#FFFFFF' } : undefined}
            >{lbl}</button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        {mode === 'tm' ? (
          <Toggle on={auto} onColor="#00D9FF" onClick={() => setPushAuto(ds.driverId, !auto)}>Auto</Toggle>
        ) : (
          <Toggle on={autoDefend} disabled={!isNormal} onColor="#F59E0B" onClick={() => setAutoDefend(ds.driverId, !autoDefend)}>Auto-defend</Toggle>
        )}
        {ds.defending && <span className="text-[10px] font-bold uppercase tracking-wide text-[#DC143C]">Defending</span>}
      </div>
    </div>
  )
}

export function PitWallCard({ driver, team, ds, raceState, allDrivers, onRetire, mode, teammatePitting = false }: { driver: Driver; team: Team | undefined; ds: DriverRaceState | undefined; raceState: RaceState; allDrivers: Driver[]; onRetire: (id: string) => void; mode: 'driver' | 'tm'; teammatePitting?: boolean }) {
  const cmd: PitCommand = useRaceStore((s) => s.pitCommands[driver.id]) ?? 'auto'
  const setPitCommand = useRaceStore((s) => s.setPitCommand)
  // The compound a PIT command will use; defaults to the AI's planned next compound.
  const [compound, setCompound] = useState<TyreCompound>(ds?.targetNextCompound ?? 'medium')

  const header = (
    <div className="flex items-center gap-2 mb-2">
      <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: team?.color ?? '#6B7280' }} />
      <DriverLink id={driver.id} className="text-sm font-bold text-[#FFFFFF]">{driver.name}</DriverLink>
      {ds && <span className="text-sm font-bold text-[#00D9FF] ml-auto">P{ds.position}</span>}
    </div>
  )

  if (!ds || ds.retired) {
    return (
      <div className="bg-[#1E2431] rounded p-2.5">
        {header}
        <p className="text-xs text-[#FFFFFF]">{ds?.retired ? `Retired — L${ds.retirementLap ?? ''}` : 'Out of the race.'}</p>
      </div>
    )
  }

  const isPit = cmd !== 'auto' && cmd !== 'hold'
  const st = status(cmd, ds, raceState.currentLap)
  const cond = Math.round(ds.currentTyre.condition)
  const rejoin = rejoinProjection(ds, raceState, allDrivers)

  return (
    <div className="bg-[#1E2431] rounded p-2.5 flex flex-col gap-2">
      {header}

      {/* Live tyre status: compound + condition + a temperature gauge (the quick MM-style read). */}
      <div className="flex items-center gap-3 text-xs text-[#FFFFFF]">
        <span className="flex items-center gap-1.5">
          <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
          <span className={cond < 20 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}>{cond}%</span>
        </span>
        {ds.tyreTemp != null && <TyreTempGauge temp={ds.tyreTemp} className="w-14" />}
        <span className="ml-auto flex items-center gap-1 text-[#9CA3AF]">
          AI L{ds.targetPitLap ?? '—'} <TyreIndicator compound={ds.targetNextCompound} size="sm" />
        </span>
      </div>
      {/* Stint + gap, kept on their own line now the tyre row carries the temperature gauge. */}
      <div className="flex items-center gap-3 text-xs text-[#FFFFFF] -mt-1">
        <span>L{ds.stintLap} stint</span>
        <span className="font-mono">{formatLiveGap(ds.gap)}</span>
      </div>

      {/* Prominent status */}
      <div className="text-sm font-bold tracking-wide uppercase" style={{ color: st.color }}>{st.text}</div>

      {/* Where a stop this lap drops you: behind the car you'd rejoin in front of, or ahead if you'd hold the lead. */}
      <div className="text-[11px] text-[#FFFFFF]">
        If you pit now: <span className="font-bold">P{rejoin.position}</span>
        {rejoin.other && `, ${rejoin.gap.toFixed(1)}s ${rejoin.ahead ? 'ahead of' : 'behind'} ${rejoin.other}`}
      </div>

      {/* Driver mode: heads-up that your teammate boxes this lap, so you can hold and avoid a double-stack wait. */}
      {mode === 'driver' && teammatePitting && (
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#F59E0B]">Teammate boxing this lap</div>
      )}

      {/* Command: auto / pit (+ compound) / hold */}
      <div className="flex gap-1.5">
        <ModeButton active={cmd === 'auto'} color="#2A3142" onClick={() => setPitCommand(driver.id, 'auto')}>Auto</ModeButton>
        <ModeButton active={isPit} color="#00D9FF" onClick={() => setPitCommand(driver.id, { pit: compound })}>Pit</ModeButton>
        <ModeButton active={cmd === 'hold'} color="#DC143C" onClick={() => setPitCommand(driver.id, 'hold')}>Hold</ModeButton>
      </div>

      {/* Push presets + the manual intensity slider (both modes — your own car in Driver, both cars in TM). */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-widest text-[#FFFFFF]">Push</span>
        <PushControl ds={ds} mode={mode} />
      </div>

      {isPit && (
        <select
          value={cmd.pit}
          onChange={(e) => { const c = e.target.value as TyreCompound; setCompound(c); setPitCommand(driver.id, { pit: c }) }}
          className="w-full bg-[#2A3142] text-[#FFFFFF] text-xs px-2 py-1 rounded border border-[#3a4255] focus:outline-none focus:border-[#00D9FF]"
        >
          {COMPOUNDS.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
        </select>
      )}

      <button onClick={() => onRetire(driver.id)} className="self-start text-[10px] uppercase tracking-widest text-[#DC143C]/80 hover:text-[#DC143C]">Retire car</button>
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
