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

  setCircuit: (circuitId: string) => void
  initSession: () => void
  tickLap: (godModeActions?: GodModeAction[]) => void
  setSpeed: (speed: SimSpeed) => void
  setPaused: (paused: boolean) => void
  resetSession: () => void
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  raceState: null,
  drivers: drivers2026,
  teams: teams2026,
  selectedCircuitId: 'australia',
  forms: {},

  setCircuit: (circuitId) => {
    set({ selectedCircuitId: circuitId })
  },

  initSession: () => {
    const { drivers, teams, selectedCircuitId } = get()
    const circuit = calendar2026.find((c) => c.id === selectedCircuitId)
    if (!circuit) return

    const forms = rollForms(drivers.map((d) => d.id))
    const { results, sessions } = runQualifying(drivers, teams, circuit, forms)
    const raceState = initRaceState(drivers, teams, circuit, results, sessions, forms)

    set({ forms, raceState })
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
    set({ raceState: null, forms: {} })
  },
}))
