'use client'

import { useState, useMemo } from 'react'
import type { Driver, Team, DriverRaceState, RaceState, TyreCompound } from '@/lib/sim/types'
import { useRaceStore, type PitCommand } from '@/lib/store/race-store'
import { useSeasonStore } from '@/lib/store/season-store'
import { useSettingsStore } from '@/lib/store/settings-store'
import { planStrategy, truthBelief, type StrategyStint } from '@/lib/sim/pit-ai'
import { pitLaneLoss } from '@/lib/sim/pit-loss'
import { getMoistureAtLap } from '@/lib/sim/weather'
import { expectedStintLaps, trafficStintLaps, currentSetRemainingLaps, tyreLapTimeLoss } from '@/lib/sim/tyre-telemetry'
import { formatLiveGap } from '@/lib/format'
import TyreIndicator from './TyreIndicator'
import { DriverLink } from '@/components/world/EntityLink'

const COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet']
const DRY_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard']
const CRITICAL = 10 // tyre condition at/under which a stop is imminent

const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1)

// Tyre Telemetry talent: the true tyre picture the pit wall is normally blind to — the current set's exact
// remaining laps (clear air vs traffic), each compound's expected life and pace-vs-wear, and the
// perfect-information strategy. All numbers come straight from the engine maths (see tyre-telemetry.ts).
function TyreTelemetry({ driver, ds, raceState }: { driver: Driver; ds: DriverRaceState; raceState: RaceState }) {
  // Showing wet rows in the dry would leak the forecast; the CURRENT moisture is already observable (it's
  // raining now), so it's fair to surface wet data once it's actually wet.
  const wet = getMoistureAtLap(raceState.weather, raceState.currentLap) >= 0.1
  const compounds: TyreCompound[] = wet ? COMPOUNDS : DRY_COMPOUNDS
  const set = currentSetRemainingLaps(ds.currentTyre)

  const perfect = useMemo(
    () =>
      planStrategy(
        raceState.currentLap, raceState.totalLaps,
        ds.currentTyre.condition, ds.currentTyre.compound, driver.smoothness,
        truthBelief(raceState.compoundDeltas, raceState.tyreBaseLife, raceState.totalLaps),
        raceState.weather, raceState.weatherForecast, pitLaneLoss(raceState.year),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driver.id, raceState.currentLap, ds.currentTyre.condition, ds.currentTyre.compound],
  )

  return (
    <div className="bg-[#0d2230] rounded p-2.5 border border-[#00D9FF]/20 flex flex-col gap-2">
      <div className="text-[10px] font-bold tracking-widest text-[#00D9FF] uppercase">Tyre Telemetry</div>

      <div className="text-xs text-[#FFFFFF]">
        This set: <span className="font-bold">{set.clear}</span> laps clear · <span className="font-bold">{set.traffic}</span> in traffic
      </div>

      <table className="w-full text-xs text-[#FFFFFF]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[#FFFFFF]">
            <th className="text-left font-medium" />
            <th className="text-right font-medium">Life</th>
            <th className="text-right font-medium">Fresh</th>
            <th className="text-right font-medium">50%</th>
            <th className="text-right font-medium">Dead</th>
          </tr>
        </thead>
        <tbody>
          {compounds.map((c) => {
            const clear = expectedStintLaps(raceState.tyreBaseLife[c], driver.smoothness, raceState.totalLaps)
            const delta = raceState.compoundDeltas[c]
            return (
              <tr key={c}>
                <td className="py-0.5"><TyreIndicator compound={c} size="sm" /></td>
                <td className="text-right font-mono">{clear}/{trafficStintLaps(clear)}</td>
                <td className="text-right font-mono">{signed(tyreLapTimeLoss(delta, 100))}</td>
                <td className="text-right font-mono">{signed(tyreLapTimeLoss(delta, 50))}</td>
                <td className="text-right font-mono text-[#DC143C]">{signed(tyreLapTimeLoss(delta, 0))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-[#FFFFFF]">Life: laps clear/traffic. Pace: s/lap vs fresh soft.</div>

      {perfect && (
        <div className="flex flex-col gap-1 pt-1.5 border-t border-[#00D9FF]/10">
          <div className="text-[10px] font-bold tracking-widest text-[#00D9FF] uppercase">Perfect strategy</div>
          {perfect.stints.map((s: StrategyStint, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs text-[#FFFFFF]">
              <TyreIndicator compound={s.compound} size="sm" />
              <span>L{s.fromLap}–{s.toLap}</span>
              <span>({s.toLap - s.fromLap + 1})</span>
              {i < perfect.stints.length - 1 && <span className="text-[#00D9FF] ml-auto">pit →</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  drivers: Driver[]
  teams: Team[]
  states: DriverRaceState[]
  raceState: RaceState
  onRetire: (driverId: string) => void
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

function Card({ driver, team, ds, raceState, onRetire }: { driver: Driver; team: Team | undefined; ds: DriverRaceState | undefined; raceState: RaceState; onRetire: (id: string) => void }) {
  const cmd: PitCommand = useRaceStore((s) => s.pitCommands[driver.id]) ?? 'auto'
  const setPitCommand = useRaceStore((s) => s.setPitCommand)
  const tyreTel = useSettingsStore((s) => s.talents['tyre-telemetry'] ?? false)
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
            onRetire={onRetire}
          />
        ))
      )}
    </div>
  )
}
