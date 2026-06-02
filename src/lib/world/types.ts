// Client-safe DTOs for the World pages. These must NOT import from db/queries.ts
// (which pulls in better-sqlite3) so they can be used in client components.

import type { TyreCompound, Gender } from '@/lib/sim/types'

export interface CareerSeason {
  year: number
  teamId: string
  teamName: string
  races: number
  wins: number
  podiums: number
  poles: number
  points: number
  championshipFinish: number | null
  results: (number | null)[] // per-round finish (null = DNF); length = rounds contested
  inProgress: boolean
}

export interface DriverAttributes {
  pace: number
  wetWeatherPace: number
  overtaking: number
  smoothness: number
  overall: number
  age: number
  primeEnd: number // age at which the driver's decline begins ("peak age")
  peakPotential: number
  nationality: string
  gender: Gender
  teamId: string
  teamName: string
  contractExpiresAfterSeason: number
  isFreeAgent: boolean
}

export interface DriverCurrentResult {
  round: number
  circuitName: string
  gridPosition: number
  finishPosition: number | null
  points: number
  form: number        // pre-race form (0-10)
  dnf: boolean
}

// One sampled point on a driver's attribute-development timeline. round 0 = season-start
// baseline; rounds 1..N = post-race snapshots. Ordered by (year, round) across the career.
export interface RatingsPoint {
  year: number
  round: number
  overall: number
  pace: number
  wetWeatherPace: number
  overtaking: number
  smoothness: number
}

// Head-to-head record against one teammate over a span of races (career or a single season).
export interface H2HRecord {
  races: number
  qualSelf: number   // times this driver out-qualified the teammate
  qualMate: number
  raceSelf: number   // times finished ahead (both classified, no DNF)
  raceMate: number
  pointsSelf: number
  pointsMate: number
}

export interface TeammateH2HSeason extends H2HRecord {
  year: number
  teamName: string
}

export interface TeammateH2H extends H2HRecord {
  teammateId: string
  teammateName: string
  seasons: TeammateH2HSeason[] // per-season breakdown, most recent first
}

// One race on the Recent form line: pre-race form plus the result for the tooltip.
// Carries year so it can be ordered across season boundaries.
export interface RecentFormEntry {
  year: number
  round: number
  circuitName: string
  gridPosition: number
  finishPosition: number | null
  points: number
  form: number
  dnf: boolean
}

export interface DriverCareer {
  driverId: string
  driverName: string
  totals: { races: number; wins: number; podiums: number; points: number; poles: number; titles: number; seasons: number }
  seasons: CareerSeason[]
  ratingsHistory: RatingsPoint[]          // per-race attribute development (DB archived + live merged)
  recentForm: RecentFormEntry[]           // chronological per-race form (DB archived + live merged)
  teammateH2H: TeammateH2H[]              // complete career teammate head-to-head (DB archived + live merged)
  attributes: DriverAttributes | null     // live, from store, if on current grid
  currentResults: DriverCurrentResult[] | null  // live, from store
}

export interface TeamSeason {
  year: number
  finalPosition: number | null
  points: number
  wins: number
  podiums: number
  drivers: { driverId: string; driverName: string }[]
  inProgress: boolean
}

export interface TeamCareer {
  teamId: string
  teamName: string
  honours: { constructorTitles: number; titleYears: number[]; bestFinish: number | null }
  totals: { races: number; wins: number; podiums: number; points: number; seasons: number }
  seasons: TeamSeason[]
  currentSquad: { driverId: string; driverName: string; overall: number }[] | null  // live
  teamColor: string | null      // live
  carPace: number | null        // live
  currentPosition: number | null // live championship position
}

export interface SeasonChampionRow {
  year: number
  driverChampionId: string | null
  driverChampionName: string | null
  driverChampionTeamId: string | null
  constructorChampionId: string | null
  constructorChampionName: string | null
}

export interface LeaderboardEntry { id: string; name: string; value: number }
export interface AllTimeLeaders {
  driverWins: LeaderboardEntry[]; driverPodiums: LeaderboardEntry[]; driverPoints: LeaderboardEntry[]; driverTitles: LeaderboardEntry[]
  teamWins: LeaderboardEntry[]; teamPodiums: LeaderboardEntry[]; teamPoints: LeaderboardEntry[]; teamTitles: LeaderboardEntry[]
}

export interface WorldOverview {
  championsRoll: SeasonChampionRow[]
  leaders: AllTimeLeaders
  teamsDirectory: { teamId: string; teamName: string }[]
}

export interface SearchEntry { id: string; name: string; kind: 'driver' | 'team' }

// --- Drill-down detail (one driver/team in one season, and one full race) ---

export type Stint = { compound: TyreCompound; laps: number }

export interface DriverSeasonRace {
  round: number
  circuitId: string
  circuitName: string
  gridPosition: number
  finishPosition: number | null // null = DNF
  dnf: boolean
  points: number
  lapsCompleted: number
  q1: number | null // qualifying lap times, seconds
  q2: number | null
  q3: number | null
  stints: Stint[]
}

export interface DriverSeasonDetail {
  driverId: string
  driverName: string
  year: number
  teamId: string
  teamName: string
  championshipFinish: number | null
  inProgress: boolean
  totals: { races: number; wins: number; podiums: number; points: number; poles: number; dnfs: number }
  races: DriverSeasonRace[]
}

export interface TeamSeasonCar {
  driverId: string
  driverName: string
  gridPosition: number
  finishPosition: number | null
  dnf: boolean
  points: number
}

export interface TeamSeasonRace {
  round: number
  circuitId: string
  circuitName: string
  cars: TeamSeasonCar[]
  points: number // team's combined haul this round
}

export interface TeamSeasonDetail {
  teamId: string
  teamName: string
  year: number
  finalPosition: number | null
  inProgress: boolean
  totals: { races: number; wins: number; podiums: number; points: number }
  drivers: { driverId: string; driverName: string }[]
  races: TeamSeasonRace[]
}

export interface RaceClassificationRow {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  gridPosition: number
  finishPosition: number | null
  dnf: boolean
  points: number
  lapsCompleted: number
  totalTime: number | null
  q1: number | null
  q2: number | null
  q3: number | null
  stints: Stint[]
}

export interface RaceClassification {
  year: number
  round: number
  circuitId: string
  circuitName: string
  inProgress: boolean
  rows: RaceClassificationRow[] // finishers (by position) then DNFs
}
