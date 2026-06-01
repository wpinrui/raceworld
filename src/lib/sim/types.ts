export type TyreCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet'
export type RacePhase = 'pre-qualifying' | 'qualifying' | 'pre-race' | 'racing' | 'finished'
export type SimSpeed = 1 | 2 | 3 | 4

export interface Driver {
  id: string
  name: string
  teamId: string
  pace: number           // 0-100
  wetWeatherPace: number // 0-100
  overtaking: number     // 0-100
  smoothness: number     // 0-100
  age: number
  peakPotential: number
  primeEnd: number       // age at which decline starts
  narrativeModifier: number // -20 to +20
  contractExpiresAfterSeason: number
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
}

export interface GodModeAction {
  type: 'set-tyre-condition' | 'force-retire' | 'set-form' | 'force-pit' | 'cancel-pit'
  driverId: string
  value?: number
  compound?: TyreCompound  // used with force-pit
}
