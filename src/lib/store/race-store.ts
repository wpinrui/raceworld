import { create } from 'zustand'
import type { Driver, Team, Circuit, RaceState, DriverRaceState, GodModeAction, SimSpeed, TyreCompound, SliderLevel, PushPreset } from '@/lib/sim/types'
import { rollForms, initRaceState, simulateLap } from '@/lib/sim/race'
import { simulateSector, PIT_SECTOR } from '@/lib/sim/sector'
import { liveBridge } from './live-bridge'
import { NORMAL } from '@/lib/sim/push'
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

// Merge a patch onto one car's race state (immutably).
const patchCar = (drivers: DriverRaceState[], driverId: string, patch: Partial<DriverRaceState>): DriverRaceState[] =>
  drivers.map((d) => (d.driverId === driverId ? { ...d, ...patch } : d))

// The cars the player drives directly (so the sim honours their push instead of the AI heuristic).
function playerControlledIds(drivers: Driver[]): string[] {
  const { teamManagerMode, playerTeamId, driverMode, playerDriverId } = useSeasonStore.getState()
  if (driverMode && playerDriverId) return [playerDriverId]
  if (teamManagerMode && playerTeamId) return drivers.filter((d) => d.teamId === playerTeamId).map((d) => d.id)
  return []
}

// The sim races the SHOWN ratings (true + season form, #66). Bake them in as drivers enter the race
// store and zero the offset on the copy, so the form applies exactly once (a re-bake is then a no-op).
const toRaceDriver = (d: Driver): Driver => ({ ...d, ...shownStats(d), seasonForm: 0 })

// Team Manager pit wall: the player's standing instruction for a car each lap. Absent = auto (AI decides).
export type PitCommand = 'auto' | 'hold' | { pit: TyreCompound }

// Pit-wall instructions become per-tick pit overrides (hold -> cancel-pit, pit -> force-pit).
function buildCommandActions(pitCommands: Record<string, PitCommand>): GodModeAction[] {
  const actions: GodModeAction[] = []
  for (const [driverId, cmd] of Object.entries(pitCommands)) {
    if (cmd === 'hold') actions.push({ type: 'cancel-pit', driverId })
    else if (cmd !== 'auto') actions.push({ type: 'force-pit', driverId, compound: cmd.pit })
  }
  return actions
}

// Once a commanded PIT has landed (lastPitLap caught up), keep manual control: fall back to HOLD, not
// auto — the player took the wheel, so don't hand the car back to the AI behind their back. A retired or
// missing car just clears. HOLD persists until the player changes it (or fast-forward clears it).
// Returns the SAME object when nothing changed so callers can skip the state write.
function reconcilePitCommands(
  pitCommands: Record<string, PitCommand>,
  next: RaceState,
  lapBeing: number,
): Record<string, PitCommand> {
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
  return nextCommands
}

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
  // One-shot god-mode pit overrides (#sector-engine) held until the pit sector — the only slice that
  // reads them; consuming them on any other slice would silently drop them.
  carriedPitActions: GodModeAction[]
  // The push controls live on the race state (DriverRaceState.push), evolving with the sim; these write them.

  loadFromSeason: (drivers: Driver[], teams: Team[], circuit: Circuit) => void
  setGodModeDriver: (driverId: string) => void
  updateDriverForm: (driverId: string, value: number) => void
  setStartingTyre: (driverId: string, compound: TyreCompound) => void // pre-race: choose a car's grid tyre
  setPitCommand: (driverId: string, cmd: PitCommand) => void          // pit wall: auto / hold / pit(compound)
  setPushSlider: (driverId: string, level: SliderLevel) => void       // persistent push level (back off…max)
  setPushPreset: (driverId: string, preset: PushPreset) => void       // transient preset (overtake/push/conserve)
  setPushAuto: (driverId: string, on: boolean) => void                // Team Manager: hand a car's push to the AI
  setAutoDefend: (driverId: string, on: boolean) => void              // Driver mode: arm auto-defend (only from Normal)
  setStrategyNoise: (n: number) => void
  initSession: () => void
  tickLap: (godModeActions?: GodModeAction[]) => void
  tickSector: (godModeActions?: GodModeAction[]) => void              // played races: one 1/8-lap slice per tick
  setSpeed: (speed: SimSpeed) => void
  setPaused: (paused: boolean) => void
  finishQualifying: () => void
  beginRacing: () => void
  restartRace: () => void                                             // rebuild the race from the grid (qualifying kept)
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
  carriedPitActions: [],

  loadFromSeason: (drivers, teams, circuit) => {
    const { godModeDriverId } = get()
    // Keep selection if the driver is still on the grid, otherwise clear
    const stillExists = godModeDriverId && drivers.some((d) => d.id === godModeDriverId)
    // Driver mode: you call your own stops, so your car starts on HOLD (the AI won't pit you behind your
    // back); every other car (and all of Team Manager / sandbox) starts on auto.
    const { driverMode, playerDriverId } = useSeasonStore.getState()
    const pitCommands: Record<string, PitCommand> =
      driverMode && playerDriverId && drivers.some((d) => d.id === playerDriverId) ? { [playerDriverId]: 'hold' } : {}
    set({
      drivers: drivers.map(toRaceDriver),
      teams: teams.map((t) => ({ ...t })),
      selectedCircuit: circuit,
      forms: applyPeakForm(rollForms(drivers), drivers),
      godModeDriverId: stillExists ? godModeDriverId : null,
      pitCommands,
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
    // A live race takes the command directly (#live-engine): pit calls are physical there.
    const live = liveBridge.current
    if (live) {
      if (cmd === 'auto') live.clearPitOverrides(driverId)
      else if (cmd === 'hold') live.setHold(driverId, true)
      else { live.setHold(driverId, false); live.commandPit(driverId, cmd.pit) }
    }
    set((state) => {
      const next = { ...state.pitCommands }
      if (cmd === 'auto') delete next[driverId] // auto = no standing instruction (also the cancel/unset)
      else next[driverId] = cmd
      return { pitCommands: next }
    })
  },

  // Write the player's push onto the race state (where the sim reads + evolves it). No-op pre-race. A manual
  // change is the player taking control, so it exits TM-auto; it also exits auto-defend UNLESS the move is to
  // Normal (level 0), where auto-defend is allowed to stay armed. A preset (overtake/push/conserve) is never
  // Normal, so it always exits auto-defend.
  setPushSlider: (driverId, level) => {
    const patch = { push: { kind: 'manual', level }, pushAuto: false, ...(level !== 0 ? { autoDefend: false } : {}) } as const
    liveBridge.current?.setPushFields(driverId, patch)
    set((state) => (state.raceState
      ? { raceState: { ...state.raceState, drivers: patchCar(state.raceState.drivers, driverId, patch) } }
      : {}))
  },
  setPushPreset: (driverId, preset) => {
    const patch = { push: { kind: 'preset', preset }, pushAuto: false, autoDefend: false } as const
    liveBridge.current?.setPushFields(driverId, patch)
    set((state) => (state.raceState
      ? { raceState: { ...state.raceState, drivers: patchCar(state.raceState.drivers, driverId, patch) } }
      : {}))
  },
  // Team Manager: hand a car's push to the AI (on) or take it back (off). Leaving auto keeps the AI's last pick
  // as the manual selection — a smooth handoff. Mutually exclusive with auto-defend.
  setPushAuto: (driverId, on) => {
    const patch = { pushAuto: on, autoDefend: false } as const
    liveBridge.current?.setPushFields(driverId, patch)
    set((state) => (state.raceState
      ? { raceState: { ...state.raceState, drivers: patchCar(state.raceState.drivers, driverId, patch) } }
      : {}))
  },
  // Driver mode: arm/disarm auto-defend. Only valid from Normal, so force the selection to Normal when arming —
  // intent and the toggle then agree, and the sim's transient defensive pushes never alter that intent.
  setAutoDefend: (driverId, on) => {
    const patch = { autoDefend: on, pushAuto: false, ...(on ? { push: NORMAL } : {}) } as const
    liveBridge.current?.setPushFields(driverId, patch)
    set((state) => (state.raceState
      ? { raceState: { ...state.raceState, drivers: patchCar(state.raceState.drivers, driverId, patch) } }
      : {}))
  },

  setStrategyNoise: (n) => set({ strategyNoise: Math.min(1, Math.max(0, n)) }),

  initSession: () => {
    const { drivers, teams, selectedCircuit, forms, strategyNoise } = get()
    if (!selectedCircuit) return
    const { year, saveSeed } = useSeasonStore.getState()
    const { results, sessions } = runQualifying(drivers, teams, selectedCircuit, forms)
    const raceState = initRaceState(drivers, teams, selectedCircuit, results, sessions, forms, year, strategyNoise, saveSeed)
    // Enter the playable qualifying phase, paused — the player presses play to run each session (Q1→Q2→Q3).
    set({ raceState: { ...raceState, phase: 'qualifying', paused: true }, qualSessionIdx: 0, carriedPitActions: [] })
  },

  tickLap: (godModeActions) => {
    const { raceState, drivers, teams, selectedCircuit, pitCommands } = get()
    if (!raceState || raceState.phase !== 'racing' || !selectedCircuit) return
    const year = useSeasonStore.getState().year
    const lapBeing = raceState.currentLap

    // Standing pit-wall instructions apply on the scheduled tick AND under fast-forward (which calls
    // tickLap directly).
    const commandActions = buildCommandActions(pitCommands)
    const merged = commandActions.length || godModeActions ? [...commandActions, ...(godModeActions ?? [])] : undefined

    const next = simulateLap(raceState, drivers, teams, selectedCircuit, year, merged, false, playerControlledIds(drivers))

    const nextCommands = reconcilePitCommands(pitCommands, next, lapBeing)
    set(nextCommands === pitCommands ? { raceState: next } : { raceState: next, pitCommands: nextCommands })
  },

  // The played-race tick (#sector-engine): one 1/8-lap slice. Immediate god actions (retire / tyre /
  // form) apply on any slice; one-shot pit overrides are held in carriedPitActions until the pit
  // sector, where the sim actually reads them. Standing pitCommands regenerate every tick, so they
  // are only converted on the pit slice (elsewhere they'd be ignored).
  tickSector: (godModeActions) => {
    const { raceState, drivers, teams, selectedCircuit, pitCommands, carriedPitActions } = get()
    if (!raceState || raceState.phase !== 'racing' || !selectedCircuit) return
    const year = useSeasonStore.getState().year
    const lapBeing = raceState.currentLap
    const isPitSlice = (raceState.currentSector ?? 0) === PIT_SECTOR

    const incoming = godModeActions ?? []
    const pitType = incoming.filter((a) => a.type === 'force-pit' || a.type === 'cancel-pit')
    const immediate = incoming.filter((a) => a.type !== 'force-pit' && a.type !== 'cancel-pit')
    const pitPool = pitType.length ? [...carriedPitActions, ...pitType] : carriedPitActions

    // Order matters: standing commands first, one-shot god overrides after (the sim's reverse-find
    // gives the later force-pit precedence) — same precedence as tickLap.
    const applied = isPitSlice ? [...buildCommandActions(pitCommands), ...pitPool, ...immediate] : immediate
    const next = simulateSector(raceState, drivers, teams, selectedCircuit, year, applied.length ? applied : undefined, playerControlledIds(drivers))

    const nextCommands = reconcilePitCommands(pitCommands, next, lapBeing)
    set({
      raceState: next,
      ...(isPitSlice ? { carriedPitActions: [] } : pitPool !== carriedPitActions ? { carriedPitActions: pitPool } : {}),
      ...(nextCommands !== pitCommands ? { pitCommands: nextCommands } : {}),
    })
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

  // Restart just the RACE (qualifying kept): rebuild the lap-1 state from the existing grid and drop back to
  // the pre-race screen. Same conditions — the seeded weather/tyres are identical, and the car-form roll is
  // carried over from the current race so it's a true re-run, not a fresh roll. Pit/pace commands reset.
  restartRace: () => {
    const { raceState, drivers, teams, selectedCircuit, forms, strategyNoise } = get()
    if (!raceState || !selectedCircuit) return
    const { year, saveSeed, driverMode, playerDriverId } = useSeasonStore.getState()
    const fresh = initRaceState(drivers, teams, selectedCircuit, raceState.qualifyingResults, raceState.qualifyingSessions, forms, year, strategyNoise, saveSeed)
    const pitCommands: Record<string, PitCommand> =
      driverMode && playerDriverId && drivers.some((d) => d.id === playerDriverId) ? { [playerDriverId]: 'hold' } : {}
    set({ raceState: { ...fresh, carForm: raceState.carForm, phase: 'pre-race', paused: false }, pitCommands, carriedPitActions: [] })
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
      carriedPitActions: [],
    })
  },
}))
