import { create } from 'zustand'
import type { Driver, Team, RaceState, GodModeAction, SimSpeed } from '@/lib/sim/types'
import { calendar2026 } from '@/data/calendar'
import { rollForms, initRaceState, simulateLap } from '@/lib/sim/race'
import { runQualifying } from '@/lib/sim/qualifying'

interface RaceStore {
  raceState: RaceState | null
  drivers: Driver[]
  teams: Team[]
  selectedCircuitId: string
  forms: Record<string, number>
  strategyNoise: number
  godModeDriverId: string | null  // persists across races

  loadFromSeason: (drivers: Driver[], teams: Team[], circuitId: string) => void
  setGodModeDriver: (driverId: string) => void
  updateDriverForm: (driverId: string, value: number) => void
  setStrategyNoise: (n: number) => void
  initSession: () => void
  tickLap: (godModeActions?: GodModeAction[]) => void
  setSpeed: (speed: SimSpeed) => void
  setPaused: (paused: boolean) => void
  resetSession: (drivers?: Driver[], teams?: Team[], circuitId?: string) => void
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  raceState: null,
  drivers: [],
  teams: [],
  selectedCircuitId: 'australia',
  forms: {},
  strategyNoise: 0.35,
  godModeDriverId: null,

  loadFromSeason: (drivers, teams, circuitId) => {
    const { godModeDriverId } = get()
    // Keep selection if the driver is still on the grid, otherwise clear
    const stillExists = godModeDriverId && drivers.some((d) => d.id === godModeDriverId)
    set({
      drivers: drivers.map((d) => ({ ...d })),
      teams: teams.map((t) => ({ ...t })),
      selectedCircuitId: circuitId,
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
    const { drivers, teams, selectedCircuitId, forms, strategyNoise } = get()
    const circuit = calendar2026.find((c) => c.id === selectedCircuitId)
    if (!circuit) return
    const { results, sessions } = runQualifying(drivers, teams, circuit, forms)
    const raceState = initRaceState(drivers, teams, circuit, results, sessions, forms, strategyNoise)
    set({ raceState })
  },

  tickLap: (godModeActions) => {
    const { raceState, drivers, teams, selectedCircuitId } = get()
    if (!raceState || raceState.phase !== 'racing') return
    const circuit = calendar2026.find((c) => c.id === selectedCircuitId)
    if (!circuit) return
    set({ raceState: simulateLap(raceState, drivers, teams, circuit, godModeActions) })
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

  resetSession: (drivers, teams, circuitId) => {
    const nextDrivers = (drivers ?? get().drivers).map((d) => ({ ...d }))
    set({
      raceState: null,
      drivers: nextDrivers,
      teams: teams ? teams.map((t) => ({ ...t })) : get().teams,
      selectedCircuitId: circuitId ?? get().selectedCircuitId,
      forms: rollForms(nextDrivers),
    })
  },
}))
