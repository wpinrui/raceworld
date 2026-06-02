export type TyreCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet'
export type RacePhase = 'pre-qualifying' | 'qualifying' | 'pre-race' | 'racing' | 'finished'
export type SimSpeed = 1 | 2 | 3 | 4

export interface Driver {
  id: string
  name: string
  teamId: string
  nationality: string    // ISO 3166-1 alpha-2
  pace: number           // 0-100
  wetWeatherPace: number // 0-100
  overtaking: number     // 0-100
  smoothness: number     // 0-100
  age: number
  peakPotential: number
  primeEnd: number       // age at which decline starts
  narrativeModifier: number // -20 to +20
  contractExpiresAfterSeason: number
  seasonsSinceF1Seat?: number // consecutive seasons without an F1 seat; removed from the market at 5
}

export interface Team {
  id: string
  name: string
  shortName: string
  color: string          // primary hex
  carPace: number        // 75/70/65/60/55/50/45/40/35/30
}

export interface Circuit {
  id: string
  name: string
  location: string
  laps: number
  flatModifier: number   // seconds added to base laptime for cosmetic realism
}

export interface TyreState {
  compound: TyreCompound
  condition: number      // 0-100
  maxLifeLaps: number
}

export interface DriverRaceState {
  driverId: string
  position: number
  totalTime: number
  lapTimes: number[]
  currentTyre: TyreState
  stintLap: number
  fuelLaps: number
  form: number           // 0-10
  retired: boolean
  retirementLap: number | null
  lastPitLap: number
  pitStops: number
  stintHistory: Array<{ compound: TyreCompound; laps: number }>
  targetPitLap: number | null   // lap the team plans to pit; null = no planned stop
  targetNextCompound: TyreCompound
  gap: number            // gap to car directly ahead in seconds; leader = 0
  dsq: boolean
}

export interface QualifyingLap {
  driverId: string
  lap1: number | null
  lap2: number | null
  best: number | null
}

export interface QualifyingSessionResult {
  session: 'Q1' | 'Q2' | 'Q3'
  results: QualifyingLap[]
  eliminated: string[]
}

export interface QualifyingResult {
  driverId: string
  gridPosition: number
  bestTime: number | null
  q1Time: number | null
  q2Time: number | null
  q3Time: number | null
}

export interface CommentaryEntry {
  lap: number
  text: string
  type: 'pit' | 'overtake' | 'closing' | 'weather' | 'retirement' | 'finish' | 'info'
}

export interface WeatherPoint {
  lap: number
  moisture: number       // 0-1
}

// Per-team assumed tyre wear rates (condition lost per lap per compound).
// Sampled once at race start with noise — both drivers share the same team assumptions.
export type TeamTyreAssumptions = Record<TyreCompound, number>

export interface RaceState {
  circuitId: string
  totalLaps: number
  currentLap: number
  weather: WeatherPoint[]
  drivers: DriverRaceState[]
  commentary: CommentaryEntry[]
  phase: RacePhase
  qualifyingResults: QualifyingResult[]
  qualifyingSessions: QualifyingSessionResult[]
  speed: SimSpeed
  paused: boolean
  strategyNoise: number                                    // 0–1; tunable
  teamAssumptions: Record<string, TeamTyreAssumptions>     // teamId -> compound -> wear rate/lap
  trackCompat?: Record<string, number>                     // teamId -> 0–10 (5 neutral); (compat−5) adds to car pace this race
}

export interface GodModeAction {
  type: 'set-tyre-condition' | 'force-retire' | 'set-form' | 'force-pit' | 'cancel-pit'
  driverId: string
  value?: number
  compound?: TyreCompound  // used with force-pit
}

// --- Season / standings types ---

export type SeasonPhase =
  | 'idle'
  | 'pre-race'
  | 'post-race'
  | 'end-of-season'
  | 'contract-negotiations'
  | 'driver-retirements'
  | 'pre-season-testing'

// Off-season phases that run sequentially after the final race, each presenting
// its own slice of info before rolling into the next pre-season.
export const OFF_SEASON_PHASES: SeasonPhase[] = [
  'end-of-season',
  'contract-negotiations',
  'driver-retirements',
  'pre-season-testing',
]

export function isOffSeason(phase: SeasonPhase): boolean {
  return OFF_SEASON_PHASES.includes(phase)
}

export interface RaceResult {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  gridPosition: number
  finishPosition: number | null  // null = DNF
  points: number
  lapsCompleted: number
  totalTime: number | null
  dnf: boolean
  stints: Array<{ compound: TyreCompound; laps: number }>
  q1Time: number | null
  q2Time: number | null
  q3Time: number | null
}

export interface DriverStanding {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  points: number
  wins: number
  results: (number | null)[]  // finishPosition per round index; null = DNF or not yet raced
}

export interface ConstructorStanding {
  teamId: string
  teamName: string
  points: number
  wins: number
  results: (number | null)[][]  // [driverIdx][roundIdx]
}

// --- M3: Multi-season dynamics types ---

export type FundingTier = 1 | 2 | 3 | 4

export interface TeamDevPlan {
  teamId: string
  cycleLength: number          // 3–6 races per upgrade
  nextUpgradeRound: number
  fundingTier: FundingTier
  cumulativePenalty: number
}

export interface DevUpgradeEvent {
  teamId: string
  round: number
  paceDelta: number
  failed: boolean
}

export interface ConstructorSeasonRecord {
  seasonYear: number
  teamId: string
  finalPosition: number
  points: number
}

export interface DriverProgressionEvent {
  driverId: string
  driverName: string
  stat: 'pace' | 'wetWeatherPace' | 'overtaking' | 'smoothness'
  before: number
  after: number
  direction: 'improved' | 'declined' | 'unchanged'
}

export interface DriverMediaScore { driverId: string; score: number }
export interface TeamMediaScore   { teamId: string;   score: number }

// Full media breakdown for the power-rankings view — the component values that
// feed `media_score = 0.35·a + 0.45·b + 0.2·c + narrative + paceNarrative`.
export interface DriverMediaBreakdown {
  driverId: string
  a: number              // results percentile (grid only)
  b: number              // teammate H2H
  c: number              // car-adjusted overperformance
  narrative: number      // effective narrative: god-mode modifier after past-prime decay
  paceNarrative: number  // pace-derived swing (free agents only)
  score: number
}

export interface MarketMove {
  driverId: string
  driverName: string
  fromTeamId: string | null
  toTeamId: string
  toTeamName: string
  contractLength: number
  contractExpiresAfterSeason: number
  mediaScore: number
  isResignation: boolean   // re-signed with the same team (from === to)
}

export interface SeatContestDriver {
  driverId: string
  driverName: string
  teamPerceived: number   // the team's perceived value: driver media + incumbent bonus + noise
  incumbent: boolean      // the driver's expiring contract was with this team
}

// A driver whose contract expired and who was NOT re-signed anywhere — dropped
// to the free-agent pool this off-season.
export interface DroppedDriver {
  driverId: string
  driverName: string
  fromTeamId: string
  fromTeamName: string
  mediaScore: number
}

// A team's seat battle from the deferred-acceptance market — raw material for
// newsroom transfer stories. `winners` are who the team signed, `rivals` are the
// free agents it turned away; teamPerceived is the "why".
export interface SeatContest {
  teamId: string
  teamName: string
  seats: number                    // open seats the team was filling
  winners: SeatContestDriver[]     // signed, best-perceived first
  rivals: SeatContestDriver[]      // applied but turned away, best-perceived first
}

// Fuel load is revealed to the player only as a qualitative band, never the
// exact number — so a fast lap on a full tank reads as genuinely quick.
export type FuelBand = 'full' | 'heavy' | 'medium' | 'light'

export interface PreSeasonTestEntry {
  teamId: string
  teamName: string
  driverId: string
  driverName: string
  tyre: TyreCompound
  fuelBand: FuelBand
  lapTime: number   // simulated representative lap (seconds)
  carPace: number   // true new-season pace; only surfaced via god-mode reveal
}

export interface PreSeasonTest {
  circuitName: string
  entries: PreSeasonTestEntry[]   // sorted by lapTime ascending
}

export interface EndOfSeasonSummary {
  seasonYear: number
  driverChampion: string
  constructorChampion: string
  progressionEvents: DriverProgressionEvent[]
  retiredDriverIds: string[]
  carReshuffleOldPaces: Record<string, number>
  carReshuffleNewPaces: Record<string, number>
  marketMoves: MarketMove[]
  droppedDrivers: DroppedDriver[]
  seatContests: SeatContest[]
  driverMediaScores: DriverMediaScore[]
  teamMediaScores: TeamMediaScore[]
  upgradeEvents: DevUpgradeEvent[]
  preSeasonTest: PreSeasonTest | null
  // Per-driver finish vs car-pace expectation this season; drives re-sign offers.
  // Optional: saves serialized before this field existed won't have it (caller defaults to {}).
  retentionDelta?: Record<string, number>
}
