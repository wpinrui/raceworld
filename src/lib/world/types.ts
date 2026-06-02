// Client-safe DTOs for the World pages. These must NOT import from db/queries.ts
// (which pulls in better-sqlite3) so they can be used in client components.

export interface CareerSeason {
  year: number
  teamId: string
  teamName: string
  races: number
  wins: number
  podiums: number
  points: number
  championshipFinish: number | null
  inProgress: boolean
}

export interface DriverAttributes {
  pace: number
  wetWeatherPace: number
  overtaking: number
  smoothness: number
  overall: number
  age: number
  nationality: string
  teamId: string
  teamName: string
  contractExpiresAfterSeason: number
  isFreeAgent: boolean
}

export interface DriverCurrentResult {
  round: number
  circuitName: string
  finishPosition: number | null
  points: number
  dnf: boolean
}

export interface DriverCareer {
  driverId: string
  driverName: string
  totals: { races: number; wins: number; podiums: number; points: number; poles: number; titles: number; seasons: number }
  seasons: CareerSeason[]
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
