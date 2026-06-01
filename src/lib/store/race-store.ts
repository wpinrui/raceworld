import { create } from 'zustand'
import type { Driver, Team, RaceState, GodModeAction, SimSpeed } from '@/lib/sim/types'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import { calendar2026 } from '@/data/calendar'
import { rollForms, initRaceState, simulateLap } from '@/lib/sim/race'
import { runQualifying } from '@/lib/sim/qualifying'

interface RaceStore {
  raceState: RaceState | null
  drivers: Driver[]
  teams: Team[]
  selectedCircuitId: string
  forms: Record<string, number>
  strategyNoise: number   // 0–1; controls team tyre assumption accuracy

  setCircuit: (circuitId: string) => void
  updateDriverForm: (driverId: string, value: number) => void
  updateDriverStat: (driverId: string, stat: 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness', value: number) => void
  setStrategyNoise: (n: number) => void
  initSession: () => void
  tickLap: (godModeActions?: GodModeAction[]) => void
  setSpeed: (speed: SimSpeed) => void
  setPaused: (paused: boolean) => void
  resetSession: () => void
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  raceState: null,
  drivers: drivers2026.map((d) => ({ ...d })),
  teams: teams2026,
  selectedCircuitId: 'australia',
  forms: rollForms(drivers2026.map((d) => d.id)),
  strategyNoise: 0.35,

  setCircuit: (circuitId) => {
    const { drivers } = get()
    set({
      selectedCircuitId: circuitId,
      forms: rollForms(drivers.map((d) => d.id)),
    })
  },

  updateDriverForm: (driverId, value) => {
    set((state) => ({
      forms: { ...state.forms, [driverId]: Math.min(10, Math.max(0, value)) },
    }))
  },

  updateDriverStat: (driverId, stat, value) => {
    set((state) => ({
      drivers: state.drivers.map((d) =>
        d.id === driverId ? { ...d, [stat]: Math.min(100, Math.max(0, value)) } : d
      ),
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

    const nextState = simulateLap(raceState, drivers, teams, circuit, godModeActions)
    set({ raceState: nextState })
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

  resetSession: () => {
    const freshDrivers = drivers2026.map((d) => ({ ...d }))
    set({
      raceState: null,
      drivers: freshDrivers,
      forms: rollForms(freshDrivers.map((d) => d.id)),
    })
  },
}))
