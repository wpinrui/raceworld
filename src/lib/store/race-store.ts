import { create } from 'zustand'
import type { Driver, Team, Circuit, RaceState, GodModeAction, SimSpeed } from '@/lib/sim/types'
import { rollForms, initRaceState, simulateLap } from '@/lib/sim/race'
import { runQualifying } from '@/lib/sim/qualifying'
import { useSeasonStore } from './season-store'

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

  loadFromSeason: (drivers: Driver[], teams: Team[], circuit: Circuit) => void
  setGodModeDriver: (driverId: string) => void
  updateDriverForm: (driverId: string, value: number) => void
  setStrategyNoise: (n: number) => void
  initSession: () => void
  tickLap: (godModeActions?: GodModeAction[]) => void
  setSpeed: (speed: SimSpeed) => void
  setPaused: (paused: boolean) => void
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

  loadFromSeason: (drivers, teams, circuit) => {
    const { godModeDriverId } = get()
    // Keep selection if the driver is still on the grid, otherwise clear
    const stillExists = godModeDriverId && drivers.some((d) => d.id === godModeDriverId)
    set({
      drivers: drivers.map((d) => ({ ...d })),
      teams: teams.map((t) => ({ ...t })),
      selectedCircuit: circuit,
      forms: rollForms(drivers),
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
    const { results, sessions } = runQualifying(drivers, teams, selectedCircuit, forms)
    const raceState = initRaceState(drivers, teams, selectedCircuit, results, sessions, forms, strategyNoise)
    set({ raceState })
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

  resetSession: (drivers, teams, circuit) => {
    const nextDrivers = (drivers ?? get().drivers).map((d) => ({ ...d }))
    set({
      raceState: null,
      drivers: nextDrivers,
      teams: teams ? teams.map((t) => ({ ...t })) : get().teams,
      selectedCircuit: circuit ?? get().selectedCircuit,
      forms: rollForms(nextDrivers),
    })
  },
}))
