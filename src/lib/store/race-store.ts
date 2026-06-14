import { create } from 'zustand'
import type { Driver, Team, Circuit, RaceState, GodModeAction, SimSpeed, TyreCompound, DriverPaceMode } from '@/lib/sim/types'
import { rollForms, initRaceState, simulateLap } from '@/lib/sim/race'
import { computeTyreLife } from '@/lib/sim/tyres'
import { runQualifying } from '@/lib/sim/qualifying'
import { shownStats } from '@/lib/sim/progression'
import { useSeasonStore } from './season-store'
import { useSettingsStore } from './settings-store'

// Peak Form talent: the player's own car(s) run at maximum form (10) every weekend — both of a Team
// Manager's drivers, or just your own driver in Driver mode.
function applyPeakForm(forms: Record<string, number>, drivers: Driver[]): Record<string, number> {
  if (!useSettingsStore.getState().talents['peak-form']) return forms
  const { teamManagerMode, playerTeamId, driverMode, playerDriverId } = useSeasonStore.getState()
  if (teamManagerMode && playerTeamId) {
    const out = { ...forms }
    for (const d of drivers) if (d.teamId === playerTeamId) out[d.id] = 10
    return out
  }
  if (driverMode && playerDriverId) return { ...forms, [playerDriverId]: 10 }
  return forms
}

// The sim races the SHOWN ratings (true + season form, #66). Bake them in as drivers enter the race
// store and zero the offset on the copy, so the form applies exactly once (a re-bake is then a no-op).
const toRaceDriver = (d: Driver): Driver => ({ ...d, ...shownStats(d), seasonForm: 0 })

// Team Manager pit wall: the player's standing instruction for a car each lap. Absent = auto (AI decides).
export type PitCommand = 'auto' | 'hold' | { pit: TyreCompound }

interface RaceStore {
  raceState: RaceState | null
  drivers: Driver[]
  teams: Team[]
  // The exact circuit being raced, held as the resolved object rather than an id: a season can run the
  // same venue twice (era-accurate double-headers, e.g. 2020 Bahrain GP 57 laps + Sakhir GP 87 laps share
  // id 'bahrain'), so an id is no longer enough to identify the right round's lap count (#64).
  selectedCircuit: Circuit | null
  forms: Record<string, number>
  strategyNoise: number
  godModeDriverId: string | null  // persists across races
  qualSessionIdx: number          // which qualifying session (0=Q1) — in the store so a Quit resumes it
  pitCommands: Record<string, PitCommand>  // Team Manager pit-wall instructions, per driver (absent = auto)
  driverModes: Record<string, DriverPaceMode>  // Driver mode pace tools, per driver (absent = normal)

  loadFromSeason: (drivers: Driver[], teams: Team[], circuit: Circuit) => void
  setGodModeDriver: (driverId: string) => void
  updateDriverForm: (driverId: string, value: number) => void
  setStartingTyre: (driverId: string, compound: TyreCompound) => void // pre-race: choose a car's grid tyre
  setPitCommand: (driverId: string, cmd: PitCommand) => void          // pit wall: auto / hold / pit(compound)
  setDriverMode: (driverId: string, mode: DriverPaceMode) => void     // Driver mode: normal / defend / back-off
  clearHolds: () => void                                              // drop all HOLDs back to auto (FF)
  setStrategyNoise: (n: number) => void
  initSession: () => void
  tickLap: (godModeActions?: GodModeAction[]) => void
  setSpeed: (speed: SimSpeed) => void
  setPaused: (paused: boolean) => void
  finishQualifying: () => void
  beginRacing: () => void
  advanceQualSession: () => void
  resetSession: (drivers?: Driver[], teams?: Team[], circuit?: Circuit) => void
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  raceState: null,
  drivers: [],
  teams: [],
  selectedCircuit: null,
  forms: {},
  strategyNoise: 0.35,
  godModeDriverId: null,
  qualSessionIdx: 0,
  pitCommands: {},
  driverModes: {},

  loadFromSeason: (drivers, teams, circuit) => {
    const { godModeDriverId } = get()
    // Keep selection if the driver is still on the grid, otherwise clear
    const stillExists = godModeDriverId && drivers.some((d) => d.id === godModeDriverId)
    set({
      drivers: drivers.map(toRaceDriver),
      teams: teams.map((t) => ({ ...t })),
      selectedCircuit: circuit,
      forms: applyPeakForm(rollForms(drivers), drivers),
      godModeDriverId: stillExists ? godModeDriverId : null,
      pitCommands: {},
      driverModes: {},
    })
  },

  setGodModeDriver: (driverId) => set({ godModeDriverId: driverId }),

  updateDriverForm: (driverId, value) => {
    set((state) => ({
      forms: { ...state.forms, [driverId]: Math.min(10, Math.max(0, value)) },
    }))
  },

  // Pre-race only: put a driver on a fresh set of the chosen compound for the start, recomputing its life
  // from the race's base tyre wear and the driver's smoothness (same maths as a pit stop).
  setStartingTyre: (driverId, compound) => {
    set((state) => {
      const { raceState, selectedCircuit } = state
      if (!raceState || raceState.phase !== 'pre-race' || !selectedCircuit) return state
      const driver = state.drivers.find((d) => d.id === driverId)
      if (!driver) return state
      const maxLifeLaps = computeTyreLife(raceState.tyreBaseLife[compound], driver.smoothness, selectedCircuit.laps)
      return {
        raceState: {
          ...raceState,
          drivers: raceState.drivers.map((ds) =>
            ds.driverId === driverId ? { ...ds, currentTyre: { compound, condition: 100, maxLifeLaps } } : ds,
          ),
        },
      }
    })
  },

  setPitCommand: (driverId, cmd) => {
    set((state) => {
      const next = { ...state.pitCommands }
      if (cmd === 'auto') delete next[driverId] // auto = no standing instruction (also the cancel/unset)
      else next[driverId] = cmd
      return { pitCommands: next }
    })
  },

  setDriverMode: (driverId, mode) => {
    set((state) => {
      const next = { ...state.driverModes }
      if (mode === 'normal') delete next[driverId] // normal = no standing instruction
      else next[driverId] = mode
      return { driverModes: next }
    })
  },

  clearHolds: () => {
    set((state) => {
      const next: Record<string, PitCommand> = {}
      for (const [id, cmd] of Object.entries(state.pitCommands)) if (cmd !== 'hold') next[id] = cmd
      return { pitCommands: next }
    })
  },

  setStrategyNoise: (n) => set({ strategyNoise: Math.min(1, Math.max(0, n)) }),

  initSession: () => {
    const { drivers, teams, selectedCircuit, forms, strategyNoise } = get()
    if (!selectedCircuit) return
    const { year, saveSeed } = useSeasonStore.getState()
    const { results, sessions } = runQualifying(drivers, teams, selectedCircuit, forms)
    const raceState = initRaceState(drivers, teams, selectedCircuit, results, sessions, forms, year, strategyNoise, saveSeed)
    // Enter the playable qualifying phase, paused — the player presses play to run each session (Q1→Q2→Q3).
    set({ raceState: { ...raceState, phase: 'qualifying', paused: true }, qualSessionIdx: 0 })
  },

  tickLap: (godModeActions) => {
    const { raceState, drivers, teams, selectedCircuit, pitCommands, driverModes } = get()
    if (!raceState || raceState.phase !== 'racing' || !selectedCircuit) return
    const year = useSeasonStore.getState().year
    const lapBeing = raceState.currentLap

    // Pit-wall instructions become per-lap pit overrides (hold -> cancel-pit, pit -> force-pit). They live in
    // the store so they apply on the scheduled tick AND under fast-forward (which calls tickLap directly).
    const commandActions: GodModeAction[] = []
    for (const [driverId, cmd] of Object.entries(pitCommands)) {
      if (cmd === 'hold') commandActions.push({ type: 'cancel-pit', driverId })
      else if (cmd !== 'auto') commandActions.push({ type: 'force-pit', driverId, compound: cmd.pit })
    }
    const merged = commandActions.length || godModeActions ? [...commandActions, ...(godModeActions ?? [])] : undefined

    const hasModes = Object.keys(driverModes).length > 0
    const next = simulateLap(raceState, drivers, teams, selectedCircuit, year, merged, false, hasModes ? driverModes : undefined)

    // Once a commanded PIT has landed (lastPitLap caught up), keep manual control: fall back to HOLD, not
    // auto — the player took the wheel, so don't hand the car back to the AI behind their back. A retired or
    // missing car just clears. HOLD persists until the player changes it (or fast-forward clears it).
    let nextCommands = pitCommands
    for (const [driverId, cmd] of Object.entries(pitCommands)) {
      if (cmd === 'auto' || cmd === 'hold') continue
      const ds = next.drivers.find((d) => d.driverId === driverId)
      if (!ds || ds.retired) {
        if (nextCommands === pitCommands) nextCommands = { ...pitCommands }
        delete nextCommands[driverId]
      } else if (ds.lastPitLap === lapBeing) {
        if (nextCommands === pitCommands) nextCommands = { ...pitCommands }
        nextCommands[driverId] = 'hold'
      }
    }

    set(nextCommands === pitCommands ? { raceState: next } : { raceState: next, pitCommands: nextCommands })
  },

  setSpeed: (speed) => {
    const { raceState } = get()
    if (!raceState) return
    set({ raceState: { ...raceState, speed } })
  },

  setPaused: (paused) => {
    const { raceState } = get()
    if (!raceState) return
    set({ raceState: { ...raceState, paused } })
  },

  // Qualifying playback finished (after Q3): drop into the existing pre-race grid screen.
  finishQualifying: () => {
    const { raceState } = get()
    if (!raceState) return
    set({ raceState: { ...raceState, phase: 'pre-race', paused: false } })
  },

  // Start the race: go green at speed 1 but PAUSED, so the player picks a speed / hits Resume to set off.
  beginRacing: () => {
    const { raceState } = get()
    if (!raceState) return
    set({ raceState: { ...raceState, phase: 'racing', speed: 1, paused: true } })
  },

  // Advance to the next qualifying session (Q1→Q2→Q3). In the store so a mid-Q3 Quit resumes at Q3.
  advanceQualSession: () => set((s) => ({ qualSessionIdx: s.qualSessionIdx + 1 })),

  resetSession: (drivers, teams, circuit) => {
    const nextDrivers = (drivers ?? get().drivers).map(toRaceDriver)
    set({
      raceState: null,
      drivers: nextDrivers,
      teams: teams ? teams.map((t) => ({ ...t })) : get().teams,
      selectedCircuit: circuit ?? get().selectedCircuit,
      forms: rollForms(nextDrivers),
      qualSessionIdx: 0,
      pitCommands: {},
      driverModes: {},
    })
  },
}))
