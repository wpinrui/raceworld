import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Player preferences for the FM-style "Continue" loop: which news interrupts the sim, and which
// drivers/teams the player follows (so any story mentioning them interrupts too). Kept in its own
// persisted store — these are personal settings, independent of any one season save, and survive a
// "Clear Save". Raceday ALWAYS interrupts and is not a category here (it's hardcoded in the loop).

// Sensible defaults: only rare, consequential, factual events stop the sim. Routine race-weekend
// coverage and opinion/rumour pieces (race reports, previews, analysis, features, technical, silly
// season, driver-watch, rookie debuts, launches) are left to read at leisure in the newsroom.
export const DEFAULT_INTERRUPT_CATEGORIES: string[] = [
  'championship_state', // title clinched / title-fight state
  'milestone',          // career firsts & landmarks
  'driver_signing',     // transfers in
  'driver_exit',        // transfers out
  'career_retirement',  // retirements
  'team_entry',         // a constructor joins
  'team_exit',          // a constructor leaves
  'mid_season_swap',    // mid-season driver change
]

interface SettingsStore {
  interruptOnRaceday: boolean      // stop the sim on race day (default on; off = races auto-simulate)
  interruptCategories: string[]   // category strings whose articles interrupt the sim
  followedDriverIds: string[]
  followedTeamIds: string[]
  interruptOnFollowed: boolean     // master switch: stop on any story mentioning a followed entity

  setInterruptOnRaceday: (on: boolean) => void
  setCategoryInterrupt: (category: string, on: boolean) => void
  toggleFollowDriver: (id: string) => void
  toggleFollowTeam: (id: string) => void
  setInterruptOnFollowed: (on: boolean) => void
  resetInterruptsToDefault: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      interruptOnRaceday: true,
      interruptCategories: [...DEFAULT_INTERRUPT_CATEGORIES],
      followedDriverIds: [],
      followedTeamIds: [],
      interruptOnFollowed: true,

      setInterruptOnRaceday: (on) => set({ interruptOnRaceday: on }),

      setCategoryInterrupt: (category, on) => {
        const cur = new Set(get().interruptCategories)
        if (on) cur.add(category)
        else cur.delete(category)
        set({ interruptCategories: [...cur] })
      },
      toggleFollowDriver: (id) => {
        const cur = new Set(get().followedDriverIds)
        if (cur.has(id)) cur.delete(id); else cur.add(id)
        set({ followedDriverIds: [...cur] })
      },
      toggleFollowTeam: (id) => {
        const cur = new Set(get().followedTeamIds)
        if (cur.has(id)) cur.delete(id); else cur.add(id)
        set({ followedTeamIds: [...cur] })
      },
      setInterruptOnFollowed: (on) => set({ interruptOnFollowed: on }),
      resetInterruptsToDefault: () => set({ interruptCategories: [...DEFAULT_INTERRUPT_CATEGORIES] }),
    }),
    { name: 'raceworld-settings' },
  ),
)
