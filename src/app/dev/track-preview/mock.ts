// Fabricated race-day data for the track preview (#sim-overhaul phase 6 spike). Deterministic (no
// randomness: it renders on the server too) and plausible enough to exercise every real race-screen
// component: grid deltas, mixed compounds and wear, stint histories, a lapped car, a DNF, push states,
// a rain threat mid-race, commentary of every type, and championship baselines.

import type {
  Circuit, CommentaryEntry, ConstructorStanding, Driver, DriverRaceState, DriverStanding, RaceState, Team,
  TyreCompound, WeatherPoint,
} from '@/lib/sim/types'

export const MOCK_LAP = 30
export const MOCK_TOTAL_LAPS = 78

const TEAM_DEFS: Array<[string, string, string, string]> = [
  ['Crimson GP', 'CRI', '#DC143C', 'IT'],
  ['Meridian', 'MER', '#1E6FD9', 'GB'],
  ['Lagoon', 'LAG', '#00A19C', 'FR'],
  ['Sunburst', 'SUN', '#F58020', 'NL'],
  ['Violet Arrows', 'VIO', '#9B59B6', 'DE'],
  ['Verdant', 'VER', '#2ECC71', 'BR'],
  ['Aurum', 'AUR', '#E8B923', 'ES'],
  ['Rosa Corse', 'ROS', '#FF69B4', 'JP'],
  ['Terra', 'TER', '#8B4513', 'US'],
  ['Steel Racing', 'STL', '#5D6D7E', 'FI'],
]

export const MOCK_TEAMS: Team[] = TEAM_DEFS.map(([name, shortName, color, nationality], i) => ({
  id: `team-${i}`,
  name,
  shortName,
  nationality,
  color,
  carPace: 75 - i * 4,
}))

const DRIVER_DEFS: Array<[string, string]> = [
  ['L. Moreau', 'FR'], ['T. Kovac', 'HR'],
  ['R. Tanaka', 'JP'], ['J. Silva', 'BR'],
  ['M. Weber', 'DE'], ['A. Rossi', 'IT'],
  ['C. Andersen', 'DK'], ['P. Novak', 'CZ'],
  ['D. Fraser', 'GB'], ['S. Laine', 'FI'],
  ['E. Duarte', 'PT'], ['K. Nilsson', 'SE'],
  ['B. Carter', 'US'], ['H. Vermeulen', 'NL'],
  ['G. Petrov', 'BG'], ['O. Kim', 'KR'],
  ['F. Morales', 'ES'], ['W. Kowalski', 'PL'],
  ['N. Dubois', 'BE'], ['I. Farkas', 'HU'],
]

export const MOCK_DRIVERS: Driver[] = DRIVER_DEFS.map(([name, nationality], i) => ({
  id: `car-${i}`,
  name,
  teamId: `team-${Math.floor(i / 2)}`,
  nationality,
  gender: 'male',
  pace: 90 - i * 2,
  wetWeatherPace: 80,
  overtaking: 80,
  smoothness: 80,
  consistency: 80,
  age: 27,
  peakPotential: 92,
  primeEnd: 31,
  narrativeModifier: 0,
  contractExpiresAfterSeason: 2027,
}))

// Running order: mostly pace order with a few swaps so grid deltas show both colours.
const ORDER = [0, 2, 1, 4, 3, 5, 8, 6, 7, 10, 9, 12, 11, 13, 15, 14, 16, 17, 18, 19]
// Grid: another shuffle so (grid -> now) deltas vary.
const GRID = [1, 4, 2, 3, 6, 5, 10, 7, 9, 12, 8, 14, 11, 13, 17, 15, 16, 20, 18, 19]

export const MOCK_GRID: Record<string, number> = Object.fromEntries(
  ORDER.map((driverIdx, pos) => [`car-${driverIdx}`, GRID[pos]]),
)

const COMPOUND_CYCLE: TyreCompound[] = ['medium', 'soft', 'hard']

const LEADER_TOTAL = MOCK_LAP * 78.4

export const MOCK_STATES: DriverRaceState[] = ORDER.map((driverIdx, posIdx) => {
  const position = posIdx + 1
  const interval = position === 1 ? 0 : 0.3 + ((posIdx * 7) % 13) / 10
  // Cumulative deficit to the leader grows down the field.
  const behind = position === 1 ? 0 : posIdx * 1.9 + ((posIdx * 5) % 7) / 3
  const lapsDown = position === 19 ? 1 : 0
  const retired = position === 20
  const stopped = posIdx % 3 === 0
  const compound = COMPOUND_CYCLE[posIdx % 3]
  const stintLap = stopped ? 16 : MOCK_LAP
  const condition = Math.max(12, 88 - stintLap * 2 - ((posIdx * 3) % 9))
  const lastLap = 78.2 + ((posIdx * 11) % 17) / 12

  return {
    driverId: `car-${driverIdx}`,
    position,
    totalTime: LEADER_TOTAL + behind + lapsDown * 78.4,
    lapTimes: [lastLap],
    currentTyre: { compound, condition, maxLifeLaps: 30 },
    tyreTemp: 0.5,
    stintLap,
    fuelLaps: MOCK_TOTAL_LAPS - MOCK_LAP,
    form: 5,
    retired,
    retirementLap: retired ? 18 : null,
    retirementReason: retired ? 'engine' : null,
    mistakeCount: 0,
    worstMistakeLoss: 0,
    lastPitLap: stopped ? 14 : 0,
    pitStops: stopped ? 1 : 0,
    stintHistory: stopped ? [{ compound: 'soft', laps: 14 }] : [],
    targetPitLap: null,
    targetNextCompound: 'hard',
    gap: interval,
    lapsDown,
    dsq: false,
  }
})

// The mock player team (Sunburst, car-6 + car-7) gets live push/temp state so the pit wall cards read real.
{
  const byId = new Map(MOCK_STATES.map((s) => [s.driverId, s]))
  const c6 = byId.get('car-6')!
  c6.push = { kind: 'preset', preset: 'overtake' }
  c6.tyreTemp = 0.85
  c6.targetPitLap = 41
  const c7 = byId.get('car-7')!
  c7.push = { kind: 'manual', level: 0 }
  c7.autoDefend = true
  c7.defending = true
  c7.tyreTemp = 0.4
  c7.targetPitLap = 44
}

export const MOCK_CIRCUIT: Circuit = {
  id: 'monaco',
  name: 'Monaco Grand Prix',
  code: 'MON',
  location: 'Monte Carlo',
  country: 'MC',
  laps: MOCK_TOTAL_LAPS,
  flatModifier: -23,
  sundayOfYear: 21,
  straightness: 0.05,
}

// Dry race with a mid-race rain threat the forecast overcalls, so the weather graph has something to say.
const moistureAt = (lap: number) => (lap < 24 || lap > 52 ? 0.04 : 0.04 + 0.4 * Math.sin(((lap - 24) / 28) * Math.PI))
const MOCK_WEATHER: WeatherPoint[] = Array.from({ length: MOCK_TOTAL_LAPS }, (_, i) => ({
  lap: i + 1,
  moisture: Math.round(moistureAt(i + 1) * 100) / 100,
}))
const MOCK_FORECAST: WeatherPoint[] = MOCK_WEATHER.map(({ lap, moisture }) => ({
  lap,
  moisture: Math.min(1, Math.round(moisture * 1.5 * 100) / 100),
}))

const MOCK_COMMENTARY: CommentaryEntry[] = [
  { lap: 1, type: 'info', text: 'Lights out, the field streams through Sainte Devote without contact' },
  { lap: 8, type: 'closing', text: 'D. Fraser closes to within 1.2s of A. Rossi' },
  { lap: 14, type: 'pit', text: 'L. Moreau pits from the lead for mediums' },
  { lap: 18, type: 'retirement', text: 'I. Farkas retires, engine failure' },
  { lap: 23, type: 'weather', text: 'Drizzle reported at the chicane, moisture rising' },
  { lap: 27, type: 'overtake', text: 'R. Tanaka passes T. Kovac for P2 into the chicane' },
  { lap: 29, type: 'closing', text: 'B. Carter closes to within 0.8s of E. Duarte' },
]

export const MOCK_RACE_STATE: RaceState = {
  circuitId: 'monaco',
  year: 2026,
  totalLaps: MOCK_TOTAL_LAPS,
  currentLap: MOCK_LAP,
  weather: MOCK_WEATHER,
  weatherForecast: MOCK_FORECAST,
  drivers: MOCK_STATES,
  commentary: MOCK_COMMENTARY,
  phase: 'racing',
  qualifyingResults: [],
  qualifyingSessions: [],
  speed: 2,
  paused: false,
  strategyNoise: 0.5,
  compoundDeltas: { soft: -0.6, medium: 0, hard: 0.5, intermediate: 2.5, wet: 5 },
  tyreBaseLife: { soft: 0.25, medium: 0.35, hard: 0.5, intermediate: 0.4, wet: 0.45 },
  teamBeliefs: {},
  carForm: {},
}

// Championship baselines after 4 rounds: broadly the pace order with a few inversions so the live
// projection shows movement both ways.
const BASE_PTS = [82, 61, 74, 66, 48, 52, 38, 30, 41, 22, 26, 15, 18, 9, 12, 11, 4, 6, 1, 0]
const WINS: Record<number, number> = { 0: 3, 2: 1 }

export const MOCK_BASELINE_DRIVERS: DriverStanding[] = MOCK_DRIVERS
  .map((d, i) => ({
    driverId: d.id,
    driverName: d.name,
    teamId: d.teamId,
    teamName: MOCK_TEAMS.find((t) => t.id === d.teamId)?.name ?? '',
    points: BASE_PTS[i],
    wins: WINS[i] ?? 0,
    results: [],
  }))
  .sort((a, b) => b.points - a.points)

export const MOCK_BASELINE_CONSTRUCTORS: ConstructorStanding[] = MOCK_TEAMS
  .map((t, i) => ({
    teamId: t.id,
    teamName: t.name,
    points: BASE_PTS[i * 2] + BASE_PTS[i * 2 + 1],
    wins: (WINS[i * 2] ?? 0) + (WINS[i * 2 + 1] ?? 0),
    results: [[], []],
  }))
  .sort((a, b) => b.points - a.points)
