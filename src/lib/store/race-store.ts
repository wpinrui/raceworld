import { create } from 'zustand'
import type { Driver, Team, Circuit, RaceState, GodModeAction, SimSpeed } from '@/lib/sim/types'
import { rollForms, initRaceState, simulateLap } from '@/lib/sim/race'
import { runQualifying } from '@/lib/sim/qualifying'
import { shownStats } from '@/lib/sim/progression'
import { useSeasonStore } from './season-store'
import { useSettingsStore } from './settings-store'

// Team Manager + Peak Form talent: the player's own drivers run at maximum form (10) every weekend.
function applyPeakForm(forms: Record<string, number>, drivers: Driver[]): Record<string, number> {
  const { teamManagerMode, playerTeamId } = useSeasonStore.getState()
  if (!teamManagerMode || !playerTeamId || !useSettingsStore.getState().talents['peak-form']) return forms
  const out = { ...forms }
  for (const d of drivers) if (d.teamId === playerTeamId) out[d.id] = 10
  return out
}

// The sim races the SHOWN ratings (true + season form, #66). Bake them in as drivers enter the race
// store and zero the offset on the copy, so the form applies exactly once (a re-bake is then a no-op).
const toRaceDriver = (d: Driver): Driver => ({ ...d, ...shownStats(d), seasonForm: 0 })

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

  loadFromSeason: (drivers: Driver[], teams: Team[], circuit: Circuit) => void
  setGodModeDriver: (driverId: string) => void
  updateDriverForm: (driverId: string, value: number) => void
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
    })
  },

  setGodModeDriver: (driverId) => set({ godModeDriverId: driverId }),

  updateDriverForm: (driverId, value) => {
    set((state) => ({
      forms: { ...state.forms, [driverId]: Math.min(10, Math.max(0, value)) },
    }))
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
    const { raceState, drivers, teams, selectedCircuit } = get()
    if (!raceState || raceState.phase !== 'racing' || !selectedCircuit) return
    const year = useSeasonStore.getState().year
    set({ raceState: simulateLap(raceState, drivers, teams, selectedCircuit, year, godModeActions) })
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
    })
  },
}))
