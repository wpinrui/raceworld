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
  MarketMove,
  DroppedDriver,
  PreSeasonTest,
} from '@/lib/sim/types'
import { composeDefaultSeason, DEFAULT_START_YEAR } from '@/lib/history/compose'
import { calendarForYear, DEFAULT_CALENDAR_YEAR } from '@/data/calendars'
import { raceDate, toISODate } from '@/lib/sim/calendar-dates'
import { computeFundingTiers, initDevPlans, applyUpgradeEvents, computeCarReshuffle, rollUpgrade, applyPlayerCycle } from '@/lib/sim/development'
import { applyRaceProgression, ageDrivers, rollSeasonForm, shownStats } from '@/lib/sim/progression'
import { applyConfidenceUpdate } from '@/lib/sim/race-results'
import { computeDriverMediaScores, computeTeamMediaScores, applyMarketAttrition, generateFreeAgentPool, generateRookie, computeRetentionDeltas } from '@/lib/sim/market'
import { runDraft, negotiateRenewals, assessExpiringContracts, marketWatchRound, marketRenewalRound, renewalChance, type DraftPick, type DraftSeat, type RenewalResult, type ContractWatch } from '@/lib/sim/driver-market'

// Team Manager: an expiring driver of the player's, awaiting the player's renewal decision (offer or let
// expire). `diff` = driver media percentile − team WCC percentile: >0 = outdriving the seat (a decline risk).
export interface PendingPlayerRenewal { driverId: string; driverName: string; diff: number }
import { runPreSeasonTest } from '@/lib/sim/pre-season-test'
import { sortDriverStandings, sortConstructorStandings } from '@/lib/sim/standings-calc'
import { rookiesForYear, lastDriverEntryYear } from '@/lib/history/compose'

// Team Manager free-agency pause: everything needed to finish the off-season draft once the player has
// filled their seat(s). Rivals ABOVE the player's seat rank are already signed (picksAbove); the player
// picks from `pool`; on confirm the rivals BELOW (belowSeats) are auto-drafted from what's left.
export interface PendingPlayerDraft {
  year: number
  newYear: number
  allDrivers: Driver[]
  stayingIds: string[]
  aboveSeats: DraftSeat[]
  picksAbove: DraftPick[]
  playerSeats: DraftSeat[]
  belowSeats: DraftSeat[]
  pool: Driver[]
  faRankOf: Record<string, number> // driverId -> free-agent rank (1 = best) in the full pool, for the board label
  playerPicks: { teamId: string; driverId: string; driverName: string; years: number }[]
  rejected: string[] // declined for the seat currently being filled
}

// Default new-game grid: the latest season composed from the historical timeline (no bespoke grid).
const DEFAULT_GRID = composeDefaultSeason()
// Round count is per-season (era-accurate calendars, #64): derived from the active season's year
// where needed, never a single global. See calendarForYear(). The in-season driver-market beats
// (contract watch, then renewals) are likewise placed proportionally per season via
// marketWatchRound / marketRenewalRound.

// Pre-season testing always runs at Barcelona/Catalunya.
const TEST_CIRCUIT = calendarForYear(DEFAULT_CALENDAR_YEAR).find((c) => c.id === 'spain') ?? calendarForYear(DEFAULT_CALENDAR_YEAR)[0]

// The game clock starts on 1 January of the season year — a pre-season window (launches,
// testing) ahead of the opening round. Stored as a serialisable 'YYYY-MM-DD' string.
const seasonStartDate = (year: number) => `${year}-01-01`
// Race day (ISO date string) for a 1-based round in a given season year.
const roundDate = (year: number, round: number): string => {
  const c = calendarForYear(year)[round - 1]
  return c ? toISODate(raceDate(year, c)) : seasonStartDate(year)
}

type StatSnapshot = Record<string, { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }>

// One sampled point on a driver's in-progress-season attribute timeline. round 0 = season
// start; rounds 1..N = post-race. Past seasons live in the DB; this carries only the
// current (unarchived) season, which the DB career query excludes.
export type StatPoint = { round: number; pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }
type StatHistory = Record<string, StatPoint[]>

// Snapshot the four SHOWN stats (true + season form, #66) of every grid driver, keyed by id — the
// ratings timeline is what the player saw, so it carries the form wobble.
function snapshotStats(drivers: Driver[]): StatSnapshot {
  const snap: StatSnapshot = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    const s = shownStats(d)
    snap[d.id] = {
      pace: s.pace,
      wetWeatherPace: s.wetWeatherPace,
      overtaking: s.overtaking,
      smoothness: s.smoothness,
    }
  }
  return snap
}

// Seed the per-race stat history with a round-0 baseline (shown stats) for every grid driver.
function seedStatHistory(drivers: Driver[]): StatHistory {
  const hist: StatHistory = {}
  for (const d of drivers) {
    if (d.teamId === '') continue
    const s = shownStats(d)
    hist[d.id] = [{ round: 0, pace: s.pace, wetWeatherPace: s.wetWeatherPace, overtaking: s.overtaking, smoothness: s.smoothness }]
  }
  return hist
}

// Append a post-race point (shown stats) for each grid driver at the given round.
function appendStatHistory(prev: StatHistory, drivers: Driver[], round: number): StatHistory {
  const next: StatHistory = { ...prev }
  for (const d of drivers) {
    if (d.teamId === '') continue
    const s = shownStats(d)
    const point: StatPoint = { round, pace: s.pace, wetWeatherPace: s.wetWeatherPace, overtaking: s.overtaking, smoothness: s.smoothness }
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
        points: 0, wins: 0, results: Array(raceResults.length).fill(null),
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
      results: order.map(() => Array(raceResults.length).fill(null)),
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

// Turn an ordered set of draft picks (one per seat, in seat order) into next-season state: market moves,
// the updated grid (winners seated, the unpicked freed), rookies for any seat the pool couldn't fill, and
// the dropped (had a seat, signed nowhere) list. Shared by the auto-draft and the Team Manager player draft.
function resolveDraft(
  picks: DraftPick[], allDrivers: Driver[], stayingIds: Set<string>, seats: DraftSeat[],
  mediaMap: Map<string, number>, teams: Team[], year: number, newYear: number,
): { marketMoves: MarketMove[]; updatedDrivers: Driver[]; droppedDrivers: DroppedDriver[] } {
  const pickById = new Map(picks.map((p) => [p.driverId, p]))
  const prevTeam = new Map(allDrivers.map((d) => [d.id, d.teamId]))
  const teamNameOf = new Map(teams.map((t) => [t.id, t.name]))
  const marketMoves: MarketMove[] = picks.map((p) => ({
    driverId: p.driverId, driverName: p.driverName,
    fromTeamId: prevTeam.get(p.driverId) || null,
    toTeamId: p.teamId, toTeamName: p.teamName,
    contractLength: p.years, contractExpiresAfterSeason: year + p.years,
    mediaScore: mediaMap.get(p.driverId) ?? 0,
    isResignation: prevTeam.get(p.driverId) === p.teamId,
  }))
  const updatedDrivers: Driver[] = allDrivers.map((d) => {
    const p = pickById.get(d.id)
    if (p) return { ...d, teamId: p.teamId, contractExpiresAfterSeason: year + p.years, seasonsSinceF1Seat: 0 }
    if (stayingIds.has(d.id)) return d
    return { ...d, teamId: '' }
  })
  for (let i = picks.length; i < seats.length; i++) {
    const seat = seats[i]
    const rookie = generateRookie(seat.teamId, newYear, Math.random)
    updatedDrivers.push(rookie)
    marketMoves.push({ driverId: rookie.id, driverName: rookie.name, fromTeamId: null, toTeamId: seat.teamId, toTeamName: seat.teamName, contractLength: 1, contractExpiresAfterSeason: newYear, mediaScore: 0, isResignation: false })
  }
  const droppedDrivers: DroppedDriver[] = allDrivers
    .filter((d) => !pickById.has(d.id) && !stayingIds.has(d.id) && (prevTeam.get(d.id) || '') !== '')
    .map((d) => ({ driverId: d.id, driverName: d.name, fromTeamId: prevTeam.get(d.id)!, fromTeamName: teamNameOf.get(prevTeam.get(d.id)!) ?? prevTeam.get(d.id)!, mediaScore: mediaMap.get(d.id) ?? 0 }))
  return { marketMoves, updatedDrivers, droppedDrivers }
}

interface SeasonStore {
  phase: SeasonPhase
  year: number
  saveSeed: string                 // per-save random id; seeds race weather/tyres so different saves differ
  drivers: Driver[]
  teams: Team[]
  currentRound: number  // 1-indexed
  currentDate: string   // game clock, ISO 'YYYY-MM-DD' (the FM-style "Continue" advances this)
  // When true, the season was started from the historical timeline: the market draws real free
  // agents (until the dataset runs out) and season-ends apply real team changes (with consent).
  realWorldMode: boolean
  // Team Manager mode: the player runs ONE team (playerTeamId) instead of the god-mode sandbox. God-mode
  // powers are off unless re-enabled as Settings "talents", ratings are hidden, and contracts are the
  // player's to make. null playerTeamId / false mode = the classic sandbox (everything below is gated on it).
  teamManagerMode: boolean
  playerTeamId: string | null
  playerDevCycle: number | null  // Team Manager: the player's chosen upgrade cycle (3-6 races); null = unset
  // Start-of-season gate: true once the player has acted on the team changes taking effect NEXT season
  // (Apply, with whatever overrides). Surfaced when a season begins; reset each time a season starts.
  realWorldChangesResolved: boolean
  // The approved next-season transition (decided at THIS season's start): the news announces it mid-season
  // and runEndOfSeason applies it to next year's grid at the rollover. null = none decided / fictional mode.
  approvedSeasonChanges: {
    joins: { id: string; name: string; shortName: string; nationality: string; color: string }[]
    leaves: string[]
    rebrands: { id: string; name: string; shortName: string; color: string; nationality: string }[]
  } | null
  raceResults: RaceResult[][]  // [round-1]
  dbSeasonId: number | null

  // M3 state
  devPlans: TeamDevPlan[]
  constructorHistory: ConstructorSeasonRecord[]
  allUpgradeEvents: DevUpgradeEvent[]
  endOfSeasonSummary: EndOfSeasonSummary | null
  preSeasonTest: PreSeasonTest | null   // new season's test result, shown at the dated pre-season testing stop (#126)
  pendingNextSeasonState: { drivers: Driver[]; teams: Team[] } | null
  // M4 god-mode: team add/remove queued for next season (applied at season end).
  pendingGridChanges: PendingGridChanges
  // Snapshot of each grid driver's stats at season start, for the net-development summary.
  seasonStartStats: Record<string, { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }>
  // Per-race attribute snapshots for the CURRENT (unarchived) season's progression chart.
  statHistory: StatHistory
  // Per-round car-pace snapshots for the current season's Car Development chart.
  carPaceHistory: CarPaceSnapshot[]
  // Last completed season's end-of-year driver media scores (driverId -> score), carried into the new
  // season as the basis for news expectation (#88). Empty in a save's first season.
  priorSeasonDriverMediaScores: Record<string, number>
  // The end-of-season draft picks (ordered, best seat first), for the Signing Day reveal.
  seasonDraft: DraftPick[]
  // Team Manager free agency: when the off-season draft reaches the player's seat(s), it pauses here so the
  // player picks (rivals above already signed; rivals below sign on confirm). null outside that window.
  pendingPlayerDraft: PendingPlayerDraft | null
  // Team Manager: the player's own expiring drivers at the renewal round, awaiting an offer/let-expire call.
  pendingPlayerRenewals: PendingPlayerRenewal[]
  // Round-18 contract renewals this season, for the renewals round-up feature.
  seasonRenewals: RenewalResult[]
  // Round-15 verdicts on the expiring contracts, for the contract-watch feature.
  seasonContractWatch: ContractWatch[]
  // How many Signing Day signings the player has revealed, persisted so revisiting shows the same state.
  signingDayRevealed: number
  // Ids of news articles the player has opened (read), so the feed can dim them. Persisted across the
  // playthrough; cleared on a fresh game.
  readNewsIds: string[]

  // Computed
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]

  // Actions
  initSeason: (drivers: Driver[], teams: Team[], year: number) => void
  updateGrid: (drivers: Driver[], teams: Team[]) => void
  setCurrentDate: (date: string) => void
  setRealWorldMode: (on: boolean) => void
  setTeamManager: (mode: boolean, playerTeamId: string | null) => void
  setPlayerDevCycle: (cycle: number) => void
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
  decidePlayerRenewal: (driverId: string, offer: boolean, years?: number) => void  // Team Manager: offer your expiring driver a renewal of `years` (1-4), or let them go
  playerDraftSign: (driverId: string, years: number) => void   // Team Manager: offer a free agent a contract of `years` for your open seat (50% accept)
  finishPlayerDraft: () => void                  // Team Manager: resolve rival seats below yours and close the draft
  runDriverRetirements: () => void
  runPreSeasonTesting: () => void
  // Date-driven off-season (#126): the New-Year roster swap (kept clock), and the pre-season test on its own date.
  rolloverSeason: () => void
  runPreSeasonTestOnly: () => void
  setDbSeasonId: (id: number) => void
  setSigningDayRevealed: (n: number) => void
  markNewsRead: (id: string) => void
  startNewSeason: () => void
  resetToIdle: () => void
  loadConstructorHistory: (history: ConstructorSeasonRecord[]) => void
}

export const useSeasonStore = create<SeasonStore>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      year: DEFAULT_START_YEAR,
      saveSeed: '',
      drivers: DEFAULT_GRID.drivers.map((d) => ({ ...d })),
      teams: DEFAULT_GRID.teams.map((t) => ({ ...t })),
      currentRound: 1,
      currentDate: seasonStartDate(DEFAULT_START_YEAR),
      realWorldMode: false,
      teamManagerMode: false,
      playerTeamId: null,
      playerDevCycle: null,
      pendingPlayerDraft: null,
      pendingPlayerRenewals: [],
      realWorldChangesResolved: false,
      approvedSeasonChanges: null,
      raceResults: [],
      dbSeasonId: null,
      devPlans: [],
      constructorHistory: [],
      allUpgradeEvents: [],
      endOfSeasonSummary: null,
      preSeasonTest: null,
      pendingNextSeasonState: null,
      pendingGridChanges: { additions: [], removals: [] },
      seasonStartStats: {},
      statHistory: {},
      carPaceHistory: [],
      priorSeasonDriverMediaScores: {},
      seasonDraft: [],
      seasonRenewals: [],
      seasonContractWatch: [],
      signingDayRevealed: 0,
      readNewsIds: [],
      driverStandings: [],
      constructorStandings: [],

      initSeason: (drivers, teams, year) => {
        const { constructorHistory } = get()
        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const devPlans = applyPlayerCycle(initDevPlans(teams, fundingTiers, Math.random), teams, get().teamManagerMode ? get().playerTeamId : null, get().playerDevCycle, get().currentRound, Math.random)
        // Real-world mode: the pool is the real free agents in the composed grid (no fictional drivers).
        // Otherwise keep existing free agents from the store, or generate a pool if none present.
        const poolDrivers = get().realWorldMode
          ? drivers.filter((d) => d.teamId === '')
          : (() => {
              const existingPool = get().drivers.filter((d) => d.teamId === '')
              return existingPool.length > 0 ? existingPool : generateFreeAgentPool(25, year, drivers, Math.random)
            })()
        // Roll season form (#66) for SEATED drivers only, here at season start; held all year. Free
        // agents haven't raced, so they carry no wobble (form 0) until they take a seat at a rollover.
        const allDrivers = [
          ...drivers.filter((d) => d.teamId !== ''),
          ...poolDrivers,
        ].map((d) => ({ ...d, seasonForm: d.teamId !== '' ? rollSeasonForm(Math.random) : 0 }))
        set({
          phase: 'pre-race',
          year,
          saveSeed: Math.random().toString(36).slice(2, 10),
          drivers: allDrivers,
          teams,
          currentRound: 1,
          currentDate: seasonStartDate(year),
          raceResults: [],
          dbSeasonId: null,
          devPlans,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          preSeasonTest: null,
          pendingNextSeasonState: null,
          seasonStartStats: snapshotStats(allDrivers),
          statHistory: seedStatHistory(allDrivers),
          carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
          seasonDraft: [],
          seasonRenewals: [],
          seasonContractWatch: [],
          signingDayRevealed: 0,
          // Fresh season: re-arm the start-of-season real-world gate (decide next year's changes now).
          realWorldChangesResolved: false,
          approvedSeasonChanges: null,
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

      setTeamManager: (mode, playerTeamId) => set({ teamManagerMode: mode, playerTeamId: mode ? playerTeamId : null, playerDevCycle: null }),

      setPlayerDevCycle: (cycle) => {
        const { playerTeamId, devPlans, teams, currentRound } = get()
        set({ playerDevCycle: cycle, devPlans: applyPlayerCycle(devPlans, teams, playerTeamId, cycle, currentRound, Math.random) })
      },

      // Real-world season-end: apply the approved team changes to the next-season grid (built by
      // endSeason into pendingNextSeasonState), BEFORE contract negotiations fill the seats. Leaving
      // teams free their drivers into the market; joiners enter at the back; rebrands swap identity.
      // Idempotent: a change already reflected in the grid simply isn't offered again.
      // Decided at the START of the season for NEXT season: just record the approved subset and clear the
      // gate. The grid mutation happens at the rollover (runEndOfSeason), so the end-of-season market fills
      // seats against the confirmed roster, and the mid-season news announces these same changes.
      applyRealWorldChanges: (approved) => {
        set({ approvedSeasonChanges: approved, realWorldChangesResolved: true })
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
        let { updatedDrivers } = applyRaceProgression(drivers, Math.random)

        // Confidence (morale) updates after each race, off this round's results vs each
        // driver's teammate. Uses pre-race confidence (progression doesn't touch it).
        updatedDrivers = applyConfidenceUpdate(updatedDrivers, results)

        // Phase 1 of the driver market plays out in-season: a contract watch (~62.5% through the season),
        // then renewals (~75% through) — both scaled to the season length via marketWatchRound /
        // marketRenewalRound (#66), so 24 rounds = 15/18, 16 rounds = 10/12. Both compare each expiring
        // driver's grid-wide media standing against their team's
        // WCC standing — the closer the match, the better the fit (and, at renewal, the likelier + longer
        // the new deal). Whoever isn't re-signed becomes a free agent in the end-of-season draft.
        let seasonRenewals = get().seasonRenewals
        let seasonContractWatch = get().seasonContractWatch
        const watchRound = marketWatchRound(calendarForYear(year).length)
        const renewalRound = marketRenewalRound(calendarForYear(year).length)
        if (currentRound === watchRound || currentRound === renewalRound) {
          const standings = computeConstructorStandings(updatedTeams, updatedDrivers, updated)
          const rankInfo = standings.map((cs, idx) => ({ teamId: cs.teamId, points: cs.points, finalPosition: idx + 1 }))
          const mediaScores = computeDriverMediaScores(updatedDrivers, updatedTeams, updated, rankInfo, updatedTeams.length)
          const mediaMap = new Map(mediaScores.map((s) => [s.driverId, s.score]))
          const wccOrderBestFirst = standings.map((cs) => cs.teamId)
          if (currentRound === watchRound) {
            seasonContractWatch = assessExpiringContracts({ drivers: updatedDrivers, teams: updatedTeams, mediaScore: mediaMap, wccOrderBestFirst, currentYear: year })
          } else {
            const preById = new Map(updatedDrivers.map((d) => [d.id, d]))
            const result = negotiateRenewals({ drivers: updatedDrivers, teams: updatedTeams, mediaScore: mediaMap, wccOrderBestFirst, currentYear: year, rng: Math.random })
            updatedDrivers = result.drivers
            seasonRenewals = result.renewals
            // Team Manager: the player's own expiring drivers are the player's call — undo any auto-renewal
            // of theirs and queue them for an offer/let-expire decision (model b acceptance on offer).
            const { teamManagerMode, playerTeamId } = get()
            if (teamManagerMode && playerTeamId) {
              const seated = updatedDrivers.filter((d) => d.teamId !== '')
              const dOrder = [...seated].sort((a, b) => (mediaMap.get(b.id) ?? 0) - (mediaMap.get(a.id) ?? 0)).map((d) => d.id)
              const nD = dOrder.length, nT = wccOrderBestFirst.length
              const dPct = (id: string) => { const i = dOrder.indexOf(id); return nD > 1 ? ((nD - 1 - i) / (nD - 1)) * 100 : 50 }
              const tPct = nT > 1 ? ((nT - 1 - wccOrderBestFirst.indexOf(playerTeamId)) / (nT - 1)) * 100 : 50
              const mine = updatedDrivers.filter((d) => d.teamId === playerTeamId && (preById.get(d.id)?.contractExpiresAfterSeason ?? year + 1) <= year)
              if (mine.length) {
                const mineIds = new Set(mine.map((d) => d.id))
                updatedDrivers = updatedDrivers.map((d) => mineIds.has(d.id) ? preById.get(d.id)! : d) // restore expiring
                seasonRenewals = seasonRenewals.filter((r) => !mineIds.has(r.driverId))
                set({ pendingPlayerRenewals: mine.map((d) => ({ driverId: d.id, driverName: d.name, diff: Math.round(dPct(d.id) - tPct) })) })
              }
            }
          }
        }

        set({
          raceResults: updated,
          phase: 'post-race',
          // The clock catches up to race day for the round just run (keeps live + headless sim truthful).
          currentDate: roundDate(year, currentRound),
          teams: updatedTeams,
          drivers: updatedDrivers,
          devPlans: updatedDevPlans,
          allUpgradeEvents: [...allUpgradeEvents, ...upgradeEvents],
          seasonRenewals,
          seasonContractWatch,
          // Capture the post-race attributes for this round's progression chart.
          statHistory: appendStatHistory(statHistory, updatedDrivers, currentRound),
          // Capture each car's post-upgrade pace for the Car Development chart.
          carPaceHistory: [...carPaceHistory.filter((h) => h.round !== currentRound), { round: currentRound, paces: snapshotCarPaces(updatedTeams) }],
          driverStandings: computeDriverStandings(updatedDrivers, updatedTeams, updated),
          constructorStandings: computeConstructorStandings(updatedTeams, updatedDrivers, updated),
        })
      },

      advanceRound: () => {
        const { currentRound, endSeason, year } = get()
        if (currentRound >= calendarForYear(year).length) {
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
          approvedSeasonChanges,
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

        // Real-world transitions APPROVED at the start of this season (and already announced mid-season by
        // the newsroom) now take effect on next year's grid. Applying them here, before the end-of-season
        // market runs, means seats are filled against the confirmed roster.
        if (approvedSeasonChanges) {
          const leaveIds = new Set(approvedSeasonChanges.leaves)
          nextTeams = nextTeams.filter((t) => !leaveIds.has(t.id))
          nextDrivers = nextDrivers.map((d) =>
            leaveIds.has(d.teamId) ? { ...d, teamId: '', contractExpiresAfterSeason: year, seasonsSinceF1Seat: 0 } : d,
          )
          const rebrandById = new Map(approvedSeasonChanges.rebrands.map((r) => [r.id, r]))
          nextTeams = nextTeams.map((t) => {
            const r = rebrandById.get(t.id)
            return r ? { ...t, name: r.name, shortName: r.shortName, color: r.color, nationality: r.nationality } : t
          })
          const lowest = nextTeams.reduce((m, t) => Math.min(m, t.carPace), 75)
          approvedSeasonChanges.joins.forEach((j, i) => {
            if (nextTeams.some((t) => t.id === j.id)) return
            nextTeams = [...nextTeams, { id: j.id, name: j.name, shortName: j.shortName, nationality: j.nationality, color: j.color, carPace: Math.max(5, lowest - 5 * (i + 1)) }]
            teamMediaScores = [...teamMediaScores, { teamId: j.id, score: 0 }]
          })
        }

        // Team Manager: a brand-new player team enters as the strictly slowest car on the grid (exempt from
        // the historical pace assignment), and stays slowest even if real-world teams join the same year.
        // Only on its inaugural rollover (when it's actually among the additions); after that it develops.
        const { teamManagerMode: tmModeRollover, playerTeamId: tmTeamId } = get()
        if (tmModeRollover && tmTeamId && additions.some((t) => t.id === tmTeamId)) {
          const slowestOther = nextTeams.reduce((m, t) => (t.id === tmTeamId ? m : Math.min(m, t.carPace)), 75)
          nextTeams = nextTeams.map((t) => (t.id === tmTeamId ? { ...t, carPace: Math.max(1, slowestOther - 5) } : t))
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
          // God-mode (fictional) grid changes taking effect next season, for the generic off-season
          // newsroom. Real-world transitions are handled separately (approved at season start, announced
          // mid-season, applied to nextTeams above), so they do NOT go through the summary.
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
        })
      },

      // Phase 2: the end-of-season DRAFT fills every open seat (best car first) from the free-agent
      // pool weighted by media (round-18 renewals + multi-year deals keep their seats). Picks are stored
      // for the Signing Day reveal; the resulting moves are mapped onto the summary for the newsroom.
      runContractNegotiations: () => {
        const { pendingNextSeasonState, endOfSeasonSummary, year, realWorldMode } = get()
        if (!pendingNextSeasonState || !endOfSeasonSummary) return
        const { teams } = pendingNextSeasonState
        const newYear = year + 1

        // Real-world mode (while the dataset still has entrants): seed next year's real rookies into the
        // pool so the draft signs real drivers, never fictional fill-ins, before 2026.
        let allDrivers = pendingNextSeasonState.drivers
        if (realWorldMode && newYear <= lastDriverEntryYear()) {
          const have = new Set(allDrivers.map((d) => d.id))
          allDrivers = [...allDrivers, ...rookiesForYear(newYear).filter((d) => !have.has(d.id))]
        }

        // Under contract for next year (incl. round-18 renewals) -> keeps the seat.
        const stayingIds = new Set(allDrivers.filter((d) => d.teamId !== '' && d.contractExpiresAfterSeason > year).map((d) => d.id))
        const stayCount = new Map<string, number>()
        for (const d of allDrivers) if (stayingIds.has(d.id)) stayCount.set(d.teamId, (stayCount.get(d.teamId) ?? 0) + 1)

        // Open seats, most desirable (fastest car) first.
        const seats: DraftSeat[] = []
        for (const t of [...teams].sort((a, b) => b.carPace - a.carPace)) {
          for (let i = 0; i < Math.max(0, 2 - (stayCount.get(t.id) ?? 0)); i++) seats.push({ teamId: t.id, teamName: t.name, teamColor: t.color })
        }

        // Free-agent pool ranked by media; free agents with no media fall back to a pace proxy.
        const mediaMap = new Map(endOfSeasonSummary.driverMediaScores.map((s) => [s.driverId, s.score]))
        const valueOf = (d: Driver) => mediaMap.get(d.id) ?? Math.max(0, Math.min(100, 35 + (d.pace - 68) * 0.8))
        const pool = allDrivers.filter((d) => !stayingIds.has(d.id)).sort((a, b) => valueOf(b) - valueOf(a))

        // Team Manager: pause for the player to fill their own seat(s). Rivals ABOVE the player's seat rank
        // sign now; the player picks from what's left; rivals BELOW sign on confirm (finishPlayerDraft).
        const { teamManagerMode, playerTeamId } = get()
        if (teamManagerMode && playerTeamId && seats.some((s) => s.teamId === playerTeamId)) {
          const firstIdx = seats.findIndex((s) => s.teamId === playerTeamId)
          const aboveSeats = seats.slice(0, firstIdx)
          const playerSeats = seats.filter((s) => s.teamId === playerTeamId)
          const belowSeats = seats.filter((s, i) => i >= firstIdx && s.teamId !== playerTeamId)
          const picksAbove = runDraft({ seats: aboveSeats, pool, teams, currentYear: year, rng: Math.random })
          const takenAbove = new Set(picksAbove.map((p) => p.driverId))
          const faRankOf: Record<string, number> = {}
          pool.forEach((d, i) => { faRankOf[d.id] = i + 1 }) // rank in the full pool, fixed for the window
          set({
            phase: 'contract-negotiations',
            signingDayRevealed: 0, // start hidden so the player reveals the rivals above one at a time up to their turn
            pendingPlayerDraft: { year, newYear, allDrivers, stayingIds: [...stayingIds], aboveSeats, picksAbove, playerSeats, belowSeats, pool: pool.filter((d) => !takenAbove.has(d.id)), faRankOf, playerPicks: [], rejected: [] },
          })
          return
        }

        const picks = runDraft({ seats, pool, teams, currentYear: year, rng: Math.random })
        const { marketMoves, updatedDrivers, droppedDrivers } = resolveDraft(picks, allDrivers, stayingIds, seats, mediaMap, teams, year, newYear)

        set({
          phase: 'contract-negotiations',
          endOfSeasonSummary: { ...endOfSeasonSummary, marketMoves, seatContests: [], droppedDrivers },
          pendingNextSeasonState: { drivers: updatedDrivers, teams },
          seasonDraft: picks,
          signingDayRevealed: 0,
          pendingPlayerDraft: null,
        })
      },

      // Team Manager: offer your expiring driver a renewal (auto-accept unless they outclass the seat, then
      // a half-strength decline roll), or let them go (they enter the off-season free-agency draft).
      decidePlayerRenewal: (driverId, offer, years = 1) => {
        const { pendingPlayerRenewals, drivers, teams, year, seasonRenewals } = get()
        const pr = pendingPlayerRenewals.find((p) => p.driverId === driverId)
        if (!pr) return
        let nextDrivers = drivers
        let nextRenewals = seasonRenewals
        if (offer) {
          const accept = pr.diff <= 0 || Math.random() >= (1 - renewalChance(pr.diff)) * 0.5
          if (accept) {
            const term = Math.max(1, Math.min(4, Math.round(years)))
            nextDrivers = drivers.map((d) => (d.id === driverId ? { ...d, contractExpiresAfterSeason: year + term } : d))
            // Record it like an AI renewal so the news/history reports the re-signing (not a silent outcome).
            const driver = drivers.find((d) => d.id === driverId)
            const team = teams.find((t) => t.id === driver?.teamId)
            nextRenewals = [...seasonRenewals, { driverId, driverName: pr.driverName, teamId: driver?.teamId ?? '', teamName: team?.name ?? '', years: term, driverPct: 50 + pr.diff, teamPct: 50, diff: Math.abs(pr.diff) }]
          }
        }
        set({ drivers: nextDrivers, seasonRenewals: nextRenewals, pendingPlayerRenewals: pendingPlayerRenewals.filter((p) => p.driverId !== driverId) })
      },

      // Team Manager: try to sign a free agent to your next open seat (50% accept). A driver who declines is
      // locked out of THIS seat (retryable for the other); if every remaining agent has declined, the slate
      // clears (soft-lock guard). When your last seat fills, the draft auto-finishes.
      playerDraftSign: (driverId, years) => {
        const ppd = get().pendingPlayerDraft
        if (!ppd) return
        const seatIdx = ppd.playerPicks.length
        if (seatIdx >= ppd.playerSeats.length) return
        const driver = ppd.pool.find((d) => d.id === driverId)
        if (!driver || ppd.rejected.includes(driverId)) return
        if (Math.random() < 0.5) {
          const seat = ppd.playerSeats[seatIdx]
          const playerPicks = [...ppd.playerPicks, { teamId: seat.teamId, driverId: driver.id, driverName: driver.name, years: Math.max(1, Math.min(4, Math.round(years))) }]
          set({ pendingPlayerDraft: { ...ppd, playerPicks, pool: ppd.pool.filter((d) => d.id !== driver.id), rejected: [] } })
          if (playerPicks.length >= ppd.playerSeats.length) get().finishPlayerDraft()
        } else {
          const rejected = [...ppd.rejected, driverId]
          const stillOpen = ppd.pool.filter((d) => !rejected.includes(d.id))
          set({ pendingPlayerDraft: { ...ppd, rejected: stillOpen.length === 0 ? [] : rejected } })
        }
      },

      // Team Manager: resolve the seats below yours and close the draft (also the escape if you stop early).
      finishPlayerDraft: () => {
        const { pendingPlayerDraft: ppd, endOfSeasonSummary, pendingNextSeasonState } = get()
        if (!ppd || !endOfSeasonSummary || !pendingNextSeasonState) return
        const teams = pendingNextSeasonState.teams
        const mediaMap = new Map(endOfSeasonSummary.driverMediaScores.map((s) => [s.driverId, s.score]))
        const playerPicks: DraftPick[] = ppd.playerPicks.map((pp, i) => {
          const seat = ppd.playerSeats[i]
          return { teamId: seat.teamId, teamName: seat.teamName, teamColor: seat.teamColor, driverId: pp.driverId, driverName: pp.driverName, prevTeamName: '', faRank: ppd.faRankOf[pp.driverId] ?? 0, seatRank: 0, pickPct: 50, realizedProb: 0.5, years: pp.years, flavour: 'chalk', odds: [] }
        })
        const usedIds = new Set(ppd.playerPicks.map((p) => p.driverId))
        const picksBelow = runDraft({ seats: ppd.belowSeats, pool: ppd.pool.filter((d) => !usedIds.has(d.id)), teams, currentYear: ppd.year, rng: Math.random })
        const allSeats = [...ppd.aboveSeats, ...ppd.playerSeats, ...ppd.belowSeats]
        const allPicks = [...ppd.picksAbove, ...playerPicks, ...picksBelow]
        const { marketMoves, updatedDrivers, droppedDrivers } = resolveDraft(allPicks, ppd.allDrivers, new Set(ppd.stayingIds), allSeats, mediaMap, teams, ppd.year, ppd.newYear)
        set({
          endOfSeasonSummary: { ...endOfSeasonSummary, marketMoves, seatContests: [], droppedDrivers },
          pendingNextSeasonState: { drivers: updatedDrivers, teams },
          seasonDraft: allPicks,
          signingDayRevealed: allPicks.length, // already lived the draft — show it complete, don't replay it
          pendingPlayerDraft: null,
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
        const { pendingNextSeasonState, endOfSeasonSummary, constructorHistory } = get()
        if (!pendingNextSeasonState || !endOfSeasonSummary) return
        const { drivers, teams } = pendingNextSeasonState

        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const { updatedTeams: reshuffledTeams, oldPaces, newPaces } =
          computeCarReshuffle(teams, fundingTiers, Math.random)
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
      setSigningDayRevealed: (n) => set({ signingDayRevealed: n }),
      markNewsRead: (id) => set((s) => (s.readNewsIds.includes(id) ? s : { readNewsIds: [...s.readNewsIds, id] })),

      startNewSeason: () => {
        const { pendingNextSeasonState, year, constructorHistory } = get()
        const newYear = year + 1
        // Carry the just-completed season's driver media scores into the new season as the basis for
        // news expectation (#88). Captured here (not at finalization) so during season N the field holds
        // N-1's scores — exactly what the new season's preview/expectation articles need.
        const priorSeasonDriverMediaScores = Object.fromEntries(
          (get().endOfSeasonSummary?.driverMediaScores ?? []).map((s) => [s.driverId, s.score]),
        )

        if (!pendingNextSeasonState) {
          // Fallback: should not normally occur
          const { teams } = get()
          const drivers = get().drivers.map((d) => ({ ...d, seasonForm: d.teamId !== '' ? rollSeasonForm(Math.random) : 0 }))
          const fundingTiers = computeFundingTiers(teams, constructorHistory)
          const devPlans = applyPlayerCycle(initDevPlans(teams, fundingTiers, Math.random), teams, get().teamManagerMode ? get().playerTeamId : null, get().playerDevCycle, get().currentRound, Math.random)
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
            priorSeasonDriverMediaScores,
            seasonStartStats: snapshotStats(drivers),
            statHistory: seedStatHistory(drivers),
            carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
          seasonDraft: [],
          seasonRenewals: [],
          seasonContractWatch: [],
          signingDayRevealed: 0,
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
        // Roll season form (#66) for the new season — seated drivers only (free agents carry no wobble).
        const drivers = [...pendingDrivers, ...topUp].map((d) => ({ ...d, seasonForm: d.teamId !== '' ? rollSeasonForm(Math.random) : 0 }))
        const fundingTiers = computeFundingTiers(teams, constructorHistory)
        const devPlans = applyPlayerCycle(initDevPlans(teams, fundingTiers, Math.random), teams, get().teamManagerMode ? get().playerTeamId : null, get().playerDevCycle, get().currentRound, Math.random)

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
          preSeasonTest: null,
          pendingNextSeasonState: null,
          priorSeasonDriverMediaScores,
          seasonStartStats: snapshotStats(drivers),
          statHistory: seedStatHistory(drivers),
          carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
          seasonDraft: [],
          seasonRenewals: [],
          seasonContractWatch: [],
          signingDayRevealed: 0,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      // New-Year roster swap for the dated off-season (#126): make next season's grid live, reshuffle car
      // pace (the cars are now "built", so launches show them and testing later reveals the pace), and
      // increment the year — but KEEP the clock running (no Jan-1 reset), so the off-season flows
      // continuously into the new season's pre-season run-up. Mirrors startNewSeason otherwise.
      rolloverSeason: () => {
        const { pendingNextSeasonState, year, constructorHistory, realWorldMode } = get()
        if (!pendingNextSeasonState) return
        const newYear = year + 1
        const priorSeasonDriverMediaScores = Object.fromEntries(
          (get().endOfSeasonSummary?.driverMediaScores ?? []).map((s) => [s.driverId, s.score]),
        )
        const fundingTiers = computeFundingTiers(pendingNextSeasonState.teams, constructorHistory)
        const { updatedTeams: teams } = computeCarReshuffle(pendingNextSeasonState.teams, fundingTiers, Math.random)
        const pendingDrivers = pendingNextSeasonState.drivers
        const existingIds = new Set(pendingDrivers.map((d) => d.id))
        let topUp: Driver[]
        if (realWorldMode && newYear <= lastDriverEntryYear()) {
          topUp = rookiesForYear(newYear).filter((d) => !existingIds.has(d.id))
        } else {
          const poolSize = pendingDrivers.filter((d) => d.teamId === '').length
          topUp = poolSize < 15 ? generateFreeAgentPool(15 - poolSize, newYear, pendingDrivers, Math.random) : []
        }
        const drivers = [...pendingDrivers, ...topUp].map((d) => ({ ...d, seasonForm: d.teamId !== '' ? rollSeasonForm(Math.random) : 0 }))
        const devPlans = applyPlayerCycle(initDevPlans(teams, fundingTiers, Math.random), teams, get().teamManagerMode ? get().playerTeamId : null, get().playerDevCycle, get().currentRound, Math.random)
        set({
          phase: 'pre-race',
          year: newYear,
          drivers,
          teams,
          currentRound: 1,
          // currentDate is intentionally KEPT — the clock flowed here from the finale (no Jan-1 reset).
          raceResults: [],
          dbSeasonId: null,
          devPlans,
          allUpgradeEvents: [],
          endOfSeasonSummary: null,
          preSeasonTest: null,
          pendingNextSeasonState: null,
          priorSeasonDriverMediaScores,
          seasonStartStats: snapshotStats(drivers),
          statHistory: seedStatHistory(drivers),
          carPaceHistory: [{ round: 0, paces: snapshotCarPaces(teams) }],
          seasonDraft: [],
          seasonRenewals: [],
          seasonContractWatch: [],
          signingDayRevealed: 0,
          realWorldChangesResolved: false,
          approvedSeasonChanges: null,
          driverStandings: computeDriverStandings(drivers, teams, []),
          constructorStandings: computeConstructorStandings(teams, drivers, []),
        })
      },

      // The pre-season test on its own dated stop (opener-10): run on the now-live, reshuffled grid and
      // reveal the pecking order obliquely. Stored for the testing stop's board + its recap news.
      runPreSeasonTestOnly: () => {
        const { drivers, teams } = get()
        set({ preSeasonTest: runPreSeasonTest(drivers, teams, TEST_CIRCUIT, Math.random) })
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
          approvedSeasonChanges: null, // reset with `resolved` — the pair is always cleared together
          endOfSeasonSummary: null,
          preSeasonTest: null,
          pendingNextSeasonState: null,
          // Season-scoped per-round history is cleared too, matching raceResults/allUpgradeEvents.
          statHistory: {},
          carPaceHistory: [],
          seasonDraft: [],
          seasonRenewals: [],
          seasonContractWatch: [],
          signingDayRevealed: 0,
          readNewsIds: [],
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
        saveSeed: state.saveSeed,
        drivers: state.drivers,
        teams: state.teams,
        currentRound: state.currentRound,
        currentDate: state.currentDate,
        realWorldMode: state.realWorldMode,
        teamManagerMode: state.teamManagerMode,
        playerTeamId: state.playerTeamId,
        playerDevCycle: state.playerDevCycle,
        realWorldChangesResolved: state.realWorldChangesResolved,
        // MUST persist alongside `resolved`: it holds WHAT was approved at the season opener and is
        // applied at the season-end rollover. Persisting `resolved` without this dropped the approved
        // change on any reload, so the rollover skipped it and the rebrand re-fired (mis-keyed) a year
        // late with generic copy instead of the authored real-world prose (issue: Ligier->Prost).
        approvedSeasonChanges: state.approvedSeasonChanges,
        raceResults: state.raceResults,
        dbSeasonId: state.dbSeasonId,
        devPlans: state.devPlans,
        constructorHistory: state.constructorHistory,
        allUpgradeEvents: state.allUpgradeEvents,
        endOfSeasonSummary: state.endOfSeasonSummary,
        preSeasonTest: state.preSeasonTest,
        pendingNextSeasonState: state.pendingNextSeasonState,
        pendingGridChanges: state.pendingGridChanges,
        seasonStartStats: state.seasonStartStats,
        statHistory: state.statHistory,
        carPaceHistory: state.carPaceHistory,
        priorSeasonDriverMediaScores: state.priorSeasonDriverMediaScores,
        seasonDraft: state.seasonDraft,
        pendingPlayerDraft: state.pendingPlayerDraft,
        pendingPlayerRenewals: state.pendingPlayerRenewals,
        seasonRenewals: state.seasonRenewals,
        seasonContractWatch: state.seasonContractWatch,
        signingDayRevealed: state.signingDayRevealed,
        readNewsIds: state.readNewsIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Saves from before per-save seeding: give them a stable seed now, so their weather/tyres
        // become reproducible (and distinct from other saves) from here on.
        if (!state.saveSeed) state.saveSeed = Math.random().toString(36).slice(2, 10)
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
          state.currentDate = r >= 1 && r <= calendarForYear(state.year).length ? roundDate(state.year, r) : seasonStartDate(state.year)
        }
        // Saves from before M4: default the grid-change queue and backfill each dev
        // plan's pre-rolled pending upgrade so the override UI always has a value.
        if (!state.pendingGridChanges) state.pendingGridChanges = { additions: [], removals: [] }
        if (state.devPlans) {
          const teamsForDeficit = state.teams ?? []
          const leaderPace = teamsForDeficit.length ? Math.max(...teamsForDeficit.map((t) => t.carPace)) : 75
          state.devPlans = state.devPlans.map((p) => {
            if (p.pendingPaceDelta !== undefined && p.pendingFailed !== undefined) return p
            const carPace = teamsForDeficit.find((t) => t.id === p.teamId)?.carPace ?? leaderPace
            const rolled = rollUpgrade(p.cycleLength, leaderPace - carPace, Math.random)
            return { ...p, pendingPaceDelta: rolled.paceDelta, pendingFailed: rolled.failed }
          })
        }
      },
    },
  ),
)
