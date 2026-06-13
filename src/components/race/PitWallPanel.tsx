'use client'

import { useState } from 'react'
import type { Driver, Team, DriverRaceState, RaceState, TyreCompound } from '@/lib/sim/types'
import { useRaceStore, type PitCommand } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { formatLiveGap } from '@/lib/format'
import TyreIndicator from './TyreIndicator'
import { TyreTelemetry } from './TyreTelemetry'
import { RaceEngineer } from './RaceEngineer'
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

function Card({ driver, team, ds, raceState, allDrivers, onRetire }: { driver: Driver; team: Team | undefined; ds: DriverRaceState | undefined; raceState: RaceState; allDrivers: Driver[]; onRetire: (id: string) => void }) {
  const cmd: PitCommand = useRaceStore((s) => s.pitCommands[driver.id]) ?? 'auto'
  const setPitCommand = useRaceStore((s) => s.setPitCommand)
  const tyreTel = useSettingsStore((s) => s.talents['tyre-telemetry'] ?? false)
  const raceEng = useSettingsStore((s) => s.talents['race-engineer'] ?? false)
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

      {/* Live: tyre + condition, stint, gap, AI plan */}
      <div className="flex items-center gap-3 text-xs text-[#FFFFFF]">
        <span className="flex items-center gap-1.5">
          <TyreIndicator compound={ds.currentTyre.compound} size="sm" />
          <span className={cond < 20 ? 'text-[#DC143C]' : 'text-[#FFFFFF]'}>{cond}%</span>
        </span>
        <span>L{ds.stintLap} stint</span>
        <span className="font-mono">{formatLiveGap(ds.gap)}</span>
        <span className="ml-auto flex items-center gap-1 text-[#9CA3AF]">
          AI L{ds.targetPitLap ?? '—'} <TyreIndicator compound={ds.targetNextCompound} size="sm" />
        </span>
      </div>

      {/* Prominent status */}
      <div className="text-sm font-bold tracking-wide uppercase" style={{ color: st.color }}>{st.text}</div>

      {/* Where a stop this lap drops you: behind the car you'd rejoin in front of, or ahead if you'd hold the lead. */}
      <div className="text-[11px] text-[#FFFFFF]">
        If you pit now: <span className="font-bold">P{rejoin.position}</span>
        {rejoin.other && `, ${rejoin.gap.toFixed(1)}s ${rejoin.ahead ? 'ahead of' : 'behind'} ${rejoin.other}`}
      </div>

      {/* Command: auto / pit (+ compound) / hold */}
      <div className="flex gap-1.5">
        <ModeButton active={cmd === 'auto'} color="#2A3142" onClick={() => setPitCommand(driver.id, 'auto')}>Auto</ModeButton>
        <ModeButton active={isPit} color="#00D9FF" onClick={() => setPitCommand(driver.id, { pit: compound })}>Pit</ModeButton>
        <ModeButton active={cmd === 'hold'} color="#DC143C" onClick={() => setPitCommand(driver.id, 'hold')}>Hold</ModeButton>
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

      {tyreTel && <TyreTelemetry driver={driver} ds={ds} raceState={raceState} />}
      {raceEng && raceState.paused && <RaceEngineer driver={driver} raceState={raceState} mode="racing" />}

      <button onClick={() => onRetire(driver.id)} className="self-start text-[10px] uppercase tracking-widest text-[#DC143C]/80 hover:text-[#DC143C]">Retire car</button>
    </div>
  )
}

export default function PitWallPanel({ drivers, teams, states, raceState, onRetire }: Props) {
  const playerTeamId = useSeasonStore((s) => s.playerTeamId)
  const myDrivers = drivers.filter((d) => d.teamId === playerTeamId)

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
          <Card
            key={d.id}
            driver={d}
            team={teams.find((t) => t.id === d.teamId)}
            ds={states.find((s) => s.driverId === d.id)}
            raceState={raceState}
            allDrivers={drivers}
            onRetire={onRetire}
          />
        ))
      )}
    </div>
  )
}
