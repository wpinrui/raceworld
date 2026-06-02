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
  DriverProgressionEvent,
  PendingGridChanges,
} from '@/lib/sim/types'
import { drivers2026, teams2026 } from '@/data/2026-grid'
import { calendar2026 } from '@/data/calendar'
import { computeFundingTiers, initDevPlans, applyUpgradeEvents, computeCarReshuffle, rollUpgrade } from '@/lib/sim/development'
import { applyRaceProgression, ageDrivers } from '@/lib/sim/progression'
import { computeDriverMediaScores, computeTeamMediaScores, applyMarketAttrition, runDriverMarket, generateFreeAgentPool, computeRetentionDeltas } from '@/lib/sim/market'
import { runPreSeasonTest } from '@/lib/sim/pre-season-test'
import { sortDriverStandings, sortConstructorStandings } from '@/lib/sim/standings-calc'

const TOTAL_ROUNDS = calendar2026.length

// Pre-season testing always runs at Barcelona/Catalunya.
const TEST_CIRCUIT = calendar2026.find((c) => c.id === 'spain') ?? calendar2026[0]

type StatSnapshot = Record<string, { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }>

// Snapshot the four stats of every grid driver, keyed by id.
function snapshotStats(drivers: Driver[]): StatSnapshot {
  const snap: StatSnapshot = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    snap[d.id] = {
      pace: d.pace,
      wetWeatherPace: d.wetWeatherPace,
      overtaking: d.overtaking,
      smoothness: d.smoothness,
    }
  }
  return snap
}

function computeDriverStandings(
  drivers: Driver[],
  teams: Team[],
  raceResults: RaceResult[][],
): DriverStanding[] {
  const map = new Map<string, DriverStanding>()

  for (const driver of drivers.filter((d) => d.teamId !== '')) {
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

  return sortDriverStandings([...map.values()])
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

  return sortConstructorStandings([...map.values()])
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
  // M4 god-mode: team add/remove queued for next season (applied at season end).
  pendingGridChanges: PendingGridChanges
  // Snapshot of each grid driver's stats at season start, for the net-development summary.
  seasonStartStats: Record<string, { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }>

  // Computed
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]

  // Actions
  initSeason: (drivers: Driver[], teams: Team[], year: number) => void
  updateGrid: (drivers: Driver[], teams: Team[]) => void
  updateDriver: (id: string, patch: Partial<Driver>) => void
  releaseDriver: (id: string) => void
  extendContract: (id: string, seasons: number) => void
  assignDriverToTeam: (driverId: string, teamId: string) => void
  setPendingUpgrade: (teamId: string, patch: { paceDelta?: number; failed?: boolean }) => void
  queueTeamAddition: (team: Team) => void
  cancelTeamAddition: (teamId: string) => void
  queueTeamRemoval: (teamId: string) => void
  cancelTeamRemoval: (teamId: string) => void
  recordRaceResult: (results: RaceResult[]) => void
  advanceRound: () => void
  endSeason: () => void
  runContractNegotiations: () => void
  runDriverRetirements: () => void
  runPreSeasonTesting: () => void
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
      pendingGridChanges: { additions: [], removals: [] },
      seasonStartStats: {},
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
          : generateFreeAgentPool(25, year, drivers, Math.random)
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
          seasonStartStats: snapshotStats(allDrivers),
          driverStandings: computeDriverStandings(allDrivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, allDrivers, []),
        })
      },

      // Persist in-place edits to the grid (driver market screen) without
      // resetting the season. Recompute standings so renames / team moves show.
      updateGrid: (drivers, teams) => {
        const { raceResults } = get()
        set({
          drivers,
          teams,
          driverStandings: computeDriverStandings(drivers, teams, raceResults),
          constructorStandings: computeConstructorStandings(teams, drivers, raceResults),
        })
      },

      // God-mode edit of a single driver (e.g. from the world driver page).
      updateDriver: (id, patch) => {
        const { drivers, teams, raceResults } = get()
        const next = drivers.map((d) => (d.id === id ? { ...d, ...patch } : d))
        set({
          drivers: next,
          driverStandings: computeDriverStandings(next, teams, raceResults),
          constructorStandings: computeConstructorStandings(teams, next, raceResults),
        })
      },

      // God-mode: forcibly release a driver from their contract. The seat opens for the
      // next market window; mid-season the team simply runs one car until it's filled.
      releaseDriver: (id) => {
        const { drivers, teams, raceResults, year } = get()
        const next = drivers.map((d) =>
          // Only reset the out-of-F1 counter for a driver who actually held a seat.
          d.id === id
            ? { ...d, teamId: '', contractExpiresAfterSeason: year - 1, seasonsSinceF1Seat: d.teamId !== '' ? 0 : (d.seasonsSinceF1Seat ?? 0) }
            : d,
        )
        set({
          drivers: next,
          driverStandings: computeDriverStandings(next, teams, raceResults),
          constructorStandings: computeConstructorStandings(teams, next, raceResults),
        })
      },

      // God-mode: extend a driver's contract by N seasons (from the current year if it
      // had already lapsed).
      extendContract: (id, seasons) => {
        const { drivers, year } = get()
        const next = drivers.map((d) =>
          d.id === id
            ? { ...d, contractExpiresAfterSeason: Math.max(d.contractExpiresAfterSeason, year) + seasons }
            : d,
        )
        set({ drivers: next })
      },

      // God-mode: manually assign an uncontracted driver to a team with an open seat,
      // bypassing the market. No-op if the team already has two drivers.
      assignDriverToTeam: (driverId, teamId) => {
        const { drivers, teams, raceResults, year } = get()
        if (drivers.filter((d) => d.teamId === teamId).length >= 2) return
        const next = drivers.map((d) =>
          d.id === driverId
            ? { ...d, teamId, contractExpiresAfterSeason: year + 1, seasonsSinceF1Seat: 0 }
            : d,
        )
        set({
          drivers: next,
          driverStandings: computeDriverStandings(next, teams, raceResults),
          constructorStandings: computeConstructorStandings(teams, next, raceResults),
        })
      },

      // God-mode: view/edit a team's pre-rolled pending upgrade before it lands.
      // The player can override the impact or force/clear a failure; the cycle length
      // and delivery round stay fixed (the GDD forbids influencing the cycle itself).
      setPendingUpgrade: (teamId, patch) => {
        const { devPlans } = get()
        set({
          devPlans: devPlans.map((p) => {
            if (p.teamId !== teamId) return p
            const failed = patch.failed ?? p.pendingFailed ?? false
            const rawDelta = patch.paceDelta ?? p.pendingPaceDelta ?? 0
            // Keep the rolled/edited impact even when failure is forced — delivery already
            // zeroes a failed upgrade (applyUpgradeEvents), so toggling failure off restores it.
            const paceDelta = Math.max(0, Math.round(rawDelta * 10) / 10)
            return { ...p, pendingFailed: failed, pendingPaceDelta: paceDelta }
          }),
        })
      },

      // God-mode grid change: queue a brand-new team to join next season. Seats start
      // empty and are filled by the market; the change applies at the season-end
      // transition (see endSeason).
      queueTeamAddition: (team) => {
        const { pendingGridChanges } = get()
        if (pendingGridChanges.additions.some((t) => t.id === team.id)) return
        set({
          pendingGridChanges: {
            ...pendingGridChanges,
            additions: [...pendingGridChanges.additions, team],
          },
        })
      },

      cancelTeamAddition: (teamId) => {
        const { pendingGridChanges } = get()
        set({
          pendingGridChanges: {
            ...pendingGridChanges,
            additions: pendingGridChanges.additions.filter((t) => t.id !== teamId),
          },
        })
      },

      // God-mode grid change: queue an existing team to leave at season end. Its drivers
      // re-enter the market. Applied at the season-end transition (see endSeason).
      queueTeamRemoval: (teamId) => {
        const { pendingGridChanges } = get()
        if (pendingGridChanges.removals.includes(teamId)) return
        set({
          pendingGridChanges: {
            ...pendingGridChanges,
            removals: [...pendingGridChanges.removals, teamId],
          },
        })
      },

      cancelTeamRemoval: (teamId) => {
        const { pendingGridChanges } = get()
        set({
          pendingGridChanges: {
            ...pendingGridChanges,
            removals: pendingGridChanges.removals.filter((id) => id !== teamId),
          },
        })
      },

      recordRaceResult: (results) => {
        const { drivers, teams, raceResults, currentRound, devPlans, allUpgradeEvents } = get()
        const updated = [...raceResults]
        updated[currentRound - 1] = results

        // Deliver any car upgrades due this round (funding penalty is baked into the upgrade).
        const { upgradeEvents, updatedTeams, updatedDevPlans } =
          applyUpgradeEvents(currentRound, teams, devPlans, Math.random)

        // Driver development applies after each race.
        const { updatedDrivers } = applyRaceProgression(drivers, Math.random)

        set({
          raceResults: updated,
          phase: 'post-race',
          teams: updatedTeams,
          drivers: updatedDrivers,
          devPlans: updatedDevPlans,
          allUpgradeEvents: [...allUpgradeEvents, ...upgradeEvents],
          driverStandings: computeDriverStandings(updatedDrivers, updatedTeams, updated),
          constructorStandings: computeConstructorStandings(updatedTeams, updatedDrivers, updated),
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
          seasonStartStats,
          pendingGridChanges,
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

        // 2. Net development this season = current stats vs the season-start snapshot
        //    (the actual improvement/decline already happened race-by-race).
        const progressionEvents: DriverProgressionEvent[] = []
        for (const d of drivers) {
          const start = seasonStartStats[d.id]
          if (!start) continue
          for (const stat of ['pace', 'wetWeatherPace', 'overtaking', 'smoothness'] as const) {
            if (Math.abs(d[stat] - start[stat]) >= 0.05) {
              progressionEvents.push({
                driverId: d.id, driverName: d.name, stat,
                before: start[stat], after: d[stat],
                direction: d[stat] > start[stat] ? 'improved' : 'declined',
              })
            }
          }
        }

        // 3. Age every driver one year. Reshuffle, market and attrition are
        //    deferred to their own off-season phases (run lazily on entry).
        const agedDrivers = ageDrivers(drivers)

        // 3b. Apply any god-mode grid changes for the coming season (GDD §Grid Changes):
        //     departing teams leave and their drivers re-enter the market as free agents;
        //     new teams join at the lowest car pace, with empty seats the market then
        //     fills during contract negotiations. The current season has already played
        //     out under the old grid, so the change takes effect from next season.
        let nextTeams = teams
        let nextDrivers = agedDrivers
        const { additions, removals } = pendingGridChanges
        if (removals.length > 0) {
          nextTeams = nextTeams.filter((t) => !removals.includes(t.id))
          nextDrivers = nextDrivers.map((d) =>
            removals.includes(d.teamId) ? { ...d, teamId: '', seasonsSinceF1Seat: 0 } : d,
          )
        }
        if (additions.length > 0) {
          const lowestPace = Math.min(75, ...nextTeams.map((t) => t.carPace))
          const added = additions.map((t, i) => ({
            ...t,
            carPace: Math.max(5, lowestPace - 5 * (i + 1)),
          }))
          nextTeams = [...nextTeams, ...added]
        }

        // 4. Build the partial summary; later phases fill in their slices.
        const summary: EndOfSeasonSummary = {
          seasonYear: year,
          driverChampion: driverStandings[0]?.driverId ?? '',
          constructorChampion: constructorStandings[0]?.teamId ?? '',
          progressionEvents,
          retiredDriverIds: [],
          carReshuffleOldPaces: {},
          carReshuffleNewPaces: {},
          marketMoves: [],
          droppedDrivers: [],
          seatContests: [],
          driverMediaScores,
          teamMediaScores,
          upgradeEvents: allUpgradeEvents,
          preSeasonTest: null,
          retentionDelta: computeRetentionDeltas(drivers, teams, raceResults),
        }

        // 5. Update constructor history (prepend current season, dedupe, keep ≤55)
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
          pendingNextSeasonState: { drivers: nextDrivers, teams: nextTeams },
          pendingGridChanges: { additions: [], removals: [] },
        })
      },

      // Phase 2: free agents sign for the coming season.
      runContractNegotiations: () => {
        const { pendingNextSeasonState, endOfSeasonSummary, year } = get()
        if (!pendingNextSeasonState || !endOfSeasonSummary) return
        const { drivers, teams } = pendingNextSeasonState

        const { updatedDrivers, marketMoves, seatContests, droppedDrivers } = runDriverMarket(
          drivers,
          teams,
          endOfSeasonSummary.driverMediaScores,
          endOfSeasonSummary.teamMediaScores,
          endOfSeasonSummary.retentionDelta ?? {},
          year + 1,
          Math.random,
        )

        set({
          phase: 'contract-negotiations',
          endOfSeasonSummary: { ...endOfSeasonSummary, marketMoves, seatContests, droppedDrivers },
          pendingNextSeasonState: { drivers: updatedDrivers, teams },
        })
      },

      // Phase 3: drivers without a seat for 5 seasons leave the market.
      runDriverRetirements: () => {
        const { pendingNextSeasonState, endOfSeasonSummary } = get()
        if (!pendingNextSeasonState || !endOfSeasonSummary) return
        const { drivers, teams } = pendingNextSeasonState

        const { drivers: survivors, retiredDriverIds } = applyMarketAttrition(drivers)

        set({
          phase: 'driver-retirements',
          endOfSeasonSummary: { ...endOfSeasonSummary, retiredDriverIds },
          pendingNextSeasonState: { drivers: survivors, teams },
        })
      },

      // Phase 4: car reshuffle for next season, revealed obliquely via a test session.
      runPreSeasonTesting: () => {
        const { pendingNextSeasonState, endOfSeasonSummary } = get()
        if (!pendingNextSeasonState || !endOfSeasonSummary) return
        const { drivers, teams } = pendingNextSeasonState

        const { updatedTeams: reshuffledTeams, oldPaces, newPaces } =
          computeCarReshuffle(teams, Math.random)
        const preSeasonTest = runPreSeasonTest(drivers, reshuffledTeams, TEST_CIRCUIT, Math.random)

        set({
          phase: 'pre-season-testing',
          endOfSeasonSummary: {
            ...endOfSeasonSummary,
            carReshuffleOldPaces: oldPaces,
            carReshuffleNewPaces: newPaces,
            preSeasonTest,
          },
          pendingNextSeasonState: { drivers, teams: reshuffledTeams },
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
        const topUp = existingPool.length < 15
          ? generateFreeAgentPool(15 - existingPool.length, newYear, pendingDrivers, Math.random)
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
        pendingGridChanges: state.pendingGridChanges,
        seasonStartStats: state.seasonStartStats,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const { drivers, teams, raceResults } = state
        state.driverStandings = computeDriverStandings(drivers, teams, raceResults)
        state.constructorStandings = computeConstructorStandings(teams, drivers, raceResults)
        // Saves from before M4: default the grid-change queue and backfill each dev
        // plan's pre-rolled pending upgrade so the override UI always has a value.
        if (!state.pendingGridChanges) state.pendingGridChanges = { additions: [], removals: [] }
        if (state.devPlans) {
          state.devPlans = state.devPlans.map((p) => {
            if (p.pendingPaceDelta !== undefined && p.pendingFailed !== undefined) return p
            const rolled = rollUpgrade(p.cycleLength, p.fundingTier, Math.random)
            return { ...p, pendingPaceDelta: rolled.paceDelta, pendingFailed: rolled.failed }
          })
        }
      },
    },
  ),
)
