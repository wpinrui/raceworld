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
import { raceDate, toISODate } from '@/lib/sim/calendar-dates'
import { computeFundingTiers, initDevPlans, applyUpgradeEvents, computeCarReshuffle, rollUpgrade } from '@/lib/sim/development'
import { applyRaceProgression, ageDrivers } from '@/lib/sim/progression'
import { computeDriverMediaScores, computeTeamMediaScores, applyMarketAttrition, runDriverMarket, generateFreeAgentPool, computeRetentionDeltas } from '@/lib/sim/market'
import { runPreSeasonTest } from '@/lib/sim/pre-season-test'
import { sortDriverStandings, sortConstructorStandings } from '@/lib/sim/standings-calc'
import { rookiesForYear, lastDriverEntryYear } from '@/lib/history/compose'

const TOTAL_ROUNDS = calendar2026.length

// Pre-season testing always runs at Barcelona/Catalunya.
const TEST_CIRCUIT = calendar2026.find((c) => c.id === 'spain') ?? calendar2026[0]

// The game clock starts on 1 January of the season year — a pre-season window (launches,
// testing) ahead of the opening round. Stored as a serialisable 'YYYY-MM-DD' string.
const seasonStartDate = (year: number) => `${year}-01-01`
// Race day (ISO date string) for a 1-based round in a given season year.
const roundDate = (year: number, round: number): string => {
  const c = calendar2026[round - 1]
  return c ? toISODate(raceDate(year, c)) : seasonStartDate(year)
}

type StatSnapshot = Record<string, { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }>

// One sampled point on a driver's in-progress-season attribute timeline. round 0 = season
// start; rounds 1..N = post-race. Past seasons live in the DB; this carries only the
// current (unarchived) season, which the DB career query excludes.
export type StatPoint = { round: number; pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }
type StatHistory = Record<string, StatPoint[]>

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

// Seed the per-race stat history with a round-0 baseline for every grid driver.
function seedStatHistory(drivers: Driver[]): StatHistory {
  const hist: StatHistory = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    hist[d.id] = [{ round: 0, pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness }]
  }
  return hist
}

// Append a post-race point for each grid driver at the given round.
function appendStatHistory(prev: StatHistory, drivers: Driver[], round: number): StatHistory {
  const next: StatHistory = { ...prev }
  for (const d of drivers) {
    if (d.teamId === '') continue
    const point: StatPoint = { round, pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness }
    const series = (next[d.id] ?? []).filter((p) => p.round !== round)
    next[d.id] = [...series, point]
  }
  return next
}

// Per-round snapshot of every car's pace, for the home Car Development chart. Round 0 = season start;
// one entry is appended per completed round. A god-mode pace edit refreshes the latest (current) entry,
// so the chart stays accurate without reconstructing from the upgrade log (which can't see edits).
export interface CarPaceSnapshot { round: number; paces: Record<string, number> }

function snapshotCarPaces(teams: Team[]): Record<string, number> {
  const paces: Record<string, number> = {}
  for (const t of teams) paces[t.id] = t.carPace
  return paces
}

// One-time backfill for saves that predate carPaceHistory: rebuild it from the current pace minus the
// upgrades delivered after each round (best-effort; can't see past god-mode edits, which weren't logged).
function reconstructCarPaceHistory(teams: Team[], events: DevUpgradeEvent[], completedRounds: number): CarPaceSnapshot[] {
  const out: CarPaceSnapshot[] = []
  for (let r = 0; r <= completedRounds; r++) {
    const paces: Record<string, number> = {}
    for (const t of teams) {
      const future = events.reduce((s, e) => (e.teamId === t.id && e.round > r ? s + e.paceDelta : s), 0)
      paces[t.id] = Math.round((t.carPace - future) * 10) / 10
    }
    out.push({ round: r, paces })
  }
  return out
}

// Standings are derived purely from race history, never from CURRENT grid membership,
// so god-mode mid-season moves (release, reassign — even cut-and-rehire to the same
// team) stay correct: a driver's points follow the DRIVER, a team's points stay with
// the TEAM that scored them.
function computeDriverStandings(
  drivers: Driver[],
  teams: Team[],
  raceResults: RaceResult[][],
): DriverStanding[] {
  const map = new Map<string, DriverStanding>()
  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const teamName = (teamId: string) =>
    teams.find((t) => t.id === teamId)?.name ?? (teamId === '' ? 'Free agent' : teamId)

  const ensure = (driverId: string, name: string, teamId: string): DriverStanding => {
    let s = map.get(driverId)
    if (!s) {
      s = {
        driverId, driverName: name, teamId, teamName: teamName(teamId),
        points: 0, wins: 0, results: Array(TOTAL_ROUNDS).fill(null),
      }
      map.set(driverId, s)
    }
    return s
  }

  // Currently-seated drivers always appear (even on 0 points)…
  for (const d of drivers) if (d.teamId !== '') ensure(d.id, d.name, d.teamId)

  // …plus everyone who scored this season, keyed by driver — including drivers since
  // released (shown as free agents) or moved teams. Points = all they scored, anywhere.
  for (let round = 0; round < raceResults.length; round++) {
    for (const result of raceResults[round]) {
      const live = driverById.get(result.driverId)
      const s = ensure(result.driverId, live?.name ?? result.driverName, live?.teamId ?? '')
      s.points += result.points
      if (result.finishPosition === 1) s.wins++
      s.results[round] = result.dnf ? null : result.finishPosition
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

  // Drivers who raced for each team this season, in order of first appearance — so a
  // mid-season swap keeps every driver's row and attributes points to the team they
  // scored for, not whoever holds the seat now.
  const teamDriverOrder = new Map<string, string[]>()
  for (const round of raceResults) {
    for (const r of round) {
      if (!teamDriverOrder.has(r.teamId)) teamDriverOrder.set(r.teamId, [])
      const order = teamDriverOrder.get(r.teamId)!
      if (!order.includes(r.driverId)) order.push(r.driverId)
    }
  }

  for (const team of teams) {
    const order = teamDriverOrder.get(team.id) ?? drivers.filter((d) => d.teamId === team.id).map((d) => d.id)
    map.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      points: 0,
      wins: 0,
      results: order.map(() => Array(TOTAL_ROUNDS).fill(null)),
    })
  }

  for (let round = 0; round < raceResults.length; round++) {
    for (const result of raceResults[round]) {
      const standing = map.get(result.teamId)
      if (!standing) continue
      standing.points += result.points
      if (result.finishPosition === 1) standing.wins++
      const idx = (teamDriverOrder.get(result.teamId) ?? []).indexOf(result.driverId)
      if (idx >= 0) standing.results[idx][round] = result.dnf ? null : result.finishPosition
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
  currentDate: string   // game clock, ISO 'YYYY-MM-DD' (the FM-style "Continue" advances this)
  // When true, the season was started from the historical timeline: the market draws real free
  // agents (until the dataset runs out) and season-ends apply real team changes (with consent).
  realWorldMode: boolean
  // End-of-season gate: true once the player has acted on that season's real-world team changes
  // (Apply, with whatever overrides). Blocks the off-season from advancing until then. Reset each
  // time a season concludes.
  realWorldChangesResolved: boolean
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
  // Per-race attribute snapshots for the CURRENT (unarchived) season's progression chart.
  statHistory: StatHistory
  // Per-round car-pace snapshots for the current season's Car Development chart.
  carPaceHistory: CarPaceSnapshot[]

  // Computed
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]

  // Actions
  initSeason: (drivers: Driver[], teams: Team[], year: number) => void
  updateGrid: (drivers: Driver[], teams: Team[]) => void
  setCurrentDate: (date: string) => void
  setRealWorldMode: (on: boolean) => void
  // Apply the player-approved subset of a season's real-world team changes to the next-season grid.
  applyRealWorldChanges: (approved: {
    joins: { id: string; name: string; shortName: string; nationality: string; color: string }[]
    leaves: string[] // team ids leaving the grid
    rebrands: { id: string; name: string; shortName: string; color: string; nationality: string }[]
  }) => void
  updateDriver: (id: string, patch: Partial<Driver>) => void
  updateTeam: (id: string, patch: Partial<Team>) => void
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
      currentDate: seasonStartDate(2026),
      realWorldMode: false,
      realWorldChangesResolved: false,
      raceResults: [],
      dbSeasonId: null,
      devPlans: [],
      constructorHistory: [],
      allUpgradeEvents: [],
      endOfSeasonSummary: null,
      pendingNextSeasonState: null,
      pendingGridChanges: { additions: [], removals: [] },
      seasonStartStats: {},
      statHistory: {},
      carPaceHistory: [],
      driverStandings: [],
      constructorStandings: [],

      initSeason: (drivers, teams, year) => {
        const { constructorHistory } = get()
        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const devPlans = initDevPlans(teams, fundingTiers, Math.random)
        // Real-world mode: the pool is the real free agents in the composed grid (no fictional drivers).
        // Otherwise keep existing free agents from the store, or generate a pool if none present.
        const poolDrivers = get().realWorldMode
          ? drivers.filter((d) => d.teamId === '')
          : (() => {
              const existingPool = get().drivers.filter((d) => d.teamId === '')
              return existingPool.length > 0 ? existingPool : generateFreeAgentPool(25, year, drivers, Math.random)
            })()
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
          currentDate: seasonStartDate(year),
          raceResults: [],
          dbSeasonId: null,
          devPlans,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          pendingNextSeasonState: null,
          seasonStartStats: snapshotStats(allDrivers),
          statHistory: seedStatHistory(allDrivers),
          carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
          driverStandings: computeDriverStandings(allDrivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, allDrivers, []),
        })
      },

      // Persist in-place edits to the grid (driver market screen) without
      // resetting the season. Recompute standings so renames / team moves show.
      updateGrid: (drivers, teams) => {
        const { raceResults, carPaceHistory, currentRound, teams: prevTeams } = get()
        // Only touch history if a pace actually changed (the market screen also handles renames etc.);
        // then record it against the in-progress round, same as a team-page edit.
        const prevPace = new Map(prevTeams.map((t) => [t.id, t.carPace]))
        const paceChanged = teams.some((t) => prevPace.get(t.id) !== t.carPace)
        const history = paceChanged && carPaceHistory.length > 0
          ? [...carPaceHistory.filter((h) => h.round !== currentRound), { round: currentRound, paces: snapshotCarPaces(teams) }]
          : carPaceHistory
        set({
          drivers,
          teams,
          carPaceHistory: history,
          driverStandings: computeDriverStandings(drivers, teams, raceResults),
          constructorStandings: computeConstructorStandings(teams, drivers, raceResults),
        })
      },

      // Advance / set the game clock (the FM-style "Continue" loop drives this).
      setCurrentDate: (date) => set({ currentDate: date }),

      setRealWorldMode: (on) => set({ realWorldMode: on }),

      // Real-world season-end: apply the approved team changes to the next-season grid (built by
      // endSeason into pendingNextSeasonState), BEFORE contract negotiations fill the seats. Leaving
      // teams free their drivers into the market; joiners enter at the back; rebrands swap identity.
      // Idempotent: a change already reflected in the grid simply isn't offered again.
      applyRealWorldChanges: (approved) => {
        const { pendingNextSeasonState, year } = get()
        if (!pendingNextSeasonState) return
        const leaveIds = new Set(approved.leaves)
        let teams = pendingNextSeasonState.teams.filter((t) => !leaveIds.has(t.id))
        const drivers = pendingNextSeasonState.drivers.map((d) =>
          leaveIds.has(d.teamId) ? { ...d, teamId: '', contractExpiresAfterSeason: year, seasonsSinceF1Seat: 0 } : d,
        )
        const rebrandById = new Map(approved.rebrands.map((r) => [r.id, r]))
        teams = teams.map((t) => {
          const r = rebrandById.get(t.id)
          return r ? { ...t, name: r.name, shortName: r.shortName, color: r.color, nationality: r.nationality } : t
        })
        const lowest = teams.reduce((m, t) => Math.min(m, t.carPace), 75)
        approved.joins.forEach((j, i) => {
          if (teams.some((t) => t.id === j.id)) return // already applied; don't add a duplicate
          teams.push({ id: j.id, name: j.name, shortName: j.shortName, nationality: j.nationality, color: j.color, carPace: Math.max(5, lowest - 5 * (i + 1)) })
        })
        set({ pendingNextSeasonState: { drivers, teams }, realWorldChangesResolved: true })
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

      // God-mode edit of a single team (e.g. from the world team page): name, colour,
      // nationality, etc. Recompute standings so renames show through immediately.
      updateTeam: (id, patch) => {
        const { drivers, teams, raceResults, carPaceHistory, currentRound } = get()
        const next = teams.map((t) => (t.id === id ? { ...t, ...patch } : t))
        // A god-mode pace edit takes effect going forward: record it against the in-progress round
        // (upsert), leaving already-raced rounds untouched, so the Car Development chart shows the new
        // level from now without rewriting what the car actually had in past races.
        const history = patch.carPace !== undefined && carPaceHistory.length > 0
          ? [...carPaceHistory.filter((h) => h.round !== currentRound), { round: currentRound, paces: snapshotCarPaces(next) }]
          : carPaceHistory
        set({
          teams: next,
          carPaceHistory: history,
          driverStandings: computeDriverStandings(drivers, next, raceResults),
          constructorStandings: computeConstructorStandings(next, drivers, raceResults),
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
        const { drivers, teams, raceResults, currentRound, devPlans, allUpgradeEvents, statHistory, carPaceHistory, year } = get()
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
          // The clock catches up to race day for the round just run (keeps live + headless sim truthful).
          currentDate: roundDate(year, currentRound),
          teams: updatedTeams,
          drivers: updatedDrivers,
          devPlans: updatedDevPlans,
          allUpgradeEvents: [...allUpgradeEvents, ...upgradeEvents],
          // Capture the post-race attributes for this round's progression chart.
          statHistory: appendStatHistory(statHistory, updatedDrivers, currentRound),
          // Capture each car's post-upgrade pace for the Car Development chart.
          carPaceHistory: [...carPaceHistory.filter((h) => h.round !== currentRound), { round: currentRound, paces: snapshotCarPaces(updatedTeams) }],
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
        let teamMediaScores = computeTeamMediaScores(teams, constructorHistory, constructorRankInfo)

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
          // A brand-new team has no results — it's the LEAST attractive seat on the grid,
          // not the mid-pack default. Otherwise the market poaches top drivers into it.
          teamMediaScores = [...teamMediaScores, ...added.map((t) => ({ teamId: t.id, score: 0 }))]
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
          // God-mode grid changes applied above, recorded for the newsroom (arrival + farewell).
          gridAdditions: additions.map((t) => ({ teamId: t.id, teamName: t.name })),
          gridRemovals: removals.map((id) => ({
            teamId: id,
            teamName: teams.find((t) => t.id === id)?.name ?? id,
            finalPosition: constructorRankInfo.find((c) => c.teamId === id)?.finalPosition ?? null,
          })),
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
          realWorldChangesResolved: false, // new season's changes need acting on before the off-season advances
        })
      },

      // Phase 2: free agents sign for the coming season.
      runContractNegotiations: () => {
        const { pendingNextSeasonState, endOfSeasonSummary, year, realWorldMode } = get()
        if (!pendingNextSeasonState || !endOfSeasonSummary) return
        const { teams } = pendingNextSeasonState
        const newYear = year + 1

        // Real-world mode (while the dataset still has entrants): seed next year's real rookies into
        // the free-agent pool so the emergent market signs real drivers, never fictional fill-ins,
        // before 2026. The market still decides who-signs-where; we only make the pool real.
        let drivers = pendingNextSeasonState.drivers
        if (realWorldMode && newYear <= lastDriverEntryYear()) {
          const have = new Set(drivers.map((d) => d.id))
          drivers = [...drivers, ...rookiesForYear(newYear).filter((d) => !have.has(d.id))]
        }

        const { updatedDrivers, marketMoves, seatContests, droppedDrivers } = runDriverMarket(
          drivers,
          teams,
          endOfSeasonSummary.driverMediaScores,
          endOfSeasonSummary.teamMediaScores,
          endOfSeasonSummary.retentionDelta ?? {},
          newYear,
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
            currentDate: seasonStartDate(newYear),
            raceResults: [],
            dbSeasonId: null,
            devPlans,
            allUpgradeEvents: [],
            endOfSeasonSummary: null,
            seasonStartStats: snapshotStats(drivers),
            statHistory: seedStatHistory(drivers),
            carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
            driverStandings: computeDriverStandings(drivers, teams, []),
            constructorStandings: computeConstructorStandings(teams, drivers, []),
          })
          return
        }

        const { drivers: pendingDrivers, teams } = pendingNextSeasonState
        // Top up the free-agent pool. Real-world mode brings in that year's real rookies (until the
        // dataset is exhausted past the last entry year); otherwise generate fictional drivers.
        const existingIds = new Set(pendingDrivers.map((d) => d.id))
        let topUp: Driver[]
        if (get().realWorldMode && newYear <= lastDriverEntryYear()) {
          topUp = rookiesForYear(newYear).filter((d) => !existingIds.has(d.id))
        } else {
          const poolSize = pendingDrivers.filter((d) => d.teamId === '').length
          topUp = poolSize < 15 ? generateFreeAgentPool(15 - poolSize, newYear, pendingDrivers, Math.random) : []
        }
        const drivers = [...pendingDrivers, ...topUp]
        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const devPlans = initDevPlans(teams, fundingTiers, Math.random)

        set({
          phase: 'idle',
          year: newYear,
          drivers,
          teams,
          currentRound: 1,
          currentDate: seasonStartDate(newYear),
          raceResults: [],
          dbSeasonId: null,
          devPlans,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          pendingNextSeasonState: null,
          seasonStartStats: snapshotStats(drivers),
          statHistory: seedStatHistory(drivers),
          carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      resetToIdle: () => {
        const { drivers, teams, year } = get()
        set({
          phase: 'idle',
          currentRound: 1,
          currentDate: seasonStartDate(year),
          raceResults: [],
          dbSeasonId: null,
          allUpgradeEvents: [],
          realWorldChangesResolved: false,
          endOfSeasonSummary: null,
          pendingNextSeasonState: null,
          // Season-scoped per-round history is cleared too, matching raceResults/allUpgradeEvents.
          statHistory: {},
          carPaceHistory: [],
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
        currentDate: state.currentDate,
        realWorldMode: state.realWorldMode,
        realWorldChangesResolved: state.realWorldChangesResolved,
        raceResults: state.raceResults,
        dbSeasonId: state.dbSeasonId,
        devPlans: state.devPlans,
        constructorHistory: state.constructorHistory,
        allUpgradeEvents: state.allUpgradeEvents,
        endOfSeasonSummary: state.endOfSeasonSummary,
        pendingNextSeasonState: state.pendingNextSeasonState,
        pendingGridChanges: state.pendingGridChanges,
        seasonStartStats: state.seasonStartStats,
        statHistory: state.statHistory,
        carPaceHistory: state.carPaceHistory,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const { drivers, teams, raceResults } = state
        state.driverStandings = computeDriverStandings(drivers, teams, raceResults)
        state.constructorStandings = computeConstructorStandings(teams, drivers, raceResults)
        // Saves from before car-pace snapshots: backfill an in-progress season's history from the
        // upgrade log so the Car Development chart isn't empty. Idle saves get theirs from initSeason.
        if ((!state.carPaceHistory || state.carPaceHistory.length === 0) && teams.length > 0 && state.phase !== 'idle') {
          state.carPaceHistory = reconstructCarPaceHistory(teams, state.allUpgradeEvents ?? [], raceResults.length)
        }
        // Saves from before the date system: backfill the game clock from the current round
        // (the upcoming race's date), or the season start if no valid round.
        if (!state.currentDate) {
          const r = state.currentRound
          state.currentDate = r >= 1 && r <= TOTAL_ROUNDS ? roundDate(state.year, r) : seasonStartDate(state.year)
        }
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
