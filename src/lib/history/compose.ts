import type { Driver, Team } from '@/lib/sim/types'
import { overall } from '@/lib/sim/progression'
import { historicalDrivers } from '@/data/history/drivers'
import { historicalGrids } from '@/data/history/grids'
import type { HistoricalDriver } from '@/data/history/types'

// Builds a season's Driver[]/Team[] from the real-world timeline. Mid-career drivers are
// fast-forwarded to the chosen start year by a deterministic (RNG-free) projection that mirrors the
// engine's race-by-race development curve (src/lib/sim/progression.ts), so the same start year always
// composes the same grid. From the start year on, the live engine takes over and history diverges.

const RACES_PER_SEASON = 22 // rough average 1996-2026; only used to pace the deterministic projection
type Stats = { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number }
const STAT_KEYS: (keyof Stats)[] = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness']
const round1 = (n: number) => Math.round(n * 10) / 10

// Expected-value (no-RNG) version of one applyRaceProgression tick for a single driver.
function stepRace(stats: Stats, age: number, peakPotential: number, primeEnd: number): Stats {
  const ov = overall(stats)
  const next = { ...stats }
  if (age < primeEnd) {
    if (ov >= peakPotential) return stats
    const yearsTillPrime = Math.max(0.001, primeEnd - age)
    const racesToPotential = Math.max(1, 20 * yearsTillPrime)
    const gap = peakPotential - ov
    const gain = Math.min(gap, (gap / racesToPotential) * 1.5) // per-race median
    for (const k of STAT_KEYS) next[k] = Math.min(100, round1(stats[k] + gain))
  } else {
    const declineMedian = 0.04 * (age - primeEnd + 1)
    for (const k of STAT_KEYS) next[k] = Math.max(20, round1(stats[k] - declineMedian))
  }
  return next
}

// Neutral placeholders for any rating not yet signed off, so bios can be encoded before the ratings
// pass. A driver with no ratings projects as a generic midfielder.
const DEFAULTS = { pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, peakPotential: 78, primeEnd: 31, narrativeModifier: 0 }
const peakOf = (h: HistoricalDriver) => h.peakPotential ?? DEFAULTS.peakPotential
const primeEndOf = (h: HistoricalDriver) => h.primeEnd ?? DEFAULTS.primeEnd

// Project a driver's ratings + age from market entry forward to `targetYear`.
export function projectToYear(h: HistoricalDriver, targetYear: number): { stats: Stats; age: number } {
  let stats: Stats = {
    pace: h.pace ?? DEFAULTS.pace, wetWeatherPace: h.wetWeatherPace ?? DEFAULTS.wetWeatherPace,
    overtaking: h.overtaking ?? DEFAULTS.overtaking, smoothness: h.smoothness ?? DEFAULTS.smoothness,
  }
  let age = h.ageAtEntry
  for (let y = h.marketEntryYear; y < targetYear; y++) {
    for (let r = 0; r < RACES_PER_SEASON; r++) stats = stepRace(stats, age, peakOf(h), primeEndOf(h))
    age += 1
  }
  return { stats, age }
}

function toDriver(h: HistoricalDriver, teamId: string, year: number): Driver {
  const { stats, age } = projectToYear(h, year)
  const seated = teamId !== ''
  return {
    id: h.id, name: h.name, teamId, nationality: h.nationality, gender: h.gender,
    pace: stats.pace, wetWeatherPace: stats.wetWeatherPace, overtaking: stats.overtaking, smoothness: stats.smoothness,
    age, peakPotential: peakOf(h), primeEnd: primeEndOf(h), narrativeModifier: h.narrativeModifier ?? DEFAULTS.narrativeModifier,
    // Seated drivers carry a short contract so the market doesn't churn the whole grid after year 1.
    contractExpiresAfterSeason: seated ? year + 1 : year - 1,
    seasonsSinceF1Seat: 0,
  }
}

// Constructors-championship order (best first) -> the engine's 75/70/65/... pace ranking.
function carPaceForRank(rank: number): number {
  return Math.max(5, 75 - rank * 5)
}

export function historyYears(): number[] {
  return historicalGrids.map((g) => g.year).sort((a, b) => a - b)
}

export function hasHistoryYear(year: number): boolean {
  return historicalGrids.some((g) => g.year === year)
}

// The last year for which the real-world driver dataset still feeds the market. Past this, there are
// no more real rookies, so the game falls back to generating fictional free agents.
export function lastDriverEntryYear(): number {
  return historicalDrivers.reduce((max, d) => Math.max(max, d.marketEntryYear), 0)
}

// The real drivers entering the market in `year`, as free agents (projected to that year). Used to
// feed the pool each season instead of generating fictional drivers, while the timeline has data.
export function rookiesForYear(year: number): Driver[] {
  return historicalDrivers.filter((d) => d.marketEntryYear === year).map((d) => toDriver(d, '', year))
}

// Build the full grid (seated drivers + that year's incoming rookies as free agents) and teams for a
// historical season. Returns null if there's no data for that year.
export function composeSeason(year: number): { drivers: Driver[]; teams: Team[] } | null {
  const grid = historicalGrids.find((g) => g.year === year)
  if (!grid) return null

  const byId = new Map(historicalDrivers.map((d) => [d.id, d]))
  // De-dupe teams by id defensively (a stray duplicate in the source must not double a constructor).
  const seenTeam = new Set<string>()
  const teams: Team[] = grid.teams
    .filter((t) => (seenTeam.has(t.id) ? false : (seenTeam.add(t.id), true)))
    .map((t, i) => ({ id: t.id, name: t.name, shortName: t.shortName, nationality: t.nationality, color: t.color, carPace: carPaceForRank(i) }))

  const seatedIds = new Set<string>()
  const drivers: Driver[] = []
  for (const seat of grid.lineup) {
    if (seatedIds.has(seat.driverId)) continue // never seat the same driver twice
    const h = byId.get(seat.driverId)
    if (!h) continue // unknown driver id in the lineup; skipped (data not yet filled)
    seatedIds.add(h.id)
    drivers.push(toDriver(h, seat.teamId, year))
  }
  // Real rookies who enter the market this exact year but aren't seated start as free agents.
  for (const h of historicalDrivers) {
    if (h.marketEntryYear === year && !seatedIds.has(h.id)) drivers.push(toDriver(h, '', year))
  }

  return { drivers, teams }
}
