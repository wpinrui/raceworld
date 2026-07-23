// Fabricated race-day data for the track preview (#sim-overhaul phase 6 spike). Deterministic (no
// randomness: it renders on the server too) and plausible enough to exercise every RaceTable feature:
// grid deltas, mixed compounds and wear, stint histories, a lapped car, and a DNF.

import type { Driver, DriverRaceState, Team, TyreCompound } from '@/lib/sim/types'

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
