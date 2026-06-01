import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Driver,
  Team,
  RaceResult,
  SeasonPhase,
  DriverStanding,
  ConstructorStanding,
} from '@/lib/sim/types'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import { calendar2026 } from '@/data/calendar'

const TOTAL_ROUNDS = calendar2026.length

function computeDriverStandings(
  drivers: Driver[],
  teams: Team[],
  raceResults: RaceResult[][],
): DriverStanding[] {
  const map = new Map<string, DriverStanding>()

  for (const driver of drivers) {
    const team = teams.find((t) => t.id === driver.teamId)
    map.set(driver.id, {
      driverId: driver.id,
      driverName: driver.name,
      teamId: driver.teamId,
      teamName: team?.name ?? driver.teamId,
      points: 0,
      wins: 0,
      results: Array(TOTAL_ROUNDS).fill(null),
    })
  }

  for (let round = 0; round < raceResults.length; round++) {
    for (const result of raceResults[round]) {
      const standing = map.get(result.driverId)
      if (!standing) continue
      standing.points += result.points
      if (result.finishPosition === 1) standing.wins++
      standing.results[round] = result.dnf ? null : result.finishPosition
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    // Countback: compare number of each position 1→22. DNF (null) never matches, so it loses to any finish.
    for (let pos = 1; pos <= 22; pos++) {
      const diff = b.results.filter((r) => r === pos).length - a.results.filter((r) => r === pos).length
      if (diff !== 0) return diff
    }
    return 0
  })
}

function computeConstructorStandings(
  teams: Team[],
  drivers: Driver[],
  raceResults: RaceResult[][],
): ConstructorStanding[] {
  const map = new Map<string, ConstructorStanding>()

  for (const team of teams) {
    const teamDrivers = drivers.filter((d) => d.teamId === team.id)
    map.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      points: 0,
      wins: 0,
      results: teamDrivers.map(() => Array(TOTAL_ROUNDS).fill(null)),
    })
  }

  for (let round = 0; round < raceResults.length; round++) {
    for (const result of raceResults[round]) {
      const standing = map.get(result.teamId)
      if (!standing) continue
      standing.points += result.points
      if (result.finishPosition === 1) standing.wins++
      const teamDrivers = drivers.filter((d) => d.teamId === result.teamId)
      const driverIdx = teamDrivers.findIndex((d) => d.id === result.driverId)
      if (driverIdx >= 0) {
        standing.results[driverIdx][round] = result.dnf ? null : result.finishPosition
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    return b.wins - a.wins
  })
}

// Reset car paces to initial order (75, 70, 65, ...) with a floor of 5
function resetCarPaces(teams: Team[]): Team[] {
  return teams.map((team, idx) => ({
    ...team,
    carPace: Math.max(5, 75 - idx * 5),
  }))
}

interface SeasonStore {
  phase: SeasonPhase
  year: number
  drivers: Driver[]
  teams: Team[]
  currentRound: number  // 1-indexed
  raceResults: RaceResult[][]  // [round-1]
  dbSeasonId: number | null

  // Computed
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]

  // Actions
  initSeason: (drivers: Driver[], teams: Team[], year: number) => void
  recordRaceResult: (results: RaceResult[]) => void
  advanceRound: () => void
  endSeason: () => void
  setDbSeasonId: (id: number) => void
  startNewSeason: () => void
  resetToIdle: () => void
}

export const useSeasonStore = create<SeasonStore>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      year: 2026,
      drivers: drivers2026.map((d) => ({ ...d })),
      teams: teams2026.map((t) => ({ ...t })),
      currentRound: 1,
      raceResults: [],
      dbSeasonId: null,
      driverStandings: [],
      constructorStandings: [],

      initSeason: (drivers, teams, year) => {
        set({
          phase: 'pre-race',
          year,
          drivers,
          teams,
          currentRound: 1,
          raceResults: [],
          dbSeasonId: null,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      recordRaceResult: (results) => {
        const { drivers, teams, raceResults, currentRound } = get()
        const updated = [...raceResults]
        updated[currentRound - 1] = results
        set({
          raceResults: updated,
          phase: 'post-race',
          driverStandings: computeDriverStandings(drivers, teams, updated),
          constructorStandings: computeConstructorStandings(teams, drivers, updated),
        })
      },

      advanceRound: () => {
        const { currentRound } = get()
        if (currentRound >= TOTAL_ROUNDS) {
          set({ phase: 'end-of-season' })
        } else {
          set({ currentRound: currentRound + 1, phase: 'pre-race' })
        }
      },

      endSeason: () => set({ phase: 'end-of-season' }),

      setDbSeasonId: (id) => set({ dbSeasonId: id }),

      startNewSeason: () => {
        const { drivers, teams, year } = get()
        const resetTeams = resetCarPaces(teams)
        const newYear = year + 1
        set({
          phase: 'idle',
          year: newYear,
          drivers: drivers.map((d) => ({ ...d })),
          teams: resetTeams,
          currentRound: 1,
          raceResults: [],
          dbSeasonId: null,
          driverStandings: computeDriverStandings(drivers, resetTeams, []),
          constructorStandings: computeConstructorStandings(resetTeams, drivers, []),
        })
      },

      resetToIdle: () => {
        const { drivers, teams } = get()
        set({
          phase: 'idle',
          currentRound: 1,
          raceResults: [],
          dbSeasonId: null,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },
    }),
    {
      name: 'raceworld-season',
      // Persist everything except computed fields (they'll be recomputed on hydration)
      partialize: (state) => ({
        phase: state.phase,
        year: state.year,
        drivers: state.drivers,
        teams: state.teams,
        currentRound: state.currentRound,
        raceResults: state.raceResults,
        dbSeasonId: state.dbSeasonId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const { drivers, teams, raceResults } = state
        state.driverStandings = computeDriverStandings(drivers, teams, raceResults)
        state.constructorStandings = computeConstructorStandings(teams, drivers, raceResults)
      },
    },
  ),
)
