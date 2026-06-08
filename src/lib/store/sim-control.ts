import { create } from 'zustand'

// Bridges the home calendar (RaceBanner) to the Nav, which owns the sim execution + overlays. RaceBanner
// posts a request here; a Nav effect picks it up, runs the sim, and clears it. `simBusy` lets RaceBanner
// disable its buttons while any sim is running.
interface SimControlState {
  simBusy: boolean
  setSimBusy: (v: boolean) => void
  // Simulate the CURRENT race (the race-sim modal).
  simRacePending: boolean
  requestSimRace: () => void
  clearSimRace: () => void
  // Fast-forward (day-bar, no news/followed interrupts) up to a FUTURE race's weekend.
  advancePending: number | null
  requestAdvance: (round: number) => void
  clearAdvance: () => void
}

export const useSimControl = create<SimControlState>((set) => ({
  simBusy: false,
  setSimBusy: (v) => set({ simBusy: v }),
  simRacePending: false,
  requestSimRace: () => set({ simRacePending: true }),
  clearSimRace: () => set({ simRacePending: false }),
  advancePending: null,
  requestAdvance: (round) => set({ advancePending: round }),
  clearAdvance: () => set({ advancePending: null }),
}))
