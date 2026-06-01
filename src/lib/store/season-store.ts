import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Driver,
  Team,
  RaceResult,
  SeasonPhase,
  DriverStanding,
  ConstructorStanding,
  TeamDevPlan,
  DevUpgradeEvent,
  ConstructorSeasonRecord,
  EndOfSeasonSummary,
} from '@/lib/sim/types'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import { calendar2026 } from '@/data/calendar'
import { computeFundingTiers, initDevPlans, applyFundingPenalties, applyUpgradeEvents, computeCarReshuffle } from '@/lib/sim/development'
import { applyDriverProgression } from '@/lib/sim/progression'
import { computeDriverMediaScores, computeTeamMediaScores, determineRetirements, runDriverMarket, generateFreeAgentPool } from '@/lib/sim/market'

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

interface SeasonStore {
  phase: SeasonPhase
  year: number
  drivers: Driver[]
  teams: Team[]
  currentRound: number  // 1-indexed
  raceResults: RaceResult[][]  // [round-1]
  dbSeasonId: number | null

  // M3 state
  devPlans: TeamDevPlan[]
  constructorHistory: ConstructorSeasonRecord[]
  allUpgradeEvents: DevUpgradeEvent[]
  endOfSeasonSummary: EndOfSeasonSummary | null
  pendingNextSeasonState: { drivers: Driver[]; teams: Team[] } | null

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
  loadConstructorHistory: (history: ConstructorSeasonRecord[]) => void
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
      devPlans: [],
      constructorHistory: [],
      allUpgradeEvents: [],
      endOfSeasonSummary: null,
      pendingNextSeasonState: null,
      driverStandings: [],
      constructorStandings: [],

      initSeason: (drivers, teams, year) => {
        const { constructorHistory } = get()
        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const devPlans = initDevPlans(teams, fundingTiers, Math.random)
        // Keep existing free agents from store; generate pool only if none present
        const existingPool = get().drivers.filter((d) => d.teamId === '')
        const poolDrivers = existingPool.length > 0
          ? existingPool
          : generateFreeAgentPool(12, year, drivers, Math.random)
        const allDrivers = [
          ...drivers.filter((d) => d.teamId !== ''),
          ...poolDrivers,
        ]
        set({
          phase: 'pre-race',
          year,
          drivers: allDrivers,
          teams,
          currentRound: 1,
          raceResults: [],
          dbSeasonId: null,
          devPlans,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          pendingNextSeasonState: null,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      recordRaceResult: (results) => {
        const { drivers, teams, raceResults, currentRound, devPlans, allUpgradeEvents } = get()
        const updated = [...raceResults]
        updated[currentRound - 1] = results

        // Apply upgrade events for this round, then funding penalties
        const { upgradeEvents, updatedTeams: teamsAfterUpgrades, updatedDevPlans: plansAfterUpgrades } =
          applyUpgradeEvents(currentRound, teams, devPlans, Math.random)

        const { updatedTeams, updatedDevPlans } =
          applyFundingPenalties(teamsAfterUpgrades, plansAfterUpgrades)

        set({
          raceResults: updated,
          phase: 'post-race',
          teams: updatedTeams,
          devPlans: updatedDevPlans,
          allUpgradeEvents: [...allUpgradeEvents, ...upgradeEvents],
          driverStandings: computeDriverStandings(drivers, updatedTeams, updated),
          constructorStandings: computeConstructorStandings(updatedTeams, drivers, updated),
        })
      },

      advanceRound: () => {
        const { currentRound, endSeason } = get()
        if (currentRound >= TOTAL_ROUNDS) {
          endSeason()
        } else {
          set({ currentRound: currentRound + 1, phase: 'pre-race' })
        }
      },

      endSeason: () => {
        const {
          drivers,
          teams,
          raceResults,
          year,
          constructorHistory,
          allUpgradeEvents,
          driverStandings,
          constructorStandings,
        } = get()

        const totalTeams = teams.length
        const constructorRankInfo = constructorStandings.map((cs, idx) => ({
          teamId: cs.teamId,
          points: cs.points,
          finalPosition: idx + 1,
        }))

        // 1. Media scores
        const driverMediaScores = computeDriverMediaScores(
          drivers, teams, raceResults, constructorRankInfo, totalTeams,
        )
        const teamMediaScores = computeTeamMediaScores(teams, constructorHistory, constructorRankInfo)

        // 2. Driver progression (age increment + stat changes)
        const { updatedDrivers: agedDrivers, events: progressionEvents } =
          applyDriverProgression(drivers, Math.random)

        // 3. Retirements
        const retiredDriverIds = determineRetirements(agedDrivers, driverMediaScores, year)

        // 4. Car reshuffle
        const { updatedTeams: reshuffledTeams, oldPaces, newPaces } =
          computeCarReshuffle(teams, Math.random)

        // 5. Driver market
        const newYear = year + 1
        const { updatedDrivers: finalDrivers, marketMoves } = runDriverMarket(
          agedDrivers,
          reshuffledTeams,
          retiredDriverIds,
          driverMediaScores,
          teamMediaScores,
          newYear,
          Math.random,
        )

        // 6. Build summary
        const summary: EndOfSeasonSummary = {
          seasonYear: year,
          driverChampion: driverStandings[0]?.driverId ?? '',
          constructorChampion: constructorStandings[0]?.teamId ?? '',
          progressionEvents,
          retiredDriverIds,
          carReshuffleOldPaces: oldPaces,
          carReshuffleNewPaces: newPaces,
          marketMoves,
          driverMediaScores,
          teamMediaScores,
          upgradeEvents: allUpgradeEvents,
        }

        // 7. Update constructor history (prepend current season, dedupe, keep ≤55)
        const newHistoryEntries: ConstructorSeasonRecord[] = constructorRankInfo.map((cs) => ({
          seasonYear: year,
          teamId: cs.teamId,
          finalPosition: cs.finalPosition,
          points: cs.points,
        }))
        const updatedHistory = [
          ...newHistoryEntries,
          ...constructorHistory,
        ]
          .filter(
            (r, idx, arr) =>
              arr.findIndex((x) => x.seasonYear === r.seasonYear && x.teamId === r.teamId) === idx,
          )
          .slice(0, 55)

        set({
          phase: 'end-of-season',
          endOfSeasonSummary: summary,
          constructorHistory: updatedHistory,
          pendingNextSeasonState: { drivers: finalDrivers, teams: reshuffledTeams },
        })
      },

      setDbSeasonId: (id) => set({ dbSeasonId: id }),

      startNewSeason: () => {
        const { pendingNextSeasonState, year, constructorHistory } = get()
        const newYear = year + 1

        if (!pendingNextSeasonState) {
          // Fallback: should not normally occur
          const { drivers, teams } = get()
          const fundingTiers = computeFundingTiers(teams, constructorHistory)
          const devPlans = initDevPlans(teams, fundingTiers, Math.random)
          set({
            phase: 'idle',
            year: newYear,
            currentRound: 1,
            raceResults: [],
            dbSeasonId: null,
            devPlans,
            allUpgradeEvents: [],
            endOfSeasonSummary: null,
            driverStandings: computeDriverStandings(drivers, teams, []),
            constructorStandings: computeConstructorStandings(teams, drivers, []),
          })
          return
        }

        const { drivers: pendingDrivers, teams } = pendingNextSeasonState
        // Ensure at least 8 free agents in the pool; top up if needed
        const existingPool = pendingDrivers.filter((d) => d.teamId === '')
        const topUp = existingPool.length < 8
          ? generateFreeAgentPool(8 - existingPool.length, newYear, pendingDrivers, Math.random)
          : []
        const drivers = [...pendingDrivers, ...topUp]
        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const devPlans = initDevPlans(teams, fundingTiers, Math.random)

        set({
          phase: 'idle',
          year: newYear,
          drivers,
          teams,
          currentRound: 1,
          raceResults: [],
          dbSeasonId: null,
          devPlans,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          pendingNextSeasonState: null,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      resetToIdle: () => {
        const { drivers, teams } = get()
        set({
          phase: 'idle',
          currentRound: 1,
          raceResults: [],
          dbSeasonId: null,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          pendingNextSeasonState: null,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      loadConstructorHistory: (history) => set({ constructorHistory: history }),
    }),
    {
      name: 'raceworld-season',
      partialize: (state) => ({
        phase: state.phase,
        year: state.year,
        drivers: state.drivers,
        teams: state.teams,
        currentRound: state.currentRound,
        raceResults: state.raceResults,
        dbSeasonId: state.dbSeasonId,
        devPlans: state.devPlans,
        constructorHistory: state.constructorHistory,
        allUpgradeEvents: state.allUpgradeEvents,
        endOfSeasonSummary: state.endOfSeasonSummary,
        pendingNextSeasonState: state.pendingNextSeasonState,
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
